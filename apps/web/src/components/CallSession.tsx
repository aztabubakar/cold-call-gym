"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDuration, GatewayToClientEventSchema, type GatewayToClientEvent } from "@cold-call-gym/shared";
import { MicCapture, type MicCaptureError } from "@/lib/audio/mic-capture";
import { AudioPlaybackQueue } from "@/lib/audio/playback";

type Props = {
  scenarioSlug: string | null;
  scenarioLabel: string;
  prospectName: string;
  prospectTitle: string;
  prospectCompany: string;
  remainingTodaySeconds: number;
};

type Status =
  | "idle"
  | "requesting_mic"
  | "authorizing"
  | "connecting"
  | "active"
  | "ending"
  | "ended"
  | "blocked"
  | "error";

const FRIENDLY_ERROR_FALLBACK = "We couldn't start the AI prospect. Please try again.";

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
  const [prospectSpeaking, setProspectSpeaking] = useState(false);
  const [completion, setCompletion] = useState<{
    durationSeconds: number;
    freeSecondsUsed: number;
  } | null>(null);
  const [finalRemaining, setFinalRemaining] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micCaptureRef = useRef<MicCapture | null>(null);
  const playbackRef = useRef<AudioPlaybackQueue | null>(null);
  const prospectSpeakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedCleanlyRef = useRef(false);
  const sendAudioRef = useRef(false);
  const mutedRef = useRef(false);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    return () => {
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile Safari (and mobile browsers generally) can suspend/kill a
  // backgrounded tab's audio pipeline without warning — end the call
  // gracefully rather than leaving it in a stuck state.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden" && (status === "active" || status === "ending")) {
        endCall();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function teardown() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (prospectSpeakingTimeoutRef.current) clearTimeout(prospectSpeakingTimeoutRef.current);
    sendAudioRef.current = false;
    micCaptureRef.current?.stop();
    micCaptureRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
  }

  function startLocalTimer() {
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function stopLocalTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    setLevel(0);
  }

  function markProspectSpeaking() {
    setProspectSpeaking(true);
    if (prospectSpeakingTimeoutRef.current) clearTimeout(prospectSpeakingTimeoutRef.current);
    prospectSpeakingTimeoutRef.current = setTimeout(() => setProspectSpeaking(false), 800);
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
        sendAudioRef.current = true;
        startLocalTimer();
        playbackRef.current = audioContextRef.current ? new AudioPlaybackQueue(audioContextRef.current) : null;
        return;
      case "quota":
        // Server-reported remaining time. The browser's own per-second tick
        // above is presentation-only smoothing between these authoritative
        // updates — the gateway's monotonic timer is what actually decides
        // billing (see services/voice-gateway/src/session-runtime.ts).
        setRemainingSeconds(event.remainingSeconds);
        return;
      case "quota_exhausted":
        sendAudioRef.current = false;
        setQuotaExhausted(true);
        setStatus("ending");
        return;
      case "audio":
        playbackRef.current?.enqueue(event.data);
        markProspectSpeaking();
        return;
      case "interrupted":
        // Barge-in: the caller started talking over the prospect — stop
        // and discard whatever was queued/playing immediately.
        playbackRef.current?.interrupt();
        setProspectSpeaking(false);
        return;
      case "transcript":
        // Transcript display is intentionally minimal for this MVP — see
        // docs/ARCHITECTURE.md's "Transcription" section. Not required for
        // the call to function.
        return;
      case "text":
        return;
      case "completed":
        endedCleanlyRef.current = true;
        sendAudioRef.current = false;
        stopLocalTimer();
        setCompletion({
          durationSeconds: event.durationSeconds,
          freeSecondsUsed: event.freeSecondsUsed,
        });
        setStatus("ended");
        void refreshEntitlement();
        return;
      case "error":
        sendAudioRef.current = false;
        setError(event.message || FRIENDLY_ERROR_FALLBACK);
        if (status !== "active") setStatus("error");
        return;
      case "closed":
        socketRef.current?.close();
        if (!endedCleanlyRef.current) {
          stopLocalTimer();
          setStatus((s) => (s === "active" || s === "ending" ? "ended" : s === "idle" ? "idle" : "error"));
        }
        return;
      case "pong":
        return;
    }
  }

  async function startCall() {
    setError(null);
    setQuotaExhausted(false);
    setCompletion(null);
    endedCleanlyRef.current = false;
    setStatus("requesting_mic");

    // Created synchronously within this click-triggered handler, and
    // resume()'d immediately — this is what satisfies mobile Safari's
    // requirement that audio start from a genuine user gesture.
    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setStatus("error");
      setError("This browser doesn't support the audio features Cold Call Gym needs.");
      return;
    }
    const audioContext = new AudioContextCtor();
    audioContextRef.current = audioContext;
    try {
      await audioContext.resume();
    } catch {
      // Some browsers resolve resume() lazily; playback/capture still work once wired up.
    }

    const micCapture = new MicCapture(audioContext);
    micCaptureRef.current = micCapture;

    const micErrorHolder: { current: MicCaptureError | null } = { current: null };
    await micCapture.start(
      (base64, chunkLevel) => {
        setLevel(chunkLevel);
        if (sendAudioRef.current && !mutedRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "audio", data: base64 }));
        }
      },
      (err) => {
        micErrorHolder.current = err;
      },
    );

    const micError = micErrorHolder.current;
    if (micError) {
      teardown();
      setStatus("error");
      setError(
        micError.code === "permission_denied"
          ? "Microphone permission is required to start a call. Please allow access and try again."
          : micError.message,
      );
      return;
    }

    setStatus("authorizing");

    try {
      // Server-side authorization: validates the scenario and current
      // entitlement, creates the call-session record, and signs a
      // short-lived token for the voice gateway. This does not itself
      // spend anything — the gateway is what actually meters and
      // finalizes usage.
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioSlug: scenarioSlug ?? "busy-vp" }),
      });

      if (res.status === 402) {
        teardown();
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
          stopLocalTimer();
          setStatus((s) => (s === "authorizing" || s === "connecting" ? "error" : s));
        }
      };
    } catch (err) {
      teardown();
      setStatus("error");
      setError(err instanceof Error ? err.message : FRIENDLY_ERROR_FALLBACK);
    }
  }

  function endCall() {
    // The browser only ASKS the gateway to end the call — it never submits
    // a duration. The gateway's own monotonic timer decides how much time
    // was actually billable (see docs/ARCHITECTURE.md). Stop sending mic
    // audio immediately for a snappier "hang up" feel; full teardown
    // happens once the gateway confirms completion.
    sendAudioRef.current = false;
    setStatus((s) => (s === "active" ? "ending" : s));
    micCaptureRef.current?.stop();
    socketRef.current?.send(JSON.stringify({ type: "end" }));
  }

  const displayRemaining = remainingSeconds ?? Math.max(0, remainingTodaySeconds - seconds);
  const initials = prospectName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isLive = status === "active" || status === "ending";

  return (
    <div className="call card">
      <p className="accent">
        <b>{scenarioLabel}</b>
      </p>

      <div className={`avatar ${isLive && (prospectSpeaking || !muted) ? "avatar-live" : ""}`}>{initials}</div>
      <h1>{prospectName}</h1>
      <p className="muted">
        {prospectTitle} · {prospectCompany}
      </p>

      <div className="timer">{formatDuration(seconds)}</div>

      <div className="voice-viz" aria-hidden="true">
        {Array.from({ length: 9 }).map((_, i) => {
          const active = isLive && !muted;
          const amplitude = active ? level : 0;
          const height = active ? 6 + Math.round(Math.min(1, amplitude * 3) * 28 * Math.abs(Math.sin(i + 1))) : 4;
          return <span key={i} style={{ height }} className={active ? "bar bar-active" : "bar"} />;
        })}
      </div>

      {error && <p className="form-error">{error}</p>}

      {status === "idle" && (
        <>
          <p>
            <button className="button" onClick={startCall}>
              Start call
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

      {status === "error" && (
        <>
          <div className="call-controls">
            <button className="button" onClick={startCall}>
              Try again
            </button>
            <Link className="button ghost" href="/dashboard">
              Back to Dashboard
            </Link>
          </div>
        </>
      )}

      {status === "requesting_mic" && <p className="muted">Requesting microphone access…</p>}
      {status === "authorizing" && <p className="muted">Checking your practice time…</p>}
      {status === "connecting" && <p className="muted">Connecting to AI prospect…</p>}

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
          <p className="muted call-status-line">
            {muted ? "Microphone muted" : prospectSpeaking ? `${prospectName} is speaking…` : "Listening…"}
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

      <p className="muted call-footnote">
        {status === "idle" || status === "error" || status === "blocked"
          ? "Live voice practice with a real-time AI prospect."
          : "This call uses your microphone. End the call anytime."}
      </p>
    </div>
  );
}
