import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { callsCol } from "@/lib/firebase/admin";

// Firestore `calls` collection helpers — design doc §14.4.

export type CallPurpose = "reservation" | "ask";

export interface CallRecord {
  callId: string;
  requestId: string;
  // Which feature triggered this call. The worker uses this to pick the right
  // system prompt + tool set + Firestore collection to load context from.
  // Existing reservation calls default to "reservation" if missing.
  purpose?: CallPurpose;
  conferenceName: string;
  twilioCallSid?: string;
  twilioConferenceSid?: string;
  status: "queued" | "ringing" | "in-progress" | "completed" | "busy" | "failed" | "no-answer" | "canceled";
  participants: string[];
  startedAt?: FirebaseFirestore.Timestamp | null;
  endedAt?: FirebaseFirestore.Timestamp | null;
  handoffTriggered?: boolean;
  recordingSid?: string;
  recordingDurationSeconds?: number;
}

export function newCallId(): string {
  return randomUUID();
}

export async function createCallRecord(args: {
  callId: string;
  requestId: string;
  conferenceName: string;
  purpose?: CallPurpose;
}): Promise<void> {
  await callsCol().doc(args.callId).set({
    callId: args.callId,
    requestId: args.requestId,
    purpose: args.purpose ?? "reservation",
    conferenceName: args.conferenceName,
    status: "queued",
    participants: [],
    handoffTriggered: false,
    startedAt: FieldValue.serverTimestamp(),
    endedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function getCallRecord(callId: string): Promise<CallRecord | null> {
  const snap = await callsCol().doc(callId).get();
  if (!snap.exists) return null;
  return snap.data() as CallRecord;
}

export async function updateCallRecord(callId: string, patch: Partial<CallRecord>): Promise<void> {
  await callsCol().doc(callId).set(
    { ...patch, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
