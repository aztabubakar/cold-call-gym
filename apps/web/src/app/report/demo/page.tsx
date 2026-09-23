const scores = [
  ["Opening", 82],
  ["Discovery", 71],
  ["Value articulation", 88],
  ["Objection handling", 76],
  ["Next-step close", 68],
] as const;

export default function Report() {
  return (
    <>
      <div className="page-head">
        <div>
          <p className="accent">
            <b>CALL COMPLETE</b>
          </p>
          <h1>Strong relevance. Ask better discovery questions.</h1>
          <p className="muted">
            Full evidence-cited coaching arrives in a later phase. This is a sample report layout.
          </p>
        </div>
      </div>
      <div className="grid">
        {scores.map(([name, score]) => (
          <div className="card" key={name}>
            <div className="metric">{score}</div>
            <div className="muted">{name}</div>
          </div>
        ))}
      </div>
    </>
  );
}
