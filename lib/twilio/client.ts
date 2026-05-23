// Twilio SDK v6 singleton + signature validator.
//
// Verified against:
//   - https://www.twilio.com/docs/voice/api/call-resource (calls.create, statusCallbackEvent)
//   - https://www.twilio.com/docs/usage/webhooks/webhooks-security (X-Twilio-Signature)
// SDK signatures verified in node_modules/twilio/lib/{rest/api/v2010/account/call.d.ts,webhooks/webhooks.d.ts}.

import twilio, { Twilio } from "twilio";

let client: Twilio | null = null;

export function twilioClient(): Twilio {
  if (client) return client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set.");
  }
  client = twilio(sid, token);
  return client;
}

export function fromNumber(): string {
  const n = process.env.TWILIO_PHONE_NUMBER;
  if (!n) throw new Error("TWILIO_PHONE_NUMBER must be set.");
  return n;
}

// Build the URL Twilio will see when calling our webhooks. All Twilio-facing
// webhooks now live on the worker, so this points at WORKER_PUBLIC_URL.
// Next.js itself doesn't need a public URL anymore.
export function buildWorkerWebhookUrl(path: string, query?: Record<string, string>): string {
  const raw = process.env.WORKER_PUBLIC_URL;
  if (!raw) throw new Error("WORKER_PUBLIC_URL must be set (worker's ngrok URL).");
  // Twilio's webhook URLs are https://; the worker's WSS endpoint is computed separately.
  const base = raw
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!query || Object.keys(query).length === 0) return `${base}${normalized}`;
  return `${base}${normalized}?${new URLSearchParams(query).toString()}`;
}
