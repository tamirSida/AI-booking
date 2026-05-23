import { NextResponse } from "next/server";
import { deleteContact } from "@/lib/contacts/store";
import { requireAuth } from "@/lib/auth/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  void auth;
  const { id } = await ctx.params;
  await deleteContact(id);
  return NextResponse.json({ ok: true });
}
