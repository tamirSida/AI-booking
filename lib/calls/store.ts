import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { callsCol } from "@/lib/firebase/admin";

// Firestore `calls` collection helpers — design doc §14.4.

export interface CallRecord {
  callId: string;
  requestId: string;
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
}): Promise<void> {
  await callsCol().doc(args.callId).set({
    callId: args.callId,
    requestId: args.requestId,
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
