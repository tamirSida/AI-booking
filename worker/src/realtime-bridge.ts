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
import { askSystemPrompt } from "./ask-prompts.js";
import type { AskContext } from "./ask-prompts.js";
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

export type ResolvedContext =
  | { type: "reservation"; ctx: ReservationContext }
  | { type: "ask"; ctx: AskContext; askRequestId: string };

export interface BridgeArgs {
  twilioWs: WebSocket;
  openaiApiKey: string;
  realtimeModel: string;
  resolveContext: (customParams: Record<string, string>) => Promise<ResolvedContext>;
  // Called when the model uses the record_answer tool (ask flow).
  onAnswer?: (args: { askRequestId: string; index: number; answer: string; confidence?: number }) => Promise<void>;
  log: (event: string, details?: Record<string, unknown>, level?: "info" | "warn" | "error") => void;
}

export async function runBridge(args: BridgeArgs): Promise<void> {
  const { twilioWs, openaiApiKey, realtimeModel, resolveContext, onAnswer, log } = args;

  let streamSid: string | null = null;
  let callSid: string | null = null;
  let internalCallId: string | null = null;
  let internalRequestId: string | null = null;
  let resolved: ResolvedContext | null = null;
  let askRequestId: string | null = null;
  let sessionCreatedSeen = false;
  let openaiReady = false;
  const earlyAudioQueue: string[] = [];

  // PRE-WARM: open the OpenAI WS immediately on bridge entry instead of
  // waiting for Twilio's "start" event. The handshake + session.created
  // round-trip (usually 500-1500ms) happens IN PARALLEL with Twilio's start
  // event arriving. session.update is sent once both context is resolved AND
  // session.created has fired (whichever happens last).
  const openai = new OpenAIRealtimeWS(
    { model: realtimeModel },
    new OpenAI({ apiKey: openaiApiKey }),
  );
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
    try { openai.close({ code: 1000, reason }); } catch {}
    try { twilioWs.close(1000, reason); } catch {}
  };

  const trySendSessionUpdate = () => {
    if (!sessionCreatedSeen || !resolved) return;
    openai.send({
      type: "session.update",
      session: {
        type: "realtime",
        model: realtimeModel,
        instructions:
          resolved.type === "reservation"
            ? restaurantSystemPrompt(resolved.ctx)
            : askSystemPrompt(resolved.ctx),
        output_modalities: ["audio"],
        reasoning: { effort: "minimal" },
        tools:
          resolved.type === "reservation"
            ? [
                {
                  type: "function",
                  name: "end_call",
                  description:
                    "End the phone call. Use ONLY when the reservation is fully confirmed and acknowledged, or when the host has clearly declined. Say a brief polite goodbye BEFORE calling this tool.",
                  parameters: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      outcome: { type: "string", enum: ["reserved", "declined", "unreachable", "other"] },
                      confirmedTime: { type: "string" },
                      notes: { type: "string" },
                    },
                    required: ["outcome"],
                  },
                },
              ]
            : [
                {
                  type: "function",
                  name: "record_answer",
                  description:
                    "Capture the recipient's answer to a specific question (by index). Call this each time you finish a question, before moving to the next.",
                  parameters: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      index: { type: "integer", description: "0-based index in the questions list." },
                      answer: { type: "string" },
                      confidence: { type: "number" },
                    },
                    required: ["index", "answer"],
                  },
                },
                {
                  type: "function",
                  name: "end_call",
                  description:
                    "End the phone call after all answers are recorded or the recipient declines.",
                  parameters: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      outcome: { type: "string", enum: ["answered", "declined", "unreachable", "other"] },
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
              type: "semantic_vad",
              eagerness: "high",
              interrupt_response: false,
              create_response: true,
            },
          },
          output: {
            format: { type: "audio/pcmu" },
            voice: "marin",
          },
        },
      },
    });
    logEverywhere("openai_session_update_sent", { type: resolved.type });
  };

  // Wire OpenAI handlers up front (they fire as soon as the WS is connected).
  openai.on("response.created", () => { responseInFlight = true; });
  openai.on("response.done", () => { responseInFlight = false; });

  openai.on("session.created", () => {
    logEverywhere("openai_session_created");
    sessionCreatedSeen = true;
    trySendSessionUpdate();
  });

  openai.on("session.updated", () => {
    openaiReady = true;
    logEverywhere("openai_session_updated", { queuedFrames: earlyAudioQueue.length });
    for (const payload of earlyAudioQueue) {
      openai.send({ type: "input_audio_buffer.append", audio: payload });
    }
    earlyAudioQueue.length = 0;
  });

  openai.on("response.output_audio.delta", (e) => {
    if (!streamSid) return;
    twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload: e.delta } }));
  });

  openai.on("response.output_audio_transcript.delta", (e) => {
    logEverywhere("ai_transcript_delta", { text: e.delta });
  });

  openai.on("response.output_audio_transcript.done", (e) => {
    logEverywhere("ai_transcript_done", { text: e.transcript });
  });

  openai.on("response.function_call_arguments.done", async (e) => {
    logEverywhere("ai_tool_call", { name: e.name, args: e.arguments });
    if (e.name === "end_call") {
      hangupPending = true;
      logEverywhere("hangup_pending", { args: e.arguments });
    } else if (e.name === "record_answer") {
      if (!askRequestId || !onAnswer) {
        logEverywhere("record_answer_no_handler", {}, "warn");
        return;
      }
      try {
        const parsed = JSON.parse(e.arguments || "{}") as { index?: number; answer?: string; confidence?: number };
        if (typeof parsed.answer === "string" && typeof parsed.index === "number") {
          await onAnswer({ askRequestId, index: parsed.index, answer: parsed.answer, confidence: parsed.confidence });
          logEverywhere("ask_answer_recorded", { index: parsed.index, answer: parsed.answer });
        }
      } catch (err) {
        logEverywhere("record_answer_parse_failed", { message: String(err) }, "error");
      }
    }
  });

  openai.on("response.done", () => {
    if (hangupPending && streamSid && !hangupMarkName) {
      hangupMarkName = `hangup-${Date.now()}`;
      twilioWs.send(JSON.stringify({ event: "mark", streamSid, mark: { name: hangupMarkName } }));
      logEverywhere("hangup_mark_sent", { mark: hangupMarkName });
    }
  });

  openai.on("conversation.item.input_audio_transcription.completed", (e) => {
    logEverywhere("host_transcript", { text: e.transcript });
  });

  openai.on("input_audio_buffer.speech_started", () => {
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
        if (hostHasSpoken || !openaiReady || responseInFlight) return;
        logEverywhere("host_silence_timeout_fired");
        openai.send({ type: "response.create" });
      }, HOST_SILENCE_TIMEOUT_MS);

      // Resolve context and (if session.created already fired) send session.update.
      resolved = await resolveContext(msg.start.customParameters ?? {});
      askRequestId = resolved.type === "ask" ? resolved.askRequestId : null;
      trySendSessionUpdate();
      return;
    }

    if (msg.event === "media") {
      const payload = msg.media.payload;
      if (!openaiReady) {
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
