const PACKS = ["50 credits", "150 credits", "400 credits"];

export default function Billing() {
  return (
    <>
      <div className="page-head">
        <div>
          <p className="accent">
            <b>CREDITS</b>
          </p>
          <h1>Practice credits</h1>
          <p className="muted">
            Use free daily minutes first. Purchased credits continue practice after the free
            allowance is used.
          </p>
        </div>
      </div>
      <div className="grid">
        {PACKS.map((pack) => (
          <div className="card" key={pack}>
            <h3>{pack}</h3>
            <button className="button ghost" disabled>
              Stripe checkout — Phase 6
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
