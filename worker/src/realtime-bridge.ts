// Bridges a single Twilio Media Streams session with an OpenAI Realtime session.
//
// Protocols verified:
//   - Twilio: https://www.twilio.com/docs/voice/media-streams/websocket-messages
//     μ-law 8kHz base64-encoded 20ms frames. Inbound events: connected|start|media|mark|stop.
//     Outbound events: media|mark|clear.
//   - OpenAI Realtime: g711_ulaw accepted as both input AND output (no transcoding needed).
//     SDK class: openai/beta/realtime/ws OpenAIRealtimeWS.
//
// AI ↔ restaurant only in this round. Tool calls (send_dtmf, trigger_user_handoff),
// payment classifier, and IVR detection arrive in the next phase 4 round.

import type WebSocket from "ws";
import OpenAI from "openai";
// GA Realtime API (not the retired /beta/realtime path).
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import twilioPkg from "twilio";
import { restaurantSystemPrompt } from "./prompts.js";
import type { ReservationContext } from "./prompts.js";
import { writeLog } from "./firestore-logs.js";

const twilioRest = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
  return twilioPkg(sid, token);
};

interface TwilioStartEvent {
  event: "start";
  streamSid: string;
  start: {
    accountSid: string;
    callSid: string;
    streamSid: string;
    tracks: string[];
    customParameters?: Record<string, string>;
    mediaFormat: { encoding: string; sampleRate: number; channels: number };
  };
}
interface TwilioMediaEvent {
  event: "media";
  streamSid: string;
  media: { track: string; chunk: string; timestamp: string; payload: string };
}
interface TwilioMarkEvent {
  event: "mark";
  streamSid: string;
  mark: { name: string };
}
interface TwilioConnectedEvent { event: "connected"; protocol: string; version: string }
interface TwilioStopEvent { event: "stop"; streamSid: string; stop: { callSid: string; accountSid: string } }

type TwilioInboundEvent =
  | TwilioConnectedEvent
  | TwilioStartEvent
  | TwilioMediaEvent
  | (TwilioMarkEvent & { mark: { name: string } })
  | TwilioStopEvent;

export interface BridgeArgs {
  twilioWs: WebSocket;
  openaiApiKey: string;
  realtimeModel: string;
  resolveContext: (customParams: Record<string, string>) => Promise<ReservationContext>;
  log: (event: string, details?: Record<string, unknown>, level?: "info" | "warn" | "error") => void;
}

