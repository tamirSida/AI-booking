// Shared helper that walks a reservation from "draft" to "calling" without
// going through the LLM intake agent. Used by:
//   - The LLM tool handler (start_restaurant_call)
//   - The structured-UI endpoint (POST /api/reservations/[id]/place-call)

import type { TraceCtx } from "@/lib/logging/trace";
import { REQUIRED_FIELDS, type ReservationRequest } from "@/lib/reservation/schema";
import { reservationsCol } from "@/lib/firebase/admin";
import { getReservation, saveReservation } from "@/lib/reservation/store";
import { transition } from "@/lib/state/machine";
import { startRestaurantCall } from "@/lib/calls/start";

export class ReservationNotReadyError extends Error {
  constructor(public readonly missingFields: string[]) {
    super(`Reservation missing required fields: ${missingFields.join(", ")}`);
  }
}

export interface PlaceCallArgs {
  trace: TraceCtx;
  requestId: string;
  // Either an updated phone number from the model, or null to use the stored value.
  restaurantPhoneNumber?: string | null;
  reservationSummary: string;
}

function missingFields(req: ReservationRequest): string[] {
  const missing: string[] = [];
  for (const path of REQUIRED_FIELDS) {
    const [a, b] = path.split(".") as [keyof ReservationRequest, string];
    const root = req[a] as unknown;
    const v = root && typeof root === "object" ? (root as Record<string, unknown>)[b] : undefined;
    if (v === null || v === undefined || v === "" || (typeof v === "number" && v === 0)) {
      missing.push(path);
    }
  }
  return missing;
}

export async function placeCall(args: PlaceCallArgs): Promise<string> {
  const current = await getReservation(args.requestId);
  if (!current) throw new Error(`reservation ${args.requestId} not found`);

  const withPhone: ReservationRequest = args.restaurantPhoneNumber
    ? { ...current, restaurant: { ...current.restaurant, phoneNumber: args.restaurantPhoneNumber } }
    : current;

  const missing = missingFields(withPhone);
  if (missing.length > 0 || !withPhone.restaurant.phoneNumber) {
    throw new ReservationNotReadyError(
      missing.concat(withPhone.restaurant.phoneNumber ? [] : ["restaurant.phoneNumber"]),
    );
  }

  // FSM walk. The LLM intake path arrives here in COLLECTING_REQUEST and needs
  // the fields_complete transition first; the structured-form path skips intake
  // and starts in READY_TO_CALL, so the first hop is a no-op.
  let next = withPhone.status;
  if (next === "COLLECTING_REQUEST" || next === "CLARIFYING_DETAILS") {
    next = transition(next, "fields_complete");
  }
  next = transition(next, "user_confirmed");
  await saveReservation({ ...withPhone, status: next });

  const callId = await startRestaurantCall({
    trace: args.trace,
    reservation: { ...withPhone, status: next },
    reservationSummary: args.reservationSummary,
  });

  // Stamp the reservation with the latest callId so the UI can link to the monitor.
  await reservationsCol().doc(args.requestId).set({ lastCallId: callId }, { merge: true });

  return callId;
}
