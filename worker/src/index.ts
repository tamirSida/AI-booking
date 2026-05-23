// Standalone worker service for Twilio Media Streams ↔ OpenAI Realtime bridging.
// Runs separately from Next.js because Next.js route handlers don't support
// WebSocket upgrades. See architecture-hybrid-backend memory note.

import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runBridge } from "./realtime-bridge.js";
import type { ResolvedContext } from "./realtime-bridge.js";
import type { ReservationContext } from "./prompts.js";
import type { AskContext } from "./ask-prompts.js";
import { registerVoiceRoute } from "./routes/voice.js";
import { registerStatusRoute } from "./routes/status.js";
import { registerRecordingRoute } from "./routes/recording.js";

const PORT = Number(process.env.WORKER_PORT ?? 8080);
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";

function log(event: string, details: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, level, ...details });
  if (level === "error") console.error(line);
  else console.log(line);
}

function initFirebase() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be set");
  initializeApp({ credential: cert(JSON.parse(raw)) });
}

async function resolveContext(customParams: Record<string, string>): Promise<ResolvedContext> {
  const requestId = customParams.requestId;
  const callId = customParams.callId;
  initFirebase();

  // Look up the call record first to learn the purpose (reservation vs ask).
  // Falls back to reservation if not found (Phase 1 calls predated purpose).
  let purpose: "reservation" | "ask" = "reservation";
  if (callId) {
    const callDoc = await getFirestore().collection("calls").doc(callId).get();
    const p = (callDoc.data() as { purpose?: string } | undefined)?.purpose;
    if (p === "ask") purpose = "ask";
  }

  if (purpose === "ask") {
    if (!requestId) {
      log("ask_missing_request_id", { customParams }, "warn");
      return { type: "ask", ctx: fallbackAskContext(), askRequestId: "" };
    }
    const doc = await getFirestore().collection("askRequests").doc(requestId).get();
    if (!doc.exists) {
      log("ask_not_found", { requestId }, "warn");
      return { type: "ask", ctx: fallbackAskContext(), askRequestId: requestId };
    }
    const data = doc.data() as Record<string, unknown>;
    return {
      type: "ask",
      askRequestId: requestId,
      ctx: {
        recipientName: (data.recipientName as string | null) ?? null,
        recipientPhoneNumber: String(data.recipientPhoneNumber ?? ""),
        onBehalfOf: String(data.onBehalfOf ?? "the customer"),
        questions: Array.isArray(data.questions) ? (data.questions as string[]) : [],
      },
    };
  }

  // Reservation path (existing behavior).
  if (!requestId) {
    log("missing_request_id", { customParams }, "warn");
    return { type: "reservation", ctx: fallbackReservationContext() };
  }
  const doc = await getFirestore().collection("reservationRequests").doc(requestId).get();
  if (!doc.exists) {
    log("reservation_not_found", { requestId }, "warn");
    return { type: "reservation", ctx: fallbackReservationContext() };
  }
  const data = doc.data() as Record<string, unknown>;
  const restaurant = (data.restaurant ?? {}) as Record<string, unknown>;
  const reservation = (data.reservation ?? {}) as Record<string, unknown>;
  const altRaw = reservation.acceptableAlternatives as Record<string, unknown> | undefined;
  return {
    type: "reservation",
    ctx: {
      restaurantName: String(restaurant.name ?? ""),
      city: String(restaurant.city ?? ""),
      date: String(reservation.date ?? ""),
      time: String(reservation.time ?? ""),
      partySize: Number(reservation.partySize ?? 0),
      reservationName: String(reservation.reservationName ?? ""),
      preferences: (reservation.preferences as string[]) ?? [],
      allowNearbyTimes: Boolean(altRaw?.allowNearbyTimes),
      timeWindowMinutes: Number(altRaw?.timeWindowMinutes ?? 30),
      today: new Date().toISOString().slice(0, 10),
    },
  };
}

function fallbackReservationContext(): ReservationContext {
  return {
    restaurantName: "the restaurant",
    city: "",
    date: "",
    time: "",
    partySize: 1,
    reservationName: "",
    today: new Date().toISOString().slice(0, 10),
  };
}

function fallbackAskContext(): AskContext {
  return {
    recipientName: null,
    recipientPhoneNumber: "",
    onBehalfOf: "the customer",
    questions: [],
  };
}

async function recordAskAnswer(args: { askRequestId: string; index: number; answer: string; confidence?: number }) {
  initFirebase();
  const ref = getFirestore().collection("askRequests").doc(args.askRequestId);
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() ?? {}) as { questions?: string[]; answers?: Array<{ index: number; question: string; answer: string; confidence: number | null; answeredAt: string }> };
    const question = data.questions?.[args.index] ?? "";
    const existing = (data.answers ?? []).filter((a) => a.index !== args.index);
    const next = {
      index: args.index,
      question,
      answer: args.answer,
      confidence: args.confidence ?? null,
      answeredAt: new Date().toISOString(),
    };
    const allCount = data.questions?.length ?? 0;
    const done = existing.length + 1 >= allCount;
    tx.set(
      ref,
      {
        answers: [...existing, next].sort((a, b) => a.index - b.index),
        status: done ? "ANSWERED" : "ASKING",
        updatedAt: new Date(),
      },
      { merge: true },
    );
  });
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY must be set");

  // Firebase admin must init once before any route handler reads/writes.
  initFirebase();

  const app = Fastify({ logger: false });
  await app.register(formbody); // Twilio webhooks are application/x-www-form-urlencoded
  await app.register(websocket);

  // Surface route errors instead of letting Fastify swallow them into a 500.
  // Without this, signature/env failures return 500 with no log line.
  app.setErrorHandler((err, req, reply) => {
    const e = err as Error;
    log("route_error", {
      url: req.url,
      method: req.method,
      message: e.message,
      stack: e.stack,
    }, "error");
    reply.code(500).send({ error: e.message });
  });

  app.get("/health", async () => ({ ok: true, model: REALTIME_MODEL }));

  // Twilio webhooks live on the worker so we only need ONE public tunnel.
  registerVoiceRoute(app);
  registerStatusRoute(app);
  registerRecordingRoute(app);

  app.get("/media", { websocket: true }, (twilioWs /* , req */) => {
    log("ws_upgrade_accepted");
    runBridge({
      twilioWs,
      openaiApiKey: apiKey,
      realtimeModel: REALTIME_MODEL,
      resolveContext,
      onAnswer: recordAskAnswer,
      log: (event, details, level) => log(event, details ?? {}, level),
    }).catch((err) => log("bridge_error", { message: String(err) }, "error"));
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  log("worker_listening", { port: PORT, model: REALTIME_MODEL });
}

main().catch((err) => {
  log("worker_fatal", { message: String(err) }, "error");
  process.exit(1);
});
