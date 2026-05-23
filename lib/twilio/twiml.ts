// TwiML builders for the reservation call workflow.
//
// Design doc §8 calls for a conference-first architecture so the user can be
// added later for payment handoff (§8.3, §8.5). Both the restaurant leg and
// any later-joining user leg dial into the same named conference room.
//
// Verified against: https://docs.twilio.com/voice/twiml/conference

import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

export interface ConferenceJoinOpts {
  conferenceName: string;
  statusCallbackUrl: string;
  // Whether this participant's arrival should start mixing.
  // The first leg (restaurant) sets this true; later handoff legs set false (they join an ongoing conference).
  startConferenceOnEnter: boolean;
  // Whether the conference should end when this participant leaves.
  // Set true for the AI/restaurant leg, false for user handoff legs.
  endConferenceOnExit: boolean;
  // Per design doc §16: recordings should not be enabled without explicit legal review.
  // Default off; opt in per-call when reviewed.
  record?: boolean;
}

export function conferenceJoinTwiml(opts: ConferenceJoinOpts): string {
  const vr = new VoiceResponse();
  const dial = vr.dial();
  dial.conference(
    {
      startConferenceOnEnter: opts.startConferenceOnEnter,
      endConferenceOnExit: opts.endConferenceOnExit,
      statusCallback: opts.statusCallbackUrl,
      statusCallbackEvent: ["start", "end", "join", "leave"],
      statusCallbackMethod: "POST",
      beep: "false",
      record: opts.record ? "record-from-start" : undefined,
    },
    opts.conferenceName,
  );
  return vr.toString();
}

// Phase 4: restaurant leg uses <Connect><Stream> to bridge audio to our worker,
// which talks to OpenAI Realtime in Hebrew. Twilio sends μ-law 8kHz frames over
// a WebSocket; the worker pipes them to OpenAI and ships the response audio back.
// docs: https://www.twilio.com/docs/voice/twiml/stream
export interface RestaurantLegOpts {
  // wss:// URL where the worker is listening (e.g. wss://abc.ngrok-free.app/media).
  workerStreamUrl: string;
  // Passed to the worker via the Twilio "start" event's customParameters map,
  // so the bridge can look up reservation details before greeting the host.
  requestId: string;
  callId: string;
}

export function restaurantLegTwiml(opts: RestaurantLegOpts): string {
  const vr = new VoiceResponse();
  const connect = vr.connect();
  const stream = connect.stream({ url: opts.workerStreamUrl });
  stream.parameter({ name: "requestId", value: opts.requestId });
  stream.parameter({ name: "callId", value: opts.callId });
  return vr.toString();
}

// Used to fail gracefully if the webhook is hit in an invalid state.
export function hangupTwiml(): string {
  const vr = new VoiceResponse();
  vr.hangup();
  return vr.toString();
}
