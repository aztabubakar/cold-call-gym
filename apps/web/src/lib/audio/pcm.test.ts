import { describe, it, expect } from "vitest";
import { floatTo16BitPCM, int16ToFloat32, resampleLinear, pcm16ToBase64, base64ToPcm16, rmsLevel } from "./pcm";

describe("floatTo16BitPCM", () => {
  it("converts 0 to 0", () => {
    expect(floatTo16BitPCM(new Float32Array([0]))[0]).toBe(0);
  });

  it("converts 1.0 to the max positive 16-bit value", () => {
    expect(floatTo16BitPCM(new Float32Array([1]))[0]).toBe(0x7fff);
  });

  it("converts -1.0 to the min 16-bit value", () => {
    expect(floatTo16BitPCM(new Float32Array([-1]))[0]).toBe(-0x8000);
  });

  it("clamps values outside [-1, 1] instead of overflowing/wrapping", () => {
    const out = floatTo16BitPCM(new Float32Array([2.5, -3.7]));
    expect(out[0]).toBe(0x7fff);
    expect(out[1]).toBe(-0x8000);
  });
});

describe("int16ToFloat32 / floatTo16BitPCM round trip", () => {
  it("round-trips within one quantization step", () => {
    const original = new Float32Array([0, 0.5, -0.5, 0.25, -0.99]);
    const back = int16ToFloat32(floatTo16BitPCM(original));
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(back[i]! - original[i]!)).toBeLessThan(0.001);
    }
  });
});

describe("resampleLinear", () => {
  it("returns the same array when rates match", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleLinear(input, 16000, 16000)).toBe(input);
  });

  it("halves the sample count when downsampling by half", () => {
    const input = new Float32Array(200).fill(0.5);
    const out = resampleLinear(input, 48000, 24000);
    expect(out.length).toBeCloseTo(100, -1);
  });

  it("preserves a constant (DC) signal through resampling", () => {
    const input = new Float32Array(480).fill(0.42);
    const out = resampleLinear(input, 48000, 16000);
    for (const sample of out) {
      expect(sample).toBeCloseTo(0.42, 5);
    }
  });

  it("upsamples correctly (more output samples than input)", () => {
    const input = new Float32Array(160).fill(0.1);
    const out = resampleLinear(input, 16000, 24000);
    expect(out.length).toBeGreaterThan(input.length);
  });

  it("never throws on a single-sample input", () => {
    expect(() => resampleLinear(new Float32Array([0.3]), 48000, 16000)).not.toThrow();
  });

  it("never throws on an empty input", () => {
    expect(resampleLinear(new Float32Array([]), 48000, 16000).length).toBe(0);
  });
});

describe("pcm16ToBase64 / base64ToPcm16 round trip", () => {
  it("round-trips exact integer sample values", () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 1234, -5678]);
    const decoded = base64ToPcm16(pcm16ToBase64(samples));
    expect(Array.from(decoded)).toEqual(Array.from(samples));
  });

  it("round-trips a large chunk without stack overflow", () => {
    const samples = new Int16Array(50_000);
    for (let i = 0; i < samples.length; i++) samples[i] = (i % 60000) - 30000;
    const decoded = base64ToPcm16(pcm16ToBase64(samples));
    expect(decoded.length).toBe(samples.length);
    expect(decoded[0]).toBe(samples[0]);
    expect(decoded.at(-1)).toBe(samples.at(-1));
  });

  it("produces valid base64 (decodable by atob)", () => {
    const samples = new Int16Array([100, -100, 200]);
    const encoded = pcm16ToBase64(samples);
    expect(() => atob(encoded)).not.toThrow();
  });
});

describe("rmsLevel", () => {
  it("is 0 for silence", () => {
    expect(rmsLevel(new Float32Array(100))).toBe(0);
  });

  it("is 0 for an empty array", () => {
    expect(rmsLevel(new Float32Array([]))).toBe(0);
  });

  it("is 1 for a full-scale constant signal", () => {
    expect(rmsLevel(new Float32Array(10).fill(1))).toBeCloseTo(1, 5);
  });

  it("is between 0 and 1 for typical voice-level input", () => {
    const level = rmsLevel(new Float32Array([0.1, -0.2, 0.15, -0.05]));
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(1);
  });
});
