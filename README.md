# ai_booking

AI restaurant-reservation call agent. See [files/ai_restaurant_call_agent_design_doc.md](files/ai_restaurant_call_agent_design_doc.md) for the full spec.

## Phase 1 quickstart

Phase 1 is the Telegram/web-chat MVP: free-form text in → reservation collected → Twilio places a call → Hebrew TwiML reads the request → user can be bridged in via the handoff endpoint. Realtime AI voice arrives in Phase 4.

### 1. Install deps

```bash
npm install
```

### 2. Expose localhost over a tunnel

Twilio webhooks need a public URL. The simplest setup is ngrok:

```bash
brew install ngrok        # or: https://ngrok.com/download
ngrok config add-authtoken <YOUR_TOKEN>
ngrok http 3000
```

Copy the `https://xxxx.ngrok.app` URL from ngrok's terminal output — that's your `PUBLIC_BASE_URL`. It changes every ngrok restart unless you have a paid static domain.

### 3. Configure `.env.local`

```bash
cp .env.local.example .env.local
# fill in the values
```

Required for the Phase 1 smoke test:

- `OPENAI_API_KEY`, `OPENAI_MODEL` (e.g. `gpt-5`)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `FIREBASE_SERVICE_ACCOUNT_JSON` — single-line JSON. Generate via Firebase Console → Project settings → Service accounts → "Generate new private key", then:
  ```bash
  node -e "console.log(JSON.stringify(require('./service-account.json')))"
  ```
- `USER_PHONE_NUMBER` — your own phone, E.164 like `+972501234567`
- `PUBLIC_BASE_URL` — your ngrok HTTPS URL, no trailing slash

### 4. Enable Israel calling in Twilio

Twilio outbound calls to `+972` require geo permissions. Open Twilio Console → Voice → Settings → Geo Permissions and tick **Israel**. Without this, calls to `+972…` fail with error `21215`.

### 5. Start the dev server

```bash
npm run dev
```

### 6. Smoke test

Use your own phone as the "restaurant" first. With ngrok running and `npm run dev` up:

```bash
# Start an intake conversation. Use your own phone as the restaurant for testing.
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "tamir",
    "message": "Book me a table at Test Restaurant Tel Aviv tonight at 21:00 for 4 people under Tamir. Restaurant number: +972501234567."
  }'
```

The response includes `requestId` and `conversationId`. Continue the chat by re-using both:

```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "tamir",
    "requestId": "<from previous response>",
    "conversationId": "<from previous response>",
    "message": "yes confirm"
  }'
```

When the agent calls the `start_restaurant_call` tool, Twilio dials the number. Your phone rings, you hear the Hebrew summary via TwiML `<Say>`, and the call drops into a conference. Trigger handoff with:

```bash
# Replace <callId> with the value from toolsCalled output / Firestore.
curl -X POST http://localhost:3000/api/calls/<callId>/handoff \
  -H "Content-Type: application/json" \
  -d '{"reason": "manual"}'
```

`USER_PHONE_NUMBER` will ring; answering joins the conference. (In Phase 1 you'll be talking to yourself — that's expected.)

### 7. Inspect logs

Every step is written to the `logs` Firestore collection with a `traceId`. Filter by `traceId` to follow one request end-to-end. Stdout also receives the same lines as JSON.

## Project structure

```
app/api/                            Next.js route handlers (webhooks, REST)
lib/firebase/admin.ts               Firestore singleton + collection accessors
lib/reservation/{schema,store}.ts   Reservation object (§6) + Firestore CRUD
lib/state/machine.ts                Explicit FSM (§7.3)
lib/logging/trace.ts                traceId logger + PII scrubbing (§15/§16)
lib/openai/{client,prompts,tools,agent}.ts   Intake agent loop
lib/tools/handlers.ts               Server-side tool implementations
lib/twilio/{client,twiml}.ts        Twilio SDK + TwiML builders
lib/calls/{store,start,handoff}.ts  Twilio call orchestration
files/ai_restaurant_call_agent_design_doc.md   Source-of-truth spec
```

## Next phases

Phase 2 (web UI), Phase 3 (browser voice), Phase 4 (realtime restaurant voice agent), Phase 5 (eval suite). See the design doc §18 and the planning notes in `~/.claude/plans/`.
