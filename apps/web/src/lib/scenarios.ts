import type { Scenario } from "@cold-call-gym/shared";
import { SCENARIOS, getScenarioBySlug as getScenarioBySlugSync } from "@cold-call-gym/shared";

export { SCENARIOS };

export async function getScenarios(): Promise<Scenario[]> {
  return SCENARIOS;
}

export async function getScenarioBySlug(slug: string): Promise<Scenario | null> {
  return getScenarioBySlugSync(slug);
}
