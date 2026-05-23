import { NextResponse } from "next/server";
import { newTrace } from "@/lib/logging/trace";
import { placeAskCall } from "@/lib/calls/place-ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await ctx.params;
  const trace = newTrace({ requestId });
  try {
    const callId = await placeAskCall({ trace, requestId });
    await trace.log("ask_call_started", { callId, requestId });
    return NextResponse.json({ callId, traceId: trace.traceId });
  } catch (err) {
    await trace.log("ask_call_failed", { requestId, error: String(err) }, "error");
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
