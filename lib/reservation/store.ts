import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { reservationsCol, conversationsCol } from "@/lib/firebase/admin";
import type { ReservationRequest, ReservationRequestPatch, Source } from "@/lib/reservation/schema";
import { ReservationRequest as ReservationRequestSchema } from "@/lib/reservation/schema";

// Firestore CRUD for reservation requests and conversations.
// Matches design doc §14.2 (conversations) and §14.3 (reservationRequests).

export function emptyReservation(args: {
  requestId?: string;
  userId: string;
  source: Source;
  conversationId?: string;
  userPhoneNumber: string;
}): ReservationRequest {
  return {
    requestId: args.requestId ?? randomUUID(),
    userId: args.userId,
    conversationId: args.conversationId,
    source: args.source,
    restaurant: { name: "", city: "", phoneNumber: null, branch: null },
    reservation: {
      date: "1970-01-01",
      time: "00:00",
      partySize: 0,
      reservationName: "",
      preferences: [],
      acceptableAlternatives: { allowNearbyTimes: false, timeWindowMinutes: 0 },
    },
    handoff: { userPhoneNumber: args.userPhoneNumber, required: false, reason: null },
    status: "COLLECTING_REQUEST",
  };
}

export async function saveReservation(req: ReservationRequest): Promise<void> {
  // No validation here — drafts are intentionally incomplete (empty restaurant
  // name, partySize=0, etc.) until the model fills them in. The strict shape
  // is enforced at the boundary that needs it: the state machine refuses to
  // transition to READY_TO_CALL if required fields are missing, and the
  // start_restaurant_call tool handler validates phone numbers there.
  await reservationsCol().doc(req.requestId).set(
    { ...req, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function getReservation(requestId: string): Promise<ReservationRequest | null> {
  const snap = await reservationsCol().doc(requestId).get();
  if (!snap.exists) return null;
  // Strip Firestore-only fields (createdAt, updatedAt) before parsing.
  const data = snap.data() as Record<string, unknown>;
  const { createdAt: _c, updatedAt: _u, ...rest } = data;
  // Read path tolerates drafts: cast through unknown rather than schema-parse,
  // since the strict schema would reject empty placeholders.
  return rest as unknown as ReservationRequest;
}

export function applyPatch(current: ReservationRequest, patch: ReservationRequestPatch): ReservationRequest {
  const next: ReservationRequest = JSON.parse(JSON.stringify(current));
  if (patch.restaurantName != null) next.restaurant.name = patch.restaurantName;
  if (patch.city != null) next.restaurant.city = patch.city;
  if (patch.date != null) next.reservation.date = patch.date;
  if (patch.time != null) next.reservation.time = patch.time;
  if (patch.partySize != null) next.reservation.partySize = patch.partySize;
  if (patch.reservationName != null) next.reservation.reservationName = patch.reservationName;
  if (patch.preferences) next.reservation.preferences = patch.preferences;
  return next;
}

// Conversation metadata (Firestore §14.2). The OpenAI conversation ID is opaque
// and bound to a single reservation request.
export async function createConversation(args: {
  userId: string;
  source: Source;
  openAiConversationId: string;
}): Promise<string> {
  const conversationId = randomUUID();
  await conversationsCol().doc(conversationId).set({
    conversationId,
    userId: args.userId,
    source: args.source,
    openAiConversationId: args.openAiConversationId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return conversationId;
}

export async function getConversation(conversationId: string): Promise<{ openAiConversationId: string } | null> {
  const snap = await conversationsCol().doc(conversationId).get();
  if (!snap.exists) return null;
  const data = snap.data() as { openAiConversationId?: string };
  if (!data.openAiConversationId) return null;
  return { openAiConversationId: data.openAiConversationId };
}
