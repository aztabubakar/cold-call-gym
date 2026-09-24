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
};

type Status =
  | "idle"
  | "requesting_mic"
  | "authorizing"
  | "connecting"
  | "active"
  | "ending"
  | "ended"
  | "error";

const FRIENDLY_ERROR_FALLBACK = "We couldn't start the AI prospect. Please try again.";

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5.5A3.5 3.5 0 0 0 12 15Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {muted && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

function EndCallIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 13.2c5.2-4.9 11.8-4.9 17 0 .5.5.5 1.3-.1 1.7l-2.6 2c-.5.4-1.2.3-1.6-.1l-1.5-1.6a1.2 1.2 0 0 0-1.3-.3c-1.6.6-3.4.6-5 0a1.2 1.2 0 0 0-1.3.3l-1.5 1.6c-.4.4-1.1.5-1.6.1l-2.6-2c-.6-.4-.6-1.2-.1-1.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function CallSession({
  scenarioSlug,
  scenarioLabel,
  prospectName,
  prospectTitle,
  prospectCompany,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [prospectSpeaking, setProspectSpeaking] = useState(false);
  const [completion, setCompletion] = useState<{ durationSeconds: number } | null>(null);
  const [practicedTodaySeconds, setPracticedTodaySeconds] = useState<number | null>(null);

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

  useEffect(() => {
    void refreshPracticedToday();
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

  async function refreshPracticedToday() {
    try {
      const res = await fetch("/api/practice-stats");
      if (res.ok) {
        const stats = (await res.json()) as { usedTodaySeconds: number };
        setPracticedTodaySeconds(stats.usedTodaySeconds);
      }
    } catch {
      // Non-critical: purely informational, the dashboard is the source of truth.
    }
  }

  function handleGatewayEvent(event: GatewayToClientEvent) {
    switch (event.type) {
      case "connected":
        return;
      case "active":
        setStatus("active");
        sendAudioRef.current = true;
        startLocalTimer();
        playbackRef.current = audioContextRef.current ? new AudioPlaybackQueue(audioContextRef.current) : null;
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
        setCompletion({ durationSeconds: event.durationSeconds });
        setStatus("ended");
        void refreshPracticedToday();
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
      // Server-side authorization: validates the scenario, creates the
      // call-session record, and signs a short-lived token for the voice
      // gateway. The gateway is what actually connects and finalizes the
      // call's recorded duration.
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioSlug: scenarioSlug ?? "busy-vp" }),
      });

      if (!res.ok) {
        throw new Error(`Authorization failed (${res.status})`);
      }

      const authorization = (await res.json()) as {
        sessionId: string;
        gatewayUrl: string;
        token: string;
      };

      setStatus("connecting");
      setSeconds(0);

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
    // The browser only ASKS the gateway to end the call — the gateway's
    // own monotonic timer decides how much time was actually recorded (see
    // docs/ARCHITECTURE.md). Stop sending mic audio immediately for a
    // snappier "hang up" feel; full teardown happens once the gateway
    // confirms completion.
    sendAudioRef.current = false;
    setStatus((s) => (s === "active" ? "ending" : s));
    micCaptureRef.current?.stop();
    socketRef.current?.send(JSON.stringify({ type: "end" }));
  }

  const initials = prospectName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isLive = status === "active" || status === "ending";
  const isConnecting = status === "requesting_mic" || status === "authorizing" || status === "connecting";
  const orbSpeaking = isLive && prospectSpeaking && !muted;
  const orbClass = [
    "call-orb",
    orbSpeaking ? "orb-speaking" : "",
    muted && isLive ? "orb-muted" : "",
    status === "idle" ? "orb-idle" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="callscreen">
      <div className="callcard card">
        <span className="call-scenario-badge">{scenarioLabel}</span>

        <div className={`call-orb-wrap ${isLive ? "rings-active" : ""}`}>
          {isLive && (
            <>
              <span className="call-orb-ring" aria-hidden="true" />
              <span className="call-orb-ring" aria-hidden="true" />
              <span className="call-orb-ring" aria-hidden="true" />
            </>
          )}
          <div className={orbClass}>{initials}</div>
        </div>

        <h1>{prospectName}</h1>
        <p className="muted">
          {prospectTitle} · {prospectCompany}
        </p>

        <p className="call-status-pill">
          <span
            className={`status-dot ${
              isLive ? "status-live" : isConnecting ? "status-busy" : status === "error" ? "status-error" : ""
            }`}
          />
          {status === "idle" && "Ready when you are"}
          {status === "requesting_mic" && "Requesting microphone…"}
          {status === "authorizing" && "Checking your session…"}
          {status === "connecting" && "Connecting to AI prospect…"}
          {status === "active" && "Live"}
          {status === "ending" && "Ending…"}
          {status === "ended" && "Call complete"}
          {status === "error" && "Something went wrong"}
        </p>

        {isLive && <div className="call-timer">{formatDuration(seconds)}</div>}

        <div className="call-waveform" aria-hidden="true">
          {Array.from({ length: 9 }).map((_, i) => {
            const active = isLive && !muted;
            const amplitude = active ? level : 0;
            const height = active ? 6 + Math.round(Math.min(1, amplitude * 3) * 32 * Math.abs(Math.sin(i + 1))) : 4;
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
            <p className="muted">Free, unlimited live voice practice with a real-time AI prospect.</p>
            {practicedTodaySeconds !== null && practicedTodaySeconds > 0 && (
              <p className="muted call-practiced-today">
                You&apos;ve practiced {formatDuration(practicedTodaySeconds)} today.
              </p>
            )}
          </>
        )}

        {status === "error" && (
          <div className="call-controls">
            <button className="button" onClick={startCall}>
              Try again
            </button>
            <Link className="button ghost" href="/dashboard">
              Back to Dashboard
            </Link>
          </div>
        )}

        {(status === "active" || status === "ending") && (
          <>
            <div className="call-controls-live">
              <button
                className={`icon-btn ${muted ? "icon-btn-muted" : ""}`}
                onClick={() => setMuted((m) => !m)}
                disabled={status === "ending"}
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                title={muted ? "Unmute" : "Mute"}
              >
                <MicIcon muted={muted} />
              </button>
              <button
                className="icon-btn icon-btn-end"
                onClick={endCall}
                disabled={status === "ending"}
                aria-label="End call"
                title="End call"
              >
                <EndCallIcon />
              </button>
            </div>
            <p className="muted call-status-line">
              {muted ? "Microphone muted" : prospectSpeaking ? `${prospectName} is speaking…` : "Listening…"}
            </p>
          </>
        )}

        {status === "ended" && (
          <>
            <p className="accent">
              <b>CALL COMPLETE</b>
            </p>
            {completion && <p className="muted">{formatDuration(completion.durationSeconds)} on this call.</p>}
            {practicedTodaySeconds !== null && (
              <p className="muted">{formatDuration(practicedTodaySeconds)} practiced today.</p>
            )}
            <div className="call-controls">
              <Link className="button" href="/report/demo">
                View coaching report
              </Link>
              <button className="button ghost" onClick={startCall}>
                Practice again
              </button>
            </div>
          </>
        )}

        <p className="muted call-footnote">
          {status === "idle" || status === "error"
            ? "This call uses your microphone."
            : "This call uses your microphone. End the call anytime."}
        </p>
      </div>
    </div>
  );
}
