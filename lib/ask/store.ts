import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import type { AskRequest, AskStatus, AskAnswer } from "@/lib/ask/schema";

const COL = "askRequests";

export function asksCol() {
  return db().collection(COL);
}

export function newAskId(): string {
  return randomUUID();
}

export async function saveAsk(req: AskRequest): Promise<void> {
  await asksCol().doc(req.requestId).set(
    { ...req, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function getAsk(requestId: string): Promise<AskRequest | null> {
  const snap = await asksCol().doc(requestId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  const { createdAt: _c, updatedAt: _u, ...rest } = data;
  return rest as unknown as AskRequest;
}

export async function updateAskStatus(requestId: string, status: AskStatus): Promise<void> {
  await asksCol().doc(requestId).set(
    { status, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function recordAskAnswer(
  requestId: string,
  args: { index: number; answer: string; confidence?: number },
): Promise<void> {
  const ref = asksCol().doc(requestId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() ?? {}) as { questions?: string[]; answers?: AskAnswer[] };
    const question = data.questions?.[args.index] ?? "";
    const existing = (data.answers ?? []).filter((a) => a.index !== args.index);
    const next: AskAnswer = {
      index: args.index,
      question,
      answer: args.answer,
      confidence: args.confidence ?? null,
      answeredAt: new Date().toISOString(),
    };
    tx.set(
      ref,
      {
        answers: [...existing, next].sort((a, b) => a.index - b.index),
        // Mark as fully answered only when we've captured all questions.
        status: (data.questions ?? []).length <= existing.length + 1 ? ("ANSWERED" as AskStatus) : ("ASKING" as AskStatus),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}
