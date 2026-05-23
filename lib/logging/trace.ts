import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { logsCol } from "@/lib/firebase/admin";

// Structured logging with traceId per design doc §15.
// Logs go to stdout (always) and Firestore (best-effort).
// PII scrubbing per §15/§16: never write credit-card numbers, CVVs, etc.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  traceId: string;
  requestId?: string;
  callId?: string | null;
  eventType: string;
  level: LogLevel;
  details: Record<string, unknown>;
}

// Match common payment-sensitive patterns. Order matters; broader patterns last.
const SENSITIVE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\b\d{13,19}\b/g, replacement: "[REDACTED_CARD]" },
  { pattern: /\b\d{3,4}\b(?=.{0,20}(cvv|cvc|security code|קוד אבטחה))/gi, replacement: "[REDACTED_CVV]" },
  { pattern: /\b(0[1-9]|1[0-2])\/\d{2,4}\b/g, replacement: "[REDACTED_EXP]" },
];

export function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = scrub(v);
    }
    return result;
  }
  return value;
}

export interface TraceCtx {
  traceId: string;
  requestId?: string;
  log: (eventType: string, details?: Record<string, unknown>, level?: LogLevel) => Promise<void>;
  child: (overrides: Partial<Pick<TraceCtx, "requestId">>) => TraceCtx;
}

export function newTrace(seed?: Partial<Pick<TraceCtx, "traceId" | "requestId">>): TraceCtx {
  const traceId = seed?.traceId ?? randomUUID();
  const requestId = seed?.requestId;
  return buildCtx(traceId, requestId);
}

function buildCtx(traceId: string, requestId?: string): TraceCtx {
  return {
    traceId,
    requestId,
    async log(eventType, details = {}, level = "info") {
      const safe = scrub(details) as Record<string, unknown>;
      const entry: LogEntry = { traceId, requestId, eventType, level, details: safe };
      // Always log to stdout — cheap and durable across crashes.
      const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
      if (level === "error") console.error(line);
      else console.log(line);
      // Best-effort Firestore write. Never block the caller on logging failure.
      try {
        await logsCol().add({ ...entry, createdAt: FieldValue.serverTimestamp() });
      } catch (err) {
        console.error(JSON.stringify({ ts: new Date().toISOString(), eventType: "log_write_failed", error: String(err) }));
      }
    },
    child(overrides) {
      return buildCtx(traceId, overrides.requestId ?? requestId);
    },
  };
}
