import { GEMINI_INPUT_SAMPLE_RATE_HZ } from "@cold-call-gym/shared";
import { floatTo16BitPCM, pcm16ToBase64, resampleLinear, rmsLevel } from "./pcm";

export type MicCaptureError =
  | { code: "permission_denied"; message: string }
  | { code: "device_error"; message: string }
  | { code: "unsupported"; message: string };

/**
 * Real browser microphone capture, streamed in small real-time chunks.
 *
 * Requests getUserMedia only when start() is called (i.e. only in
 * response to the user clicking "Start call" — see CallSession.tsx, which
 * is what satisfies "request microphone permission only when user starts
 * the call"). Uses an AudioWorkletNode (not the deprecated
 * ScriptProcessorNode) for capture — see public/audio/mic-worklet.js —
 * which does no processing of its own; all resampling/PCM16 conversion
 * happens here on the main thread using pcm.ts's pure functions.
 *
 * DOM-coupled, so not unit-tested directly (no AudioContext/getUserMedia
 * in the Vitest environment) — verified manually in a real browser. The
 * actual audio math it calls (resampleLinear, floatTo16BitPCM,
 * pcm16ToBase64) is fully unit-tested in pcm.test.ts.
 */
export class MicCapture {
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private stopped = false;

  constructor(private readonly audioContext: AudioContext) {}

  async start(
    onChunk: (base64Pcm16: string, level: number) => void,
    onError: (err: MicCaptureError) => void,
  ): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      onError({ code: "unsupported", message: "Microphone capture isn't supported in this browser." });
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
        onError({ code: "permission_denied", message: "Microphone permission was denied." });
      } else {
        onError({ code: "device_error", message: "Could not access the microphone." });
      }
      return;
    }

    // Device loss mid-call (unplugged, OS revoked access, etc.).
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (this.stopped) return;
        onError({ code: "device_error", message: "The microphone was disconnected." });
      });
    }

    try {
      await this.audioContext.audioWorklet.addModule("/audio/mic-worklet.js");
    } catch {
      onError({ code: "unsupported", message: "Could not start the audio processor." });
      this.stop();
      return;
    }

    if (this.stopped) return; // stop() may have been called while awaiting the above

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, "mic-capture-processor");

    this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (this.stopped) return;
      const float32 = event.data;
      const resampled = resampleLinear(float32, this.audioContext.sampleRate, GEMINI_INPUT_SAMPLE_RATE_HZ);
      const base64 = pcm16ToBase64(floatTo16BitPCM(resampled));
      onChunk(base64, rmsLevel(float32));
    };

    this.sourceNode.connect(this.workletNode);
    // Some browsers (notably Safari) throttle/stop calling process() on a
    // worklet node that isn't connected anywhere in the graph reaching
    // `destination`. Route through a silent (gain=0) node so the graph
    // stays "live" without the mic ever being audibly looped back.
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.workletNode.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);
  }

  stop(): void {
    this.stopped = true;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.workletNode?.port.close();
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.silentGain?.disconnect();
    this.stream = null;
    this.workletNode = null;
    this.sourceNode = null;
    this.silentGain = null;
  }
}
