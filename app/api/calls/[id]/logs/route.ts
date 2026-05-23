import { NextRequest, NextResponse } from "next/server";
import { logsCol } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calls/[id]/logs?since=<ts>
// Returns log entries scoped to this callId. UI polls this to build the live transcript.

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: callId } = await ctx.params;
  const since = req.nextUrl.searchParams.get("since");
  // Requires composite index (callId asc, createdAt asc). See firestore.indexes.json.
  let q = logsCol().where("callId", "==", callId).orderBy("createdAt", "asc").limit(500);
  if (since) {
    const ts = new Date(since);
    if (!Number.isNaN(ts.getTime())) {
      q = logsCol()
        .where("callId", "==", callId)
        .where("createdAt", ">", ts)
        .orderBy("createdAt", "asc")
        .limit(500);
    }
  }
  const snap = await q.get();
  const items = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const createdAt = data.createdAt as FirebaseFirestore.Timestamp | undefined;
    return {
      id: d.id,
      eventType: data.eventType,
      level: data.level,
      details: data.details,
      source: data.source ?? "next",
      createdAt: createdAt ? createdAt.toDate().toISOString() : null,
    };
  });
  return NextResponse.json({ items });
}
