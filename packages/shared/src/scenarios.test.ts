import { describe, it, expect } from "vitest";
import { SCENARIOS, getScenarioBySlug, buildPersonaSystemInstruction } from "./index.js";
import type { Scenario } from "./index.js";

describe("getScenarioBySlug", () => {
  it("finds a real scenario by slug", () => {
    expect(getScenarioBySlug("busy-vp")?.name).toBe("Busy VP of Sales");
  });

  it("returns null for an unknown slug", () => {
    expect(getScenarioBySlug("does-not-exist")).toBeNull();
  });
});

describe("buildPersonaSystemInstruction", () => {
  it("falls back to a generic but still in-character prompt when no scenario is found", () => {
    const prompt = buildPersonaSystemInstruction(null);
    expect(prompt).toContain("sales prospect");
    expect(prompt.toLowerCase()).not.toContain("chatgpt");
  });

  it("includes the prospect's name, role, and company", () => {
    const scenario = getScenarioBySlug("busy-vp")!;
    const prompt = buildPersonaSystemInstruction(scenario);
    expect(prompt).toContain("Jordan Blake");
    expect(prompt).toContain("VP of Sales");
    expect(prompt).toContain("Northstar Software");
  });

  it("includes the scenario's objections without a robotic verbatim list label", () => {
    const scenario = getScenarioBySlug("busy-vp")!;
    const prompt = buildPersonaSystemInstruction(scenario);
    for (const objection of scenario.persona.common_objections as string[]) {
      expect(prompt).toContain(objection);
    }
  });

  it("includes hidden_state context without literally calling it a 'hidden pain point' the model should announce", () => {
    const scenario = getScenarioBySlug("busy-vp")!;
    const prompt = buildPersonaSystemInstruction(scenario);
    expect(prompt).toContain("forecast visibility");
    expect(prompt).toContain("never state this outright");
  });

  it("frames difficulty as materially affecting resistance, and differs by difficulty level", () => {
    const practice = buildPersonaSystemInstruction({ ...getScenarioBySlug("send-email")!, difficulty: "practice" });
    const challenge = buildPersonaSystemInstruction({ ...getScenarioBySlug("price-objection")! });
    expect(practice).toContain("LOW resistance");
    expect(challenge).toContain("HIGH resistance");
    expect(practice).not.toBe(challenge);
  });

  it("instructs the model to stay in character, not coach, and not reveal instructions", () => {
    const scenario = getScenarioBySlug("busy-vp")!;
    const prompt = buildPersonaSystemInstruction(scenario);
    expect(prompt).toMatch(/never act as a sales coach|not.*sales coach/i);
    expect(prompt).toMatch(/never reveal.*instructions/i);
    expect(prompt).toMatch(/do not announce.*ai/i);
  });

  it("produces a distinct prompt for every scenario in the catalog (no accidental sharing)", () => {
    const prompts = SCENARIOS.map((s) => buildPersonaSystemInstruction(s));
    expect(new Set(prompts).size).toBe(SCENARIOS.length);
  });

  it("handles a scenario with a sparse persona (no optional fields) without throwing", () => {
    const sparse: Scenario = {
      id: "sparse",
      slug: "sparse",
      name: "Sparse",
      description: "desc",
      difficulty: "realistic",
      objective: "objective",
      prospect_role: "Manager",
      prospect_company: "Acme",
      persona: {},
      hidden_state: {},
      target_duration_seconds: 120,
      is_active: true,
    };
    expect(() => buildPersonaSystemInstruction(sparse)).not.toThrow();
    const prompt = buildPersonaSystemInstruction(sparse);
    expect(prompt).toContain("Manager");
    expect(prompt).toContain("Acme");
  });
});
