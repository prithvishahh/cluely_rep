import type { CluelyApi } from "../main/preload";
import { startLoopbackCapture } from "./capture";

declare global {
  interface Window {
    cluely: CluelyApi;
  }
}

// If the preload bridge failed to load, surface it instead of a dead UI.
if (!window.cluely) {
  document.body.innerHTML =
    '<div style="margin:10px auto;max-width:320px;padding:10px 14px;background:#3a1d1d;' +
    "color:#ffd7d7;font:12px/1.4 system-ui;border-radius:12px;text-align:center\">" +
    "Bridge failed to load — please restart the app.</div>";
  throw new Error("cluely bridge unavailable");
}

const bar = document.getElementById("bar") as HTMLElement;
const panel = document.getElementById("panel") as HTMLElement;
const answerEl = document.getElementById("answer") as HTMLElement;
const qbubble = document.getElementById("qbubble") as HTMLElement;
const promptEl = document.getElementById("prompt") as HTMLInputElement;
const sendEl = document.getElementById("send") as HTMLButtonElement;
const askBtn = document.getElementById("askBtn") as HTMLButtonElement;
const hideBtn = document.getElementById("hideBtn") as HTMLButtonElement;
const kbBtn = document.getElementById("kbBtn") as HTMLButtonElement;
const kbCount = document.getElementById("kbCount") as HTMLElement;
const actionsEl = document.getElementById("actions") as HTMLElement;
const transcriptEl = document.getElementById("transcript") as HTMLElement;
const audioDot = document.getElementById("audioDot") as HTMLElement;
const timerEl = document.getElementById("timer") as HTMLElement;

const isMac = window.cluely.platform === "darwin";
const MOD = isMac ? "⌘" : "Ctrl";

// Platform-aware keycaps in the bar.
for (const el of Array.from(document.querySelectorAll<HTMLElement>(".keys"))) {
  const keys = (el.dataset.keys ?? "").split(",").filter(Boolean);
  el.innerHTML = keys.map((k) => `<kbd>${k === "mod" ? MOD : k}</kbd>`).join("");
}

// ── Keep the OS window sized to the visible UI ───────────────────────────
// The window is always interactive (so clicks/typing just work); keeping it
// tight to the content means it never covers the meeting behind it.
let lastW = 0;
let lastH = 0;
function measure(): void {
  const barRect = bar.getBoundingClientRect();
  let w = barRect.width;
  let bottom = barRect.bottom;
  if (!panel.hidden) {
    const p = panel.getBoundingClientRect();
    w = Math.max(w, p.width);
    bottom = p.bottom;
  }
  const width = Math.ceil(w) + 6;
  const height = Math.ceil(bottom) + 10;
  if (width === lastW && height === lastH) return;
  lastW = width;
  lastH = height;
  window.cluely.resize(width, height);
}
const ro = new ResizeObserver(() => measure());
ro.observe(bar);
ro.observe(panel);
window.addEventListener("load", () => {
  measure();
  setTimeout(measure, 60);
});

function openPanel(): void {
  if (panel.hidden) {
    panel.hidden = false;
    measure();
  }
}

// ── Ask flow ─────────────────────────────────────────────────────────────
let cancelCurrent: (() => void) | null = null;

function ask(prompt: string, useScreen = false, label?: string): void {
  const q = prompt.trim();
  if (!q) return;
  openPanel();
  cancelCurrent?.();

  qbubble.hidden = false;
  qbubble.textContent = label ?? q;
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

function openAndFocus(): void {
  openPanel();
  window.cluely.focusOverlay();
  setTimeout(() => promptEl.focus(), 30);
}

askBtn.addEventListener("click", openAndFocus);
function submitPrompt(): void {
  const text = promptEl.value.trim();
  ask(text || "What should I say next?", false, text || undefined);
  promptEl.value = "";
}
sendEl.addEventListener("click", submitPrompt);
hideBtn.addEventListener("click", () => window.cluely.toggleHidden());
promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitPrompt();
});

// Global hotkeys.
window.cluely.onAsk(() => {
  const text = promptEl.value.trim();
  ask(text || "What should I say next?", false, text || "What should I say?");
});
window.cluely.onAskScreen(() =>
  ask("Answer the question or problem shown on screen.", true, "Explain my screen"),
);

// ── Action row (matches Cluely: icon · icon · icon) ──────────────────────
interface Action {
  icon: string;
  label: string;
  prompt: string;
  useScreen?: boolean;
}
const ACTIONS: Action[] = [
  { icon: "✦", label: "Assist", prompt: "Given the conversation and my screen, tell me the single best thing to say or do next.", useScreen: true },
  { icon: "🗣", label: "What should I say?", prompt: "What should I say next? Give a concise line I can say out loud." },
  { icon: "💬", label: "Follow-up questions", prompt: "Suggest 3 sharp follow-up questions I could ask right now." },
  { icon: "↺", label: "Recap", prompt: "Recap the conversation so far: key points, decisions, and open items." },
];
ACTIONS.forEach((action, i) => {
  if (i > 0) {
    const dot = document.createElement("span");
    dot.className = "sepdot";
    dot.textContent = "·";
    actionsEl.appendChild(dot);
  }
  const btn = document.createElement("button");
  btn.className = "action";
  btn.innerHTML = `<span class="ico">${action.icon}</span> ${action.label}`;
  btn.addEventListener("click", () => ask(action.prompt, action.useScreen, action.label));
  actionsEl.appendChild(btn);
});

// ── Live transcript ──────────────────────────────────────────────────────
const MAX_SEGMENTS = 10;
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
