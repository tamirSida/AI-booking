# ai_booking — context snapshot

What this project does, what's built, where things live. Concise reference for getting back up to speed quickly.

## What it is

A personal AI phone agent that places outbound calls in Hebrew on behalf of one user (Tamir). Two flows:

- **Reservation** — fill a form (restaurant phone, name, date, time, party size, reservation name, alt-time window) → AI calls the restaurant → speaks Hebrew → negotiates → hangs up.
- **Ask** — call any number with 1–10 questions → AI introduces itself as the user's agent → captures answer per question → hangs up.

Both flows share the same Twilio + OpenAI Realtime call infrastructure.

## Architecture (split)

```
┌─────────────────────────────────────────────────────────────┐
│ Netlify (Next.js)              VPS (Docker worker)          │
│                                                              │
│ • UI (gated by Firebase Auth)  • Twilio webhooks (signed)   │
│ • /api/* route handlers        • WS /media bridge           │
│   (gated by requireAuth)       • OpenAI Realtime client      │
│ • Creates Twilio calls          • Writes logs to Firestore   │
│ • Reads/writes Firestore                                     │
└─────────────────────────────────────────────────────────────┘
         │                                  │
         ▼                                  ▼
                  Firestore (shared SoR)
                  Twilio (call provider)
                  OpenAI (chat + realtime audio)
```

Worker's public URL: `https://worker.portfolio-plus.com` (Caddy + Let's Encrypt). Netlify URL: whatever Netlify gave the site.

## Key file map

| Path | What it does |
|---|---|
| [app/page.tsx](app/page.tsx) | Home page — Reservation/Ask tabs, history with click-to-monitor + "again" |
| [app/calls/[id]/page.tsx](app/calls/[id]/page.tsx) | Live call monitor — status pills, transcript, recording, hangup |
| [app/contacts/page.tsx](app/contacts/page.tsx) | Contacts CRUD |
| [app/api/*/route.ts](app/api/) | Server-side endpoints (all `requireAuth`-gated) |
| [lib/auth/](lib/auth/) | AuthGate, AuthProvider, requireAuth, authedFetch |
| [lib/firebase/](lib/firebase/) | Admin SDK (server) + Web SDK (client) |
| [lib/calls/start.ts](lib/calls/start.ts) | Create reservation Twilio call |
| [lib/calls/place-ask.ts](lib/calls/place-ask.ts) | Create ask Twilio call |
| [lib/twilio/client.ts](lib/twilio/client.ts) | `buildWorkerWebhookUrl()` — builds URLs that point at the worker |
| [worker/src/index.ts](worker/src/index.ts) | Fastify entry, route registration |
| [worker/src/realtime-bridge.ts](worker/src/realtime-bridge.ts) | Twilio Media Streams ↔ OpenAI Realtime audio bridge |
| [worker/src/prompts.ts](worker/src/prompts.ts) | Hebrew restaurant agent prompt |
| [worker/src/ask-prompts.ts](worker/src/ask-prompts.ts) | Hebrew ask-question agent prompt |
| [worker/src/routes/](worker/src/routes/) | Twilio webhooks (voice, status, recording) |
| [files/ai_restaurant_call_agent_design_doc.md](files/ai_restaurant_call_agent_design_doc.md) | Original 1110-line spec — source of truth for product intent |

## Models

- **Form path**: no LLM (form fields → Firestore → Twilio).
- **Chat intake** (legacy, still wired at `/api/messages`): `OPENAI_MODEL=gpt-5.4-mini`.
- **Realtime voice agent** (the call itself): `OPENAI_REALTIME_MODEL=gpt-realtime-2` with `reasoning: { effort: "minimal" }`, voice `marin` (female), `g711_ulaw` both directions (no transcoding).

## Auth

Firebase email/password. One user (Tamir). User creation is manual via Firebase Console — no signup UI. Every Next.js API route calls `requireAuth(req)` before doing anything. The browser sends `Authorization: Bearer <firebase-id-token>` via `authedFetch()`.

Worker has no Firebase auth — Twilio webhooks are signature-verified instead. Known open vector: `WS /media` doesn't verify Twilio signature on handshake (someone with the URL could burn OpenAI tokens). Acceptable risk for now.

## Deployment

- **Frontend (Netlify)**: auto-deploys from `main` via Netlify GitHub integration. Config: [netlify.toml](netlify.toml).
- **Worker (Hostinger VPS)**: GitHub Actions workflow [.github/workflows/deploy-worker.yml](.github/workflows/deploy-worker.yml) SSHs in and rebuilds the container when worker files change. Triggered on push to `main` with path filter `worker/**` + compose files + the workflow itself.
- **Worker process**: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build worker` at `/home/dev/apps/ai_booking` on the VPS.
- **HTTPS for worker**: Caddy on the VPS auto-fetches Let's Encrypt cert for `worker.portfolio-plus.com` (DNS A record in GoDaddy points there).

## Env vars (shape, not values)

Both Netlify and VPS need most of these — only `WORKER_PUBLIC_URL` and the `NEXT_PUBLIC_*` differ slightly.

```
OPENAI_API_KEY
OPENAI_MODEL=gpt-5.4-mini
OPENAI_REALTIME_MODEL=gpt-realtime-2
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER=+972…
FIREBASE_SERVICE_ACCOUNT_JSON  # single-line admin JSON
USER_PHONE_NUMBER=+972…         # hardcoded handoff target
WORKER_PUBLIC_URL=https://worker.portfolio-plus.com
NEXT_PUBLIC_FIREBASE_API_KEY    # ← public-by-design; Netlify scanner skipped via netlify.toml
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

## Firestore collections

- `users` (unused so far — one user lives in Firebase Auth only)
- `conversations` — LLM-intake conversation IDs (legacy path)
- `reservationRequests` — Reservation flow records; `lastCallId` points at most recent call
- `askRequests` — Ask flow records; `questions[]`, `answers[]`, `lastCallId`
- `contacts` — saved phone book entries
- `calls` — call records (per Twilio outbound), `purpose: reservation|ask`, `twilioCallSid`, `recordingSid`
- `logs` — append-only event log per call; composite index on `(callId asc, createdAt asc)` deployed via `firestore.indexes.json`

## Kill switches

| Want to | Run |
|---|---|
| Stop worker (calls fail) | `ssh dev@69.62.110.81 'cd /home/dev/apps/ai_booking && docker compose stop worker'` |
| Take UI down | Netlify dashboard → Unpublish site |
| Stop ALL Twilio billing | Twilio Console → Account → Suspend |
| Stop OpenAI billing | platform.openai.com → revoke API key |
| Power off VPS | Hostinger dashboard → Stop |

## What's NOT done (deliberately deferred)

- Twilio signature verification on the WS `/media` handshake (known open vector for OpenAI token abuse)
- Telegram channel (was Phase 1 plan; web chat replaced it)
- Per-user data isolation (single-user app)
- Recording auth (currently relies on Twilio SID being unguessable)
- Custom voice / domain swap on Netlify
- Eval suite from Phase 5 of the design doc
