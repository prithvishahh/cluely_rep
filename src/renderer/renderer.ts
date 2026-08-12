import type { CluelyApi } from "../main/preload";
import { startLoopbackCapture } from "./capture";

declare global {
  interface Window {
    cluely: CluelyApi;
  }
}

const bar = document.getElementById("bar") as HTMLElement;
const panel = document.getElementById("panel") as HTMLElement;
const answerEl = document.getElementById("answer") as HTMLElement;
const promptEl = document.getElementById("prompt") as HTMLInputElement;
const sendEl = document.getElementById("send") as HTMLButtonElement;
const askBtn = document.getElementById("askBtn") as HTMLButtonElement;
const screenBtn = document.getElementById("screenBtn") as HTMLButtonElement;
const hideBtn = document.getElementById("hideBtn") as HTMLButtonElement;
const kbBtn = document.getElementById("kbBtn") as HTMLButtonElement;
const kbCount = document.getElementById("kbCount") as HTMLElement;
const actionsEl = document.getElementById("actions") as HTMLElement;
const transcriptEl = document.getElementById("transcript") as HTMLElement;
const audioDot = document.getElementById("audioDot") as HTMLElement;
const timerEl = document.getElementById("timer") as HTMLElement;

const isMac = window.cluely.platform === "darwin";
const MOD = isMac ? "⌘" : "Ctrl";

// ── Keycap hints (platform-aware) ────────────────────────────────────────
for (const el of Array.from(document.querySelectorAll<HTMLElement>(".keys"))) {
  const keys = (el.dataset.keys ?? "").split(",").filter(Boolean);
  el.innerHTML = keys
    .map((k) => `<kbd>${k === "mod" ? MOD : k}</kbd>`)
    .join("");
}

// ── Interactivity: pass clicks through except over the bar/panel ─────────
// The main process ignores the mouse by default (so the overlay never blocks
// the app behind it); we flip it on whenever the pointer is over real UI.
let interactive = false;
function setInteractive(on: boolean): void {
  if (on === interactive) return;
  interactive = on;
  window.cluely.setInteractive(on);
}
window.addEventListener("mousemove", (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  setInteractive(!!el?.closest(".interactive"));
});
// If the pointer leaves the window entirely, go back to pass-through.
window.addEventListener("mouseleave", () => setInteractive(false));

// ── Panel ────────────────────────────────────────────────────────────────
function openPanel(): void {
  panel.hidden = false;
}

// ── Ask flow ─────────────────────────────────────────────────────────────
let cancelCurrent: (() => void) | null = null;

function ask(prompt: string, useScreen = false): void {
  const q = prompt.trim();
  if (!q) return;
  openPanel();
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

function focusPrompt(): void {
  openPanel();
  window.cluely.focusOverlay();
  setTimeout(() => promptEl.focus(), 30);
}

askBtn.addEventListener("click", focusPrompt);
sendEl.addEventListener("click", () => ask(promptEl.value || "What should I say next?"));
screenBtn.addEventListener("click", () =>
  ask(promptEl.value || "Answer the question or problem shown on screen.", true),
);
hideBtn.addEventListener("click", () => window.cluely.toggleHidden());

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    ask(promptEl.value || "What should I say next?");
    promptEl.value = "";
  }
});

// Global hotkeys (from the main process).
window.cluely.onAsk(() => ask(promptEl.value || "What should I say next?"));
window.cluely.onAskScreen(() =>
  ask(promptEl.value || "Answer the question or problem shown on screen.", true),
);

// ── One-tap action chips ─────────────────────────────────────────────────
interface Action {
  label: string;
  prompt: string;
  useScreen?: boolean;
}
const ACTIONS: Action[] = [
  { label: "Say next", prompt: "What should I say next? Give a concise line I can say out loud." },
  { label: "Follow-ups", prompt: "Suggest 3 sharp follow-up questions I could ask right now." },
  { label: "Fact-check", prompt: "Fact-check the most recent claims. Flag anything wrong with the correction." },
  { label: "Who", prompt: "Who am I talking to and what do they likely want? Infer from the conversation." },
  { label: "Recap", prompt: "Recap the conversation so far: key points, decisions, and open items." },
  { label: "Explain screen", prompt: "Explain what's on screen, and answer any question or problem shown.", useScreen: true },
];
for (const action of ACTIONS) {
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.textContent = action.label;
  chip.addEventListener("click", () => ask(action.prompt, action.useScreen));
  actionsEl.appendChild(chip);
}

// ── Live transcript ──────────────────────────────────────────────────────
const MAX_SEGMENTS = 12;
window.cluely.onTranscriptSegment((text) => {
  openPanel();
  transcriptEl.hidden = false;
  const seg = document.createElement("div");
  seg.className = "seg-line";
  seg.textContent = text;
  transcriptEl.appendChild(seg);
  while (transcriptEl.childElementCount > MAX_SEGMENTS) {
    transcriptEl.firstElementChild?.remove();
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
});

// ── Audio status + listen timer ──────────────────────────────────────────
let timerHandle: number | null = null;
let startedAt = 0;
function startTimer(): void {
  if (timerHandle !== null) return;
  startedAt = Date.now();
  timerEl.hidden = false;
  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    timerEl.textContent = `${mm}:${ss}`;
  };
  tick();
  timerHandle = window.setInterval(tick, 1000);
}
function stopTimer(): void {
  if (timerHandle !== null) window.clearInterval(timerHandle);
  timerHandle = null;
  timerEl.hidden = true;
}

window.cluely.onAudioStatus((status) => {
  audioDot.classList.toggle("live", status.active);
  if (status.active) startTimer();
  else stopTimer();
  const listenBtn = document.getElementById("listenBtn") as HTMLElement;
  listenBtn.title = status.active
    ? "Transcribing live audio"
    : `Transcription off — ${status.reason ?? "unavailable"}`;
});

// ── Knowledge grounding ──────────────────────────────────────────────────
function renderKnowledge(names: string[]): void {
  const n = names.length;
  kbCount.hidden = n === 0;
  kbCount.textContent = String(n);
  kbBtn.title = n
    ? `${n} doc${n > 1 ? "s" : ""}: ${names.join(", ")} — click to add, shift-click to clear`
    : "Add reference material (résumé, docs)";
}
kbBtn.addEventListener("click", async (e) => {
  const names = e.shiftKey
    ? await window.cluely.knowledge.clear()
    : await window.cluely.knowledge.add();
  renderKnowledge(names);
});
window.cluely.knowledge.onChanged(renderKnowledge);
window.cluely.knowledge.list().then(renderKnowledge);

// Windows: begin loopback audio capture when main signals readiness.
window.cluely.onStartCapture(() => void startLoopbackCapture());

void bar; // referenced for clarity; interactivity handled via .interactive
