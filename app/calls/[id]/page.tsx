"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface CallState {
  call: {
    callId: string;
    twilioCallSid?: string;
    status?: string;
    requestId?: string;
    purpose?: "reservation" | "ask";
    recordingSid: string | null;
    recordingDurationSeconds: number | null;
    handoffTriggered: boolean;
  };
  reservation: {
    status: string;
    restaurant: { name: string; city: string };
    reservation: { date: string; time: string; partySize: number; reservationName: string };
  } | null;
  ask: {
    status: string;
    recipientPhoneNumber: string;
    recipientName: string | null;
    onBehalfOf: string;
    questions: string[];
    answers: Array<{ index: number; question: string; answer: string; confidence: number | null }>;
  } | null;
}

interface LogEntry {
  id: string;
  eventType: string;
  level: string;
  details: Record<string, unknown>;
  source: string;
  createdAt: string | null;
}

const TRANSCRIPT_EVENTS = new Set([
  "ai_transcript_done",
  "host_transcript",
]);
const INTERESTING_EVENTS = new Set([
  "twilio_stream_started",
  "openai_session_updated",
  "ai_transcript_done",
  "host_transcript",
  "ai_tool_call",
  "end_call_invoked",
  "twilio_recording_callback",
  "twilio_status_callback",
  "twilio_stream_stopped",
  "openai_error",
]);

