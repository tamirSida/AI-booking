// Minimal Firestore accessor for the `calls` collection so the worker can
// update call status from Twilio status callbacks. Mirrors the shape in
// lib/calls/store.ts on the Next.js side.

import { FieldValue, getFirestore } from "firebase-admin/firestore";

export interface CallRecord {
  callId: string;
  requestId: string;
  conferenceName?: string;
  twilioCallSid?: string;
  twilioConferenceSid?: string;
  status?: string;
  handoffTriggered?: boolean;
  recordingSid?: string;
  recordingDurationSeconds?: number;
}

export async function getCallRecord(callId: string): Promise<CallRecord | null> {
  const snap = await getFirestore().collection("calls").doc(callId).get();
  if (!snap.exists) return null;
  return snap.data() as CallRecord;
}

export async function updateCallRecord(callId: string, patch: Partial<CallRecord>): Promise<void> {
  await getFirestore().collection("calls").doc(callId).set(
    { ...patch, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
