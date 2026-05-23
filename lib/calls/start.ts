import type { TraceCtx } from "@/lib/logging/trace";
import type { ReservationRequest } from "@/lib/reservation/schema";
import { twilioClient, fromNumber, buildWorkerWebhookUrl } from "@/lib/twilio/client";
import { createCallRecord, newCallId, updateCallRecord } from "@/lib/calls/store";

// Initiates an outbound Twilio call to the restaurant.
// The restaurant leg joins a named conference (`callId`) so the user can be
// added later via the handoff endpoint (design doc §8.3).

export interface StartCallArgs {
  trace: TraceCtx;
  reservation: ReservationRequest;
  reservationSummary: string; // Hebrew text the TwiML <Say> will read first.
}

export async function startRestaurantCall(args: StartCallArgs): Promise<string> {
  const restaurantPhone = args.reservation.restaurant.phoneNumber;
  if (!restaurantPhone) {
    throw new Error("reservation.restaurant.phoneNumber is required to start a call");
  }
  const callId = newCallId();
  const conferenceName = `reservation-${callId}`;

  await createCallRecord({
    callId,
    requestId: args.reservation.requestId,
    conferenceName,
  });

  // Phase 4: /api/twilio/voice returns TwiML that opens a Media Stream to the
  // worker. The worker resolves reservation details from Firestore via requestId,
  // so we don't need to embed the summary in the URL anymore. Kept the arg in the
  // signature because the intake agent still passes a Hebrew summary string and
  // it gets logged for traceability.
  // Twilio webhooks live on the worker (so only the worker needs to be publicly reachable).
  const voiceUrl = buildWorkerWebhookUrl("/twilio/voice", { callId });
  void args.reservationSummary; // logged at the tool-call layer; not needed by the worker
  const statusUrl = buildWorkerWebhookUrl("/twilio/status", { callId });
  const recordingUrl = buildWorkerWebhookUrl("/twilio/recording", { callId });

  await args.trace.log("twilio_call_create_request", {
    callId,
    to: restaurantPhone,
    from: fromNumber(),
    voiceUrl,
    statusUrl,
  });

  const call = await twilioClient().calls.create({
    to: restaurantPhone,
    from: fromNumber(),
    url: voiceUrl,
    method: "POST",
    statusCallback: statusUrl,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    // Design doc §16 warns about recording — enabled here intentionally for
    // single-user MVP playback. Recordings stay on Twilio; we proxy through
    // the API with basic auth so they aren't publicly accessible.
    record: true,
    recordingStatusCallback: recordingUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
    recordingChannels: "dual",
  });

  await updateCallRecord(callId, { twilioCallSid: call.sid, status: "queued" });
  await args.trace.log("twilio_call_created", { callId, twilioCallSid: call.sid });

  return callId;
}
