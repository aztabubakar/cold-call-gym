import { redirect } from "next/navigation";
import CallSession from "@/components/CallSession";
import SupabaseSetupNotice from "@/components/SupabaseSetupNotice";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getEntitlementSnapshot } from "@/lib/dashboard";
import { getScenarioBySlug } from "@/lib/scenarios";

export const metadata = { title: "Practice call · Cold Call Gym" };

export default async function CallPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return <SupabaseSetupNotice />;
  }

  const { scenario: scenarioSlug } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/call");
  }

  const scenario = scenarioSlug ? await getScenarioBySlug(scenarioSlug) : null;
  const entitlement = await getEntitlementSnapshot(user.id);

  return (
    <CallSession
      scenarioLabel={scenario ? `${scenario.difficulty.toUpperCase()} MODE` : "PRACTICE MODE"}
      prospectName={scenario ? (scenario.persona.name as string) ?? scenario.prospect_role : "Jordan Blake"}
      prospectTitle={scenario ? scenario.prospect_role : "VP of Sales"}
      prospectCompany={scenario ? scenario.prospect_company : "Northstar Software"}
      freeSecondsRemaining={entitlement.freeSecondsRemaining}
    />
  );
}
