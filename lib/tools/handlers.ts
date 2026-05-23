// Server-side implementations of the tools defined in lib/openai/tools.ts.
// Each handler returns a JSON-serializable result that gets sent back to the
// model as a function_call_output item (see lib/openai/agent.ts).

import { z } from "zod";
import type { TraceCtx } from "@/lib/logging/trace";
import { ReservationRequestPatch } from "@/lib/reservation/schema";
import { applyPatch, getReservation, saveReservation } from "@/lib/reservation/store";
import { transition } from "@/lib/state/machine";
import { placeCall } from "@/lib/calls/place";

export interface ToolContext {
  trace: TraceCtx;
  requestId: string;
  userId: string;
}

export type ToolResult =
  | { status: "ok"; result?: unknown }
  | { status: "error"; message: string };

export type ToolHandler = (ctx: ToolContext, rawArgs: string) => Promise<ToolResult>;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const updateArgs = ReservationRequestPatch;

const startCallArgs = z.object({
  restaurantPhoneNumber: z.string().regex(/^\+\d{7,15}$/, "expected E.164"),
  reservationSummary: z.string().min(1),
});

const askClarificationArgs = z.object({
  question: z.string().min(1),
  missingFields: z.array(z.string()),
});

const logEventArgs = z.object({
  eventType: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const handlers: Record<string, ToolHandler> = {
  async update_reservation_request(ctx, rawArgs) {
    const parsed = updateArgs.safeParse(parseJson(rawArgs));
    if (!parsed.success) return { status: "error", message: parsed.error.message };
    const current = await getReservation(ctx.requestId);
    if (!current) return { status: "error", message: `reservation ${ctx.requestId} not found` };
    const next = applyPatch(current, parsed.data);
    await saveReservation(next);
    await ctx.trace.log("reservation_updated", { patch: parsed.data, requestId: ctx.requestId });
    return { status: "ok", result: { updatedFields: Object.keys(parsed.data) } };
  },

  async ask_user_clarification(ctx, rawArgs) {
    const parsed = askClarificationArgs.safeParse(parseJson(rawArgs));
    if (!parsed.success) return { status: "error", message: parsed.error.message };
    // The model's assistant text already conveys the question to the user.
    // We log the structured form so the UI can highlight missing fields.
    await ctx.trace.log("clarification_asked", {
      question: parsed.data.question,
      missingFields: parsed.data.missingFields,
    });
    // Transition to CLARIFYING_DETAILS so the UI reflects what's happening.
    const current = await getReservation(ctx.requestId);
    if (current) {
      try {
        const nextStatus = transition(current.status, "fields_missing");
        await saveReservation({ ...current, status: nextStatus });
      } catch {
        // Illegal transition is fine here — just stay in current state.
      }
    }
    return { status: "ok" };
  },

  async start_restaurant_call(ctx, rawArgs) {
    const parsed = startCallArgs.safeParse(parseJson(rawArgs));
    if (!parsed.success) return { status: "error", message: parsed.error.message };
    try {
      const callId = await placeCall({
        trace: ctx.trace,
        requestId: ctx.requestId,
        restaurantPhoneNumber: parsed.data.restaurantPhoneNumber,
        reservationSummary: parsed.data.reservationSummary,
      });
      await ctx.trace.log("restaurant_call_started", { callId, requestId: ctx.requestId });
      return { status: "ok", result: { callId } };
    } catch (err) {
      return { status: "error", message: String(err) };
    }
  },

  async log_event(ctx, rawArgs) {
    const parsed = logEventArgs.safeParse(parseJson(rawArgs));
    if (!parsed.success) return { status: "error", message: parsed.error.message };
    await ctx.trace.log(parsed.data.eventType, parsed.data.details ?? {});
    return { status: "ok" };
  },
};
