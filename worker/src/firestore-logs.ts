// Best-effort Firestore log writer for the worker. Mirrors the shape used by
// lib/logging/trace.ts on the Next.js side so the UI can query `logs` for
// transcripts and bridge events tied to a specific callId/requestId.

import { FieldValue, getFirestore } from "firebase-admin/firestore";

export interface LogContext {
  callId?: string | null;
  requestId?: string | null;
}

export async function writeLog(
  event: string,
  details: Record<string, unknown>,
  level: "info" | "warn" | "error",
  ctx: LogContext,
): Promise<void> {
  try {
    await getFirestore().collection("logs").add({
      eventType: event,
      level,
      details,
      callId: ctx.callId ?? null,
      requestId: ctx.requestId ?? null,
      source: "worker",
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Never let logging errors break the bridge. Print to stdout so it's still visible.
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      event: "firestore_log_write_failed",
      level: "error",
      message: String(err),
    }));
  }
}