export default function CallMonitor() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<CallState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const lastTsRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let finishedAt: number | null = null;
    const TERMINAL = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);

    async function tick(): Promise<{ status?: string; recordingSid?: string | null } | null> {
      try {
        const callRes = await fetch(`/api/calls/${id}`);
        let nextState: CallState | null = null;
        if (callRes.ok && active) {
          nextState = await callRes.json();
          setState(nextState);
        }
        const since = lastTsRef.current ? `?since=${encodeURIComponent(lastTsRef.current)}` : "";
        const logsRes = await fetch(`/api/calls/${id}/logs${since}`);
        if (logsRes.ok && active) {
          const data = await logsRes.json();
          if (data.items?.length) {
            setLogs((prev) => [...prev, ...data.items]);
            const last = data.items[data.items.length - 1];
            if (last?.createdAt) lastTsRef.current = last.createdAt;
          }
        }
        return nextState ? { status: nextState.call.status, recordingSid: nextState.call.recordingSid } : null;
      } catch {
        return null;
      }
    }

    let t: ReturnType<typeof setTimeout> | null = null;
    async function loop() {
      const result = await tick();
      if (!active) return;
      const isTerminal = result?.status && TERMINAL.has(result.status);
      const hasRecording = !!result?.recordingSid;
      // Stop polling once the call ended AND we have the recording (or it's
      // been > 60s since the call ended — recording may have failed to upload).
      if (isTerminal) {
        if (!finishedAt) finishedAt = Date.now();
        if (hasRecording || Date.now() - finishedAt > 60_000) return;
      }
      const delay = isTerminal ? 4000 : 1500;
      t = setTimeout(loop, delay);
    }
    void loop();
    return () => {
      active = false;
      if (t) clearTimeout(t);
    };
  }, [id]);

  const transcript = logs.filter((l) => TRANSCRIPT_EVENTS.has(l.eventType));
  const events = logs.filter((l) => INTERESTING_EVENTS.has(l.eventType) && !TRANSCRIPT_EVENTS.has(l.eventType));

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <Link href="/" className="text-sm opacity-70 hover:underline">← back</Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Call monitor</h1>
        <p className="text-xs font-mono opacity-60">callId: {id}</p>
      </header>

      <section className="grid grid-cols-2 gap-4 text-sm">
        <Box label="Twilio call status">
          <Pill value={state?.call.status} />
        </Box>
        <Box label={state?.call.purpose === "ask" ? "Ask state" : "Reservation FSM state"}>
          <Pill value={state?.call.purpose === "ask" ? state.ask?.status : state?.reservation?.status} />
        </Box>
        {state?.call.purpose === "ask" ? (
          <Box label={`Questions (${(state.ask?.answers?.length ?? 0) ?? 0}/${(state.ask?.questions?.length ?? 0) ?? 0} answered)`}>
            {state.ask ? (
              <div className="text-xs space-y-1" dir="auto">
                <div className="font-mono">📞 {state.ask.recipientPhoneNumber}{state.ask.recipientName ? ` (${state.ask.recipientName})` : ""}</div>
                <div className="opacity-70 font-mono">on behalf of {state.ask.onBehalfOf}</div>
                {(state.ask.questions ?? []).map((q, i) => (
                  <div key={i} className="pl-1">Q{i + 1}: {q}</div>
                ))}
              </div>
            ) : <span className="opacity-50">—</span>}
          </Box>
        ) : (
          <Box label="Restaurant">
            {state?.reservation ? (
              <div className="font-mono text-xs">
                <div>{state.reservation.restaurant.name} ({state.reservation.restaurant.city})</div>
                <div className="opacity-70">{state.reservation.reservation.date} {state.reservation.reservation.time}, {state.reservation.reservation.partySize}p · {state.reservation.reservation.reservationName}</div>
              </div>
            ) : <span className="opacity-50">—</span>}
          </Box>
        )}
        {state?.call.purpose === "ask" ? (
          <Box label="Captured answers">
            {state.ask && (state.ask.answers?.length ?? 0) > 0 ? (
              <div className="text-xs space-y-2" dir="auto">
                {(state.ask.answers ?? []).map((a) => (
                  <div key={a.index}>
                    <div className="opacity-60">Q{a.index + 1}: {a.question}</div>
                    <div className="font-medium">A: {a.answer}</div>
                    {a.confidence != null && (
                      <div className="opacity-60">confidence: {Math.round(a.confidence * 100)}%</div>
                    )}
                  </div>
                ))}
              </div>
            ) : <span className="text-xs opacity-60">waiting…</span>}
          </Box>
        ) : (
          <Box label="Handoff">
            <span className="text-xs font-mono">{state?.call.handoffTriggered ? "triggered" : "no"}</span>
          </Box>
        )}
      </section>

      <HangupButton state={state} />

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Transcript</h2>
        <div className="rounded border border-black/10 dark:border-white/10 p-4 space-y-2 max-h-[400px] overflow-y-auto" dir="auto">
          {transcript.length === 0 && <p className="text-sm opacity-50">Waiting for audio…</p>}
          {transcript.map((l) => {
            const text = (l.details as { text?: string; transcript?: string }).text ?? "";
            const speaker = l.eventType === "host_transcript" ? "Host" : "AI";
            return (
              <div key={l.id} className="text-sm">
                <span className={"mr-2 font-mono text-xs " + (speaker === "AI" ? "text-blue-600" : "text-emerald-600")}>{speaker}:</span>
                <span dir="auto">{text}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Recording</h2>
        {state?.call.recordingSid ? (
          <div className="space-y-2 text-sm">
            <audio controls className="w-full" src={`/api/recordings/${state.call.recordingSid}`}>
              Your browser does not support audio playback.
            </audio>
            {state.call.recordingDurationSeconds != null && (
              <p className="text-xs opacity-70">Duration: {state.call.recordingDurationSeconds}s</p>
            )}
          </div>
        ) : (
          <p className="text-sm opacity-60">
            {state?.call.status === "completed" ? "Recording processing… (usually arrives ~10s after call ends)" : "Recording will appear here after the call ends."}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Events</h2>
        <ul className="text-xs font-mono space-y-1 max-h-[300px] overflow-y-auto">
          {events.map((l) => (
            <li key={l.id} className="opacity-80">
              <span className="opacity-60">{l.createdAt?.slice(11, 19)}</span>{" "}
              <span className="font-medium">{l.eventType}</span>{" "}
              <span className="opacity-70">{JSON.stringify(l.details).slice(0, 200)}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function HangupButton({ state }: { state: CallState | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = state?.call.status;
  const terminal = !status || ["completed", "failed", "busy", "no-answer", "canceled"].includes(status);
  if (terminal || !state?.call.callId) return null;
  async function hangup() {
    if (!confirm("End this call now?")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calls/${state!.call.callId}/hangup`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "failed");
    }
    setBusy(false);
  }
  return (
    <div className="flex items-center gap-3">
      <button onClick={hangup} disabled={busy} className="rounded bg-red-600 px-4 py-2 text-white text-sm font-medium disabled:opacity-50">
        {busy ? "Hanging up…" : "Hang up call"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-black/10 dark:border-white/10 p-3">
      <p className="text-xs opacity-60 mb-1">{label}</p>
      {children}
    </div>
  );
}

function Pill({ value }: { value?: string | null }) {
  const v = value ?? "—";
  const cls =
    v === "completed" || v === "RESERVATION_CONFIRMED" || v === "CALL_COMPLETED"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
      : v === "in-progress" || v === "ringing" || v === "SPEAKING_WITH_HOST"
        ? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100"
        : v === "FAILED" || v === "failed" || v === "no-answer" || v === "canceled"
          ? "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100"
          : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-mono ${cls}`}>{v}</span>;
}
