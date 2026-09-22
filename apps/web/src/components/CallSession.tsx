"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDuration } from "@cold-call-gym/shared";

type Props = {
  scenarioSlug: string | null;
  scenarioLabel: string;
  prospectName: string;
  prospectTitle: string;
  prospectCompany: string;
  freeSecondsRemaining: number;
  paidCreditsRemaining: number;
};

type Status = "idle" | "authorizing" | "connecting" | "active" | "ending" | "ended" | "blocked";

export default function CallSession({
  scenarioSlug,
  scenarioLabel,
  prospectName,
  prospectTitle,
  prospectCompany,
  freeSecondsRemaining,
  paidCreditsRemaining,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [maxAllowedSeconds, setMaxAllowedSeconds] = useState<number | null>(null);
  const [finalRemaining, setFinalRemaining] = useState<{ free: number; paid: number } | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const endingRef = useRef(false);

  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (levelRef.current) clearInterval(levelRef.current);
    };
  }, []);

  async function startCall() {
    setError(null);
    setStatus("authorizing");

    try {
      // Server-side authorization: validates the scenario and current
      // entitlement, then creates the call_sessions row. This is the first
      // of two server gates — the second (and only financially binding
      // one) is the atomic finalize step when the call ends.
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioSlug: scenarioSlug ?? "busy-vp" }),
      });

      if (res.status === 402) {
        setStatus("blocked");
        setError("You're out of practice time for now.");
        return;
      }
      if (!res.ok) {
        throw new Error(`Authorization failed (${res.status})`);
      }

      const authorization = (await res.json()) as { sessionId: string; maxAllowedSeconds: number };
      setSessionId(authorization.sessionId);
      setMaxAllowedSeconds(authorization.maxAllowedSeconds);

      setStatus("connecting");
      // Mock provider "connects" almost instantly; Phase 3 will wire this to
      // the real voice-gateway WebSocket lifecycle (created → authorized →
      // connecting → active → ending → completed).
      setTimeout(() => {
        setStatus("active");
        timerRef.current = setInterval(() => {
          setSeconds((s) => {
            const next = s + 1;
            if (authorization.maxAllowedSeconds > 0 && next >= authorization.maxAllowedSeconds) {
              void endCall(next);
            }
            return next;
          });
        }, 1000);
        levelRef.current = setInterval(() => setLevel(Math.random()), 220);
      }, 600);
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Could not start the call. Please try again.");
    }
  }

  async function endCall(finalSeconds?: number) {
    if (endingRef.current) return;
    endingRef.current = true;

    if (timerRef.current) clearInterval(timerRef.current);
    if (levelRef.current) clearInterval(levelRef.current);
    setLevel(0);
    setStatus("ending");

    const elapsed = finalSeconds ?? secondsRef.current;

    if (!sessionId) {
      setStatus("ended");
      return;
    }

    try {
      // IMPORTANT: `elapsed` is this component's own client-side timer —
      // presentation state only. It is NOT authoritative for billing. The
      // server clamps/recomputes the chargeable duration from trusted
      // timestamps before touching the credit ledger (see
      // finalizeCallUsage() and finalize_call_usage() in
      // supabase/migrations/003_entitlement_foundation.sql).
      const res = await fetch(`/api/voice/session/${sessionId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationSeconds: elapsed }),
      });

      if (res.ok) {
        const entitlementRes = await fetch("/api/entitlement");
        if (entitlementRes.ok) {
          const entitlement = (await entitlementRes.json()) as {
            freeSecondsRemaining: number;
            paidCreditsRemaining: number;
          };
          setFinalRemaining({
            free: entitlement.freeSecondsRemaining,
            paid: entitlement.paidCreditsRemaining,
          });
        }
      }
    } catch {
      // Finalization is retried implicitly: usage_idempotency_key means a
      // future retry (or the Phase 3 gateway) can safely call finalize
      // again without double-charging.
    } finally {
      setStatus("ended");
    }
  }

  const displayRemaining = Math.max(0, freeSecondsRemaining - seconds);
  const initials = prospectName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="call card">
      <p className="accent">
        <b>{scenarioLabel}</b>
      </p>

      <div className={`avatar ${status === "active" && !muted ? "avatar-live" : ""}`}>{initials}</div>
      <h1>{prospectName}</h1>
      <p className="muted">
        {prospectTitle} · {prospectCompany}
      </p>

      <div className="timer">{formatDuration(seconds)}</div>

      <div className="voice-viz" aria-hidden="true">
        {Array.from({ length: 9 }).map((_, i) => {
          const active = status === "active" && !muted;
          const height = active ? 6 + Math.round(Math.abs(Math.sin(level * 6 + i)) * 28) : 4;
          return <span key={i} style={{ height }} className={active ? "bar bar-active" : "bar"} />;
        })}
      </div>

      {error && <p className="form-error">{error}</p>}

      {status === "idle" && (
        <>
          <p>
            <button className="button" onClick={startCall}>
              Start mock call
            </button>
          </p>
          <p className="muted">
            {formatDuration(freeSecondsRemaining)} free · {paidCreditsRemaining} paid credits
          </p>
        </>
      )}

      {status === "authorizing" && <p className="muted">Checking your practice time…</p>}
      {status === "connecting" && <p className="muted">Connecting to prospect…</p>}
      {status === "ending" && <p className="muted">Wrapping up…</p>}

      {status === "active" && (
        <>
          <div className="call-controls">
            <button
              className={`button ghost ${muted ? "button-active" : ""}`}
              onClick={() => setMuted((m) => !m)}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button className="button danger" onClick={() => void endCall()}>
              End call
            </button>
          </div>
          <p className="muted">
            {formatDuration(displayRemaining)} free minutes remaining
            {maxAllowedSeconds ? ` · max ${formatDuration(maxAllowedSeconds)} this call` : ""}
          </p>
        </>
      )}

      {status === "ended" && (
        <>
          <p className="accent">
            <b>CALL COMPLETE</b>
          </p>
          {finalRemaining && (
            <p className="muted">
              {formatDuration(finalRemaining.free)} free minutes and {finalRemaining.paid} paid credits
              remaining today.
            </p>
          )}
          <p>
            <Link className="button" href="/report/demo">
              View coaching report
            </Link>
          </p>
        </>
      )}

      <p className="muted call-footnote">Starter mode uses a mock voice provider. Gemini Live is Phase 4.</p>
    </div>
  );
}
