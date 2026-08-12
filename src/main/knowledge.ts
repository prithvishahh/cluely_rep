// Knowledge grounding: user-uploaded files (résumé, playbooks, docs) whose text
// is fed to the model as reference context. Persisted in userData so it
// survives restarts. Text files are read directly; PDFs via pdf-parse.

import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";

interface Doc {
  name: string;
  text: string;
}

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".json", ".csv", ".log", ".text",
]);
const MAX_DOC_CHARS = 20_000; // per document
const MAX_CONTEXT_CHARS = 6_000; // total injected into a prompt

let docs: Doc[] = [];

function storePath(): string {
  return path.join(app.getPath("userData"), "knowledge.json");
}

/** Load persisted knowledge on startup. */
export function initKnowledge(): void {
  try {
    const p = storePath();
    if (existsSync(p)) docs = JSON.parse(readFileSync(p, "utf8")) as Doc[];
  } catch (err) {
    console.error("[knowledge] load failed:", (err as Error).message);
    docs = [];
  }
}

async function persist(): Promise<void> {
  await writeFile(storePath(), JSON.stringify(docs), "utf8");
}

async function extract(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") {
    const buf = await readFile(file);
    const { text } = await pdfParse(buf);
    return text;
  }
  if (TEXT_EXTS.has(ext) || ext === "") {
    return await readFile(file, "utf8");
  }
  // Unknown type — attempt UTF-8, tolerate garbage rather than crash.
  return await readFile(file, "utf8");
}

/** Add files; returns the current document names. Bad files are skipped. */
export async function addFiles(paths: string[]): Promise<string[]> {
  for (const file of paths) {
    try {
      const raw = (await extract(file)).replace(/\s+\n/g, "\n").trim();
      if (!raw) continue;
      docs.push({
        name: path.basename(file),
        text: raw.slice(0, MAX_DOC_CHARS),
      });
    } catch (err) {
      console.error(`[knowledge] skip ${file}:`, (err as Error).message);
    }
  }
  await persist();
  return listNames();
}

export function listNames(): string[] {
  return docs.map((d) => d.name);
}

export async function clearKnowledge(): Promise<string[]> {
  docs = [];
  await persist();
  return [];
}

/** Concatenated reference text, capped, or "" when nothing is loaded. */
export function contextText(): string {
  if (docs.length === 0) return "";
  let out = "";
  for (const d of docs) {
    const block = `# ${d.name}\n${d.text}\n\n`;
    if (out.length + block.length > MAX_CONTEXT_CHARS) {
      out += block.slice(0, MAX_CONTEXT_CHARS - out.length);
      break;
    }
    out += block;
  }
  return out.trim();
}
