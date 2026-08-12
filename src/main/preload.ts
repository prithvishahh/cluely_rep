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
  /**
   * Ask the model a question. Tokens stream to `onToken`. Returns a cancel
   * function that aborts the generation and detaches listeners.
   */
  ask(prompt: string, handlers: AskHandlers): () => void {
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
    ipcRenderer.send("llm:ask", { id, prompt });

    return () => {
      ipcRenderer.send("llm:cancel", { id });
      cleanup();
    };
  },

  /** Fired when the global "ask" hotkey (Cmd/Ctrl+Enter) is pressed. */
  onAsk: (cb: () => void) => {
    ipcRenderer.on("action:ask", cb);
  },

  /** Fired when click-through mode toggles; passes the new state. */
  onClickThroughChanged: (cb: (clickThrough: boolean) => void) => {
    ipcRenderer.on("clickthrough:changed", (_e, v: boolean) => cb(v));
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
};

contextBridge.exposeInMainWorld("cluely", api);

export type CluelyApi = typeof api;
