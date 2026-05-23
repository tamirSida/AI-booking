import { NextResponse } from "next/server";
import { getAsk } from "@/lib/ask/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ask = await getAsk(id);
  if (!ask) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ask });
}
