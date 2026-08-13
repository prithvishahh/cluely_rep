import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
  session,
} from "electron";
import path from "node:path";
import { streamAnswer, type ChatMessage } from "./llm";
import {
  isPaused,
  needsRendererCapture,
  pushRendererPcm,
  setPaused,
  startAudioPipeline,
  type PipelineStatus,
} from "./audio";
import { captureScreen } from "./screen";
import { ocr, disposeOcr } from "./ocr";
import {
  addFiles,
  clearKnowledge,
  contextText,
  initKnowledge,
  listNames,
} from "./knowledge";

const isDev = process.argv.includes("--dev");

let overlay: BrowserWindow | null = null;
let stopAudio: (() => void) | null = null;
// Once the user drags the bar, stop auto-centering on resize.
let userMoved = false;

// ── Rolling transcript. ──────────────────────────────────────────────────
// Keeps the most recent speech so the LLM can answer "in context" of the call.
const TRANSCRIPT_MAX_CHARS = 4000;
let transcript = "";

function addSegment(text: string): void {
  transcript = (transcript + " " + text).trim();
  if (transcript.length > TRANSCRIPT_MAX_CHARS) {
    transcript = transcript.slice(-TRANSCRIPT_MAX_CHARS);
  }
  overlay?.webContents.send("transcript:segment", text);
}

function sendAudioStatus(status: PipelineStatus): void {
  overlay?.webContents.send("audio:status", status);
}

/**
 * Creates the overlay window. Everything here is in service of one goal:
 * a window that floats above all other apps, never steals focus, and is
 * excluded from screen-share capture.
 */
function createOverlay(): void {
  const primary = screen.getPrimaryDisplay();
  const area = primary.workArea;

  // Small window centered at the top; the renderer resizes it to fit its
  // content (bar, or bar + panel). Kept tight so it never covers the meeting.
  const winWidth = 360;
  const winHeight = 70;

  overlay = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    // Position: horizontally centered, near the top edge.
    x: Math.round(area.x + (area.width - winWidth) / 2),
    y: area.y + 6,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    // On macOS this keeps the window out of the app-switcher / mission control.
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Preload uses ipcRenderer only; keep it out of the sandbox so the
      // context bridge always loads (a sandboxed preload can't require node).
      sandbox: false,
    },
  });

  // ── The invisibility. ────────────────────────────────────────────────
  // Cross-platform wrapper over macOS NSWindow.sharingType = .none and
  // Windows SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE). Screen-share
  // and most recorders composite the frame WITHOUT this window.
  overlay.setContentProtection(true);

  // Float above other windows without the extreme "screen-saver" level, which
  // can interfere with input focus on Windows.
  overlay.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") {
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  overlay.loadFile(path.join(__dirname, "index.html"));

  if (isDev) {
    overlay.webContents.openDevTools({ mode: "detach" });
  }

  // Start transcription once the renderer can receive status/segment events.
  overlay.webContents.on("did-finish-load", () => {
    stopAudio?.();
    stopAudio = startAudioPipeline({
      onSegment: addSegment,
      onStatus: sendAudioStatus,
    });
    // On Windows the renderer supplies loopback audio; tell it to start.
    if (needsRendererCapture()) overlay?.webContents.send("audio:capture-start");
  });

  // If the user drags the bar, remember it so resizes don't re-center.
  overlay.on("moved", () => {
    userMoved = true;
  });

  overlay.on("closed", () => {
    stopAudio?.();
    stopAudio = null;
    overlay = null;
  });
}

function toggleVisibility(): void {
  if (!overlay) return;
  if (overlay.isVisible()) overlay.hide();
  else overlay.showInactive(); // show without stealing focus
}

function registerShortcuts(): void {
  // Ask for an answer (the core Cluely gesture).
  globalShortcut.register("CommandOrControl+Enter", () => {
    if (!overlay) return;
    overlay.showInactive();
    overlay.webContents.send("action:ask");
  });

  // Ask using what's on screen (capture + OCR as context).
  globalShortcut.register("CommandOrControl+Shift+Enter", () => {
    if (!overlay) return;
    overlay.showInactive();
    overlay.webContents.send("action:ask-screen");
  });

  // Show / hide the overlay entirely.
  globalShortcut.register("CommandOrControl+\\", () => {
    toggleVisibility();
  });
}

// ── Answer layer. ─────────────────────────────────────────────────────────
// Streams tokens from a local model. Each request carries an id so the
// renderer can correlate tokens and cancel in-flight generations. A rolling
// chat history enables multi-turn follow-ups.
const inflight = new Map<string, AbortController>();
const CHAT_HISTORY_MAX = 8; // messages (user/assistant), not turns
let chatHistory: ChatMessage[] = [];

