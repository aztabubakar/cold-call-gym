import ContactSalesForm from "@/components/ContactSalesForm";

export const metadata = { title: "Contact Sales · Cold Call Gym" };

export default function ContactSalesPage() {
  return (
    <div className="contact-sales">
      <section className="page-head">
        <div>
          <p className="accent">
            <b>EXPANDED ACCESS</b>
          </p>
          <h1>Contact Sales</h1>
          <p className="muted" style={{ maxWidth: 640 }}>
            Every Cold Call Gym account gets 10 minutes of free AI voice practice every day — no
            credit card, no self-service payment. Teams and individuals who need more than the
            free daily allowance can talk to us about expanded access.
          </p>
        </div>
      </section>

      <div className="contact-sales-grid">
        <ContactSalesForm />

        <div className="card panel">
          <h2>What to expect</h2>
          <ul className="objection-list contact-sales-list">
            <li>We&apos;ll reply from a real person, usually within one business day.</li>
            <li>Tell us your team size and how much practice time you need.</li>
            <li>No commitment required to ask questions.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
