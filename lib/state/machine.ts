import type { ReservationStatus } from "@/lib/reservation/schema";

// Explicit state machine per design doc §7.3.
// Every illegal transition throws so the orchestrator surfaces bugs loudly
// instead of silently corrupting reservation state.

export type StateEvent =
  | "user_message_received"
  | "fields_missing"
  | "fields_complete"
  | "user_confirmed"
  | "call_initiated"
  | "ivr_detected"
  | "host_detected"
  | "reservation_confirmed_by_host"
  | "payment_requested_by_host"
  | "handoff_started"
  | "user_joined_conference"
  | "call_ended"
  | "error";

const TRANSITIONS: Record<ReservationStatus, Partial<Record<StateEvent, ReservationStatus>>> = {
  IDLE: {
    user_message_received: "COLLECTING_REQUEST",
  },
  COLLECTING_REQUEST: {
    user_message_received: "COLLECTING_REQUEST",
    fields_missing: "CLARIFYING_DETAILS",
    fields_complete: "READY_TO_CALL",
    error: "FAILED",
  },
  CLARIFYING_DETAILS: {
    user_message_received: "COLLECTING_REQUEST",
    fields_complete: "READY_TO_CALL",
    error: "FAILED",
  },
  READY_TO_CALL: {
    user_confirmed: "INITIATING_CALL",
    user_message_received: "COLLECTING_REQUEST",
    error: "FAILED",
  },
  INITIATING_CALL: {
    call_initiated: "INITIATING_CALL",
    ivr_detected: "NAVIGATING_IVR",
    host_detected: "SPEAKING_WITH_HOST",
    error: "FAILED",
  },
  NAVIGATING_IVR: {
    host_detected: "SPEAKING_WITH_HOST",
    payment_requested_by_host: "PAYMENT_OR_CARD_REQUESTED",
    error: "FAILED",
  },
  SPEAKING_WITH_HOST: {
    reservation_confirmed_by_host: "RESERVATION_CONFIRMED",
    payment_requested_by_host: "PAYMENT_OR_CARD_REQUESTED",
    handoff_started: "HANDOFF_IN_PROGRESS",
    call_ended: "CALL_COMPLETED",
    error: "FAILED",
  },
  RESERVATION_CONFIRMED: {
    call_ended: "CALL_COMPLETED",
    payment_requested_by_host: "PAYMENT_OR_CARD_REQUESTED",
    error: "FAILED",
  },
  PAYMENT_OR_CARD_REQUESTED: {
    handoff_started: "HANDOFF_IN_PROGRESS",
    error: "FAILED",
  },
  HANDOFF_IN_PROGRESS: {
    user_joined_conference: "USER_JOINED_CALL",
    call_ended: "CALL_COMPLETED",
    error: "FAILED",
  },
  USER_JOINED_CALL: {
    call_ended: "CALL_COMPLETED",
    error: "FAILED",
  },
  CALL_COMPLETED: {},
  FAILED: {},
};

export class IllegalTransitionError extends Error {
  constructor(public readonly from: ReservationStatus, public readonly event: StateEvent) {
    super(`Illegal transition: ${from} --(${event})--> ?`);
  }
}

export function transition(from: ReservationStatus, event: StateEvent): ReservationStatus {
  const next = TRANSITIONS[from]?.[event];
  if (!next) throw new IllegalTransitionError(from, event);
  return next;
}

export function canTransition(from: ReservationStatus, event: StateEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}
