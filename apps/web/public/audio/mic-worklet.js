/**
 * AudioWorkletProcessor for microphone capture. Runs on the dedicated
 * audio rendering thread (not the main thread), so it stays responsive
 * even under main-thread load — this is what lets us send small,
 * real-time chunks instead of buffering audio for a second at a time.
 *
 * Deliberately "dumb": it does no resampling or PCM conversion itself —
 * it just accumulates raw Float32 render quanta (128 samples each, at the
 * AudioContext's native sample rate, typically 48000Hz or 44100Hz
 * depending on the browser/device) up to a small target chunk size, then
 * posts each chunk to the main thread. All resampling to Gemini's
 * required 16kHz and Int16 conversion happens on the main thread in
 * apps/web/src/lib/audio/pcm.ts (pure, unit-tested functions) — see
 * apps/web/src/lib/audio/mic-capture.ts, which owns this processor.
 */
class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~20ms at 48kHz ≈ 960 samples; conservative fixed size that stays
    // small at any realistic native sample rate without needing to know
    // it up front (the processor doesn't have direct access to
    // `sampleRate` context in a way that changes this calculation
    // meaningfully — a fixed sample-count target keeps chunk latency low
    // across devices).
    this.targetChunkSamples = 960;
    this.buffer = new Float32Array(this.targetChunkSamples);
    this.writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel || channel.length === 0) return true;

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.writeIndex] = channel[i];
      this.writeIndex++;

      if (this.writeIndex >= this.targetChunkSamples) {
        this.port.postMessage(this.buffer.slice(0, this.writeIndex));
        this.writeIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("mic-capture-processor", MicCaptureProcessor);
