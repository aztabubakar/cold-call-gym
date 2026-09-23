"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDuration, GatewayToClientEventSchema, type GatewayToClientEvent } from "@cold-call-gym/shared";

type Props = {
  scenarioSlug: string | null;
  scenarioLabel: string;
  prospectName: string;
  prospectTitle: string;
  prospectCompany: string;
  remainingTodaySeconds: number;
};

type Status = "idle" | "authorizing" | "connecting" | "active" | "ending" | "ended" | "blocked";

export default function CallSession({
  scenarioSlug,
  scenarioLabel,
  prospectName,
  prospectTitle,
  prospectCompany,
  remainingTodaySeconds,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const [completion, setCompletion] = useState<{
    durationSeconds: number;
    freeSecondsUsed: number;
  } | null>(null);
  const [finalRemaining, setFinalRemaining] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const endedCleanlyRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (levelRef.current) clearInterval(levelRef.current);
      socketRef.current?.close();
    };
  }, []);

  function startLocalTimers() {
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    levelRef.current = setInterval(() => setLevel(Math.random()), 220);
  }

  function stopLocalTimers() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelRef.current) clearInterval(levelRef.current);
    setLevel(0);
  }

  async function refreshEntitlement() {
    try {
      const res = await fetch("/api/entitlement");
      if (res.ok) {
        const entitlement = (await res.json()) as { remainingTodaySeconds: number };
        setFinalRemaining(entitlement.remainingTodaySeconds);
      }
    } catch {
      // Non-critical: the dashboard will show the correct balance on next load regardless.
    }
  }

  function handleGatewayEvent(event: GatewayToClientEvent) {
    switch (event.type) {
      case "connected":
        return;
      case "active":
        setStatus("active");
        setRemainingSeconds(event.maxAllowedSeconds);
        startLocalTimers();
        return;
      case "quota":
        // Server-reported remaining time. The browser's own per-second tick
        // above is presentation-only smoothing between these authoritative
        // updates — the gateway's monotonic timer is what actually decides
        // billing (see services/voice-gateway/src/session-runtime.ts).
        setRemainingSeconds(event.remainingSeconds);
        return;
      case "quota_exhausted":
        setQuotaExhausted(true);
        setStatus("ending");
        return;
      case "completed":
        endedCleanlyRef.current = true;
        stopLocalTimers();
        setCompletion({
          durationSeconds: event.durationSeconds,
          freeSecondsUsed: event.freeSecondsUsed,
        });
        setStatus("ended");
        void refreshEntitlement();
        return;
      case "error":
        setError(event.message);
        return;
      case "closed":
        socketRef.current?.close();
        if (!endedCleanlyRef.current) {
          // The gateway closed without ever sending `completed` (e.g. a
          // rejected connection before the call became active).
          stopLocalTimers();
          setStatus((s) => (s === "active" || s === "ending" ? "ended" : "idle"));
        }
        return;
      case "pong":
        return;
    }
  }

  async function startCall() {
    setError(null);
    setQuotaExhausted(false);
    setStatus("authorizing");
    endedCleanlyRef.current = false;

    try {
      // Server-side authorization: validates the scenario and current
      // entitlement, creates the call_sessions row, and signs a short-lived
      // token for the voice gateway. This does not itself spend anything —
      // the gateway is what actually meters and finalizes usage.
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioSlug: scenarioSlug ?? "busy-vp" }),
      });

      if (res.status === 402) {
        setStatus("blocked");
        return;
      }
      if (!res.ok) {
        throw new Error(`Authorization failed (${res.status})`);
      }

      const authorization = (await res.json()) as {
        sessionId: string;
        gatewayUrl: string;
        token: string;
        maxAllowedSeconds: number;
      };

      setStatus("connecting");
      setSeconds(0);
      setRemainingSeconds(authorization.maxAllowedSeconds);

      const wsUrl = `${authorization.gatewayUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(authorization.token)}`;
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onmessage = (message) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.data as string);
        } catch {
          return;
        }
        const result = GatewayToClientEventSchema.safeParse(parsed);
        if (result.success) handleGatewayEvent(result.data);
      };

      socket.onerror = () => {
        setError("Connection to the voice gateway was lost.");
      };

      socket.onclose = () => {
        if (!endedCleanlyRef.current) {
          stopLocalTimers();
          setStatus((s) => (s === "authorizing" || s === "connecting" ? "idle" : s));
        }
      };
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Could not start the call. Please try again.");
    }
  }

  function endCall() {
    // The browser only ASKS the gateway to end the call — it never submits
    // a duration. The gateway's own monotonic timer decides how much time
    // was actually billable (see docs/ARCHITECTURE.md).
    setStatus("ending");
    socketRef.current?.send(JSON.stringify({ type: "end" }));
  }

  const displayRemaining = remainingSeconds ?? Math.max(0, remainingTodaySeconds - seconds);
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
          <p className="muted">Today&apos;s practice time</p>
          <p>
            <b>{formatDuration(remainingTodaySeconds)} remaining</b>
          </p>
        </>
      )}

      {status === "blocked" && (
        <>
          <p className="accent">
            <b>DAILY LIMIT REACHED</b>
          </p>
          <p className="muted">You&apos;re out of practice time for today. Your allowance will reset automatically.</p>
          <div className="call-controls">
            <Link className="button ghost" href="/dashboard">
              Back to Dashboard
            </Link>
            <Link className="button" href="/contact-sales">
              Contact Sales
            </Link>
          </div>
        </>
      )}

      {status === "authorizing" && <p className="muted">Checking your practice time…</p>}
      {status === "connecting" && <p className="muted">Connecting to prospect…</p>}

      {(status === "active" || status === "ending") && (
        <>
          <div className="call-controls">
            <button
              className={`button ghost ${muted ? "button-active" : ""}`}
              onClick={() => setMuted((m) => !m)}
              disabled={status === "ending"}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button className="button danger" onClick={endCall} disabled={status === "ending"}>
              {status === "ending" ? "Ending…" : "End call"}
            </button>
          </div>
          <p className="muted">
            {formatDuration(Math.max(0, displayRemaining))} remaining this call
          </p>
        </>
      )}

      {status === "ended" && quotaExhausted && (
        <>
          <p className="accent">
            <b>DAILY LIMIT REACHED</b>
          </p>
          <p>You&apos;ve used today&apos;s free practice allowance.</p>
          <p className="muted">Your allowance will reset automatically.</p>
          <div className="call-controls">
            <Link className="button" href="/contact-sales">
              Contact Sales
            </Link>
            <Link className="button ghost" href="/dashboard">
              Back to Dashboard
            </Link>
          </div>
        </>
      )}

      {status === "ended" && !quotaExhausted && (
        <>
          <p className="accent">
            <b>CALL COMPLETE</b>
          </p>
          {completion && (
            <p className="muted">{formatDuration(completion.durationSeconds)} on this call.</p>
          )}
          {finalRemaining !== null && (
            <p className="muted">{formatDuration(finalRemaining)} of practice time remaining today.</p>
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
