// Intake agent loop.
//
// Flow per OpenAI Responses + Conversations APIs:
//   1. Create a conversation once per reservation request; store its ID.
//   2. On each user message, call responses.create with:
//      - input: [{ role: 'user', content: <text> }]
//      - conversation: { id: convId }   ← state auto-tracked across turns
//      - tools: INTAKE_TOOLS
//      - instructions: system + developer + channel prompts joined
//   3. Iterate the output array. For each function_call item, dispatch to the
//      handler, then call responses.create again with input containing the
//      matching function_call_output items. Repeat until the model emits text
//      with no further tool calls (or we hit MAX_TURNS).
//
// docs: https://platform.openai.com/docs/api-reference/responses
//       https://platform.openai.com/docs/guides/conversation-state

import type { Response, ResponseInputItem, FunctionTool } from "openai/resources/responses/responses";
import { openai, model } from "@/lib/openai/client";
import { INTAKE_TOOLS } from "@/lib/openai/tools";
import {
  GLOBAL_SYSTEM_PROMPT,
  INTAKE_DEVELOPER_PROMPT,
  TELEGRAM_CHANNEL_PROMPT,
  WEB_CHAT_CHANNEL_PROMPT,
  reservationContextMessage,
} from "@/lib/openai/prompts";
import { handlers, type ToolContext } from "@/lib/tools/handlers";
import { getReservation } from "@/lib/reservation/store";
import type { Source } from "@/lib/reservation/schema";

const MAX_TURNS = 6;

export interface RunAgentArgs {
  ctx: ToolContext;
  openAiConversationId: string;
  source: Source;
  userMessage: string;
}

export interface RunAgentResult {
  // Final assistant text shown to the user. May be empty if the model only
  // emitted tool calls (e.g. start_restaurant_call) on the last turn.
  assistantText: string;
  // Names of tools the model invoked during this turn (for status updates).
  toolsCalled: string[];
}

export async function runIntakeAgent(args: RunAgentArgs): Promise<RunAgentResult> {
  const channelPrompt = args.source === "telegram" ? TELEGRAM_CHANNEL_PROMPT : WEB_CHAT_CHANNEL_PROMPT;
  const reservation = await getReservation(args.ctx.requestId);
  const instructions = [
    GLOBAL_SYSTEM_PROMPT,
    INTAKE_DEVELOPER_PROMPT,
    channelPrompt,
    reservation ? reservationContextMessage(reservation) : "(no reservation request created yet)",
  ].join("\n\n---\n\n");

  let input: ResponseInputItem[] = [{ role: "user", content: args.userMessage }];
  const toolsCalled: string[] = [];
  let assistantText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response: Response = await openai().responses.create({
      model: model(),
      conversation: { id: args.openAiConversationId },
      tools: INTAKE_TOOLS as FunctionTool[],
      instructions,
      input,
    });

    await args.ctx.trace.log("model_response", {
      turn,
      responseId: response.id,
      outputItemCount: response.output.length,
    });

    // Collect text and tool calls from this turn.
    const toolCallOutputs: ResponseInputItem[] = [];
    let madeToolCall = false;

    for (const item of response.output) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") assistantText += part.text;
        }
      } else if (item.type === "function_call") {
        madeToolCall = true;
        toolsCalled.push(item.name);
        const handler = handlers[item.name];
        const result = handler
          ? await handler(args.ctx, item.arguments)
          : { status: "error" as const, message: `Unknown tool: ${item.name}` };
        await args.ctx.trace.log("tool_call", {
          name: item.name,
          callId: item.call_id,
          status: result.status,
        });
        toolCallOutputs.push({
          type: "function_call_output",
          call_id: item.call_id,
          output: JSON.stringify(result),
        });
      }
      // Reasoning items are produced by gpt-5-family but carry no user-facing
      // content; we don't forward them anywhere.
    }

    if (!madeToolCall) break;
    // Feed tool outputs back into the next turn.
    input = toolCallOutputs;
  }

  return { assistantText: assistantText.trim(), toolsCalled };
}
