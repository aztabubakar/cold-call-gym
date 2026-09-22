"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDuration } from "@cold-call-gym/shared";

type Props = {
  scenarioLabel: string;
  prospectName: string;
  prospectTitle: string;
  prospectCompany: string;
  freeSecondsRemaining: number;
};

export default function CallSession({
  scenarioLabel,
  prospectName,
  prospectTitle,
  prospectCompany,
  freeSecondsRemaining,
}: Props) {
  const [status, setStatus] = useState<"idle" | "connecting" | "active" | "ended">("idle");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (levelRef.current) clearInterval(levelRef.current);
    };
  }, []);

  function startCall() {
    setStatus("connecting");
    // Mock provider "connects" almost instantly; Phase 3 will wire this to
    // the real voice-gateway WebSocket lifecycle (created → authorized →
    // connecting → active → ending → completed).
    setTimeout(() => {
      setStatus("active");
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      levelRef.current = setInterval(() => setLevel(Math.random()), 220);
    }, 600);
  }

  function endCall() {
    setStatus("ended");
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelRef.current) clearInterval(levelRef.current);
    setLevel(0);
  }

  const remainingAfterCall = Math.max(0, freeSecondsRemaining - seconds);
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

      {status === "idle" && (
        <>
          <p>
            <button className="button" onClick={startCall}>
              Start mock call
            </button>
          </p>
          <p className="muted">{formatDuration(freeSecondsRemaining)} free minutes remaining</p>
        </>
      )}

      {status === "connecting" && <p className="muted">Connecting to prospect…</p>}

      {status === "active" && (
        <>
          <div className="call-controls">
            <button
              className={`button ghost ${muted ? "button-active" : ""}`}
              onClick={() => setMuted((m) => !m)}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button className="button danger" onClick={endCall}>
              End call
            </button>
          </div>
          <p className="muted">{formatDuration(remainingAfterCall)} free minutes remaining</p>
        </>
      )}

      {status === "ended" && (
        <>
          <p className="accent">
            <b>CALL COMPLETE</b>
          </p>
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
