// TwiML builders used by the worker. Mirrors lib/twilio/twiml.ts on the Next.js
// side but lives here so the worker is self-contained for prod (separate Docker
// image, no shared filesystem with Next.js).
//
// docs: https://docs.twilio.com/voice/twiml/stream
//       https://docs.twilio.com/voice/twiml/conference

import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

export interface RestaurantLegOpts {
  workerStreamUrl: string; // wss://...
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

export interface ConferenceJoinOpts {
  conferenceName: string;
  statusCallbackUrl: string;
  startConferenceOnEnter: boolean;
  endConferenceOnExit: boolean;
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
    },
    opts.conferenceName,
  );
  return vr.toString();
}

export function hangupTwiml(): string {
  const vr = new VoiceResponse();
  vr.hangup();
  return vr.toString();
}
