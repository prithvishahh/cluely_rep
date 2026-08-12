import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
} from "electron";
import path from "node:path";
import { streamAnswer } from "./llm";

const isDev = process.argv.includes("--dev");

let overlay: BrowserWindow | null = null;
// When click-through is on, mouse events pass to the app behind the overlay.
let clickThrough = true;

/**
 * Creates the overlay window. Everything here is in service of one goal:
 * a window that floats above all other apps, never steals focus, and is
 * excluded from screen-share capture.
 */
function createOverlay(): void {
  const primary = screen.getPrimaryDisplay();
  const { width } = primary.workAreaSize;

  const winWidth = 460;
  const winHeight = 600;

  overlay = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    // Position: top-right, slightly inset.
    x: width - winWidth - 24,
    y: 48,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    // Don't grab focus when it appears — critical so the meeting stays active.
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

  // Start in click-through mode so the overlay never blocks the app behind it.
  overlay.setIgnoreMouseEvents(clickThrough, { forward: true });

  overlay.loadFile(path.join(__dirname, "index.html"));

  if (isDev) {
    overlay.webContents.openDevTools({ mode: "detach" });
  }

  overlay.on("closed", () => {
    overlay = null;
  });
}

function toggleVisibility(): void {
  if (!overlay) return;
  if (overlay.isVisible()) overlay.hide();
  else overlay.showInactive(); // show without stealing focus
}

function toggleClickThrough(): void {
  if (!overlay) return;
  clickThrough = !clickThrough;
  overlay.setIgnoreMouseEvents(clickThrough, { forward: true });
  overlay.webContents.send("clickthrough:changed", clickThrough);
}

function registerShortcuts(): void {
  // Ask for an answer (the core Cluely gesture).
  globalShortcut.register("CommandOrControl+Enter", () => {
    if (!overlay) return;
    overlay.showInactive();
    overlay.webContents.send("action:ask");
  });

  // Show / hide the overlay entirely.
  globalShortcut.register("CommandOrControl+\\", () => {
    toggleVisibility();
  });

  // Toggle whether the overlay is interactive (to type) vs click-through.
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    toggleClickThrough();
    if (overlay && !clickThrough) overlay.focus(); // let the user type
  });
}

// ── Answer layer (Milestone 2). ──────────────────────────────────────────
// Streams tokens from a local model. Each request carries an id so the
// renderer can correlate tokens and cancel in-flight generations.
const inflight = new Map<string, AbortController>();

ipcMain.on("llm:ask", async (evt, req: { id: string; prompt: string }) => {
  const { id, prompt } = req;
  const controller = new AbortController();
  inflight.set(id, controller);
  try {
    for await (const token of streamAnswer(prompt, { signal: controller.signal })) {
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
});

ipcMain.on("llm:cancel", (_evt, req: { id: string }) => {
  inflight.get(req.id)?.abort();
  inflight.delete(req.id);
});

app.whenReady().then(() => {
  // Hide the dock icon on macOS so nothing hints at the app's presence.
  if (process.platform === "darwin" && app.dock) app.dock.hide();

  createOverlay();
  registerShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlay();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Keep running with no visible windows (overlay may be hidden).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
