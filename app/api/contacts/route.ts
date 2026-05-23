import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listContacts, newContactId, saveContact } from "@/lib/contacts/store";
import type { Contact } from "@/lib/contacts/schema";
import { requireAuth } from "@/lib/auth/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(120),
  phoneNumber: z.string().regex(/^\+\d{7,15}$/, "expected E.164 like +972…"),
  notes: z.string().max(500).nullable().default(null),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  void auth;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "bad request", details: String(err) }, { status: 400 });
  }
  const contact: Contact = {
    contactId: newContactId(),
    userId: "local-dev-user",
    name: body.name,
    phoneNumber: body.phoneNumber,
    notes: body.notes,
  };
  await saveContact(contact);
  return NextResponse.json({ contact });
}

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  void auth;
  const items = await listContacts();
  return NextResponse.json({ items });
}
