import { NextResponse } from "next/server";
import { deleteContact } from "@/lib/contacts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteContact(id);
  return NextResponse.json({ ok: true });
}
