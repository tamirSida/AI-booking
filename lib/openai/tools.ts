// Tool schemas exposed to the model. Names and shapes match design doc §11.
// FunctionTool shape verified in node_modules/openai/resources/responses/responses.d.ts:583.
//
// The intake model (Telegram/web chat) only needs the workflow tools below.
// The realtime call model (Phase 4) will use send_dtmf and trigger_user_handoff in addition.

import type { FunctionTool } from "openai/resources/responses/responses";

export const updateReservationRequestTool: FunctionTool = {
  type: "function",
  name: "update_reservation_request",
  description:
    "Update the structured reservation request with any new or corrected fields extracted from the user. Always call this before asking clarification or starting a call.",
  strict: false,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      restaurantName: { type: ["string", "null"] },
      city: { type: ["string", "null"] },
      date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      time: { type: ["string", "null"], description: "HH:mm (24h)" },
      partySize: { type: ["integer", "null"] },
      reservationName: { type: ["string", "null"] },
      preferences: { type: "array", items: { type: "string" } },
    },
  },
};

export const askUserClarificationTool: FunctionTool = {
  type: "function",
  name: "ask_user_clarification",
  description:
    "Ask the user a single clarifying question for missing or ambiguous fields. The text of your assistant message will be shown to the user; this tool records which fields are still missing.",
  strict: false,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      question: { type: "string" },
      missingFields: { type: "array", items: { type: "string" } },
    },
    required: ["question", "missingFields"],
  },
};

export const startRestaurantCallTool: FunctionTool = {
  type: "function",
  name: "start_restaurant_call",
  description:
    "Initiate the outbound phone call to the restaurant. Only call this AFTER the user has confirmed the final reservation summary and all required fields are present.",
  strict: false,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      restaurantPhoneNumber: { type: "string", description: "E.164 format, e.g. +9725xxxxxxx" },
      reservationSummary: {
        type: "string",
        description: "A short natural-language Hebrew summary the agent will speak to the host.",
      },
    },
    required: ["restaurantPhoneNumber", "reservationSummary"],
  },
};

export const sendDtmfTool: FunctionTool = {
  type: "function",
  name: "send_dtmf",
  description: "Press keypad digits during an active call to navigate an IVR menu. Phase 4 only.",
  strict: false,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      callId: { type: "string" },
      digits: { type: "string", description: "Digits to send, e.g. '1' or '12'." },
      reason: { type: "string" },
    },
    required: ["callId", "digits", "reason"],
  },
};

export const triggerUserHandoffTool: FunctionTool = {
  type: "function",
  name: "trigger_user_handoff",
  description:
    "Bridge the user phone number into the active conference. Call this immediately when the host asks for credit card, deposit, CVV, expiration, payment, or any other sensitive info.",
  strict: false,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      callId: { type: "string" },
      reason: {
        type: "string",
        enum: ["payment_required", "host_requested_user", "manual", "uncertainty", "other"],
      },
      messageToHost: {
        type: "string",
        description: "Hebrew sentence to say to the host while the user is being joined.",
      },
    },
    required: ["callId", "reason", "messageToHost"],
  },
};

export const logEventTool: FunctionTool = {
  type: "function",
  name: "log_event",
  description: "Emit a structured observability event tied to the current traceId.",
  strict: false,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      eventType: { type: "string" },
      details: { type: "object", additionalProperties: true },
    },
    required: ["eventType"],
  },
};

// Tool set for the text-intake agent (Telegram / web chat).
export const INTAKE_TOOLS: FunctionTool[] = [
  updateReservationRequestTool,
  askUserClarificationTool,
  startRestaurantCallTool,
  logEventTool,
];

// Tool set for the realtime call agent (Phase 4).
export const CALL_TOOLS: FunctionTool[] = [
  sendDtmfTool,
  triggerUserHandoffTool,
  logEventTool,
];
