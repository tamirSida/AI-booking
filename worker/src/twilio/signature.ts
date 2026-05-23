// `twilio` is CJS; ESM named imports don't work. Use the default and pull off.
import twilioPkg from "twilio";
const { validateRequest } = twilioPkg;

// docs: https://www.twilio.com/docs/usage/webhooks/webhooks-security

export function verifyTwilioSignature(opts: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !opts.signature) return false;
  return validateRequest(token, opts.signature, opts.url, opts.params);
}

export function buildWorkerUrl(path: string, query?: Record<string, string>): string {
  const base = (process.env.WORKER_PUBLIC_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("WORKER_PUBLIC_URL must be set");
  // The path we expose to Twilio uses https://. The Media Stream URL is a
  // separate variant that swaps to wss:// — handled by the voice route.
  const httpBase = base.startsWith("wss://") ? base.replace(/^wss:\/\//, "https://") : base.startsWith("ws://") ? base.replace(/^ws:\/\//, "http://") : base;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!query || Object.keys(query).length === 0) return `${httpBase}${normalized}`;
  return `${httpBase}${normalized}?${new URLSearchParams(query).toString()}`;
}

export function workerWssUrl(path: string): string {
  const base = (process.env.WORKER_PUBLIC_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("WORKER_PUBLIC_URL must be set");
  const wss = base.startsWith("https://")
    ? base.replace(/^https:\/\//, "wss://")
    : base.startsWith("http://")
      ? base.replace(/^http:\/\//, "ws://")
      : base;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${wss}${normalized}`;
}
