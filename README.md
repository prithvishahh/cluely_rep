# cluely_rep

A research replica of [Cluely](https://cluely.com) — an always-on desktop AI
overlay that listens to a meeting, watches your screen, and surfaces answers on
demand, through a window that is **excluded from screen-share capture**.

This is a learning/side project. It is built in the open to understand the
engineering behind the product (audio capture, streaming transcription, screen
OCR, low-latency LLM answers, and OS-level window exclusion).

> **Status: packaged, cross-platform (Windows + macOS).**
> Builds into a real double-clickable app (installer / portable `.exe` / `.dmg`)
> via electron-builder — no terminal needed after building once. On Windows the
> invisibility works out of the box and system audio is captured natively by
> Electron (loopback) with no extra build. On top of: actions + knowledge
> grounding (M6), screen OCR (M5), transcription (M3), local LLM answers (M2).
>
> _(historical:)_ **Milestone 6 — actions + knowledge grounding.**
> One-tap actions (Say next, Follow-ups, Fact-check, Who, Recap, Explain screen)
> and uploadable reference docs (résumé/PDF/text) that ground every answer — on
> top of live transcription (M3), screen OCR (M5), and local LLM answers (M2).
> The app **degrades gracefully** — without the native audio pieces built it
> still runs as the invisible overlay + local LLM + screen OCR + knowledge. See
> [`docs/RESEARCH.md`](docs/RESEARCH.md) for the full research brief and roadmap.

## Features

- **Invisible overlay** — excluded from screen-share capture (`setContentProtection`).
- **Local LLM answers** — streamed from Ollama; nothing leaves the machine.
- **Live transcription** — native ScreenCaptureKit system audio → whisper.cpp.
- **Screen OCR** — reads the screen and answers using it.
- **One-tap actions** — Say next · Follow-ups · Fact-check · Who · Recap · Explain screen.
- **Knowledge grounding** — upload a résumé / docs (PDF or text); answers use them.

## Stack (current)

- **Electron + TypeScript** — fastest path to a working demo. Electron's
  `win.setContentProtection(true)` wraps the platform-native window-exclusion
  APIs on both macOS and Windows.
- Local models planned for the answer layer (Ollama / whisper.cpp), with an
  API backend as a later option.

> Planned pivot: once the demo works end-to-end, rewrite fully native
> (Swift on macOS) for latency and footprint. Tracked in the roadmap.

## Download the app (no tools needed)

GitHub builds the apps automatically. Grab the latest Windows build from the
[**Releases**](https://github.com/prithvishahh/cluely_rep/releases) page (the
"Latest build (Windows)" prerelease) — download the `.exe` and run it. No git,
Node, or npm required.

> You still need [Ollama](https://ollama.com) installed and running for AI
> answers (it's the local model backend). On first launch Windows SmartScreen
> may warn "unknown publisher" — click **More info › Run anyway** (the app isn't
> code-signed yet).

## Build it yourself (build once, then just click)

To get a real double-clickable app instead of running from a terminal, build an
installer once. You need Node 18+ and the repo cloned. **Build on the OS you
want the app for** (Windows builds on Windows, macOS on macOS — no cross-compile
needed).

```bash
npm install
npm run dist:win   # Windows: makes an installer + a portable .exe
# or
npm run dist:mac   # macOS: makes a .dmg
```

The output lands in **`release/`**:

- **Windows** — `CluelyRep Setup … .exe` (installer → Start Menu + desktop
  shortcut) and `CluelyRep-…-portable.exe` (a single file you can just
  double-click, no install). Either way, after that it's a normal app you open
  by clicking its icon.
- **macOS** — a `.dmg`; drag the app to Applications.

Everything runs locally — the packaged app still uses your local Ollama for
answers and (optionally) local whisper.cpp for transcription; nothing is sent to
a server. Ollama must be installed and running for answers to work.

> First launch on macOS also needs the native audio helper built
> (`./scripts/build-native.sh`) if you want transcription; on Windows nothing
> extra is needed for audio capture.

## Run from source (development)

Requires Node 18+. Runs on **macOS and Windows** (invisibility is a no-op on
Linux). Everything except system-audio transcription works out of the box on
both; transcription setup differs per platform (see below).

The answer layer uses a **local model via [Ollama](https://ollama.com)**. Install
it, then pull a small model once:

```bash
ollama pull llama3.2      # default; any chat model works
```

Then run the app (Ollama's background server is used automatically):

```bash
npm install
npm start
```

Configure via env vars if you like:

| Var | Default | Meaning |
|---|---|---|
| `CLUELY_MODEL` | `llama3.2` | Ollama model name |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama server URL |

If Ollama isn't running or the model isn't pulled, the overlay shows the exact
command to fix it.

### Live transcription (optional)

To have the overlay hear the meeting you need whisper.cpp + a model. **Without
this the app still runs** — the header dot stays grey and transcription is off.
The **audio source** is captured differently per OS, but both feed the same
whisper transcriber:

- **Windows** — system (loopback) audio is captured by the app itself via
  `getDisplayMedia` (`audio: 'loopback'`). **No native build, no extra driver.**
- **macOS** — a native ScreenCaptureKit helper captures system audio; build it
  once with `./scripts/build-native.sh` (macOS 13+, Xcode CLT). First run
  prompts for **Screen Recording** permission.

**Get whisper.cpp + a model:**

- Windows: download a prebuilt release from
  [whisper.cpp releases](https://github.com/ggerganov/whisper.cpp/releases)
  (contains `whisper-cli.exe`) and a `ggml-base.en.bin` model — no compiling.
- macOS/Linux: `git clone` whisper.cpp, `cmake -B build && cmake --build build`,
  then `./models/download-ggml-model.sh base.en`.

**Point the app at them** before `npm start`:

```bash
# macOS/Linux
export WHISPER_CLI=/path/to/whisper-cli
export WHISPER_MODEL=/path/to/ggml-base.en.bin
```
```powershell
# Windows (PowerShell)
$env:WHISPER_CLI="C:\path\to\whisper-cli.exe"
$env:WHISPER_MODEL="C:\path\to\ggml-base.en.bin"
```

| Var | Default | Meaning |
|---|---|---|
| `WHISPER_CLI` | `whisper-cli` (PATH) | whisper.cpp CLI binary |
| `WHISPER_MODEL` | *(unset)* | path to a ggml `.bin` model |
| `AUDIOCAP_BIN` | `native/audiocap/audiocap` | macOS audio helper binary |
| `CLUELY_STT_WINDOW_MS` | `5000` | transcription window size |

The header dot turns **green** when transcription is live; hover it for status.

## Shortcuts

The overlay is a small **pill bar centered at the top of the screen**. The
window is sized exactly to the visible UI, so it's directly clickable and never
covers the app behind it. Click **Ask AI** (or press the shortcut) to open the
response panel and type.

| Shortcut | Action |
|---|---|
| `⌘/Ctrl + Enter` | Ask (uses the live transcript as context) |
| `⌘/Ctrl + Shift + Enter` | Ask using what's on screen (capture + OCR) |
| `⌘/Ctrl + \` | Show / hide the overlay |

The **⧉** button next to *Ask* does the same as the screen-ask hotkey. On-device
OCR (tesseract.js) downloads its English model once on first use (needs network
that first time).

The **action chips** run predefined prompts against the live context. The **📎**
button uploads reference material (PDF/text) that grounds every answer — the
badge shows how many docs are loaded; **shift-click** it to clear them. Uploaded
docs persist across restarts (in the app's userData).

## Verifying invisibility (do this first, on a Mac)

1. `npm start` — the overlay appears top-right.
2. Start a Zoom / Google Meet / Teams call (even solo) and **share your screen**.
3. In the shared view, the overlay should **not** appear, while it stays
   visible on your physical display.

Note: this is defeated by a phone camera pointed at the screen, a hardware
capture card, or some kernel-level proctoring software — see the research doc.

## License

MIT. For education and authorized personal use. Don't use it to violate the
rules of an exam, interview, or platform you've agreed to.
