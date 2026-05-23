import type { TraceCtx } from "@/lib/logging/trace";
import type { HandoffReason } from "@/lib/reservation/schema";
import { twilioClient, fromNumber, buildWorkerWebhookUrl } from "@/lib/twilio/client";
import { getCallRecord, updateCallRecord } from "@/lib/calls/store";

// Dials the hardcoded USER_PHONE_NUMBER and bridges them into the active
// conference for `callId`. Used both by the manual handover UI button and by
// the automatic payment-trigger path (design doc §8.4 / §8.5).

export interface HandoffArgs {
  trace: TraceCtx;
  callId: string;
  reason: HandoffReason;
}

export async function handoffUser(args: HandoffArgs): Promise<{ userCallSid: string }> {
  const userPhone = process.env.USER_PHONE_NUMBER;
  if (!userPhone) {
    throw new Error("USER_PHONE_NUMBER must be set for handoff.");
  }
  const record = await getCallRecord(args.callId);
  if (!record) throw new Error(`call ${args.callId} not found`);

  // The user's leg uses the same conference name. Their TwiML response (from
  // /api/twilio/voice with handoff=1) joins the existing conference.
  const voiceUrl = buildWorkerWebhookUrl("/twilio/voice", {
    callId: args.callId,
    handoff: "1",
  });
  const statusUrl = buildWorkerWebhookUrl("/twilio/status", {
    callId: args.callId,
    leg: "user",
  });

  await args.trace.log("handoff_dialing_user", { callId: args.callId, reason: args.reason });

  const userCall = await twilioClient().calls.create({
    to: userPhone,
    from: fromNumber(),
    url: voiceUrl,
    method: "POST",
    statusCallback: statusUrl,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
  });

  await updateCallRecord(args.callId, {
    handoffTriggered: true,
    participants: [...(record.participants ?? []), userCall.sid],
  });
  await args.trace.log("handoff_user_call_created", {
    callId: args.callId,
    userCallSid: userCall.sid,
    reason: args.reason,
  });
  return { userCallSid: userCall.sid };
}
