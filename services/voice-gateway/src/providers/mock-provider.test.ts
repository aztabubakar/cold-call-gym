import { describe, it, expect } from "vitest";
import { MockVoiceProvider } from "./mock-provider.js";
import type { VoiceEvent, VoiceProvider } from "./voice-provider.js";

describe("MockVoiceProvider", () => {
  it("emits connected then a text event after connect()", async () => {
    const provider: VoiceProvider = new MockVoiceProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));

    await provider.connect({ systemPrompt: "test" });
    // connect() schedules events via queueMicrotask; flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(events[0]).toEqual({ type: "connected" });
    expect(events[1]).toMatchObject({ type: "text" });
  });

  it("emits closed on close()", async () => {
    const provider = new MockVoiceProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));

    await provider.close();

    expect(events).toEqual([{ type: "closed" }]);
  });

  it("accepts sendAudio without throwing", async () => {
    const provider = new MockVoiceProvider();
    await expect(provider.sendAudio("base64data")).resolves.toBeUndefined();
  });
});
