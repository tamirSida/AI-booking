import { NextResponse } from "next/server";
import { getReservation } from "@/lib/reservation/store";
import { requireAuth } from "@/lib/auth/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  void auth;
  const { id } = await ctx.params;
  const r = await getReservation(id);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ reservation: r });
}
