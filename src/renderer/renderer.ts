import type { CluelyApi } from "../main/preload";

declare global {
  interface Window {
    cluely: CluelyApi;
  }
}

const answerEl = document.getElementById("answer") as HTMLElement;
const promptEl = document.getElementById("prompt") as HTMLInputElement;
const sendEl = document.getElementById("send") as HTMLButtonElement;
const modeHintEl = document.getElementById("modeHint") as HTMLElement;

let cancelCurrent: (() => void) | null = null;

function ask(prompt: string): void {
  const q = prompt.trim();
  if (!q) return;

  // Cancel any generation still in flight.
  cancelCurrent?.();

  answerEl.classList.add("thinking");
  answerEl.textContent = "thinking…";
  let first = true;

  cancelCurrent = window.cluely.ask(q, {
    onToken: (token) => {
      if (first) {
        answerEl.classList.remove("thinking");
        answerEl.textContent = "";
        first = false;
      }
      answerEl.textContent += token;
      answerEl.scrollTop = answerEl.scrollHeight;
    },
    onDone: () => {
      cancelCurrent = null;
      if (first) {
        // Stream ended with no tokens.
        answerEl.classList.remove("thinking");
        answerEl.textContent = "(no response)";
      }
    },
    onError: (message) => {
      cancelCurrent = null;
      answerEl.classList.remove("thinking");
      answerEl.textContent = message;
    },
  });
}

sendEl.addEventListener("click", () => ask(promptEl.value));

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") ask(promptEl.value);
});

// Global Cmd/Ctrl+Enter: answer whatever is in the box (later: use live context).
window.cluely.onAsk(() => ask(promptEl.value || "Summarize what's on screen."));

// Reflect click-through state in the header so the user knows if they can type.
window.cluely.onClickThroughChanged((clickThrough) => {
  modeHintEl.textContent = clickThrough ? "click-through" : "interactive";
  if (!clickThrough) promptEl.focus();
});
