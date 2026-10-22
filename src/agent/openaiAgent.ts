import { config } from "../config.js";
import type { McpTool } from "./mcpClient.js";

/**
 * Chat-completions client for any OpenAI-compatible endpoint (Groq, Gemini,
 * OpenRouter, Ollama...). Used for free-tier hosting of the voice agent.
 */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const MAX_TOOL_ROUNDS = 6;

async function chat(body: Record<string, unknown>) {
  const res = await fetch(`${config.openaiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.openaiApiKey}` },
    body: JSON.stringify({ model: config.openaiModel, ...body }),
  });
  if (!res.ok) throw new Error(`LLM request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[] };
}

export interface OpenAiTurnInput {
  system: string;
  history: ChatMessage[];
  text: string;
  tools: McpTool[];
  callTool: (name: string, input: Record<string, unknown>) => Promise<any>;
}

export async function openaiTurn(input: OpenAiTurnInput) {
  const tools = input.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  const messages: ChatMessage[] = [
    { role: "system", content: input.system },
    ...input.history,
    { role: "user", content: input.text },
  ];
  const results: { name: string; input: Record<string, unknown>; output: any }[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await chat({ messages, tools, temperature: 0.4, max_tokens: 400 });
    const msg = res.choices[0]?.message;
    if (!msg) throw new Error("Empty response from the language model");
    const calls = msg.tool_calls ?? [];
    messages.push({ role: "assistant", content: msg.content, tool_calls: calls.length ? calls : undefined });
    if (!calls.length || round === MAX_TOOL_ROUNDS) return { reply: msg.content ?? "", results };

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* model sent malformed arguments; the tool will report what is missing */
      }
      let output: any;
      try {
        output = await input.callTool(call.function.name, args);
      } catch (err) {
        output = { error: (err as Error).message };
      }
      results.push({ name: call.function.name, input: args, output });
      messages.push({ role: "tool", tool_call_id: call.id, content: typeof output === "string" ? output : JSON.stringify(output) });
    }
  }
  throw new Error("unreachable");
}

export async function openaiComplete(system: string, user: string): Promise<string> {
  const res = await chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
    max_tokens: 300,
  });
  return res.choices[0]?.message.content ?? "";
}
