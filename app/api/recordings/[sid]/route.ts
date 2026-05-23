import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recordings/[sid]
// Proxies a Twilio recording MP3 through our server with basic auth so the
// browser can play it without leaking Twilio credentials.

export async function GET(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
  const { sid } = await ctx.params;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return new Response("Twilio creds not configured", { status: 500 });
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const upstream = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
    // Pass through range requests so the <audio> element can seek.
    ...(req.headers.get("range") ? { headers: { Authorization: `Basic ${auth}`, Range: req.headers.get("range")! } } : {}),
  });
  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream ${upstream.status}`, { status: upstream.status });
  }
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  const range = upstream.headers.get("content-range");
  if (range) headers.set("Content-Range", range);
  return new Response(upstream.body, { status: upstream.status, headers });
}
