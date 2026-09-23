import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDuration } from "@cold-call-gym/shared";
import SupabaseSetupNotice from "@/components/SupabaseSetupNotice";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getDashboardData } from "@/lib/dashboard";

export const metadata = { title: "Dashboard · Cold Call Gym" };

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    return <SupabaseSetupNotice />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/dashboard");
  }

  const data = await getDashboardData(user.id);

  return (
    <>
      <section className="page-head">
        <div>
          <p className="accent">
            <b>DASHBOARD</b>
          </p>
          <h1>Welcome back.</h1>
          <p className="muted">Keep your reps consistent. Every call sharpens the next one.</p>
        </div>
        <Link className="button" href="/scenarios">
          Start Practice Call
        </Link>
      </section>

      <section className="grid stat-grid">
        <div className="card">
          <div className="metric">{formatDuration(data.freeSecondsRemaining)}</div>
          <div className="muted">Today&apos;s free practice remaining</div>
        </div>
        <div className="card">
          <div className="metric">{data.paidCreditsRemaining}</div>
          <div className="muted">Paid credits</div>
        </div>
        <div className="card">
          <div className="metric">{formatDuration(data.totalUsableSeconds)}</div>
          <div className="muted">Total practice available</div>
        </div>
        <div className="card">
          <div className="metric">{data.callsThisWeek}</div>
          <div className="muted">Calls this week</div>
        </div>
      </section>

      <section className="dashboard-columns">
        <div className="card panel">
          <h2>Recent sessions</h2>
          {data.recentSessions.length === 0 ? (
            <p className="muted">No calls yet. Start a practice call to see it show up here.</p>
          ) : (
            <ul className="session-list">
              {data.recentSessions.map((session) => (
                <li key={session.id}>
                  <div>
                    <b>{session.scenarioName}</b>
                    <span className="muted"> · {formatDuration(session.durationSeconds)}</span>
                  </div>
                  <span className={`badge badge-${session.state}`}>{session.state}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card panel">
          <h2>Recommended drills</h2>
          {data.recommended.length === 0 ? (
            <p className="muted">
              <Link href="/scenarios">Browse scenarios</Link> to find your next drill.
            </p>
          ) : (
            <ul className="drill-list">
              {data.recommended.map((scenario) => (
                <li key={scenario.slug}>
                  <div>
                    <b>{scenario.name}</b>
                    <p className="muted">{scenario.objective}</p>
                  </div>
                  <Link className="button ghost" href={`/scenarios/${scenario.slug}`}>
                    View
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
