import { contextBridge, ipcRenderer } from "electron";

/**
 * The only surface the renderer can touch. Keeps nodeIntegration off while
 * exposing a tiny, typed API.
 */
const api = {
  /** Ask the model a question; resolves with the answer text. */
  ask: (prompt: string): Promise<string> => ipcRenderer.invoke("llm:ask", prompt),

  /** Fired when the global "ask" hotkey (Cmd/Ctrl+Enter) is pressed. */
  onAsk: (cb: () => void) => {
    ipcRenderer.on("action:ask", cb);
  },

  /** Fired when click-through mode toggles; passes the new state. */
  onClickThroughChanged: (cb: (clickThrough: boolean) => void) => {
    ipcRenderer.on("clickthrough:changed", (_e, v: boolean) => cb(v));
  },
};

contextBridge.exposeInMainWorld("cluely", api);

export type CluelyApi = typeof api;
