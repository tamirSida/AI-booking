import type { FastifyInstance } from "fastify";
import { verifyTwilioSignature, buildWorkerUrl } from "../twilio/signature.js";
import { updateCallRecord } from "../twilio/firestore-calls.js";
import { writeLog } from "../firestore-logs.js";

interface Query {
  callId?: string;
}

// POST /twilio/recording
// Twilio invokes this when a call recording becomes available.
// Body includes: RecordingSid, RecordingUrl, RecordingDuration, CallSid, RecordingStatus.
export function registerRecordingRoute(app: FastifyInstance) {
  app.post<{ Querystring: Query; Body: Record<string, string> }>(
    "/twilio/recording",
    async (req, reply) => {
      const signedUrl = buildWorkerUrl("/twilio/recording", queryToObject(req.query));
      const signature = (req.headers["x-twilio-signature"] as string | undefined) ?? null;
      const valid = verifyTwilioSignature({ signature, url: signedUrl, params: req.body ?? {} });
      if (!valid) {
        req.log.warn({ url: signedUrl }, "twilio_recording_signature_invalid");
        return reply.code(403).send("Forbidden");
      }

      const body = req.body ?? {};
      const callId = req.query.callId ?? null;
      const recordingSid = body.RecordingSid;
      const recordingStatus = body.RecordingStatus;
      const duration = body.RecordingDuration;

      await writeLog(
        "twilio_recording_callback",
        { recordingSid, recordingStatus, duration, callSid: body.CallSid },
        "info",
        { callId, requestId: null },
      );

      if (callId && recordingSid && recordingStatus === "completed") {
        await updateCallRecord(callId, {
          recordingSid,
          recordingDurationSeconds: duration ? Number(duration) : undefined,
        } as never);
      }

      return reply.send("ok");
    },
  );
}

function queryToObject(q: Query): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (typeof v === "string") out[k] = v;
  return out;
}
