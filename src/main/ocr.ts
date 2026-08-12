// On-device OCR via tesseract.js (WASM). A single worker is created lazily and
// reused across captures. A native macOS Vision-based OCR would be faster and
// is a natural upgrade for the native rewrite.

import { createWorker, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // First call downloads the eng traineddata + wasm core (needs network once).
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

/** OCR a PNG buffer into plain text. Returns "" if nothing legible is found. */
export async function ocr(png: Buffer): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(png);
  return (data.text ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}
