import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import { config } from "../config.js";
import type { KinMcpClient } from "./mcpClient.js";
import { mockTurn } from "./mockAgent.js";

export type Speaker = "parent" | "family";

export interface ToolTrace {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
}

export interface TurnResult {
  reply: string;
  tools: ToolTrace[];
  familyNotified?: { title: string; level: string; reasons?: string[] };
  careLevel?: string;
}

const MAX_TOOL_ROUNDS = 6;
const HISTORY_TURNS = 8;

const bedrock = new BedrockRuntimeClient({ region: config.region });
/** Plain conversation history per session; tool exchanges are not kept, the store is the memory. */
const sessions = new Map<string, Message[]>();

function systemPrompt(speaker: Speaker, context: any): string {
  if (speaker === "family") {
    return `You are Kin, a care companion. You are talking with a family member of ${context.person}, who you check in on every day.
Answer their questions about how ${context.person} is doing using the briefing below and your tools (get_trends for detail).
Be specific and honest: say what was reported, what pattern you see, and what you'd suggest (call them, check with the doctor). Never diagnose.
Your reply is spoken aloud: 2 to 4 short sentences, no lists, no markdown.

Briefing:
${JSON.stringify(context, null, 2)}`;
  }
  const first = context.family?.[0]?.name ?? "the family";
  return `You are Kin, a warm voice companion on Alexa for ${context.person.name}. Call them "${context.person.callThem}".
You check in every day like a caring friend who remembers everything. Your replies are spoken aloud: 1 to 3 short sentences, simple words, no lists, no markdown, no emoji.

Rules:
- Whenever they mention taking or skipping a medicine, a symptom, their mood, or their sleep, call the matching log_* tool right away (several if needed), passing their exact words as "utterance". Don't ask permission to log.
- If a tool result shows "familyNotified", gently tell them you've let ${first} know so they can call. Be calm, never alarming.
- If it sounds like an emergency (chest pain, a fall, trouble breathing, fainting), tell them to call emergency services right now, and call notify_family with level "urgent".
- Never diagnose and never tell them to change their medication. Suggest mentioning it to their doctor.
- Ask at most one gentle follow-up, for example about a medicine due today that hasn't been taken yet.
- If they ask you to remind them of something, use schedule_reminder.

Current care context (from Kin's memory):
${JSON.stringify(context, null, 2)}`;
}

export class KinAgent {
  constructor(private mcp: KinMcpClient) {}

  async turn(sessionId: string, speaker: Speaker, text: string): Promise<TurnResult> {
    if (config.llm === "mock") return mockTurn(this.mcp, speaker, text);

    const traces: ToolTrace[] = [];
    const contextTool = speaker === "family" ? "get_family_briefing" : "get_care_context";
    const context = await this.mcp.call(contextTool);
    traces.push({ name: contextTool, input: {}, output: "(care context loaded)" });

    const allowed =
      speaker === "family"
        ? new Set(["get_trends", "get_family_briefing", "schedule_reminder"])
        : new Set(["get_trends", "log_medication", "log_symptom", "log_mood", "log_sleep", "log_note", "notify_family", "schedule_reminder"]);
    const tools: Tool[] = (await this.mcp.listTools())
      .filter((t) => allowed.has(t.name))
      .map((t) => {
        const { $schema, ...schema } = t.inputSchema;
        return { toolSpec: { name: t.name, description: t.description, inputSchema: { json: schema as any } } };
      });

    const key = `${speaker}:${sessionId}`;
    const history = sessions.get(key) ?? [];
    const messages: Message[] = [...history, { role: "user", content: [{ text }] }];
    let familyNotified: TurnResult["familyNotified"];
    let careLevel: string | undefined = (context as any)?.care?.level ?? (context as any)?.level;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await bedrock.send(
        new ConverseCommand({
          modelId: config.modelId,
          system: [{ text: systemPrompt(speaker, context) }],
          messages,
          toolConfig: { tools },
          inferenceConfig: { maxTokens: 400, temperature: 0.4 },
        }),
      );
      const out = res.output?.message;
      if (!out) throw new Error("Empty response from Bedrock");
      messages.push(out);

      const uses = (out.content ?? []).filter((c) => c.toolUse).map((c) => c.toolUse!);
      if (res.stopReason !== "tool_use" || !uses.length || round === MAX_TOOL_ROUNDS) {
        const reply = cleanForSpeech((out.content ?? []).map((c) => c.text ?? "").join(" "));
        const turn: Message[] = [
          { role: "user", content: [{ text }] },
          { role: "assistant", content: [{ text: reply || "..." }] },
        ];
        sessions.set(key, [...history, ...turn].slice(-HISTORY_TURNS * 2));
        return { reply, tools: traces, familyNotified, careLevel };
      }

      const results: ContentBlock[] = [];
      for (const use of uses) {
        const input = (use.input ?? {}) as Record<string, unknown>;
        let output: any;
        try {
          output = await this.mcp.call(use.name!, input);
        } catch (err) {
          output = { error: (err as Error).message };
        }
        traces.push({ name: use.name!, input, output });
        if (output?.familyNotified) familyNotified = output.familyNotified;
        if (output?.care?.level) careLevel = output.care.level;
        if (use.name === "notify_family" && output?.sent) {
          familyNotified = { title: String(input.title), level: String(input.level) };
        }
        results.push({
          toolResult: {
            toolUseId: use.toolUseId,
            content: [{ text: typeof output === "string" ? output : JSON.stringify(output) }],
            status: output?.error ? "error" : "success",
          },
        });
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error("unreachable");
  }

  /** A short written digest for the family dashboard. */
  async familyDigest(): Promise<string> {
    const briefing = await this.mcp.call("get_family_briefing");
    if (config.llm === "mock") {
      return briefing.findings.length
        ? `${briefing.headline}. ${briefing.findings.map((f: any) => f.detail).join(" ")}`
        : briefing.headline;
    }
    const res = await bedrock.send(
      new ConverseCommand({
        modelId: config.modelId,
        system: [
          {
            text: "You write a short daily care digest for an adult child about their parent. 3 to 5 sentences, warm and specific, plain text. Lead with how they are, then any pattern worth acting on, then one concrete suggestion. Never diagnose.",
          },
        ],
        messages: [{ role: "user", content: [{ text: JSON.stringify(briefing) }] }],
        inferenceConfig: { maxTokens: 300, temperature: 0.4 },
      }),
    );
    return cleanForSpeech((res.output?.message?.content ?? []).map((c) => c.text ?? "").join(" "));
  }
}

function cleanForSpeech(text: string) {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
