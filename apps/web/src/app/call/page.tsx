import { redirect } from "next/navigation";
import CallSession from "@/components/CallSession";
import { getCurrentLead } from "@/lib/server/access";
import { getScenarioBySlug } from "@/lib/scenarios";

export const metadata = { title: "Practice call · Cold Call Gym" };

export default async function CallPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario: scenarioSlug } = await searchParams;

  const lead = await getCurrentLead();
  if (!lead) {
    const redirectTarget = scenarioSlug ? `/call?scenario=${encodeURIComponent(scenarioSlug)}` : "/call";
    redirect(`/start?redirect=${encodeURIComponent(redirectTarget)}`);
  }

  const scenario = scenarioSlug ? await getScenarioBySlug(scenarioSlug) : null;

  return (
    <CallSession
      scenarioSlug={scenario?.slug ?? null}
      scenarioLabel={scenario ? `${scenario.difficulty.toUpperCase()} MODE` : "PRACTICE MODE"}
      prospectName={scenario ? (scenario.persona.name as string) ?? scenario.prospect_role : "Jordan Blake"}
      prospectTitle={scenario ? scenario.prospect_role : "VP of Sales"}
      prospectCompany={scenario ? scenario.prospect_company : "Northstar Software"}
    />
  );
}
