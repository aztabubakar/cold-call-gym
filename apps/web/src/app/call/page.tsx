import Link from "next/link";
import { redirect } from "next/navigation";
import CallSession from "@/components/CallSession";
import { getCurrentLead } from "@/lib/server/access";
import { getEntitlement } from "@/lib/server/entitlement";
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
  // Server-authoritative snapshot at page-load time. This is only used to
  // decide whether to show the "start call" UI at all — the real,
  // race-safe gate happens server-side when the call is actually
  // authorized (POST /api/voice/session) and again, atomically, when
  // usage is finalized.
  const entitlement = await getEntitlement(lead.id);

  if (!entitlement.canStartCall) {
    return (
      <div className="call card">
        <p className="accent">
          <b>DAILY LIMIT REACHED</b>
        </p>
        <h1>You&apos;ve used today&apos;s free practice allowance.</h1>
        <p className="muted">Your allowance will reset automatically.</p>
        <div className="call-controls">
          <Link className="button ghost" href="/dashboard">
            Back to Dashboard
          </Link>
          <Link className="button" href="/contact-sales">
            Contact Sales
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
      remainingTodaySeconds={entitlement.remainingTodaySeconds}
    />
  );
}
