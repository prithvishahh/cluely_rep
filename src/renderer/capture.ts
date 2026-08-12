// Windows loopback audio capture (renderer side). Grabs system audio via
// getDisplayMedia — the main process's display-media handler grants
// audio: 'loopback' — resamples to 16 kHz mono 16-bit PCM, and streams it to
// main for transcription. macOS never calls this (it uses the native helper).

const TARGET_RATE = 16_000;

let started = false;

export async function startLoopbackCapture(): Promise<void> {
  if (started) return;
  started = true;

  let media: MediaStream;
  try {
    // Video is required by getDisplayMedia; we discard it and keep the audio.
    media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    console.error("[capture] getDisplayMedia failed:", (err as Error).message);
    started = false;
    return;
  }

  media.getVideoTracks().forEach((t) => t.stop());
  if (media.getAudioTracks().length === 0) {
    console.error("[capture] no system-audio track — loopback unavailable");
    return;
  }

  // Forcing the context sample rate makes Chromium resample to 16 kHz for us.
  const ctx = new AudioContext({ sampleRate: TARGET_RATE });
  const source = ctx.createMediaStreamSource(media);
  const processor = ctx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0); // Float32, mono, 16 kHz
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    window.cluely.sendAudioPcm(pcm.buffer);
  };

  // Route through a muted gain node so the processor keeps pulling without
  // playing the captured system audio back out of the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);
}
