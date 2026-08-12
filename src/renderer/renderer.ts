import type { CluelyApi } from "../main/preload";

declare global {
  interface Window {
    cluely: CluelyApi;
  }
}

const answerEl = document.getElementById("answer") as HTMLElement;
const promptEl = document.getElementById("prompt") as HTMLInputElement;
const sendEl = document.getElementById("send") as HTMLButtonElement;
const screenBtn = document.getElementById("screenBtn") as HTMLButtonElement;
const modeHintEl = document.getElementById("modeHint") as HTMLElement;
const transcriptEl = document.getElementById("transcript") as HTMLElement;
const audioDot = document.getElementById("audioDot") as HTMLElement;

let cancelCurrent: (() => void) | null = null;

function ask(prompt: string, useScreen = false): void {
  const q = prompt.trim();
  if (!q) return;

  // Cancel any generation still in flight.
  cancelCurrent?.();

  answerEl.classList.add("thinking");
  answerEl.textContent = useScreen ? "reading screen…" : "thinking…";
  let first = true;

  cancelCurrent = window.cluely.ask(
    q,
    {
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
    },
    { useScreen },
  );
}

sendEl.addEventListener("click", () => ask(promptEl.value));
screenBtn.addEventListener("click", () =>
  ask(promptEl.value || "Answer the question or problem shown on screen.", true),
);

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") ask(promptEl.value);
});

// Global Cmd/Ctrl+Enter: answer using the live transcript context.
window.cluely.onAsk(() => ask(promptEl.value || "What should I say next?"));

// Global Cmd/Ctrl+Shift+Enter: answer using what's on screen.
window.cluely.onAskScreen(() =>
  ask(promptEl.value || "Answer the question or problem shown on screen.", true),
);

// Reflect click-through state in the header so the user knows if they can type.
window.cluely.onClickThroughChanged((clickThrough) => {
  modeHintEl.textContent = clickThrough ? "click-through" : "interactive";
  if (!clickThrough) promptEl.focus();
});

// Live transcript from meeting audio.
const MAX_SEGMENTS = 12;
window.cluely.onTranscriptSegment((text) => {
  transcriptEl.hidden = false;
  const seg = document.createElement("div");
  seg.className = "seg";
  seg.textContent = text;
  transcriptEl.appendChild(seg);
  while (transcriptEl.childElementCount > MAX_SEGMENTS) {
    transcriptEl.firstElementChild?.remove();
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
});

// Audio pipeline status → the header dot + tooltip.
window.cluely.onAudioStatus((status) => {
  audioDot.classList.toggle("live", status.active);
  audioDot.title = status.active
    ? "transcribing live audio"
    : `transcription off — ${status.reason ?? "unavailable"}`;
});
