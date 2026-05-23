import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { newTrace } from "@/lib/logging/trace";
import { reservationsCol } from "@/lib/firebase/admin";
import { saveReservation } from "@/lib/reservation/store";
import type { ReservationRequest } from "@/lib/reservation/schema";
import { requireAuth } from "@/lib/auth/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/reservations — structured create (form-driven, no LLM intake)
// GET  /api/reservations — list recent (newest first, limit 20)

const Body = z.object({
  restaurantPhoneNumber: z.string().regex(/^\+\d{7,15}$/, "expected E.164 like +972…"),
  restaurantName: z.string().min(1).default("Restaurant"),
  city: z.string().min(1).default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "HH:mm"),
  partySize: z.number().int().positive(),
  reservationName: z.string().min(1),
  preferences: z.array(z.string()).default([]),
  allowNearbyTimes: z.boolean().default(true),
  timeWindowMinutes: z.number().int().nonnegative().default(30),
  // For Phase 2 single-user: stored on the reservation as the handoff target.
  // Falls back to USER_PHONE_NUMBER env if missing.
  userPhoneNumber: z.string().regex(/^\+\d{7,15}$/).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  void auth;
  const trace = newTrace();
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "bad request", details: String(err) }, { status: 400 });
  }
  const userPhone = body.userPhoneNumber ?? process.env.USER_PHONE_NUMBER;
  if (!userPhone) {
    return NextResponse.json({ error: "userPhoneNumber missing and USER_PHONE_NUMBER env not set" }, { status: 400 });
  }

  const requestId = randomUUID();
  const reservation: ReservationRequest = {
    requestId,
    userId: "local-dev-user",
    source: "web",
    restaurant: {
      name: body.restaurantName,
      city: body.city,
      phoneNumber: body.restaurantPhoneNumber,
      branch: null,
    },
    reservation: {
      date: body.date,
      time: body.time,
      partySize: body.partySize,
      reservationName: body.reservationName,
      preferences: body.preferences,
      acceptableAlternatives: {
        allowNearbyTimes: body.allowNearbyTimes,
        timeWindowMinutes: body.timeWindowMinutes,
      },
    },
    handoff: { userPhoneNumber: userPhone, required: false, reason: null },
    // Skip COLLECTING/CLARIFYING — structured form jumps straight to ready.
    status: "READY_TO_CALL",
  };
  await saveReservation(reservation);
  await trace.log("reservation_created_structured", { requestId });

  return NextResponse.json({ requestId, reservation, traceId: trace.traceId });
}

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  void auth;
  const snap = await reservationsCol().orderBy("updatedAt", "desc").limit(20).get();
  const items = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      requestId: data.requestId,
      status: data.status,
      restaurant: data.restaurant,
      reservation: data.reservation,
      lastCallId: data.lastCallId ?? null,
      updatedAt: data.updatedAt,
    };
  });
  return NextResponse.json({ items });
}
