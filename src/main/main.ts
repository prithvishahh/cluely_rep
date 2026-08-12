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
import { streamAnswer } from "./llm";
import {
  needsRendererCapture,
  pushRendererPcm,
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

  // A wide, short window centered at the top of the screen. It's mostly
  // transparent — just the centered bar (and the panel that drops below it).
  const winWidth = 780;
  const winHeight = 640;

  overlay = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    // Position: horizontally centered, near the top edge.
    x: Math.round(area.x + (area.width - winWidth) / 2),
    y: area.y + 6,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
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
    },
  });

  // ── The invisibility. ────────────────────────────────────────────────
  // Cross-platform wrapper over macOS NSWindow.sharingType = .none and
  // Windows SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE). Screen-share
  // and most recorders composite the frame WITHOUT this window.
  overlay.setContentProtection(true);

  // Float above fullscreen apps (meetings are often fullscreen) and every space.
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Pass the mouse through by default; the renderer flips this on when the
  // pointer is over the bar/panel, so the overlay never blocks the app behind
  // it but is still fully clickable where it matters.
  overlay.setIgnoreMouseEvents(true, { forward: true });

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

// ── Answer layer (Milestone 2). ──────────────────────────────────────────
// Streams tokens from a local model. Each request carries an id so the
// renderer can correlate tokens and cancel in-flight generations.
const inflight = new Map<string, AbortController>();

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

    try {
      for await (const token of streamAnswer(prompt, {
        signal: controller.signal,
        transcript,
        screen: screenText,
        knowledge: contextText(),
      })) {
        if (evt.sender.isDestroyed()) break;
        evt.sender.send("llm:token", { id, token });
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

// Windows loopback audio streamed from the renderer (16 kHz mono 16-bit PCM).
ipcMain.on("audio:pcm", (_evt, chunk: ArrayBuffer) => {
  pushRendererPcm(Buffer.from(chunk));
});

// ── Overlay window controls. ─────────────────────────────────────────────
// Renderer flips mouse capture on/off based on whether the pointer is over UI.
ipcMain.on("overlay:interactive", (_evt, on: boolean) => {
  overlay?.setIgnoreMouseEvents(!on, { forward: true });
});

ipcMain.on("overlay:focus", () => {
  overlay?.show(); // brings to front + gives keyboard focus so the user can type
});

ipcMain.on("overlay:toggle-hidden", () => {
  if (!overlay) return;
  if (overlay.isVisible()) overlay.hide();
  else overlay.showInactive();
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
