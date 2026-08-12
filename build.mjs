// Minimal esbuild pipeline: bundles the Electron main + preload (node target)
// and the renderer (browser target), then copies static assets into dist/.
import { build, context } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

/** @type {import('esbuild').BuildOptions[]} */
const targets = [
  {
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main.js",
    platform: "node",
    // tesseract.js ships worker + wasm assets that must not be inlined;
    // resolve it from node_modules at runtime.
    external: ["electron", "tesseract.js"],
  },
  {
    entryPoints: ["src/main/preload.ts"],
    outfile: "dist/preload.js",
    platform: "node",
    external: ["electron"],
  },
  {
    entryPoints: ["src/renderer/renderer.ts"],
    outfile: "dist/renderer.js",
    platform: "browser",
  },
];

const common = {
  bundle: true,
  sourcemap: true,
  target: "es2022",
  logLevel: "info",
};

function copyStatic() {
  cpSync("src/renderer/index.html", "dist/index.html");
  cpSync("src/renderer/styles.css", "dist/styles.css");
}

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => context({ ...common, ...t })));
  await Promise.all(ctxs.map((c) => c.watch()));
  copyStatic();
  console.log("[build] watching for changes…");
} else {
  await Promise.all(targets.map((t) => build({ ...common, ...t })));
  copyStatic();
  console.log("[build] done");
}
