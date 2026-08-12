// Windowed transcription via whisper.cpp. Accumulates 16 kHz mono PCM, and
// every WINDOW_MS runs whisper-cli on the buffered audio, emitting text.
//
// Streaming word-by-word (VAD) is a later refinement; windowed is robust and
// good enough to prove the pipeline.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const WHISPER_CLI = process.env.WHISPER_CLI ?? "whisper-cli";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "";
const SAMPLE_RATE = 16_000;
const WINDOW_MS = Number(process.env.CLUELY_STT_WINDOW_MS ?? 5000);

export function transcriberAvailable(): { ok: boolean; reason?: string } {
  if (!WHISPER_MODEL) {
    return { ok: false, reason: "WHISPER_MODEL not set (path to a ggml .bin model)" };
  }
  if (!existsSync(WHISPER_MODEL)) {
    return { ok: false, reason: `whisper model not found: ${WHISPER_MODEL}` };
  }
  return { ok: true };
}

export class Transcriber {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private readonly bytesPerWindow = Math.floor(SAMPLE_RATE * 2 * (WINDOW_MS / 1000));
  private busy = false;

  constructor(
    private readonly onText: (text: string) => void,
    private readonly onError: (message: string) => void,
  ) {}

  /** Feed raw 16-bit mono PCM. Triggers a flush once a window's worth buffered. */
  push(pcm: Buffer): void {
    this.chunks.push(pcm);
    this.bytes += pcm.length;
    if (this.bytes >= this.bytesPerWindow && !this.busy) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.chunks.length === 0 || this.busy) return;
    this.busy = true;
    const pcm = Buffer.concat(this.chunks);
    this.chunks = [];
    this.bytes = 0;
    try {
      const text = await this.run(pcm);
      if (text) this.onText(text);
    } catch (err) {
      this.onError((err as Error).message);
    } finally {
      this.busy = false;
    }
  }

  private async run(pcm: Buffer): Promise<string> {
    const wav = wavFromPcm16(pcm, SAMPLE_RATE);
    const file = path.join(tmpdir(), `cluely-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    await writeFile(file, wav);
    try {
      return await runWhisper(file);
    } finally {
      unlink(file).catch(() => {});
    }
  }
}

/** Runs whisper-cli on a wav file and returns the plain transcript. */
function runWhisper(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // -nt no timestamps, -np no prints/progress, -otxt off (read stdout).
    const args = ["-m", WHISPER_MODEL, "-f", file, "-nt", "-np"];
    const proc = spawn(WHISPER_CLI, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) =>
      reject(new Error(`whisper spawn failed (${WHISPER_CLI}): ${e.message}`)),
    );
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`whisper exited ${code}: ${err.trim().slice(0, 200)}`));
        return;
      }
      resolve(
        out
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .join(" ")
          .trim(),
      );
    });
  });
}

/** Wrap raw 16-bit mono PCM in a minimal WAV container. */
function wavFromPcm16(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  const byteRate = sampleRate * 2; // mono, 16-bit
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
