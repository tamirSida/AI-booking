import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { newTrace } from "@/lib/logging/trace";
import { asksCol, newAskId, saveAsk } from "@/lib/ask/store";
import type { AskRequest } from "@/lib/ask/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  recipientPhoneNumber: z.string().regex(/^\+\d{7,15}$/, "expected E.164 like +972…"),
  recipientName: z.string().min(1).nullable().default(null),
  onBehalfOf: z.string().min(1),
  questions: z.array(z.string().min(1).max(500)).min(1).max(10),
});

export async function POST(req: NextRequest) {
  const trace = newTrace();
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "bad request", details: String(err) }, { status: 400 });
  }
  const requestId = newAskId();
  const ask: AskRequest = {
    requestId,
    userId: "local-dev-user",
    source: "web",
    recipientPhoneNumber: body.recipientPhoneNumber,
    recipientName: body.recipientName,
    onBehalfOf: body.onBehalfOf,
    questions: body.questions,
    status: "READY_TO_CALL",
    answers: [],
  };
  await saveAsk(ask);
  await trace.log("ask_created", { requestId });
  return NextResponse.json({ requestId, ask, traceId: trace.traceId });
}

export async function GET() {
  const snap = await asksCol().orderBy("updatedAt", "desc").limit(20).get();
  const items = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      requestId: data.requestId,
      status: data.status,
      recipientPhoneNumber: data.recipientPhoneNumber,
      recipientName: data.recipientName,
      onBehalfOf: data.onBehalfOf,
      questions: data.questions ?? [],
      answers: data.answers ?? [],
      lastCallId: data.lastCallId ?? null,
      updatedAt: data.updatedAt,
    };
  });
  return NextResponse.json({ items });
}
