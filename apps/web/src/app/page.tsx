import Link from "next/link";

const FEATURES = [
  {
    title: "Realistic AI prospects",
    body: "Every scenario has its own patience, skepticism, and hidden objections — not a scripted bot.",
  },
  {
    title: "Server-side scoring",
    body: "Talk/listen ratio, discovery questions, and objection recovery are measured, not guessed.",
  },
  {
    title: "Free every day",
    body: "10 minutes of AI cold-call practice every day, on the house — no card required.",
  },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <p className="accent">
          <b>VOICE-FIRST SALES PRACTICE</b>
        </p>
        <h1>
          Get your reps in
          <br />
          before the real call.
        </h1>
        <p className="muted" style={{ fontSize: 20, maxWidth: 720 }}>
          Practice cold calls against realistic AI prospects, handle objections live, and get
          evidence-based coaching after every rep.
        </p>
        <p className="hero-ctas">
          <Link className="button" href="/signup">
            Start free
          </Link>
          <Link className="button ghost" href="/scenarios">
            Browse scenarios
          </Link>
        </p>
      </section>

      <section className="grid">
        <div className="card">
          <div className="metric">10 min</div>
          <div className="muted">Free every day</div>
        </div>
        <div className="card">
          <div className="metric">6</div>
          <div className="muted">Starter scenarios</div>
        </div>
        <div className="card">
          <div className="metric">9</div>
          <div className="muted">Coaching categories</div>
        </div>
      </section>

      <section className="grid feature-grid">
        {FEATURES.map((feature) => (
          <div className="card panel" key={feature.title}>
            <h3>{feature.title}</h3>
            <p className="muted">{feature.body}</p>
          </div>
        ))}
      </section>

      <section className="card panel">
        <h3>For sales teams</h3>
        <p className="muted">
          Need more than 10 minutes a day for yourself or your team? Talk to us about expanded
          access.
        </p>
        <Link className="button ghost" href="/contact-sales">
          Contact Sales
        </Link>
      </section>
    </>
  );
}
