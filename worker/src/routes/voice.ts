import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyTwilioSignature, buildWorkerUrl, workerWssUrl } from "../twilio/signature.js";
import { conferenceJoinTwiml, hangupTwiml, restaurantLegTwiml } from "../twilio/twiml.js";
import { getCallRecord } from "../twilio/firestore-calls.js";

interface Query {
  callId?: string;
  handoff?: string;
}

// POST /twilio/voice
// Twilio fetches this when the outbound call connects. Returns TwiML.
// Two modes (selected by ?handoff query):
//   - default (restaurant leg): <Connect><Stream> to wss://.../media
//   - handoff=1 (user leg): <Dial><Conference> straight into the existing room
export function registerVoiceRoute(app: FastifyInstance) {
  app.post<{ Querystring: Query; Body: Record<string, string> }>(
    "/twilio/voice",
    async (req, reply) => {
      const { callId, handoff } = req.query;
      const isHandoff = handoff === "1";

      const signedUrl = buildWorkerUrl("/twilio/voice", queryToObject(req));
      const signature = (req.headers["x-twilio-signature"] as string | undefined) ?? null;
      const valid = verifyTwilioSignature({ signature, url: signedUrl, params: req.body ?? {} });
      if (!valid) {
        req.log.warn({ url: signedUrl }, "twilio_voice_signature_invalid");
        return reply.code(403).send("Forbidden");
      }

      if (!callId) {
        req.log.warn("twilio_voice_missing_callid");
        return twiml(reply, hangupTwiml());
      }

      const record = await getCallRecord(callId);
      req.log.info({ callId, isHandoff, twilioCallSid: req.body?.CallSid }, "twilio_voice_webhook");

      if (isHandoff) {
        return twiml(
          reply,
          conferenceJoinTwiml({
            conferenceName: `reservation-${callId}`,
            statusCallbackUrl: buildWorkerUrl("/twilio/status", { callId, source: "conference" }),
            startConferenceOnEnter: true,
            endConferenceOnExit: false,
          }),
        );
      }

      // Restaurant leg: open a Media Stream to the worker itself.
      return twiml(
        reply,
        restaurantLegTwiml({
          workerStreamUrl: workerWssUrl("/media"),
          requestId: record?.requestId ?? "",
          callId,
        }),
      );
    },
  );
}

function queryToObject(req: FastifyRequest): Record<string, string> {
  const q = req.query as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function twiml(reply: import("fastify").FastifyReply, xml: string) {
  reply.header("Content-Type", "application/xml");
  return reply.send(xml);
}
