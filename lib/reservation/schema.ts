import { z } from "zod";

// Mirrors design doc §6 (Reservation Data Model) and §7.3 (State Machine).
// This schema is the single source of truth for reservation shape across
// Firestore writes, OpenAI structured outputs, and HTTP request validation.

export const ReservationStatus = z.enum([
  "IDLE",
  "COLLECTING_REQUEST",
  "CLARIFYING_DETAILS",
  "READY_TO_CALL",
  "INITIATING_CALL",
  "NAVIGATING_IVR",
  "SPEAKING_WITH_HOST",
  "RESERVATION_CONFIRMED",
  "PAYMENT_OR_CARD_REQUESTED",
  "HANDOFF_IN_PROGRESS",
  "USER_JOINED_CALL",
  "CALL_COMPLETED",
  "FAILED",
]);
export type ReservationStatus = z.infer<typeof ReservationStatus>;

export const Source = z.enum(["web", "telegram"]);
export type Source = z.infer<typeof Source>;

export const HandoffReason = z.enum([
  "payment_required",
  "host_requested_user",
  "manual",
  "uncertainty",
  "other",
]);
export type HandoffReason = z.infer<typeof HandoffReason>;

export const Restaurant = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  phoneNumber: z.string().nullable(),
  branch: z.string().nullable(),
});

export const Reservation = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "expected HH:mm"),
  partySize: z.number().int().positive(),
  reservationName: z.string().min(1),
  preferences: z.array(z.string()).default([]),
  acceptableAlternatives: z
    .object({
      allowNearbyTimes: z.boolean(),
      timeWindowMinutes: z.number().int().nonnegative(),
    })
    .default({ allowNearbyTimes: false, timeWindowMinutes: 0 }),
});

export const Handoff = z.object({
  userPhoneNumber: z.string().regex(/^\+\d{7,15}$/, "expected E.164"),
  required: z.boolean().default(false),
  reason: HandoffReason.nullable().default(null),
});

export const ReservationRequest = z.object({
  requestId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  source: Source,
  restaurant: Restaurant,
  reservation: Reservation,
  handoff: Handoff,
  status: ReservationStatus,
});
export type ReservationRequest = z.infer<typeof ReservationRequest>;

// Partial shape used by the model when it only has some fields collected.
// Mirrors the input to the update_reservation_request tool (design doc §11.1).
export const ReservationRequestPatch = z.object({
  restaurantName: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  time: z.string().nullable().optional(),
  partySize: z.number().int().positive().nullable().optional(),
  reservationName: z.string().nullable().optional(),
  preferences: z.array(z.string()).optional(),
});
export type ReservationRequestPatch = z.infer<typeof ReservationRequestPatch>;

// Required fields for a reservation to be ready to call (design doc §6.1).
export const REQUIRED_FIELDS = [
  "restaurant.name",
  "restaurant.city",
  "reservation.date",
  "reservation.time",
  "reservation.partySize",
  "reservation.reservationName",
  "handoff.userPhoneNumber",
] as const;
