import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyTwilioSignature, buildWorkerUrl } from "../twilio/signature.js";
import { updateCallRecord } from "../twilio/firestore-calls.js";

interface Query {
  callId?: string;
  leg?: string;
  source?: string;
}

// POST /twilio/status
// Receives Twilio call-status callbacks and updates the Firestore call record.
export function registerStatusRoute(app: FastifyInstance) {
  app.post<{ Querystring: Query; Body: Record<string, string> }>(
    "/twilio/status",
    async (req, reply) => {
      const signedUrl = buildWorkerUrl("/twilio/status", queryToObject(req));
      const signature = (req.headers["x-twilio-signature"] as string | undefined) ?? null;
      const valid = verifyTwilioSignature({ signature, url: signedUrl, params: req.body ?? {} });
      if (!valid) {
        req.log.warn({ url: signedUrl }, "twilio_status_signature_invalid");
        return reply.code(403).send("Forbidden");
      }

      const callId = req.query.callId;
      const body = req.body ?? {};
      req.log.info(
        {
          callId,
          callStatus: body.CallStatus,
          callSid: body.CallSid,
          conferenceSid: body.ConferenceSid,
          leg: req.query.leg,
        },
        "twilio_status_callback",
      );

      if (callId) {
        const patch: Record<string, unknown> = {};
        if (body.CallStatus) patch.status = body.CallStatus;
        if (body.ConferenceSid) patch.twilioConferenceSid = body.ConferenceSid;
        if (Object.keys(patch).length > 0) await updateCallRecord(callId, patch);
      }
      return reply.send("ok");
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