export async function runBridge(args: BridgeArgs): Promise<void> {
  const { twilioWs, openaiApiKey, realtimeModel, resolveContext, log } = args;

  let streamSid: string | null = null;
  let callSid: string | null = null;
  let internalCallId: string | null = null;
  let internalRequestId: string | null = null;
  let openai: OpenAIRealtimeWS | null = null;
  let openaiReady = false;
  const earlyAudioQueue: string[] = [];
  // Fallback: if the host doesn't speak within this many ms after the stream
  // starts, the AI initiates. Covers silent-host and distracted-pickup cases.
  // Trade-off: an IVR with long hold music could trigger this and the AI would
  // talk over the music. Rare enough that the safety win is worth it.
  const HOST_SILENCE_TIMEOUT_MS = 4000;
  let hostSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  let hostHasSpoken = false;
  // Track whether OpenAI is mid-response. Used to suppress duplicate
  // response.create attempts that cause "active response in progress" errors.
  let responseInFlight = false;

  // Hangup coordination: when the model calls end_call, we don't terminate the
  // Twilio call immediately. We wait for the model's final spoken sentence to
  // (a) finish generating (response.done) and (b) finish playing on the host's
  // line (Twilio echoes back a mark we send AFTER all media frames). That way
  // the host actually hears the goodbye.
  let hangupPending = false;
  let hangupMarkName: string | null = null;

  // Wrap the caller-provided logEverywhere() so every event is mirrored to Firestore with
  // the call/request context. This is how the UI sees live transcripts.
  const logEverywhere = (event: string, details: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") => {
    log(event, details, level);
    void writeLog(event, details, level, { callId: internalCallId, requestId: internalRequestId });
  };

  const closeAll = (reason: string) => {
    logEverywhere("bridge_closing", { reason });
    if (hostSilenceTimer) { clearTimeout(hostSilenceTimer); hostSilenceTimer = null; }
    try { openai?.close({ code: 1000, reason }); } catch {}
    try { twilioWs.close(1000, reason); } catch {}
  };

  twilioWs.on("message", async (raw) => {
    let msg: TwilioInboundEvent;
    try {
      msg = JSON.parse(raw.toString()) as TwilioInboundEvent;
    } catch {
      logEverywhere("twilio_bad_json");
      return;
    }

    if (msg.event === "connected") {
      logEverywhere("twilio_connected", { protocol: msg.protocol, version: msg.version });
      return;
    }

    if (msg.event === "start") {
      streamSid = msg.streamSid;
      callSid = msg.start.callSid;
      internalCallId = msg.start.customParameters?.callId ?? null;
      internalRequestId = msg.start.customParameters?.requestId ?? null;
      logEverywhere("twilio_stream_started", { streamSid, callSid, customParameters: msg.start.customParameters });

      // Arm the silent-host fallback. Cleared when host_speech_started fires.
      hostSilenceTimer = setTimeout(() => {
        if (hostHasSpoken || !openai || !openaiReady || responseInFlight) return;
        logEverywhere("host_silence_timeout_fired");
        openai.send({ type: "response.create" });
      }, HOST_SILENCE_TIMEOUT_MS);

      const context = await resolveContext(msg.start.customParameters ?? {});
      openai = new OpenAIRealtimeWS(
        { model: realtimeModel },
        new OpenAI({ apiKey: openaiApiKey }),
      );

      // Track response lifecycle so we know when it's safe to fire a new one.
      openai.on("response.created", () => { responseInFlight = true; });
      openai.on("response.done", () => { responseInFlight = false; });

      // When the host's utterance is committed (speech_stopped + buffer
      // committed), trigger a response — but only if one isn't already in
      // flight. This replaces create_response: true.
      openai.on("input_audio_buffer.speech_stopped", () => {
        if (responseInFlight) {
          logEverywhere("response_skipped_in_flight");
          return;
        }
        openai!.send({ type: "response.create" });
      });

      openai.on("session.created", () => {
        logEverywhere("openai_session_created");
        // Send session.update AND response.create in one burst so the AI starts
        // generating the greeting immediately instead of waiting another round-
        // trip for session.updated. OpenAI processes client events in order,
        // so the session config is applied before the response runs.
        openai!.send({
          type: "session.update",
          session: {
            type: "realtime",
            model: realtimeModel,
            instructions: restaurantSystemPrompt(context),
            output_modalities: ["audio"],
            // gpt-realtime-2 is a reasoning model and by default "thinks"
            // before speaking — adds ~1-2s of silence before the first audio
            // frame. For a phone reservation we need conversational pace, not
            // deep planning. Minimal effort cuts that overhead dramatically.
            reasoning: { effort: "minimal" },
            tools: [
              {
                type: "function",
                name: "end_call",
                description:
                  "End the phone call. Use ONLY when the reservation is fully confirmed and acknowledged, or when the host has clearly declined and there is nothing more to discuss. Say a brief polite goodbye sentence BEFORE calling this tool — but call it immediately after, do not wait for the host's response.",
                parameters: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    outcome: {
                      type: "string",
                      enum: ["reserved", "declined", "unreachable", "other"],
                    },
                    confirmedTime: {
                      type: "string",
                      description: "If reserved, the final agreed time in HH:mm (24h). Empty otherwise.",
                    },
                    notes: { type: "string" },
                  },
                  required: ["outcome"],
                },
              },
            ],
            audio: {
              input: {
                format: { type: "audio/pcmu" },
                transcription: { model: "whisper-1" },
                turn_detection: {
                  // Semantic VAD with high eagerness caps at 2s, feels snappy.
                  // create_response: false — we manually fire response.create
                  // when (a) host has finished speaking AND (b) no response is
                  // currently in flight. This avoids "active response in
                  // progress" errors when the host barges in or background
                  // noise re-triggers VAD before the AI finishes its turn.
                  type: "semantic_vad",
                  eagerness: "high",
                  interrupt_response: false,
                  create_response: false,
                },
              },
              output: {
                format: { type: "audio/pcmu" },
                // `marin` is one of OpenAI's newer natural voices (recommended along with `cedar`).
                voice: "marin",
              },
            },
          },
        });
        // Stay silent until the host says something. Server VAD will detect
        // their first utterance and (because turn_detection.create_response =
        // true) auto-fire a response. This naturally skips IVR hold music —
        // music doesn't trigger VAD, only speech does. The prompt instructs
        // the model that its FIRST response is always the Turn 1 template
        // regardless of what the host actually said.
      });

      openai.on("session.updated", () => {
        openaiReady = true;
        logEverywhere("openai_session_updated", { queuedFrames: earlyAudioQueue.length });
        // Flush any input audio that piled up while we waited for the session
        // to be configured (input_audio_format must be set before we can append).
        for (const payload of earlyAudioQueue) {
          openai!.send({ type: "input_audio_buffer.append", audio: payload });
        }
        earlyAudioQueue.length = 0;
      });

      // GA Realtime renamed audio events: response.audio.* → response.output_audio.*
      openai.on("response.output_audio.delta", (e) => {
        if (!streamSid) return;
        // OpenAI sends g711_ulaw base64; Twilio expects the same — pass-through.
        twilioWs.send(JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: e.delta },
        }));
      });

      openai.on("response.output_audio_transcript.delta", (e) => {
        logEverywhere("ai_transcript_delta", { text: e.delta });
      });

      openai.on("response.output_audio_transcript.done", (e) => {
        logEverywhere("ai_transcript_done", { text: e.transcript });
      });

      // Tool-call handler. When end_call fires we just FLAG a pending hangup —
      // the actual call termination happens after response.done + mark-echo so
      // the host hears the full goodbye sentence.
      openai.on("response.function_call_arguments.done", (e) => {
        logEverywhere("ai_tool_call", { name: e.name, args: e.arguments });
        if (e.name === "end_call") {
          hangupPending = true;
          logEverywhere("hangup_pending", { args: e.arguments });
        }
      });

      // response.done fires after the model finishes its current turn (audio +
      // tool calls). If a hangup is pending, queue a mark on the outbound
      // audio so we know when the goodbye actually played.
      openai.on("response.done", () => {
        if (hangupPending && streamSid && !hangupMarkName) {
          hangupMarkName = `hangup-${Date.now()}`;
          twilioWs.send(JSON.stringify({
            event: "mark",
            streamSid,
            mark: { name: hangupMarkName },
          }));
          logEverywhere("hangup_mark_sent", { mark: hangupMarkName });
        }
      });

      openai.on("conversation.item.input_audio_transcription.completed", (e) => {
        logEverywhere("host_transcript", { text: e.transcript });
      });

      openai.on("input_audio_buffer.speech_started", () => {
        // With interrupt_response: false, OpenAI does NOT cancel the current
        // assistant response when the host starts speaking. Don't wipe the
        // Twilio outbound buffer — let the AI's sentence finish, then it'll
        // respond to the host's turn naturally on the next response.create.
        hostHasSpoken = true;
        if (hostSilenceTimer) { clearTimeout(hostSilenceTimer); hostSilenceTimer = null; }
        logEverywhere("host_speech_started");
      });

      openai.on("error", (err) => {
        logEverywhere("openai_error", { message: err.message, data: err.error });
      });

      openai.socket.on("close", (code, reason) => {
        logEverywhere("openai_socket_closed", { code, reason: reason.toString() });
      });

      return;
    }

    if (msg.event === "media") {
      const payload = msg.media.payload;
      if (!openai || !openaiReady) {
        earlyAudioQueue.push(payload);
        return;
      }
      openai.send({ type: "input_audio_buffer.append", audio: payload });
      return;
    }

    if (msg.event === "mark") {
      // Twilio echoes back our outbound mark once the audio before it has
      // finished playing on the host's line. If it's our hangup mark, NOW we
      // terminate the Twilio call.
      const name = msg.mark?.name;
      logEverywhere("twilio_mark_received", { name });
      if (hangupPending && name === hangupMarkName) {
        (async () => {
          try {
            if (!callSid) {
              logEverywhere("end_call_missing_call_sid", {}, "warn");
            } else {
              await twilioRest().calls(callSid).update({ status: "completed" });
              logEverywhere("end_call_invoked", { callSid });
            }
          } catch (err) {
            logEverywhere("end_call_failed", { message: String(err) }, "error");
          } finally {
            closeAll("end_call");
          }
        })();
      }
      return;
    }

    if (msg.event === "stop") {
      logEverywhere("twilio_stream_stopped", { callSid });
      closeAll("twilio_stop");
      return;
    }
  });

  twilioWs.on("close", () => {
    logEverywhere("twilio_ws_closed", { callSid });
    closeAll("twilio_ws_close");
  });

  twilioWs.on("error", (err) => {
    logEverywhere("twilio_ws_error", { message: err.message });
    closeAll("twilio_ws_error");
  });
}
