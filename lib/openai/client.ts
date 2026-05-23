// OpenAI SDK singleton.
// docs:
//   https://platform.openai.com/docs/api-reference/responses
//   https://platform.openai.com/docs/api-reference/conversations
//   https://platform.openai.com/docs/guides/conversation-state
// SDK surface verified in node_modules/openai/resources/{responses,conversations}/.

import OpenAI from "openai";

let client: OpenAI | null = null;

export function openai(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY must be set.");
  client = new OpenAI({ apiKey });
  return client;
}

export function model(): string {
  // Design doc §9.2 calls for a low-latency GPT-5-family model.
  // Verify the exact current model ID against https://platform.openai.com/docs/models.
  // Design doc §9.2: low-latency GPT-5-family model ("GPT-5 Instant or equivalent").
  // gpt-5.4-mini is the current low-latency variant (the older "Instant" alias no longer exists).
  return process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
}
