import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import type { Contact } from "@/lib/contacts/schema";

const COL = "contacts";

export function contactsCol() {
  return db().collection(COL);
}

export function newContactId(): string {
  return randomUUID();
}

export async function saveContact(c: Contact): Promise<void> {
  await contactsCol().doc(c.contactId).set(
    { ...c, updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function listContacts(): Promise<Contact[]> {
  const snap = await contactsCol().orderBy("name", "asc").limit(200).get();
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const { createdAt: _c, updatedAt: _u, ...rest } = data;
    return rest as unknown as Contact;
  });
}

export async function deleteContact(contactId: string): Promise<void> {
  await contactsCol().doc(contactId).delete();
}
