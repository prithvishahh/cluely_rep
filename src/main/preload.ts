import { contextBridge, ipcRenderer } from "electron";
import { randomUUID } from "node:crypto";

export interface AskHandlers {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * The only surface the renderer can touch. Keeps nodeIntegration off while
 * exposing a tiny, typed API.
 */
const api = {
  /** Host platform, e.g. "darwin" | "win32" | "linux". */
  platform: process.platform,

  /** Resize the overlay window to fit the visible UI (keeps it tiny). */
  resize: (width: number, height: number) =>
    ipcRenderer.send("overlay:resize", { width, height }),

  /** Give the overlay keyboard focus so the user can type. */
  focusOverlay: () => ipcRenderer.send("overlay:focus"),

  /** Show / hide the whole overlay. */
  toggleHidden: () => ipcRenderer.send("overlay:toggle-hidden"),

  /**
   * Ask the model a question. Tokens stream to `onToken`. Returns a cancel
   * function that aborts the generation and detaches listeners. Set
   * `opts.useScreen` to include OCR'd screen contents as context.
   */
  ask(prompt: string, handlers: AskHandlers, opts: { useScreen?: boolean } = {}): () => void {
    const id = randomUUID();

    const onToken = (_e: unknown, m: { id: string; token: string }) => {
      if (m.id === id) handlers.onToken(m.token);
    };
    const onDone = (_e: unknown, m: { id: string }) => {
      if (m.id === id) cleanup(), handlers.onDone();
    };
    const onError = (_e: unknown, m: { id: string; message: string }) => {
      if (m.id === id) cleanup(), handlers.onError(m.message);
    };

    function cleanup() {
      ipcRenderer.off("llm:token", onToken);
      ipcRenderer.off("llm:done", onDone);
      ipcRenderer.off("llm:error", onError);
    }

    ipcRenderer.on("llm:token", onToken);
    ipcRenderer.on("llm:done", onDone);
    ipcRenderer.on("llm:error", onError);
    ipcRenderer.send("llm:ask", { id, prompt, useScreen: opts.useScreen ?? false });

    return () => {
      ipcRenderer.send("llm:cancel", { id });
      cleanup();
    };
  },

  /** Fired when the global "ask" hotkey (Cmd/Ctrl+Enter) is pressed. */
  onAsk: (cb: () => void) => {
    ipcRenderer.on("action:ask", cb);
  },

  /** Fired when the "ask about screen" hotkey (Cmd/Ctrl+Shift+Enter) is pressed. */
  onAskScreen: (cb: () => void) => {
    ipcRenderer.on("action:ask-screen", cb);
  },

  /** Fired for each new transcript segment from the live meeting audio. */
  onTranscriptSegment: (cb: (text: string) => void) => {
    ipcRenderer.on("transcript:segment", (_e, text: string) => cb(text));
  },

  /** Fired when the audio/transcription pipeline status changes. */
  onAudioStatus: (
    cb: (status: { active: boolean; reason?: string }) => void,
  ) => {
    ipcRenderer.on("audio:status", (_e, s) => cb(s));
  },

  /** (Windows) Main asks the renderer to start capturing loopback audio. */
  onStartCapture: (cb: () => void) => {
    ipcRenderer.on("audio:capture-start", cb);
  },

  /** (Windows) Send captured PCM (16 kHz mono 16-bit) to the transcriber. */
  sendAudioPcm: (pcm: ArrayBuffer) => {
    ipcRenderer.send("audio:pcm", pcm);
  },

  /** Knowledge grounding: uploaded reference docs. */
  knowledge: {
    list: (): Promise<string[]> => ipcRenderer.invoke("knowledge:list"),
    /** Opens a file picker; resolves with the new list of doc names. */
    add: (): Promise<string[]> => ipcRenderer.invoke("knowledge:add"),
    clear: (): Promise<string[]> => ipcRenderer.invoke("knowledge:clear"),
    onChanged: (cb: (names: string[]) => void) => {
      ipcRenderer.on("knowledge:changed", (_e, names: string[]) => cb(names));
    },
  },
};

contextBridge.exposeInMainWorld("cluely", api);

export type CluelyApi = typeof api;
