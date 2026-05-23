import { NextResponse } from "next/server";
import { newTrace } from "@/lib/logging/trace";
import { twilioClient } from "@/lib/twilio/client";
import { getCallRecord, updateCallRecord } from "@/lib/calls/store";
import { requireAuth } from "@/lib/auth/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/calls/[id]/hangup — manual hangup from the UI.
// Uses Twilio's Calls.update to mark the call completed, which propagates
// through to the worker's media stream stop event and unwinds everything.

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  void auth;
  const { id: callId } = await ctx.params;
  const trace = newTrace({ requestId: callId });
  const record = await getCallRecord(callId);
  if (!record) return NextResponse.json({ error: "call not found" }, { status: 404 });
  if (!record.twilioCallSid) {
    return NextResponse.json({ error: "call has no twilio sid yet" }, { status: 400 });
  }
  try {
    await twilioClient().calls(record.twilioCallSid).update({ status: "completed" });
    await updateCallRecord(callId, { status: "completed" });
    await trace.log("manual_hangup", { callId, twilioCallSid: record.twilioCallSid });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await trace.log("manual_hangup_failed", { callId, error: String(err) }, "error");
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
