#!/usr/bin/env bash
# Compiles the macOS system-audio capture helper (native/audiocap).
# macOS 13+ with the Xcode command line tools required.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "build-native: system-audio capture is macOS-only; skipping." >&2
  exit 0
fi

OUT="native/audiocap/audiocap"
echo "build-native: compiling $OUT …"
swiftc -O \
  -framework ScreenCaptureKit \
  -framework AVFoundation \
  -framework CoreMedia \
  native/audiocap/main.swift \
  -o "$OUT"

echo "build-native: built $OUT"
echo "First run will prompt for Screen Recording permission (System Settings ›"
echo "Privacy & Security › Screen Recording). Grant it, then restart the app."
