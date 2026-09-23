"use client";

import { useState, type FormEvent } from "react";

export default function ContactSalesForm() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") ?? ""),
      workEmail: String(formData.get("workEmail") ?? ""),
      company: String(formData.get("company") ?? ""),
      jobTitle: String(formData.get("jobTitle") ?? ""),
      teamSize: String(formData.get("teamSize") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      expectedUsage: String(formData.get("expectedUsage") ?? ""),
      message: String(formData.get("message") ?? ""),
      website: String(formData.get("website") ?? ""),
    };

    try {
      const res = await fetch("/api/contact-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error === "invalid_request" ? "Please check the form and try again." : "Something went wrong. Please try again.");
      }

      setSubmitted(true);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="card panel">
        <p className="accent">
          <b>REQUEST RECEIVED</b>
        </p>
        <h2>Thanks — your request has been received.</h2>
        <p className="muted">Our team will contact you.</p>
      </div>
    );
  }

  return (
    <form className="form contact-sales-form" onSubmit={handleSubmit}>
      {/* Honeypot: hidden from real visitors via CSS; bots that fill every field trip it. */}
      <label className="honeypot" aria-hidden="true">
        <span>Website</span>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </label>

      <label className="field">
        <span>Name</span>
        <input type="text" name="name" required maxLength={200} placeholder="Jordan Blake" />
      </label>

      <label className="field">
        <span>Work email</span>
        <input type="email" name="workEmail" required maxLength={320} placeholder="jordan@company.com" />
      </label>

      <label className="field">
        <span>Company</span>
        <input type="text" name="company" required maxLength={200} placeholder="Acme Inc." />
      </label>

      <label className="field">
        <span>Job title (optional)</span>
        <input type="text" name="jobTitle" maxLength={200} placeholder="VP of Sales" />
      </label>

      <label className="field">
        <span>Team size</span>
        <input type="text" name="teamSize" maxLength={100} placeholder="e.g. 5-10 reps" />
      </label>

      <label className="field">
        <span>Phone (optional)</span>
        <input type="tel" name="phone" maxLength={50} placeholder="+1 555 000 0000" />
      </label>

      <label className="field">
        <span>Expected monthly practice usage (optional)</span>
        <input type="text" name="expectedUsage" maxLength={500} placeholder="e.g. 20 hours/month across the team" />
      </label>

      <label className="field">
        <span>Message</span>
        <textarea name="message" maxLength={4000} rows={4} placeholder="Tell us about your team and what you need." />
      </label>

      {error && <p className="form-error">{error}</p>}

      <button className="button" type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Contact Sales"}
      </button>
    </form>
  );
}
