import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { newTrace } from "@/lib/logging/trace";
import { openai } from "@/lib/openai/client";
import { runIntakeAgent } from "@/lib/openai/agent";
import { emptyReservation, getReservation, saveReservation, createConversation, getConversation } from "@/lib/reservation/store";
import { requireAuth } from "@/lib/auth/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Web-chat entrypoint. Channel-agnostic core: Telegram webhook will hit the same
// agent (runIntakeAgent) once we wire it. For now this lets us smoke-test the
// intake → tool-call → call-start chain with curl.

const PostBody = z.object({
  // For MVP single-user mode, userId is anything stable. The web flow (Phase 2) will derive it from Firebase Auth.
  userId: z.string().min(1).default("local-dev-user"),
  // Pass the same requestId on subsequent messages to continue an existing reservation.
  // Omit on the first message to start a new one.
  requestId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  message: z.string().min(1),
  // User's phone number for the eventual handoff. In Phase 1 we fall back to USER_PHONE_NUMBER env.
  userPhoneNumber: z.string().regex(/^\+\d{7,15}$/).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  void auth;
  const trace = newTrace();
  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (err) {
    await trace.log("messages_bad_request", { error: String(err) }, "warn");
    return NextResponse.json({ error: "bad request", details: String(err) }, { status: 400 });
  }

  // Resolve or create the conversation + reservation pair.
  let conversationId = body.conversationId;
  let openAiConversationId: string | null = null;
  if (conversationId) {
    const conv = await getConversation(conversationId);
    if (conv) openAiConversationId = conv.openAiConversationId;
  }
  if (!openAiConversationId) {
    const conv = await openai().conversations.create({});
    openAiConversationId = conv.id;
    conversationId = await createConversation({
      userId: body.userId,
      source: "web",
      openAiConversationId,
    });
    await trace.log("conversation_created", { conversationId, openAiConversationId });
  }

  let requestId = body.requestId;
  if (requestId) {
    const existing = await getReservation(requestId);
    if (!existing) {
      return NextResponse.json({ error: `reservation ${requestId} not found` }, { status: 404 });
    }
  } else {
    const userPhone = body.userPhoneNumber ?? process.env.USER_PHONE_NUMBER;
    if (!userPhone) {
      return NextResponse.json(
        { error: "userPhoneNumber required (or set USER_PHONE_NUMBER env for single-user mode)" },
        { status: 400 },
      );
    }
    const fresh = emptyReservation({
      userId: body.userId,
      source: "web",
      conversationId,
      userPhoneNumber: userPhone,
    });
    await saveReservation(fresh);
    requestId = fresh.requestId;
    await trace.log("reservation_created", { requestId, userId: body.userId });
  }

  const childTrace = trace.child({ requestId });
  const result = await runIntakeAgent({
    ctx: { trace: childTrace, requestId, userId: body.userId },
    openAiConversationId,
    source: "web",
    userMessage: body.message,
  });

  return NextResponse.json({
    traceId: trace.traceId,
    requestId,
    conversationId,
    assistant: result.assistantText,
    toolsCalled: result.toolsCalled,
  });
}
