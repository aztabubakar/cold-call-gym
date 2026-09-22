import { describe, it, expect } from "vitest";
import { formatDuration, DAILY_FREE_SECONDS, ScenarioSchema } from "./index.js";

describe("formatDuration", () => {
  it("pads minutes and seconds", () => expect(formatDuration(65)).toBe("01:05"));
  it("floors fractional seconds", () => expect(formatDuration(59.9)).toBe("00:59"));
  it("clamps negative input to zero", () => expect(formatDuration(-10)).toBe("00:00"));
});

describe("DAILY_FREE_SECONDS", () => {
  it("is 10 minutes", () => expect(DAILY_FREE_SECONDS).toBe(600));
});

describe("ScenarioSchema", () => {
  it("accepts a well-formed scenario", () => {
    const result = ScenarioSchema.safeParse({
      id: "1",
      slug: "busy-vp",
      name: "Busy VP of Sales",
      description: "desc",
      difficulty: "realistic",
      objective: "objective",
      prospect_role: "VP of Sales",
      prospect_company: "Northstar",
      persona: { name: "Jordan Blake", common_objections: ["no thanks"] },
      hidden_state: {},
      target_duration_seconds: 180,
      is_active: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid difficulty", () => {
    const result = ScenarioSchema.safeParse({
      id: "1",
      slug: "x",
      name: "x",
      description: "x",
      difficulty: "impossible",
      objective: "x",
      prospect_role: "x",
      prospect_company: "x",
      persona: {},
      hidden_state: {},
      target_duration_seconds: 1,
      is_active: true,
    });
    expect(result.success).toBe(false);
  });
});
