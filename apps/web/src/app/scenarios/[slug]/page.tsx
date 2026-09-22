import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDuration } from "@cold-call-gym/shared";
import DifficultyBadge from "@/components/DifficultyBadge";
import { getScenarioBySlug } from "@/lib/scenarios";

export default async function ScenarioDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const scenario = await getScenarioBySlug(slug);

  if (!scenario) notFound();

  const objections = (scenario.persona.common_objections as string[] | undefined) ?? [];

  return (
    <div className="scenario-detail">
      <Link className="muted back-link" href="/scenarios">
        ← Back to scenarios
      </Link>

      <div className="page-head">
        <div>
          <DifficultyBadge difficulty={scenario.difficulty} />
          <h1>{scenario.name}</h1>
          <p className="muted">{scenario.description}</p>
        </div>
        <Link className="button" href={`/call?scenario=${scenario.slug}`}>
          Start Call
        </Link>
      </div>

      <section className="grid stat-grid">
        <div className="card">
          <div className="metric">{scenario.prospect_role}</div>
          <div className="muted">{scenario.prospect_company}</div>
        </div>
        <div className="card">
          <div className="metric">{formatDuration(scenario.target_duration_seconds)}</div>
          <div className="muted">Expected call duration</div>
        </div>
        <div className="card">
          <div className="metric">{scenario.persona.skepticism ?? "medium"}</div>
          <div className="muted">Skepticism level</div>
        </div>
      </section>

      <section className="card panel">
        <h2>Objective</h2>
        <p>{scenario.objective}</p>
      </section>

      {objections.length > 0 && (
        <section className="card panel">
          <h2>Likely objections</h2>
          <ul className="objection-list">
            {objections.map((objection) => (
              <li key={objection}>&ldquo;{objection}&rdquo;</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
