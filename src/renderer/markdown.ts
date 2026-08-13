import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

// Answers come from a local model; still strip anything executable before we
// set innerHTML (defense in depth — no scripts, styles, or inline handlers).
function sanitize(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
}

/** Render Markdown to sanitized HTML for the answer area. */
export function renderMarkdown(src: string): string {
  return sanitize(marked.parse(src, { async: false }) as string);
}