ipcMain.on(
  "llm:ask",
  async (evt, req: { id: string; prompt: string; useScreen?: boolean }) => {
    const { id, prompt, useScreen } = req;
    const controller = new AbortController();
    inflight.set(id, controller);

    // Optionally read the screen (capture + OCR) for on-screen context.
    let screenText = "";
    if (useScreen) {
      try {
        const png = await captureScreen();
        if (png) screenText = await ocr(png);
      } catch (err) {
        console.error("[ocr]", (err as Error).message);
      }
    }

    let answer = "";
    try {
      for await (const token of streamAnswer(prompt, {
        signal: controller.signal,
        transcript,
        screen: screenText,
        knowledge: contextText(),
        history: chatHistory,
      })) {
        if (evt.sender.isDestroyed()) break;
        answer += token;
        evt.sender.send("llm:token", { id, token });
      }
      // Record the turn (plain prompt + answer) for follow-up context.
      chatHistory.push({ role: "user", content: prompt });
      chatHistory.push({ role: "assistant", content: answer });
      if (chatHistory.length > CHAT_HISTORY_MAX) {
        chatHistory = chatHistory.slice(-CHAT_HISTORY_MAX);
      }
      if (!evt.sender.isDestroyed()) evt.sender.send("llm:done", { id });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      if (!evt.sender.isDestroyed()) {
        evt.sender.send("llm:error", { id, message: (err as Error).message });
      }
    } finally {
      inflight.delete(id);
    }
  },
);

ipcMain.on("llm:cancel", (_evt, req: { id: string }) => {
  inflight.get(req.id)?.abort();
  inflight.delete(req.id);
});

// Start a fresh conversation (clear multi-turn history).
ipcMain.on("chat:reset", () => {
  chatHistory = [];
});

// Windows loopback audio streamed from the renderer (16 kHz mono 16-bit PCM).
ipcMain.on("audio:pcm", (_evt, chunk: ArrayBuffer) => {
  pushRendererPcm(Buffer.from(chunk));
});

// ── Overlay window controls. ─────────────────────────────────────────────
// The renderer measures its content and asks us to resize; we keep the window
// centered at the top of the screen. Small window == never blocks the meeting.
ipcMain.on("overlay:resize", (_evt, size: { width: number; height: number }) => {
  if (!overlay) return;
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.max(200, Math.min(Math.round(size.width), area.width));
  const height = Math.max(48, Math.min(Math.round(size.height), area.height - 16));
  if (userMoved) {
    // Keep the user's chosen position; only change the size.
    const [x, y] = overlay.getPosition();
    overlay.setBounds({ x, y, width, height });
  } else {
    overlay.setBounds({
      x: Math.round(area.x + (area.width - width) / 2),
      y: area.y + 6,
      width,
      height,
    });
  }
});

ipcMain.on("overlay:focus", () => {
  overlay?.show(); // brings to front + gives keyboard focus so the user can type
});

ipcMain.on("overlay:toggle-hidden", () => {
  if (!overlay) return;
  if (overlay.isVisible()) overlay.hide();
  else overlay.showInactive();
});

// Manually pause/resume live transcription (the Listen toggle).
ipcMain.on("audio:toggle", () => {
  const nowPaused = !isPaused();
  setPaused(nowPaused);
  sendAudioStatus({
    active: !nowPaused,
    reason: nowPaused ? "paused" : undefined,
  });
});

// ── Knowledge grounding (Milestone 6). ──────────────────────────────────
ipcMain.handle("knowledge:list", () => listNames());

ipcMain.handle("knowledge:add", async () => {
  const res = await dialog.showOpenDialog({
    title: "Add reference material",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Documents", extensions: ["pdf", "txt", "md", "markdown", "json", "csv", "log"] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return listNames();
  const names = await addFiles(res.filePaths);
  overlay?.webContents.send("knowledge:changed", names);
  return names;
});

ipcMain.handle("knowledge:clear", async () => {
  const names = await clearKnowledge();
  overlay?.webContents.send("knowledge:changed", names);
  return names;
});

app.whenReady().then(() => {
  // Hide the dock icon on macOS so nothing hints at the app's presence.
  if (process.platform === "darwin" && app.dock) app.dock.hide();

  initKnowledge();

  // Grant system-audio (loopback) capture to the renderer without a picker.
  // 'loopback' captures system audio on Windows; a video source is required by
  // the API even though the renderer discards it.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        if (sources.length === 0) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: "loopback" });
      });
    },
    { useSystemPicker: false },
  );

  createOverlay();
  registerShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlay();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopAudio?.();
  void disposeOcr();
});

// Keep running with no visible windows (overlay may be hidden).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
