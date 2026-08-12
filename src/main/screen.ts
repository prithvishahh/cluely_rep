// Screen capture for OCR. Grabs a full-resolution frame of the primary display.
//
// Our overlay has content protection on, so it is excluded from this capture —
// we never OCR our own window. Requires Screen Recording permission on macOS
// (same grant as the audio helper); without it frames come back black.

import { desktopCapturer, screen } from "electron";

/** Captures the primary display as a PNG buffer, or null on failure. */
export async function captureScreen(): Promise<Buffer | null> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    },
  });

  // Prefer the source matching the primary display.
  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;

  return source.thumbnail.toPNG();
}
