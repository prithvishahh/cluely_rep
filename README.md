# cluely_rep

A research replica of [Cluely](https://cluely.com) — an always-on desktop AI
overlay that listens to a meeting, watches your screen, and surfaces answers on
demand, through a window that is **excluded from screen-share capture**.

This is a learning/side project. It is built in the open to understand the
engineering behind the product (audio capture, streaming transcription, screen
OCR, low-latency LLM answers, and OS-level window exclusion).

> **Status: Milestone 5 — screen OCR.**
> The overlay can read the screen (capture + on-device OCR) and answer using it,
> on top of live transcription (M3) and local LLM answers (M2). The app
> **degrades gracefully** — without the native audio pieces built it still runs
> as the invisible overlay + local LLM + screen OCR. See
> [`docs/RESEARCH.md`](docs/RESEARCH.md) for the full research brief and roadmap.

## Stack (current)

- **Electron + TypeScript** — fastest path to a working demo. Electron's
  `win.setContentProtection(true)` wraps the platform-native window-exclusion
  APIs on both macOS and Windows.
- Local models planned for the answer layer (Ollama / whisper.cpp), with an
  API backend as a later option.

> Planned pivot: once the demo works end-to-end, rewrite fully native
> (Swift on macOS) for latency and footprint. Tracked in the roadmap.

## Run it

Requires Node 18+. **The invisibility only takes effect on macOS and Windows**
(it's a no-op on Linux), so test the screen-share behaviour on a Mac.

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

### Live transcription (macOS, optional)

To have the overlay hear the meeting, build the native audio helper and point
it at a local whisper.cpp model. **Without these steps the app still runs** —
the header dot stays grey and transcription is simply off.

1. **Build the ScreenCaptureKit audio helper** (macOS 13+, Xcode CLT):
   ```bash
   ./scripts/build-native.sh
   ```
   First run prompts for **Screen Recording** permission — grant it and restart.

2. **Build whisper.cpp and download a model:**
   ```bash
   git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp
   cmake -B build && cmake --build build -j --config Release
   ./models/download-ggml-model.sh base.en
   ```

3. **Point the app at them** (e.g. in your shell before `npm start`):
   ```bash
   export WHISPER_CLI=/path/to/whisper.cpp/build/bin/whisper-cli
   export WHISPER_MODEL=/path/to/whisper.cpp/models/ggml-base.en.bin
   ```

   | Var | Default | Meaning |
   |---|---|---|
   | `WHISPER_CLI` | `whisper-cli` (PATH) | whisper.cpp CLI binary |
   | `WHISPER_MODEL` | *(unset)* | path to a ggml `.bin` model |
   | `AUDIOCAP_BIN` | `native/audiocap/audiocap` | audio helper binary |
   | `CLUELY_STT_WINDOW_MS` | `5000` | transcription window size |

The header dot turns **green** when transcription is live; hover it for status.

## Shortcuts

| Shortcut | Action |
|---|---|
| `⌘/Ctrl + Enter` | Ask (uses the live transcript as context) |
| `⌘/Ctrl + Shift + Enter` | Ask using what's on screen (capture + OCR) |
| `⌘/Ctrl + Shift + Space` | Toggle interactive (type) vs. click-through |
| `⌘/Ctrl + \` | Show / hide the overlay |

The **⧉** button next to *Ask* does the same as the screen-ask hotkey. On-device
OCR (tesseract.js) downloads its English model once on first use (needs network
that first time).

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
