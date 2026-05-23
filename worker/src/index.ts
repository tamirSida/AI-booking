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
import type { ReservationContext } from "./prompts.js";
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

async function resolveContext(customParams: Record<string, string>): Promise<ReservationContext> {
  const requestId = customParams.requestId;
  if (!requestId) {
    log("missing_request_id", { customParams }, "warn");
    return fallbackContext();
  }
  initFirebase();
  const doc = await getFirestore().collection("reservationRequests").doc(requestId).get();
  if (!doc.exists) {
    log("reservation_not_found", { requestId }, "warn");
    return fallbackContext();
  }
  const data = doc.data() as Record<string, unknown>;
  const restaurant = (data.restaurant ?? {}) as Record<string, unknown>;
  const reservation = (data.reservation ?? {}) as Record<string, unknown>;
  const altRaw = reservation.acceptableAlternatives as Record<string, unknown> | undefined;
  return {
    restaurantName: String(restaurant.name ?? ""),
    city: String(restaurant.city ?? ""),
    date: String(reservation.date ?? ""),
    time: String(reservation.time ?? ""),
    partySize: Number(reservation.partySize ?? 0),
    reservationName: String(reservation.reservationName ?? ""),
    preferences: (reservation.preferences as string[]) ?? [],
    allowNearbyTimes: Boolean(altRaw?.allowNearbyTimes),
    timeWindowMinutes: Number(altRaw?.timeWindowMinutes ?? 30),
  };
}

function fallbackContext(): ReservationContext {
  return {
    restaurantName: "the restaurant",
    city: "",
    date: "",
    time: "",
    partySize: 1,
    reservationName: "",
  };
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
