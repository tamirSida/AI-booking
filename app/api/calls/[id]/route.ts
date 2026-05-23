import { NextResponse } from "next/server";
import { getCallRecord } from "@/lib/calls/store";
import { getReservation } from "@/lib/reservation/store";
import { getAsk } from "@/lib/ask/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calls/[id] — state snapshot for the live monitor UI.
// Includes either the linked reservation OR the linked ask request, based on
// the call's `purpose` field.

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const call = await getCallRecord(id);
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });
  const purpose = call.purpose ?? "reservation";
  const reservation =
    purpose === "reservation" && call.requestId ? await getReservation(call.requestId) : null;
  const ask = purpose === "ask" && call.requestId ? await getAsk(call.requestId) : null;
  return NextResponse.json({
    call: {
      callId: call.callId,
      twilioCallSid: call.twilioCallSid,
      status: call.status,
      requestId: call.requestId,
      purpose,
      recordingSid: call.recordingSid ?? null,
      recordingDurationSeconds: call.recordingDurationSeconds ?? null,
      handoffTriggered: call.handoffTriggered ?? false,
    },
    reservation,
    ask,
  });
}
