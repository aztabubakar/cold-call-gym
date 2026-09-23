import Link from "next/link";
import { redirect } from "next/navigation";
import CallSession from "@/components/CallSession";
import SupabaseSetupNotice from "@/components/SupabaseSetupNotice";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getEntitlement } from "@/lib/server/entitlement";
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
    const redirectTarget = scenarioSlug ? `/call?scenario=${encodeURIComponent(scenarioSlug)}` : "/call";
    redirect(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
  }

  const scenario = scenarioSlug ? await getScenarioBySlug(scenarioSlug) : null;
  // Server-authoritative snapshot at page-load time. This is only used to
  // decide whether to show the "start call" UI at all — the real,
  // race-safe gate happens server-side when the call is actually
  // authorized (POST /api/voice/session) and again, atomically, when
  // usage is finalized.
  const entitlement = await getEntitlement(user.id);

  if (entitlement.totalUsableSeconds <= 0) {
    return (
      <div className="call card">
        <p className="accent">
          <b>OUT OF PRACTICE TIME</b>
        </p>
        <h1>You&apos;ve used today&apos;s free practice time.</h1>
        <p className="muted">
          Free minutes reset daily. Come back tomorrow, or buy credits to keep practicing today.
        </p>
        <div className="call-controls">
          <Link className="button ghost" href="/dashboard">
            Come back tomorrow
          </Link>
          <Link className="button" href="/billing">
            Get more credits
          </Link>
        </div>
      </div>
    );
  }

  return (
    <CallSession
      scenarioSlug={scenario?.slug ?? null}
      scenarioLabel={scenario ? `${scenario.difficulty.toUpperCase()} MODE` : "PRACTICE MODE"}
      prospectName={scenario ? (scenario.persona.name as string) ?? scenario.prospect_role : "Jordan Blake"}
      prospectTitle={scenario ? scenario.prospect_role : "VP of Sales"}
      prospectCompany={scenario ? scenario.prospect_company : "Northstar Software"}
      freeSecondsRemaining={entitlement.freeSecondsRemaining}
      paidCreditsRemaining={entitlement.paidCreditsRemaining}
    />
  );
}
