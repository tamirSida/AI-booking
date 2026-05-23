"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface RecentItem {
  requestId: string;
  status: string;
  restaurant: { name: string; city: string };
  reservation: { date: string; time: string; partySize: number; reservationName: string };
}

const today = () => new Date().toISOString().slice(0, 10);

export default function Home() {
  const router = useRouter();
  const [restaurantPhoneNumber, setRestaurantPhone] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [city, setCity] = useState("Tel Aviv");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("21:00");
  const [partySize, setPartySize] = useState(2);
  const [reservationName, setReservationName] = useState("Tamir Sida");
  const [allowNearbyTimes, setAllowNearbyTimes] = useState(true);
  const [timeWindowMinutes, setTimeWindowMinutes] = useState(30);

  const [stage, setStage] = useState<"form" | "review" | "placing">("form");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  useEffect(() => {
    void refreshRecent();
  }, []);

  async function refreshRecent() {
    try {
      const res = await fetch("/api/reservations");
      if (!res.ok) return;
      const data = await res.json();
      setRecent(data.items ?? []);
    } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantPhoneNumber,
        restaurantName: restaurantName || "Restaurant",
        city,
        date,
        time,
        partySize,
        reservationName,
        allowNearbyTimes,
        timeWindowMinutes,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "failed");
      return;
    }
    setDraftId(data.requestId);
    setStage("review");
  }

  async function placeCall() {
    if (!draftId) return;
    setStage("placing");
    setError(null);
    const res = await fetch(`/api/reservations/${draftId}/place-call`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "failed");
      setStage("review");
      return;
    }
    router.push(`/calls/${data.callId}`);
  }

  function reset() {
    setStage("form");
    setDraftId(null);
    setError(null);
    void refreshRecent();
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">ai_booking</h1>
        <p className="text-sm opacity-70">AI restaurant reservation call agent</p>
      </header>

      {stage === "form" && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-black/10 dark:border-white/10 p-5">
          <h2 className="text-lg font-medium">New reservation</h2>
          <Field label="Restaurant phone (E.164)">
            <input required value={restaurantPhoneNumber} onChange={(e) => setRestaurantPhone(e.target.value)} placeholder="+972501234567" className={inputCls} />
          </Field>
          <Field label="Restaurant name (optional)">
            <input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} placeholder="Test Restaurant" className={inputCls} />
          </Field>
          <Field label="City">
            <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date">
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Time (24h)">
              <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Party size">
              <input type="number" min={1} max={20} required value={partySize} onChange={(e) => setPartySize(Number(e.target.value))} className={inputCls} />
            </Field>
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
        <div className="space-y-4 rounded-lg border border-black/10 dark:border-white/10 p-5">
          <h2 className="text-lg font-medium">Confirm reservation request</h2>
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
          {recent.map((r) => (
            <li key={r.requestId} className="rounded border border-black/10 dark:border-white/10 p-3 text-sm flex items-center justify-between">
              <span>
                <span className="font-mono mr-2">{r.restaurant.name || "Restaurant"}</span>
                <span className="opacity-60">{r.reservation.date} {r.reservation.time} · {r.reservation.partySize}p · {r.reservation.reservationName}</span>
              </span>
              <span className="text-xs font-mono opacity-70">{r.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

const inputCls = "w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm";
const btnPrimary = "rounded bg-blue-600 px-4 py-2 text-white text-sm font-medium disabled:opacity-50";
const btnSecondary = "rounded border border-black/20 dark:border-white/20 px-4 py-2 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm space-y-1">
      <span className="opacity-80">{label}</span>
      {children}
    </label>
  );
}
