import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { McpTool } from "./mcpClient.js";

export interface ClaudeToolTrace {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
}

const MAX_TOOL_ROUNDS = 6;
const client = new Anthropic();

export interface ClaudeTurnInput {
  system: string;
  history: Anthropic.MessageParam[];
  text: string;
  tools: McpTool[];
  callTool: (name: string, input: Record<string, unknown>) => Promise<any>;
}

export interface ClaudeTurnOutput {
  reply: string;
  traces: ClaudeToolTrace[];
  results: { name: string; input: Record<string, unknown>; output: any }[];
}

/** One conversational turn on the Claude API, calling Kin's MCP tools until it has an answer. */
export async function claudeTurn(input: ClaudeTurnInput): Promise<ClaudeTurnOutput> {
  const tools: Anthropic.Tool[] = input.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
  const messages: Anthropic.MessageParam[] = [...input.history, { role: "user", content: input.text }];
  const traces: ClaudeToolTrace[] = [];
  const results: ClaudeTurnOutput["results"] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 400,
      system: input.system,
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length || round === MAX_TOOL_ROUNDS) {
      const reply = res.content
        .filter((c): c is Anthropic.TextBlock => c.type === "text")
        .map((c) => c.text)
        .join(" ");
      return { reply, traces, results };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const args = (use.input ?? {}) as Record<string, unknown>;
      let output: any;
      try {
        output = await input.callTool(use.name, args);
      } catch (err) {
        output = { error: (err as Error).message };
      }
      traces.push({ name: use.name, input: args, output });
      results.push({ name: use.name, input: args, output });
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: typeof output === "string" ? output : JSON.stringify(output),
        is_error: Boolean(output?.error),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }
  throw new Error("unreachable");
}

export async function claudeComplete(system: string, user: string): Promise<string> {
  const res = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 300,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join(" ");
}
