"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function StartAccessForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";

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
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      consent: formData.get("consent") === "on",
      website: String(formData.get("website") ?? ""),
    };

    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error === "rate_limited"
            ? "Too many attempts. Please try again in a minute."
            : "Please check the form and try again.",
        );
      }

      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <p className="accent">
        <b>START PRACTICING FREE</b>
      </p>
      <h1>Get instant access</h1>
      <p className="muted">10 minutes of AI cold-call practice every day. No account, no password.</p>

      <form className="form" onSubmit={handleSubmit}>
        <label className="honeypot" aria-hidden="true">
          <span>Website</span>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>

        <label className="field">
          <span>Name</span>
          <input type="text" name="name" required maxLength={200} placeholder="Jordan Blake" autoComplete="name" />
        </label>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            required
            maxLength={320}
            placeholder="you@company.com"
            autoComplete="email"
          />
        </label>

        <label className="field">
          <span>Phone number</span>
          <input
            type="tel"
            name="phone"
            required
            maxLength={40}
            placeholder="+1 555 000 0000"
            autoComplete="tel"
          />
        </label>

        <label className="consent-field">
          <input type="checkbox" name="consent" required />
          <span>I&apos;m okay with Cold Call Gym contacting me at this email or phone number about my account and expanded access.</span>
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="button" type="submit" disabled={submitting}>
          {submitting ? "Please wait…" : "Start Practicing Free"}
        </button>
      </form>
    </div>
  );
}
