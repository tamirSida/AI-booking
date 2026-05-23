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
import { restaurantSystemPrompt, type ReservationContext } from "./prompts.js";
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

type TwilioInboundEvent = TwilioConnectedEvent | TwilioStartEvent | TwilioMediaEvent | TwilioMarkEvent | TwilioStopEvent;

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

  // Wrap the caller-provided logEverywhere() so every event is mirrored to Firestore with
  // the call/request context. This is how the UI sees live transcripts.
  const logEverywhere = (event: string, details: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") => {
    log(event, details, level);
    void writeLog(event, details, level, { callId: internalCallId, requestId: internalRequestId });
  };

  const closeAll = (reason: string) => {
    logEverywhere("bridge_closing", { reason });
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

      const context = await resolveContext(msg.start.customParameters ?? {});
      openai = new OpenAIRealtimeWS(
        { model: realtimeModel },
        new OpenAI({ apiKey: openaiApiKey }),
      );

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
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 600,
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
        // Greet immediately. OpenAI processes events in order, so this runs
        // after the session.update above is applied. Don't wait for the
        // session.updated ack — that's a wasted round-trip.
        openai!.send({ type: "response.create" });
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

      // Tool-call handler. Currently the only tool is end_call; when invoked,
      // we use the Twilio REST API to terminate the call leg (which also
      // unwinds the Media Stream and OpenAI socket via the stream.stopped event).
      openai.on("response.function_call_arguments.done", async (e) => {
        logEverywhere("ai_tool_call", { name: e.name, args: e.arguments });
        if (e.name === "end_call") {
          try {
            // Give the model's final spoken sentence ~1.5s to finish playing before we hang up.
            await new Promise((r) => setTimeout(r, 1500));
            if (!callSid) {
              logEverywhere("end_call_missing_call_sid", {}, "warn");
            } else {
              await twilioRest().calls(callSid).update({ status: "completed" });
              logEverywhere("end_call_invoked", { callSid, args: e.arguments });
            }
          } catch (err) {
            logEverywhere("end_call_failed", { message: String(err) }, "error");
          } finally {
            closeAll("end_call");
          }
        }
      });

      openai.on("conversation.item.input_audio_transcription.completed", (e) => {
        logEverywhere("host_transcript", { text: e.transcript });
      });

      openai.on("input_audio_buffer.speech_started", () => {
        // Host started talking — interrupt any AI playback.
        if (streamSid) twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
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
