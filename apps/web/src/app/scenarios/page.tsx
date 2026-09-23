import Link from "next/link";
import { formatDuration } from "@cold-call-gym/shared";
import DifficultyBadge from "@/components/DifficultyBadge";
import { getScenarios } from "@/lib/scenarios";

export const metadata = { title: "Scenarios · Cold Call Gym" };

export default async function ScenariosPage() {
  const scenarios = await getScenarios();

  return (
    <>
      <h1>Choose your drill</h1>
      <p className="muted">Every prospect has different patience, objections, and hidden needs.</p>

      <div className="grid">
        {scenarios.map((scenario) => (
          <div className="card scenario-card" key={scenario.slug}>
            <DifficultyBadge difficulty={scenario.difficulty} />
            <h3>{scenario.name}</h3>
            <p className="muted">{scenario.description}</p>
            <p className="scenario-meta muted">
              {scenario.prospect_role} · {scenario.prospect_company} · ~
              {formatDuration(scenario.target_duration_seconds)}
            </p>
            <Link className="button" href={`/scenarios/${scenario.slug}`}>
              View scenario
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
