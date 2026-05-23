import { NextRequest, NextResponse } from "next/server";
import { newTrace } from "@/lib/logging/trace";
import { placeCall, ReservationNotReadyError } from "@/lib/calls/place";
import { getReservation } from "@/lib/reservation/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/reservations/[id]/place-call
// Triggers the Twilio call. Used by the structured-UI confirm step.

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await ctx.params;
  const trace = newTrace({ requestId });
  const reservation = await getReservation(requestId);
  if (!reservation) {
    return NextResponse.json({ error: "reservation not found" }, { status: 404 });
  }

  const summary = buildHebrewSummary(reservation);
  try {
    const callId = await placeCall({
      trace,
      requestId,
      restaurantPhoneNumber: reservation.restaurant.phoneNumber,
      reservationSummary: summary,
    });
    await trace.log("restaurant_call_started", { callId, requestId });
    return NextResponse.json({ callId, traceId: trace.traceId });
  } catch (err) {
    if (err instanceof ReservationNotReadyError) {
      return NextResponse.json({ error: err.message, missingFields: err.missingFields }, { status: 400 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function buildHebrewSummary(r: ReturnType<typeof noop>): string {
  return `שולחן ל-${r.reservation.partySize} אנשים בשעה ${r.reservation.time} בתאריך ${r.reservation.date} על שם ${r.reservation.reservationName}`;
}

function noop(): import("@/lib/reservation/schema").ReservationRequest {
  throw new Error("type helper");
}
