import type { Speaker, ToolTrace, TurnResult } from "./agent.js";
import type { KinMcpClient } from "./mcpClient.js";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

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

  const family = ctx.family?.[0]?.name ?? "your family";
  const said = { tookMed: "", skippedMed: "", symptom: "", low: false, good: false, slept: 0, reminder: false, relayed: "" };

  if (/chest pain|i fell|had a fall|can'?t breathe|fainted/.test(lower)) {
    emergency = true;
    results.push(await call("log_symptom", { symptom: lower.match(/chest pain|fell|fall|breathe|fainted/)![0], severity: 5, utterance: text }));
  }
  for (const med of ctx.medicationsToday as { name: string; purpose: string }[]) {
    // People say "my BP tablet" or "my sugar tablet" far more often than the drug's name
    const byPurpose =
      (/\b(bp|blood pressure)\b/.test(lower) && /blood pressure/i.test(med.purpose)) ||
      (/\b(sugar|diabetes)\b/.test(lower) && /diabetes/i.test(med.purpose));
    if (!lower.includes(med.name.toLowerCase()) && !byPurpose) continue;
    const skipped = /forgot|missed|didn'?t take|skip/.test(lower);
    results.push(await call("log_medication", { medication: med.name, taken: !skipped, utterance: text }));
    if (skipped) said.skippedMed = med.name;
    else said.tookMed = med.name;
  }
  if (!emergency) {
    const symptom = lower.match(/dizz\w*|light ?headed|headache|knee pain|tired|nause\w*|cough/);
    if (symptom) {
      const severity = /very|really|bad|a lot/.test(lower) ? 3 : 2;
      results.push(await call("log_symptom", { symptom: symptom[0], severity, utterance: text }));
      said.symptom = symptom[0];
    }
  }
  if (/lonely|sad|low|down|upset|miss/.test(lower)) {
    results.push(await call("log_mood", { mood: 2, utterance: text }));
    said.low = true;
  } else if (/good|great|happy|fine|well/.test(lower)) {
    results.push(await call("log_mood", { mood: 4, utterance: text }));
    said.good = true;
  }
  const slept = lower.match(/slept (?:only |about |around )*(\d+(?:\.\d)?|one|two|three|four|five|six|seven|eight|nine)/);
  if (slept) {
    const hours = Number(slept[1]) || WORDS.indexOf(slept[1]) + 1;
    results.push(await call("log_sleep", { hours, utterance: text }));
    said.slept = hours;
  }
  const relay = text.match(/\btell (priya|arjun|my daughter|my son|the family|them|her|him)\b,? (?:that )?(.+)/i);
  if (relay) {
    await call("message_family", { text: relay[2].replace(/[.!]+$/, ""), utterance: text });
    said.relayed = /priya|arjun/i.test(relay[1]) ? cap(relay[1]) : family;
  }
  if (/remind me/.test(lower)) {
    await call("schedule_reminder", { message: text.replace(/.*remind me (to )?/i, "Time to "), inMinutes: 60 });
    said.reminder = true;
  }

  const notified = results.find((r) => r?.familyNotified)?.familyNotified;
  let reply: string;
  if (emergency) {
    await call("notify_family", { level: "urgent", title: `${name} may need help`, message: `${name} said: "${text}"` });
    reply = `${name}, please call emergency services right now. I've told ${family} as well, so help is on the way from both sides.`;
  } else if (notified) {
    reply = `Oh ${name}, I'm sorry you're ${/dizz|light/.test(said.symptom) ? "feeling dizzy again" : "not feeling well"}. It's happened a few times this week, so I've asked ${family} to give you a call. For now, please sit down and have a glass of water.`;
  } else if (said.relayed) {
    reply = `Of course, ${name}. I've passed that on to ${said.relayed}.`;
  } else if (said.symptom) {
    reply = `I'm sorry, ${name}, that doesn't sound pleasant. Take it slowly, and sit down if you need to. I'll keep an eye on it.`;
  } else if (said.skippedMed) {
    reply = `That's alright, ${name}, it happens to all of us. Shall I remind you about your ${said.skippedMed} tomorrow morning?`;
  } else if (said.low) {
    reply = `I'm sorry it feels so quiet today, ${name}. I'm glad you told me. Would you like me to remind ${family} to give you a call this evening?`;
  } else if (said.slept && said.slept < 6) {
    reply = `Only ${said.slept} hours, that's a long night, ${name}. Be gentle with yourself today, and maybe rest after lunch.`;
  } else if (said.reminder) {
    reply = `Of course, ${name}. I'll remind you when it's time.`;
  } else if (said.tookMed) {
    reply = `Well done, ${name}. That's your ${said.tookMed} taken for now.`;
  } else if (said.good || said.slept) {
    reply = `That's lovely to hear, ${name}. I hope the rest of the day is just as good.`;
  } else {
    reply = `I'm here, ${name}. How are you feeling today?`;
  }
  return { reply, tools, familyNotified: notified, careLevel: results.at(-1)?.care?.level ?? ctx.care.level };
}
