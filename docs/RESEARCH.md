# Cluely — Research Brief & Roadmap

Captured research on Cluely and the plan for this replica. See sources at the
bottom.

## What Cluely is

A desktop overlay app (macOS + Windows) that:

1. **Listens** to a meeting — system audio (the other person) + your mic —
   and transcribes it live (~300ms latency, 12+ languages claimed).
2. **Watches** your screen via OCR so it can answer about on-screen content
   (a coding problem, a slide).
3. **Answers** on demand: hit a hotkey and an LLM responds using the rolling
   transcript + screen context, grounded on files you upload (résumé, docs).
4. **Stays invisible** during screen sharing via an overlay excluded from
   capture on Zoom / Meet / Teams / Webex / Slack huddles. Never joins the
   call as a bot.

Marketed by founder Chungin "Roy" Lee under "cheat on everything"; the
undetectability is gated behind the top (~$150/mo) tier.

### Feature list

- Live real-time answers (`Cmd/Ctrl+Enter`).
- Canned actions: "What should I say next", "Follow-up questions",
  "Fact check", "Who am I talking to", "Recap".
- Always-on system-audio + mic transcription.
- Screen reading / OCR.
- Knowledge upload (résumé, playbooks, product docs) for grounding.
- CRM integrations (Salesforce, HubSpot, Pipedrive, Zoho) for sales calls.
- Post-meeting notes / summaries / action items.

## The invisibility mechanism

Not novel — documented OS APIs, applied to the app's own window:

- **Windows:** `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` (0x11,
  Win10 2004+). DWM renders the window on the physical monitor but omits it
  from every capture surface. App can only exclude its own windows.
- **macOS:** `NSWindow.sharingType = .none` (+ high window level, non-activating
  panel). Modern Zoom/Meet/Teams use **ScreenCaptureKit**, which composites the
  captured frame without windows marked this way.
- **Electron shortcut:** `win.setContentProtection(true)` wraps both. This is
  what our MVP uses.

### What defeats it (both platforms)

Exclusion happens at the software compositor, so anything capturing outside
that path still sees it:

- A phone camera pointed at the screen.
- A second machine / hardware HDMI capture card.
- Kernel-level proctoring (Honorlock, Proctorio) that hooks lower or flags the
  **process** rather than reading pixels.
- Detection tools (Truely, Fabric, Zero Assist) that look for the running
  process, virtual-audio drivers, or eye movement — not the window.

## Where the real engineering is (hardest → easiest)

1. **System/loopback audio** (the other person's voice): Windows = WASAPI
   loopback (native); macOS = no native loopback, needs a virtual device
   (BlackHole) or ScreenCaptureKit audio (macOS 13+).
2. **Streaming STT:** whisper.cpp (local) or Deepgram/AssemblyAI (API).
3. **LLM answer layer:** rolling transcript + OCR'd screen → streamed tokens.
4. **Screen OCR:** native Vision (macOS) or Tesseract.
5. **Invisible overlay:** the one-line API calls above.
6. **Global hotkeys, non-activating always-on-top panel, low idle CPU.**

## Roadmap for this replica

Decisions (from project owner):
- **Platform:** macOS first, then cross-platform.
- **Stack:** Electron + TypeScript now → **rewrite fully native (Swift) once
  the demo works** (owner explicitly asked to be reminded of this).
- **AI:** local models now (Ollama / whisper.cpp) → external API later.

Milestones:

- [x] **M1 — Invisible overlay shell.** Transparent, always-on-top,
  click-through window with `setContentProtection`; global hotkeys; stubbed
  answer round-trip. *Verify invisibility on a real Zoom share before anything
  else.*
- [x] **M2 — Local LLM answers.** `llm:ask` streams tokens from Ollama
  (`/api/chat`, NDJSON) into the overlay, with request-id correlation,
  cancellation, and friendly errors when Ollama/the model is missing.
- [x] **M3 — System audio + local STT.** Native ScreenCaptureKit helper
  (`native/audiocap/main.swift`) streams 16 kHz mono PCM → whisper.cpp windowed
  transcription (`transcriber.ts`) → rolling transcript fed to the LLM as
  context. Degrades gracefully when native pieces aren't built. *Native code is
  unverified on Linux — compile/test on macOS.*
- [ ] **M4 — Cross-platform audio.** Windows WASAPI loopback; refine macOS
  (VAD/streaming, mic + system mix).
- [ ] **M5 — Screen OCR** so answers can use on-screen content.
- [ ] **M6 — Canned actions + knowledge upload/grounding.**
- [ ] **Pivot decision — native rewrite** (remind owner).

## Ethics / scope

Educational replica of a public commercial product. Not for violating the
rules of an exam, interview, or platform the user has agreed to.

## Sources

- Cluely — official site & docs: https://cluely.com , https://docs.cluely.com/feature/undectability , https://docs.cluely.com/feature/liveinsights , https://cluely.com/pricing
- Wikipedia — Cluely: https://en.wikipedia.org/wiki/Cluely
- Apple — ScreenCaptureKit / Capturing screen content in macOS: https://developer.apple.com/documentation/ScreenCaptureKit/capturing-screen-content-in-macos
- Microsoft — SetWindowDisplayAffinity: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity
- Meziantou — Exclude a Windows app from screen capture and Recall: https://www.meziantou.net/how-to-exclude-your-windows-app-from-screen-capture-and-recall.htm
- Reviews / detection context: https://tldv.io/blog/cluely-review/ , https://honorlock.com/blog/what-is-cluely-how-to-block-it/ , https://fabrichq.ai/blogs/how-to-detect-cluely-in-interviews , https://www.eesel.ai/blog/cluely-pricing
