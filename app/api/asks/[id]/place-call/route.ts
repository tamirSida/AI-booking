import { NextResponse } from "next/server";
import { newTrace } from "@/lib/logging/trace";
import { placeAskCall } from "@/lib/calls/place-ask";
import { requireAuth } from "@/lib/auth/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  void auth;
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
