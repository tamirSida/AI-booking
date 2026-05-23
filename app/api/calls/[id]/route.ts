import { NextResponse } from "next/server";
import { getCallRecord } from "@/lib/calls/store";
import { getReservation } from "@/lib/reservation/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calls/[id] — state snapshot for the live monitor UI.
// Returns call status, linked reservation (which carries the FSM status),
// and recording info once available.

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const call = await getCallRecord(id);
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });
  const reservation = call.requestId ? await getReservation(call.requestId) : null;
  return NextResponse.json({
    call: {
      callId: call.callId,
      twilioCallSid: call.twilioCallSid,
      status: call.status,
      requestId: call.requestId,
      recordingSid: call.recordingSid ?? null,
      recordingDurationSeconds: call.recordingDurationSeconds ?? null,
      handoffTriggered: call.handoffTriggered ?? false,
    },
    reservation,
  });
}
