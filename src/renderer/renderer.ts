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

async function ask(prompt: string): Promise<void> {
  const q = prompt.trim();
  if (!q) return;

  answerEl.classList.add("thinking");
  answerEl.textContent = "thinking…";

  try {
    const answer = await window.cluely.ask(q);
    answerEl.classList.remove("thinking");
    answerEl.textContent = answer;
  } catch (err) {
    answerEl.classList.remove("thinking");
    answerEl.textContent = `error: ${(err as Error).message}`;
  }
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
