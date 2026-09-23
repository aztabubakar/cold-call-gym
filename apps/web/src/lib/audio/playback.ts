import { GEMINI_OUTPUT_SAMPLE_RATE_HZ } from "@cold-call-gym/shared";
import { base64ToPcm16, int16ToFloat32 } from "./pcm";

/**
 * Ordered, low-latency playback of Gemini's native audio output.
 *
 * Each incoming chunk is scheduled to start exactly when the previous one
 * ends (or immediately, if we're behind), so playback is gapless without
 * needing to wait for the whole response to arrive first — audio begins
 * playing as soon as the first chunk does. AudioBuffer accepts any sample
 * rate independent of the AudioContext's own rate (24kHz here, whatever
 * the context's native output rate is) — the Web Audio API resamples
 * during playback automatically, so no manual resampling is needed on
 * this side of the pipeline (contrast with mic-capture.ts's input side,
 * which does resample manually since it's producing raw PCM for the
 * network, not playing through a buffer).
 *
 * `interrupt()` is the barge-in handler: called when the gateway forwards
 * an `interrupted` event, it immediately stops and discards every
 * scheduled/playing source and resets the schedule cursor — nothing
 * queued survives an interruption.
 *
 * DOM-coupled (AudioContext/AudioBufferSourceNode), so not unit-tested
 * directly — see pcm.ts's decode helpers for the tested pure logic this
 * builds on.
 */
export class AudioPlaybackQueue {
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  constructor(private readonly audioContext: AudioContext) {}

  enqueue(base64Pcm16: string): void {
    const pcm16 = base64ToPcm16(base64Pcm16);
    if (pcm16.length === 0) return;
    const float32 = int16ToFloat32(pcm16);

    const buffer = this.audioContext.createBuffer(1, float32.length, GEMINI_OUTPUT_SAMPLE_RATE_HZ);
    buffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const startAt = Math.max(this.audioContext.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
    };
  }

  /** Barge-in: stop and discard everything immediately, keep nothing queued. */
  interrupt(): void {
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // Already stopped/ended — fine, we're discarding it anyway.
      }
      try {
        source.disconnect();
      } catch {
        // Ditto.
      }
    }
    this.activeSources = [];
    this.nextStartTime = this.audioContext.currentTime;
  }

  /** Full teardown at call end/cleanup — same effect as interrupt(). */
  stop(): void {
    this.interrupt();
  }

  get isPlaying(): boolean {
    return this.nextStartTime > this.audioContext.currentTime;
  }
}
