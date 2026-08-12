// audiocap — captures system audio via ScreenCaptureKit (macOS 13+) and writes
// 16 kHz mono 16-bit little-endian PCM to stdout. Electron spawns this and pipes
// the PCM into whisper.cpp.
//
// Requires Screen Recording permission (first run triggers the TCC prompt).
// Build: see scripts/build-native.sh
//
// NOTE: written on a Linux box and NOT compiled there — build/test on macOS.

import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

let SAMPLE_RATE: Int = 16_000
let CHANNELS: Int = 1

// Write a message to stderr (stdout is reserved for raw PCM).
func log(_ s: String) {
    FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

final class Capturer: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?

    func start() async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: false)
            guard let display = content.displays.first else {
                log("audiocap: no display found"); exit(1)
            }

            // We only care about audio, but a stream still needs a content
            // filter and a (tiny) video config.
            let filter = SCContentFilter(display: display, excludingWindows: [])

            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.sampleRate = SAMPLE_RATE
            config.channelCount = CHANNELS
            config.excludesCurrentProcessAudio = true // avoid capturing our own app
            // Keep the mandatory video path as cheap as possible.
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

            let stream = SCStream(filter: filter, configuration: config, delegate: self)
            try stream.addStreamOutput(
                self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "audiocap.audio"))
            try await stream.startCapture()
            self.stream = stream
            log("audiocap: capturing system audio @ \(SAMPLE_RATE)Hz mono")
        } catch {
            log("audiocap: failed to start: \(error)")
            exit(1)
        }
    }

    func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, sampleBuffer.isValid else { return }

        // ScreenCaptureKit delivers float32 samples. Get a mutable pointer to
        // the sample buffer's AudioBufferList, convert to interleaved int16,
        // and write raw bytes to stdout. The retained block buffer must stay
        // alive while we read from it.
        var abl = AudioBufferList()
        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &abl,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer)
        guard status == noErr else { return }

        let buffers = UnsafeMutableAudioBufferListPointer(&abl)
        // Mono config => one buffer of float32 samples.
        guard let ch = buffers.first,
              let src = ch.mData?.assumingMemoryBound(to: Float32.self)
        else { return }
        let frames = Int(ch.mDataByteSize) / MemoryLayout<Float32>.size

        var out = Data(capacity: frames * 2)
        for i in 0..<frames {
            let clamped = max(-1.0, min(1.0, src[i]))
            let s = Int16(clamped * 32767.0)
            withUnsafeBytes(of: s.littleEndian) { out.append(contentsOf: $0) }
        }
        FileHandle.standardOutput.write(out)

        _ = blockBuffer // keep the block buffer alive through the read above
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log("audiocap: stream stopped: \(error)")
        exit(1)
    }
}

let capturer = Capturer()

// Stop cleanly on SIGTERM/SIGINT so Electron can kill us.
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

Task { await capturer.start() }
RunLoop.main.run()
