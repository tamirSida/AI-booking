import type { TraceCtx } from "@/lib/logging/trace";
import { twilioClient, fromNumber, buildWorkerWebhookUrl } from "@/lib/twilio/client";
import { createCallRecord, newCallId, updateCallRecord } from "@/lib/calls/store";
import { getAsk, updateAskStatus, asksCol } from "@/lib/ask/store";

// Place a Twilio call for an "Ask Question" request. Mirrors lib/calls/start.ts
// but routes to the worker with purpose=ask so the worker uses the question prompt.

export interface PlaceAskCallArgs {
  trace: TraceCtx;
  requestId: string;
}

export async function placeAskCall(args: PlaceAskCallArgs): Promise<string> {
  const ask = await getAsk(args.requestId);
  if (!ask) throw new Error(`ask request ${args.requestId} not found`);
  if (!ask.recipientPhoneNumber) throw new Error("ask.recipientPhoneNumber is required");

  const callId = newCallId();
  const conferenceName = `ask-${callId}`;

  await createCallRecord({
    callId,
    requestId: args.requestId,
    conferenceName,
    purpose: "ask",
  });

  const voiceUrl = buildWorkerWebhookUrl("/twilio/voice", { callId });
  const statusUrl = buildWorkerWebhookUrl("/twilio/status", { callId });
  const recordingUrl = buildWorkerWebhookUrl("/twilio/recording", { callId });

  await args.trace.log("twilio_call_create_request", {
    callId,
    to: ask.recipientPhoneNumber,
    from: fromNumber(),
    purpose: "ask",
  });

  const call = await twilioClient().calls.create({
    to: ask.recipientPhoneNumber,
    from: fromNumber(),
    url: voiceUrl,
    method: "POST",
    statusCallback: statusUrl,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    record: true,
    recordingStatusCallback: recordingUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
    recordingChannels: "dual",
  });

  await updateCallRecord(callId, { twilioCallSid: call.sid, status: "queued" });
  await updateAskStatus(args.requestId, "INITIATING_CALL");
  await asksCol().doc(args.requestId).set({ lastCallId: callId }, { merge: true });
  await args.trace.log("ask_call_created", { callId, twilioCallSid: call.sid });

  return callId;
}
