import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { newTrace } from "@/lib/logging/trace";
import { handoffUser } from "@/lib/calls/handoff";
import { HandoffReason } from "@/lib/reservation/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual / automatic handoff endpoint. POST { reason } → dials USER_PHONE_NUMBER and bridges them into the conference.
// Used by the web "Handover Call" button (Phase 2) and by the realtime call agent (Phase 4).
//
// Phase 1: no auth on this route — single-user local dev only.
// Phase 2 will add Firebase ID-token verification via middleware.

const Body = z.object({
  reason: HandoffReason.default("manual"),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const trace = newTrace();
  const { id: callId } = await ctx.params;
  let body: z.infer<typeof Body> = { reason: "manual" };
  try {
    const raw = await req.json().catch(() => ({}));
    body = Body.parse(raw);
  } catch (err) {
    return NextResponse.json({ error: "bad request", details: String(err) }, { status: 400 });
  }
  try {
    const result = await handoffUser({ trace, callId, reason: body.reason });
    return NextResponse.json({ traceId: trace.traceId, callId, ...result });
  } catch (err) {
    await trace.log("handoff_failed", { callId, error: String(err) }, "error");
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
