"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Contact {
  contactId: string;
  name: string;
  phoneNumber: string;
  notes: string | null;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void refresh(); }, []);
  async function refresh() {
    const res = await fetch("/api/contacts");
    if (res.ok) {
      const d = await res.json();
      setContacts(d.items ?? []);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phoneNumber, notes: notes || null }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error ?? "failed"); return; }
    setName(""); setPhoneNumber(""); setNotes("");
    void refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this contact?")) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    void refresh();
  }

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-8">
      <Link href="/" className="text-sm opacity-70 hover:underline">← back</Link>
      <header>
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="text-sm opacity-70">Save numbers once, reuse them across reservations and questions.</p>
      </header>

      <form onSubmit={submit} className="space-y-3 rounded-lg border border-black/10 dark:border-white/10 p-5">
        <h2 className="text-lg font-medium">Add contact</h2>
        <label className="block text-sm space-y-1">
          <span className="opacity-80">Name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Avi's Restaurant" className={inputCls} />
        </label>
        <label className="block text-sm space-y-1">
          <span className="opacity-80">Phone (E.164)</span>
          <input required value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+972501234567" className={inputCls} />
        </label>
        <label className="block text-sm space-y-1">
          <span className="opacity-80">Notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="King George 12" className={inputCls} />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white text-sm font-medium">Add</button>
      </form>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Your contacts</h2>
        {contacts.length === 0 && <p className="text-sm opacity-60">No contacts yet.</p>}
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li key={c.contactId} className="rounded border border-black/10 dark:border-white/10 p-3 text-sm flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="opacity-70 font-mono text-xs">{c.phoneNumber}{c.notes ? ` · ${c.notes}` : ""}</div>
              </div>
              <button onClick={() => remove(c.contactId)} className="text-xs opacity-60 hover:text-red-600">Delete</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

const inputCls = "w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm";
