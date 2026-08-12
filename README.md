# cluely_rep

A research replica of [Cluely](https://cluely.com) — an always-on desktop AI
overlay that listens to a meeting, watches your screen, and surfaces answers on
demand, through a window that is **excluded from screen-share capture**.

This is a learning/side project. It is built in the open to understand the
engineering behind the product (audio capture, streaming transcription, screen
OCR, low-latency LLM answers, and OS-level window exclusion).

> **Status: Milestone 2 — local LLM answers.**
> The overlay streams answers from a local model (Ollama). Audio capture and
> screen OCR are not wired yet. See [`docs/RESEARCH.md`](docs/RESEARCH.md) for
> the full research brief and roadmap.

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

## Shortcuts

| Shortcut | Action |
|---|---|
| `⌘/Ctrl + Enter` | Ask (the core gesture) |
| `⌘/Ctrl + Shift + Space` | Toggle interactive (type) vs. click-through |
| `⌘/Ctrl + \` | Show / hide the overlay |

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
