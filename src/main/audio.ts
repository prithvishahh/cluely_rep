// Audio pipeline: spawns the native ScreenCaptureKit helper, pipes its PCM into
// the whisper transcriber, and emits transcript segments + status.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Transcriber, transcriberAvailable } from "./transcriber";

const AUDIOCAP_BIN =
  process.env.AUDIOCAP_BIN ?? path.join(process.cwd(), "native", "audiocap", "audiocap");

export interface PipelineStatus {
  active: boolean;
  reason?: string;
}

function captureAvailable(): { ok: boolean; reason?: string } {
  if (process.platform !== "darwin") {
    return { ok: false, reason: "system-audio capture helper is macOS-only" };
  }
  if (!existsSync(AUDIOCAP_BIN)) {
    return { ok: false, reason: `audio helper not built — run scripts/build-native.sh` };
  }
  return { ok: true };
}

/** Overall readiness of the transcription pipeline. */
export function pipelineStatus(): PipelineStatus {
  const cap = captureAvailable();
  if (!cap.ok) return { active: false, reason: cap.reason };
  const stt = transcriberAvailable();
  if (!stt.ok) return { active: false, reason: stt.reason };
  return { active: true };
}

export interface PipelineHandlers {
  onSegment: (text: string) => void;
  onStatus: (status: PipelineStatus) => void;
}

/**
 * Starts capture + transcription. Returns a stop function. If the pipeline
 * isn't available, reports why via onStatus and returns a no-op stop — the app
 * keeps working without transcription.
 */
export function startAudioPipeline(handlers: PipelineHandlers): () => void {
  const status = pipelineStatus();
  if (!status.active) {
    handlers.onStatus(status);
    return () => {};
  }

  const transcriber = new Transcriber(
    (text) => handlers.onSegment(text),
    (message) => handlers.onStatus({ active: false, reason: message }),
  );

  let proc: ChildProcess;
  try {
    proc = spawn(AUDIOCAP_BIN, [], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    handlers.onStatus({ active: false, reason: (err as Error).message });
    return () => {};
  }

  proc.stdout?.on("data", (buf: Buffer) => transcriber.push(buf));
  proc.stderr?.on("data", (buf: Buffer) => {
    const line = buf.toString().trim();
    if (line) console.error("[audiocap]", line);
  });
  proc.on("error", (err) =>
    handlers.onStatus({ active: false, reason: err.message }),
  );
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
  };
}
