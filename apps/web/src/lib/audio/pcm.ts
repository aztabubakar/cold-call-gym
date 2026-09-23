/**
 * Pure PCM16/base64/resampling helpers for the browser's Gemini Live audio
 * pipeline. No DOM APIs (no AudioContext, no window) so these are directly
 * unit-testable — the DOM-coupled orchestration (getUserMedia,
 * AudioContext, AudioWorkletNode, playback scheduling) lives in
 * mic-capture.ts and playback.ts, which use these functions but aren't
 * themselves unit-tested (browser-only, no jsdom AudioContext — verified
 * manually, see docs/ARCHITECTURE.md).
 *
 * Gemini Live's audio formats are fixed, not negotiated (see
 * packages/shared's GEMINI_INPUT_SAMPLE_RATE_HZ / GEMINI_OUTPUT_SAMPLE_RATE_HZ):
 *   browser mic  -> resampleLinear -> floatTo16BitPCM -> pcm16ToBase64 -> gateway -> Gemini   (16kHz mono PCM16)
 *   Gemini -> gateway -> base64ToInt16 -> int16ToFloat32 -> AudioBuffer -> speaker            (24kHz mono PCM16)
 */

/** Converts float samples in [-1, 1] to signed 16-bit PCM, clamping out-of-range values. */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]!));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}

/** Converts signed 16-bit PCM samples back to float in [-1, 1]. */
export function int16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = input[i]!;
    output[i] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
  }
  return output;
}

/**
 * Simple linear-interpolation resampler. Not audiophile-grade, but cheap
 * (O(n), no allocation-heavy FFT machinery) and more than sufficient
 * quality for voice — appropriate for real-time use on the main thread.
 */
export function resampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate || input.length === 0) return input;

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;
    const a = input[srcIndex] ?? input[input.length - 1] ?? 0;
    const b = input[srcIndex + 1] ?? a;
    output[i] = a + (b - a) * frac;
  }

  return output;
}

/** base64-encodes little-endian Int16 PCM samples. Chunked to stay safe for large arrays. */
export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  return uint8ArrayToBase64(bytes);
}

/** Decodes base64 little-endian Int16 PCM samples. */
export function base64ToPcm16(base64: string): Int16Array {
  const bytes = base64ToUint8Array(base64);
  // Copy into a fresh, aligned buffer — a view directly over `bytes.buffer`
  // could be misaligned/oversized depending on how the Uint8Array was sliced.
  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  return new Int16Array(aligned.buffer, 0, Math.floor(aligned.length / 2));
}

const CHUNK_SIZE = 0x8000; // avoid blowing the call stack on String.fromCharCode(...large array)

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Root-mean-square amplitude of a float32 chunk, in [0, 1] — drives the mic-level UI indicator. */
export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i]! * samples[i]!;
  }
  return Math.sqrt(sumSquares / samples.length);
}
