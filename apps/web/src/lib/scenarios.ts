import type { Scenario } from "@cold-call-gym/shared";
import { createClient } from "./supabase/server";

// Used when Supabase isn't configured yet (e.g. first local run before
// `supabase/seed.sql` has been applied) so scenario pages still render.
export const FALLBACK_SCENARIOS: Scenario[] = [
  {
    id: "fallback-busy-vp",
    slug: "busy-vp",
    name: "Busy VP of Sales",
    description: "Earn attention from an impatient executive.",
    difficulty: "realistic",
    objective: "Secure permission for a deeper conversation.",
    prospect_role: "VP of Sales",
    prospect_company: "Northstar Software",
    persona: {
      name: "Jordan Blake",
      patience: "low",
      skepticism: "high",
      common_objections: ["I have two minutes. What is this about?", "We're not looking right now."],
    },
    hidden_state: { pain_point: "forecast visibility" },
    target_duration_seconds: 180,
    is_active: true,
  },
  {
    id: "fallback-send-email",
    slug: "send-email",
    name: "Send me an email",
    description: "Recover from the classic brush-off.",
    difficulty: "practice",
    objective: "Earn one discovery question or follow-up.",
    prospect_role: "Director of Operations",
    prospect_company: "Lumen Logistics",
    persona: {
      name: "Priya Nathan",
      patience: "medium",
      skepticism: "medium",
      common_objections: ["Can you just email me something?", "I don't take cold calls."],
    },
    hidden_state: { pain_point: "manual reporting" },
    target_duration_seconds: 300,
    is_active: true,
  },
  {
    id: "fallback-not-interested",
    slug: "not-interested",
    name: "Not interested",
    description: "Handle early resistance naturally.",
    difficulty: "realistic",
    objective: "Turn a reflexive no into thirty more seconds of attention.",
    prospect_role: "Marketing Manager",
    prospect_company: "Fieldstone Retail",
    persona: {
      name: "Dana Ruiz",
      patience: "low",
      skepticism: "medium",
      common_objections: ["We're not interested.", "We already tried something like this."],
    },
    hidden_state: { pain_point: "campaign attribution" },
    target_duration_seconds: 240,
    is_active: true,
  },
  {
    id: "fallback-competitor",
    slug: "competitor",
    name: "We already use a competitor",
    description: "Differentiate without attacking the incumbent.",
    difficulty: "challenge",
    objective: "Uncover one unmet need.",
    prospect_role: "Head of Revenue Operations",
    prospect_company: "Atlas Cloud",
    persona: {
      name: "Marcus Webb",
      patience: "medium",
      skepticism: "high",
      common_objections: ["We already have a platform for that.", "Switching costs aren't worth it."],
    },
    hidden_state: { pain_point: "adoption" },
    target_duration_seconds: 360,
    is_active: true,
  },
  {
    id: "fallback-gatekeeper",
    slug: "gatekeeper",
    name: "Gatekeeper",
    description: "Reach the right person professionally.",
    difficulty: "challenge",
    objective: "Get transferred to or scheduled with the decision maker.",
    prospect_role: "Executive Assistant",
    prospect_company: "Harbor Financial",
    persona: {
      name: "Casey Lin",
      patience: "medium",
      skepticism: "high",
      common_objections: ["She's not available.", "What is this regarding, exactly?"],
    },
    hidden_state: { pain_point: "screening volume" },
    target_duration_seconds: 150,
    is_active: true,
  },
  {
    id: "fallback-price-objection",
    slug: "price-objection",
    name: "Price objection",
    description: "Defend value without discounting on reflex.",
    difficulty: "challenge",
    objective: "Reframe the conversation around ROI, not cost.",
    prospect_role: "Finance Director",
    prospect_company: "Ridgeline Manufacturing",
    persona: {
      name: "Alicia Ferro",
      patience: "medium",
      skepticism: "high",
      common_objections: ["That's way more than we budgeted.", "Send me a discount and I'll consider it."],
    },
    hidden_state: { pain_point: "budget approval" },
    target_duration_seconds: 300,
    is_active: true,
  },
];

export async function getScenarios(): Promise<Scenario[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return FALLBACK_SCENARIOS;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("scenarios")
      .select("*")
      .eq("is_active", true)
      .order("target_duration_seconds", { ascending: true });

    if (error || !data || data.length === 0) return FALLBACK_SCENARIOS;
    return data as unknown as Scenario[];
  } catch {
    return FALLBACK_SCENARIOS;
  }
}

export async function getScenarioBySlug(slug: string): Promise<Scenario | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return FALLBACK_SCENARIOS.find((s) => s.slug === slug) ?? null;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("scenarios")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) return FALLBACK_SCENARIOS.find((s) => s.slug === slug) ?? null;
    return data as unknown as Scenario;
  } catch {
    return FALLBACK_SCENARIOS.find((s) => s.slug === slug) ?? null;
  }
}
