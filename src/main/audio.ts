// Audio pipeline — platform-aware. Both paths feed the same whisper transcriber.
//
//   macOS   : spawn the native ScreenCaptureKit helper (native/audiocap) which
//             streams system-audio PCM to stdout.
//   Windows : the renderer captures system (loopback) audio via getDisplayMedia
//             and streams PCM to us over IPC (see pushRendererPcm); no native
//             code needed.
//   other   : unsupported — transcription stays off, app still runs.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Transcriber, transcriberAvailable } from "./transcriber";

// In a packaged app the helper is shipped under resources/native; in dev it
// lives in the project tree.
function resolveAudiocapBin(): string {
  if (process.env.AUDIOCAP_BIN) return process.env.AUDIOCAP_BIN;
  const packaged = path.join(process.resourcesPath ?? "", "native", "audiocap", "audiocap");
  if (existsSync(packaged)) return packaged;
  return path.join(process.cwd(), "native", "audiocap", "audiocap");
}
const AUDIOCAP_BIN = resolveAudiocapBin();

export interface PipelineStatus {
  active: boolean;
  reason?: string;
}

export interface PipelineHandlers {
  onSegment: (text: string) => void;
  onStatus: (status: PipelineStatus) => void;
}

let transcriber: Transcriber | null = null;
let paused = false;

/** Pause/resume transcription without tearing down capture. */
export function setPaused(p: boolean): void {
  paused = p;
}
export function isPaused(): boolean {
  return paused;
}

function macHelperAvailable(): { ok: boolean; reason?: string } {
  if (!existsSync(AUDIOCAP_BIN)) {
    return { ok: false, reason: "audio helper not built — run scripts/build-native.sh" };
  }
  return { ok: true };
}

/** Overall readiness of the transcription pipeline for this OS. */
export function pipelineStatus(): PipelineStatus {
  const stt = transcriberAvailable();
  if (!stt.ok) return { active: false, reason: stt.reason };

  if (process.platform === "darwin") {
    const cap = macHelperAvailable();
    return cap.ok ? { active: true } : { active: false, reason: cap.reason };
  }
  if (process.platform === "win32") {
    return { active: true }; // renderer supplies loopback audio
  }
  return { active: false, reason: "system-audio capture not supported on this OS" };
}

/** True when the renderer must capture loopback audio (Windows). */
export function needsRendererCapture(): boolean {
  return process.platform === "win32" && pipelineStatus().active;
}

/** Feed PCM (16 kHz mono 16-bit) captured by the renderer into the transcriber. */
export function pushRendererPcm(pcm: Buffer): void {
  if (paused) return;
  transcriber?.push(pcm);
}

/**
 * Starts transcription. Returns a stop function. If unavailable, reports why via
 * onStatus and returns a no-op stop — the app keeps working without transcription.
 */
export function startAudioPipeline(handlers: PipelineHandlers): () => void {
  const status = pipelineStatus();
  if (!status.active) {
    handlers.onStatus(status);
    return () => {};
  }

  transcriber = new Transcriber(
    (text) => handlers.onSegment(text),
    (message) => handlers.onStatus({ active: false, reason: message }),
  );

  // Windows: nothing to spawn — the renderer streams PCM via pushRendererPcm().
  if (process.platform !== "darwin") {
    handlers.onStatus({ active: true });
    return () => {
      transcriber = null;
    };
  }

  // macOS: spawn the native ScreenCaptureKit helper.
  let proc: ChildProcess;
  try {
    proc = spawn(AUDIOCAP_BIN, [], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    handlers.onStatus({ active: false, reason: (err as Error).message });
    return () => {};
  }

  proc.stdout?.on("data", (buf: Buffer) => {
    if (!paused) transcriber?.push(buf);
  });
  proc.stderr?.on("data", (buf: Buffer) => {
    const line = buf.toString().trim();
    if (line) console.error("[audiocap]", line);
  });
  proc.on("error", (err) => handlers.onStatus({ active: false, reason: err.message }));
  proc.on("exit", (code) => {
    if (code && code !== 0) {
      handlers.onStatus({
        active: false,
        reason: `audio helper exited (${code}) — grant Screen Recording permission?`,
      });
    }
  });

  handlers.onStatus({ active: true });

  return () => {
    proc.kill("SIGTERM");
    transcriber = null;
  };
}
