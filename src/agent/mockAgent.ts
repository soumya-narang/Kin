import type { Speaker, ToolTrace, TurnResult } from "./agent.js";
import type { KinMcpClient } from "./mcpClient.js";

/**
 * Rule-based stand-in for the Bedrock agent (KIN_LLM=mock), so the UI and the
 * MCP server can be developed without AWS credentials. It calls the same tools.
 */
export async function mockTurn(mcp: KinMcpClient, speaker: Speaker, text: string): Promise<TurnResult> {
  const tools: ToolTrace[] = [];
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const output = await mcp.call(name, input);
    tools.push({ name, input, output });
    return output;
  };

  if (speaker === "family") {
    const b = await call("get_family_briefing");
    const reply = b.findings.length
      ? `${b.headline}. ${b.findings[0].detail}`
      : `${b.person} is doing well. Nothing unusual this week.`;
    return { reply, tools, careLevel: b.level };
  }

  const ctx = await call("get_care_context");
  const name = ctx.person.callThem;
  const lower = text.toLowerCase();
  const results: any[] = [];
  let emergency = false;

  if (/chest pain|i fell|had a fall|can'?t breathe|fainted/.test(lower)) {
    emergency = true;
    results.push(await call("log_symptom", { symptom: lower.match(/chest pain|fell|fall|breathe|fainted/)![0], severity: 5, utterance: text }));
  }
  for (const med of ctx.medicationsToday as { name: string }[]) {
    if (!lower.includes(med.name.toLowerCase())) continue;
    const skipped = /forgot|missed|didn'?t take|skip/.test(lower);
    results.push(await call("log_medication", { medication: med.name, taken: !skipped, utterance: text }));
  }
  if (!emergency) {
    const symptom = lower.match(/dizz\w*|light ?headed|headache|knee pain|tired|nause\w*|cough/);
    if (symptom) {
      const severity = /very|really|bad|a lot/.test(lower) ? 3 : 2;
      results.push(await call("log_symptom", { symptom: symptom[0], severity, utterance: text }));
    }
  }
  if (/lonely|sad|low|down|upset|miss/.test(lower)) results.push(await call("log_mood", { mood: 2, utterance: text }));
  else if (/good|great|happy|fine|well/.test(lower)) results.push(await call("log_mood", { mood: 4, utterance: text }));
  const slept = lower.match(/slept (?:only |about |around )?(\d+(?:\.\d)?)/);
  if (slept) results.push(await call("log_sleep", { hours: Number(slept[1]), utterance: text }));
  if (/remind me/.test(lower)) await call("schedule_reminder", { message: text.replace(/.*remind me (to )?/i, "Time to "), inMinutes: 60 });

  const notified = results.find((r) => r?.familyNotified)?.familyNotified;
  const family = ctx.family?.[0]?.name ?? "your family";
  let reply: string;
  if (emergency) {
    await call("notify_family", { level: "urgent", title: `${name} may need help`, message: `${name} said: "${text}"` });
    reply = `${name}, please call emergency services right now. I've told ${family} too.`;
  } else if (notified) {
    reply = `Thank you for telling me, ${name}. I've noticed this a few times this week, so I've let ${family} know. They'll give you a call. Please sit down and have some water.`;
  } else if (results.length) {
    reply = `Got it, ${name}. I've noted that down.`;
  } else {
    reply = `I'm here, ${name}. How are you feeling today?`;
  }
  return { reply, tools, familyNotified: notified, careLevel: results.at(-1)?.care?.level ?? ctx.care.level };
}
