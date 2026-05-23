import { z } from "zod";

// "Ask Question" feature — call any number, ask one question, capture the answer.
// Separate from reservation flow; reuses the Twilio + worker call infrastructure.

export const AskStatus = z.enum([
  "READY_TO_CALL",
  "INITIATING_CALL",
  "ASKING",
  "ANSWERED",
  "DECLINED",
  "CALL_COMPLETED",
  "FAILED",
]);
export type AskStatus = z.infer<typeof AskStatus>;

export const AskAnswer = z.object({
  index: z.number().int().nonnegative(),
  question: z.string(),
  answer: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  answeredAt: z.string(),
});
export type AskAnswer = z.infer<typeof AskAnswer>;

export const AskRequest = z.object({
  requestId: z.string().min(1),
  userId: z.string().min(1),
  source: z.enum(["web", "telegram"]),
  recipientPhoneNumber: z.string().regex(/^\+\d{7,15}$/, "expected E.164"),
  recipientName: z.string().nullable(),
  onBehalfOf: z.string().min(1),
  // Multi-question support: at least one, up to a reasonable cap.
  questions: z.array(z.string().min(1).max(500)).min(1).max(10),
  status: AskStatus,
  answers: z.array(AskAnswer),
});
export type AskRequest = z.infer<typeof AskRequest>;
