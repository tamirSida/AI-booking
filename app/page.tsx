"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authedFetch } from "@/lib/auth/fetch-with-auth";
import { useAuth } from "@/lib/auth/AuthProvider";

interface RecentReservation {
  requestId: string;
  status: string;
  restaurant: { name: string; city: string; phoneNumber: string | null };
  reservation: {
    date: string;
    time: string;
    partySize: number;
    reservationName: string;
    acceptableAlternatives?: { allowNearbyTimes: boolean; timeWindowMinutes: number };
  };
  lastCallId: string | null;
}

interface AskAnswer { index: number; question: string; answer: string }
interface RecentAsk {
  requestId: string;
  status: string;
  recipientPhoneNumber: string;
  recipientName: string | null;
  onBehalfOf?: string;
  questions: string[];
  answers: AskAnswer[];
  lastCallId: string | null;
}

interface ContactRow {
  contactId: string;
  name: string;
  phoneNumber: string;
  notes: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function Home() {
  const [tab, setTab] = useState<"reservation" | "ask">("reservation");
  const { user, signOut } = useAuth();
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">ai_booking</h1>
          <p className="text-sm opacity-70">AI phone agent — reservations & questions</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/contacts" className="underline opacity-80 hover:opacity-100">Contacts →</Link>
          {user?.email && <span className="opacity-60 text-xs">{user.email}</span>}
          <button onClick={() => void signOut()} className="opacity-70 hover:opacity-100">Sign out</button>
        </div>
      </header>

      <nav className="flex gap-2 border-b border-black/10 dark:border-white/10">
        <TabButton active={tab === "reservation"} onClick={() => setTab("reservation")}>
          Reservation
        </TabButton>
        <TabButton active={tab === "ask"} onClick={() => setTab("ask")}>
          Ask a question
        </TabButton>
      </nav>

      {tab === "reservation" ? <ReservationPanel /> : <AskPanel />}
    </main>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 -mb-px ${active ? "border-blue-600 font-medium" : "border-transparent opacity-70 hover:opacity-100"}`}
    >
      {children}
    </button>
  );
}

// Shared contact-picker. Renders a select that, when picked, fills phone + name.
function ContactPicker({
  contacts,
  onPick,
}: {
  contacts: ContactRow[];
  onPick: (c: ContactRow) => void;
}) {
  if (contacts.length === 0) return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="opacity-70">Or pick:</span>
      <select
        defaultValue=""
        onChange={(e) => {
          const c = contacts.find((x) => x.contactId === e.target.value);
          if (c) onPick(c);
          e.target.value = "";
        }}
        className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1"
      >
        <option value="">— from contacts —</option>
        {contacts.map((c) => (
          <option key={c.contactId} value={c.contactId}>{c.name} · {c.phoneNumber}</option>
        ))}
      </select>
    </div>
  );
}

function useContacts(): ContactRow[] {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  useEffect(() => {
    authedFetch("/api/contacts")
      .then((r) => r.ok ? r.json() : { items: [] })
      .then((d) => setContacts(d.items ?? []))
      .catch(() => {});
  }, []);
  return contacts;
}

// ============================================================================
// Reservation panel
// ============================================================================

function ReservationPanel() {
  const router = useRouter();
  const contacts = useContacts();
  const [restaurantPhoneNumber, setRestaurantPhone] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [city, setCity] = useState("Tel Aviv");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("21:00");
  const [partySize, setPartySize] = useState(2);
  const [reservationName, setReservationName] = useState("Tamir Sida");
  const [allowNearbyTimes, setAllowNearbyTimes] = useState(true);
  const [timeWindowMinutes, setTimeWindowMinutes] = useState(30);

  function loadFromHistory(r: RecentReservation) {
    setRestaurantPhone(r.restaurant.phoneNumber ?? "");
    setRestaurantName(r.restaurant.name ?? "");
    setCity(r.restaurant.city ?? "");
    setDate(r.reservation.date);
    setTime(r.reservation.time);
    setPartySize(r.reservation.partySize);
    setReservationName(r.reservation.reservationName);
    if (r.reservation.acceptableAlternatives) {
      setAllowNearbyTimes(r.reservation.acceptableAlternatives.allowNearbyTimes);
      setTimeWindowMinutes(r.reservation.acceptableAlternatives.timeWindowMinutes);
    }
    setStage("form");
    setDraftId(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const [stage, setStage] = useState<"form" | "review" | "placing">("form");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentReservation[]>([]);

  useEffect(() => { void refreshRecent(); }, []);
  async function refreshRecent() {
    try {
      const res = await authedFetch("/api/reservations");
      if (!res.ok) return;
      const data = await res.json();
      setRecent(data.items ?? []);
    } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await authedFetch("/api/reservations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantPhoneNumber, restaurantName: restaurantName || "Restaurant", city,
        date, time, partySize, reservationName, allowNearbyTimes, timeWindowMinutes,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "failed"); return; }
    setDraftId(data.requestId);
    setStage("review");
  }

  async function placeCall() {
    if (!draftId) return;
    setStage("placing");
    setError(null);
    const res = await authedFetch(`/api/reservations/${draftId}/place-call`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "failed"); setStage("review"); return; }
    router.push(`/calls/${data.callId}`);
  }
  function reset() { setStage("form"); setDraftId(null); setError(null); void refreshRecent(); }

  return (
    <div className="space-y-8">
      {stage === "form" && (
        <form onSubmit={submit} className={panelCls}>
          <h2 className="text-lg font-medium">New reservation</h2>
          <Field label="Restaurant phone (E.164)">
            <input required value={restaurantPhoneNumber} onChange={(e) => setRestaurantPhone(e.target.value)} placeholder="+972501234567" className={inputCls} />
          </Field>
          <ContactPicker contacts={contacts} onPick={(c) => { setRestaurantPhone(c.phoneNumber); if (!restaurantName) setRestaurantName(c.name); }} />
          <Field label="Restaurant name (optional)">
            <input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} placeholder="Test Restaurant" className={inputCls} />
          </Field>
          <Field label="City">
            <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date"><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
            <Field label="Time (24h)"><input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} /></Field>
            <Field label="Party size"><input type="number" min={1} max={20} required value={partySize} onChange={(e) => setPartySize(Number(e.target.value))} className={inputCls} /></Field>
          </div>
          <Field label="Reservation name">
            <input required value={reservationName} onChange={(e) => setReservationName(e.target.value)} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowNearbyTimes} onChange={(e) => setAllowNearbyTimes(e.target.checked)} />
            Accept nearby times within
            <input type="number" min={0} max={120} value={timeWindowMinutes} onChange={(e) => setTimeWindowMinutes(Number(e.target.value))} className="w-16 rounded border border-black/15 dark:border-white/15 px-2 py-0.5" />
            minutes
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className={btnPrimary}>Review</button>
        </form>
      )}

      {stage !== "form" && draftId && (
        <div className={panelCls}>
          <h2 className="text-lg font-medium">Confirm reservation</h2>
          <ul className="text-sm space-y-1 font-mono">
            <li>📞 {restaurantPhoneNumber}</li>
            <li>🍽️ {restaurantName || "Restaurant"} ({city})</li>
            <li>📅 {date} at {time}</li>
            <li>👥 {partySize} {partySize === 1 ? "person" : "people"} under {reservationName}</li>
            <li>⏱️ {allowNearbyTimes ? `accepts ±${timeWindowMinutes}min alternates` : "exact time only"}</li>
          </ul>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button onClick={placeCall} disabled={stage === "placing"} className={btnPrimary}>
              {stage === "placing" ? "Placing call…" : "Place call now"}
            </button>
            <button onClick={reset} className={btnSecondary}>Edit / new</button>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent reservations</h2>
        {recent.length === 0 && <p className="text-sm opacity-60">None yet.</p>}
        <ul className="space-y-2">
          {recent.map((r) => {
            const Wrapper = r.lastCallId
              ? (props: { children: React.ReactNode }) => (
                  <Link
                    href={`/calls/${r.lastCallId}`}
                    className="block rounded border border-black/10 dark:border-white/10 p-3 text-sm hover:bg-black/5 dark:hover:bg-white/5 hover:border-blue-400 transition-colors cursor-pointer"
                  >
                    {props.children}
                  </Link>
                )
              : (props: { children: React.ReactNode }) => (
                  <div className="block rounded border border-black/10 dark:border-white/10 p-3 text-sm opacity-70">
                    {props.children}
                  </div>
                );
            return (
              <li key={r.requestId}>
                <Wrapper>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex-1 min-w-0">
                      <span className="font-mono mr-2">{r.restaurant.name || "Restaurant"}</span>
                      <span className="opacity-60">{r.reservation.date} {r.reservation.time} · {r.reservation.partySize}p · {r.reservation.reservationName}</span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono opacity-70">{r.status}</span>
                      {r.lastCallId && <span className="text-xs opacity-50">→</span>}
                    </div>
                  </div>
                </Wrapper>
                <button
                  onClick={(e) => { e.stopPropagation(); loadFromHistory(r); }}
                  className="mt-1 text-xs opacity-70 hover:opacity-100 hover:underline"
                  title="Pre-fill the form with these details"
                >
                  Book again ↺
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ============================================================================
// Ask panel
// ============================================================================

function AskPanel() {
  const router = useRouter();
  const contacts = useContacts();
  const [recipientPhoneNumber, setRecipientPhone] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [onBehalfOf, setOnBehalfOf] = useState("Tamir Sida");
  const [questions, setQuestions] = useState<string[]>([""]);

  function loadFromHistory(r: RecentAsk) {
    setRecipientPhone(r.recipientPhoneNumber);
    setRecipientName(r.recipientName ?? "");
    if (r.onBehalfOf) setOnBehalfOf(r.onBehalfOf);
    setQuestions(r.questions.length > 0 ? r.questions : [""]);
    setStage("form");
    setDraftId(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const [stage, setStage] = useState<"form" | "review" | "placing">("form");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentAsk[]>([]);

  useEffect(() => { void refreshRecent(); }, []);
  async function refreshRecent() {
    try {
      const res = await authedFetch("/api/asks");
      if (!res.ok) return;
      const data = await res.json();
      setRecent(data.items ?? []);
    } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const filtered = questions.map((q) => q.trim()).filter((q) => q.length > 0);
    if (filtered.length === 0) { setError("Add at least one question"); return; }
    const res = await authedFetch("/api/asks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientPhoneNumber,
        recipientName: recipientName || null,
        onBehalfOf,
        questions: filtered,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "failed"); return; }
    setDraftId(data.requestId);
    setStage("review");
  }

  async function placeCall() {
    if (!draftId) return;
    setStage("placing");
    setError(null);
    const res = await authedFetch(`/api/asks/${draftId}/place-call`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "failed"); setStage("review"); return; }
    router.push(`/calls/${data.callId}`);
  }
  function reset() { setStage("form"); setDraftId(null); setError(null); void refreshRecent(); }

  return (
    <div className="space-y-8">
      {stage === "form" && (
        <form onSubmit={submit} className={panelCls}>
          <h2 className="text-lg font-medium">Ask questions</h2>
          <Field label="Recipient phone (E.164)">
            <input required value={recipientPhoneNumber} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="+972501234567" className={inputCls} />
          </Field>
          <ContactPicker contacts={contacts} onPick={(c) => { setRecipientPhone(c.phoneNumber); if (!recipientName) setRecipientName(c.name); }} />
          <Field label="Recipient name (optional)">
            <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Dr. Cohen" className={inputCls} />
          </Field>
          <Field label="On behalf of">
            <input required value={onBehalfOf} onChange={(e) => setOnBehalfOf(e.target.value)} className={inputCls} />
          </Field>

          <div className="space-y-2">
            <p className="text-sm opacity-80">Questions (one per line, ask them in order)</p>
            {questions.map((q, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-xs opacity-50 font-mono mt-2 w-6 text-right">{i + 1}.</span>
                <input
                  value={q}
                  onChange={(e) => setQuestions((arr) => arr.map((x, idx) => idx === i ? e.target.value : x))}
                  placeholder={i === 0 ? "האם יש לכם תור פנוי השבוע?" : "next question…"}
                  className={inputCls}
                />
                {questions.length > 1 && (
                  <button type="button" onClick={() => setQuestions((arr) => arr.filter((_, idx) => idx !== i))} className="text-xs opacity-60 hover:opacity-100 px-1">×</button>
                )}
              </div>
            ))}
            {questions.length < 10 && (
              <button type="button" onClick={() => setQuestions((arr) => [...arr, ""])} className="text-xs opacity-80 hover:opacity-100">
                + add another question
              </button>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className={btnPrimary}>Review</button>
        </form>
      )}

      {stage !== "form" && draftId && (
        <div className={panelCls}>
          <h2 className="text-lg font-medium">Confirm questions</h2>
          <ul className="text-sm space-y-1 font-mono">
            <li>📞 {recipientPhoneNumber}{recipientName ? ` (${recipientName})` : ""}</li>
            <li>👤 On behalf of {onBehalfOf}</li>
            <li className="font-sans">❓ {questions.filter((q) => q.trim()).length} question(s):</li>
          </ul>
          <ol className="text-sm space-y-1 list-decimal list-inside" dir="auto">
            {questions.filter((q) => q.trim()).map((q, i) => <li key={i}>{q}</li>)}
          </ol>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button onClick={placeCall} disabled={stage === "placing"} className={btnPrimary}>
              {stage === "placing" ? "Placing call…" : "Place call now"}
            </button>
            <button onClick={reset} className={btnSecondary}>Edit / new</button>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent questions</h2>
        {recent.length === 0 && <p className="text-sm opacity-60">None yet.</p>}
        <ul className="space-y-2">
          {recent.map((r) => {
            const Wrapper = r.lastCallId
              ? (props: { children: React.ReactNode }) => (
                  <Link
                    href={`/calls/${r.lastCallId}`}
                    className="block rounded border border-black/10 dark:border-white/10 p-3 text-sm space-y-2 hover:bg-black/5 dark:hover:bg-white/5 hover:border-blue-400 transition-colors cursor-pointer"
                  >
                    {props.children}
                  </Link>
                )
              : (props: { children: React.ReactNode }) => (
                  <div className="block rounded border border-black/10 dark:border-white/10 p-3 text-sm space-y-2 opacity-70">
                    {props.children}
                  </div>
                );
            return (
              <li key={r.requestId}>
                <Wrapper>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono flex-1 min-w-0 truncate">{r.recipientName ?? r.recipientPhoneNumber}</span>
                    <span className="text-xs font-mono opacity-70 shrink-0">
                      {r.status} · {(r.answers?.length ?? 0)}/{(r.questions?.length ?? 0)}
                      {r.lastCallId && <span className="opacity-50 ml-2">→</span>}
                    </span>
                  </div>
                  <div dir="auto" className="space-y-1">
                    {(r.questions ?? []).map((q, i) => {
                      const a = (r.answers ?? []).find((x) => x.index === i);
                      return (
                        <div key={i} className="opacity-90 pl-1">
                          <div>Q{i + 1}: {q}</div>
                          {a && <div className="opacity-70 pl-3">A: {a.answer}</div>}
                        </div>
                      );
                    })}
                  </div>
                </Wrapper>
                <button
                  onClick={(e) => { e.stopPropagation(); loadFromHistory(r); }}
                  className="mt-1 text-xs opacity-70 hover:opacity-100 hover:underline"
                  title="Pre-fill the form with these details"
                >
                  Ask again ↺
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

const inputCls = "w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm";
const btnPrimary = "rounded bg-blue-600 px-4 py-2 text-white text-sm font-medium disabled:opacity-50";
const btnSecondary = "rounded border border-black/20 dark:border-white/20 px-4 py-2 text-sm";
const panelCls = "space-y-4 rounded-lg border border-black/10 dark:border-white/10 p-5";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm space-y-1">
      <span className="opacity-80">{label}</span>
      {children}
    </label>
  );
}
