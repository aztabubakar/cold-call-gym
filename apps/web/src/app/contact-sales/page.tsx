import ContactSalesForm from "@/components/ContactSalesForm";
import { getCurrentLead } from "@/lib/server/access";

export const metadata = { title: "Contact Sales · Cold Call Gym" };

export default async function ContactSalesPage() {
  const lead = await getCurrentLead();

  return (
    <div className="contact-sales">
      <section className="page-head">
        <div>
          <p className="accent">
            <b>FOR TEAMS</b>
          </p>
          <h1>Contact Sales</h1>
          <p className="muted" style={{ maxWidth: 640 }}>
            Every Cold Call Gym visitor gets free, unlimited AI voice practice — no account, no
            credit card, no self-service payment. Teams and individuals wanting dedicated
            support, custom scenarios, or reporting can talk to us about what that looks like.
          </p>
        </div>
      </section>

      <div className="contact-sales-grid">
        <ContactSalesForm
          defaultName={lead?.name ?? ""}
          defaultEmail={lead?.email ?? ""}
          defaultPhone={lead?.phone ?? ""}
        />

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
