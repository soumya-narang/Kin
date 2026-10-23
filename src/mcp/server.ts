import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { currentInsights, evaluateAndEscalate, raiseAgentAlert, requireProfile } from "../care/engine.js";
import { messageFamily, messageParent, recentlySaidByKin } from "../care/conversation.js";
import { dayKey, normalizeSymptom, type Insights } from "../care/insights.js";
import type { Store } from "../store/store.js";
import type { LogEntry, Reminder } from "../types.js";

const DAY = 24 * 60 * 60 * 1000;

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data as Record<string, unknown>,
});

const utterance = z
  .string()
  .optional()
  .describe("The person's own words, verbatim, so the family sees what was actually said");

function briefInsights(i: Insights) {
  return {
    level: i.level,
    headline: i.headline,
    findings: i.findings.map((f) => ({ level: f.level, title: f.title, detail: f.detail })),
  };
}

/**
 * Kin's MCP server. One instance per request (stateless Streamable HTTP);
 * all memory lives in the store so it carries across sessions and devices.
 */
export function buildMcpServer(store: Store): McpServer {
  const server = new McpServer(
    { name: "kin", title: "Kin care companion", version: "0.1.0" },
    {
      instructions:
        "Kin keeps a running care record for an older adult who lives alone. Call get_care_context at the start of a conversation. " +
        "Whenever the person mentions a medication, symptom, mood, or sleep, log it with the matching log_* tool. " +
        "Log results include the household's care level and whether the family was just notified; tell the person kindly when that happens.",
    },
  );

  async function logAndEvaluate(entry: Omit<LogEntry, "id" | "ts">) {
    const log: LogEntry = { id: randomUUID(), ts: new Date().toISOString(), ...entry };
    await store.addLog(log);
    const { insights, escalated } = await evaluateAndEscalate(store);
    return json({
      logged: log,
      care: briefInsights(insights),
      familyNotified: escalated
        ? { title: escalated.title, level: escalated.level, reasons: escalated.reasons }
        : null,
    });
  }

  server.registerTool(
    "get_care_context",
    {
      title: "Get care context",
      description:
        "Who the person is, their medications and what's due today, what they've reported in the last 24 hours, upcoming reminders, and the current care picture. Call this first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const profile = await requireProfile(store);
      const now = new Date();
      const logs = await store.listLogs(new Date(now.getTime() - DAY).toISOString());
      const insights = await currentInsights(store, now);
      const today = insights.days.find((d) => d.date === dayKey(now));
      const reminders = (await store.listReminders()).filter((r) => r.status === "scheduled");
      const since = new Date(now.getTime() - DAY).toISOString();
      const fromFamily = (await store.listMessages()).filter((m) => m.from === "family" && m.ts >= since);
      return json({
        now: now.toString(),
        person: {
          name: profile.parentName,
          callThem: profile.preferredName,
          age: profile.age,
          city: profile.city,
          conditions: profile.conditions,
          notes: profile.notes,
        },
        family: profile.family,
        medicationsToday: profile.medications.map((m) => ({
          name: m.name,
          dose: m.dose,
          purpose: m.purpose,
          times: m.times,
          status: today?.meds[m.name] ?? "pending",
        })),
        last24h: logs.map((l) => ({ ts: l.ts, kind: l.kind, said: l.utterance, ...pick(l) })),
        upcomingReminders: reminders.map((r) => ({ dueAt: r.dueAt, message: r.message })),
        messagesFromFamily: fromFamily.map((m) => ({ from: m.author, text: m.text, ts: m.ts, readAloud: Boolean(m.deliveredAt) })),
        kinJustSaid: await recentlySaidByKin(store, now),
        care: briefInsights(insights),
      });
    },
  );

  server.registerTool(
    "log_medication",
    {
      title: "Log medication",
      description: "Record that a medication dose was taken (or skipped). Use the medication name from get_care_context.",
      inputSchema: {
        medication: z.string().describe("Medication name, e.g. Amlodipine"),
        taken: z.boolean().default(true).describe("false if the person says they skipped or forgot it"),
        utterance,
      },
    },
    async ({ medication, taken, utterance }) => logAndEvaluate({ kind: "medication", medication, taken, utterance }),
  );

  server.registerTool(
    "log_symptom",
    {
      title: "Log symptom",
      description:
        "Record a symptom or physical complaint (dizziness, headache, pain, a fall...). Kin compares it with the last two weeks and may notify the family.",
      inputSchema: {
        symptom: z.string().describe("Short name, e.g. dizziness, knee pain, headache"),
        severity: z.number().int().min(1).max(5).default(2).describe("1 mild .. 5 severe; infer from their words"),
        utterance,
      },
    },
    async ({ symptom, severity, utterance }) =>
      logAndEvaluate({ kind: "symptom", symptom: normalizeSymptom(symptom), severity, utterance }),
  );

  server.registerTool(
    "log_mood",
    {
      title: "Log mood",
      description: "Record how the person is feeling emotionally today.",
      inputSchema: {
        mood: z.number().int().min(1).max(5).describe("1 very low, 2 low, 3 okay, 4 good, 5 great"),
        note: z.string().optional().describe("Anything notable, e.g. 'missing her sister'"),
        utterance,
      },
    },
    async ({ mood, note, utterance }) => logAndEvaluate({ kind: "mood", mood, text: note, utterance }),
  );

  server.registerTool(
    "log_sleep",
    {
      title: "Log sleep",
      description: "Record roughly how many hours the person slept last night.",
      inputSchema: {
        hours: z.number().min(0).max(16),
        utterance,
      },
    },
    async ({ hours, utterance }) => logAndEvaluate({ kind: "sleep", sleepHours: hours, utterance }),
  );

  server.registerTool(
    "log_note",
    {
      title: "Log note",
      description: "Record anything else worth remembering: meals, visitors, walks, plans, worries.",
      inputSchema: { text: z.string(), utterance },
    },
    async ({ text, utterance }) => logAndEvaluate({ kind: "note", text, utterance }),
  );

  server.registerTool(
    "get_trends",
    {
      title: "Get trends",
      description:
        "The two-week picture: medication adherence, recurring symptoms, mood and sleep drift, and any patterns linking them.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const i = await currentInsights(store);
      return json({
        ...briefInsights(i),
        adherenceLast7Days: i.adherence,
        symptomCountsLast7Days: i.symptomCounts,
        daily: i.days.map((d) => ({ date: d.date, mood: d.mood, sleepHours: d.sleepHours, symptoms: d.symptoms, meds: d.meds })),
      });
    },
  );

  server.registerTool(
    "notify_family",
    {
      title: "Notify family",
      description:
        "Send a message to the family. Use when the person asks you to, or when something they said worries you and the log tools didn't already notify the family.",
      inputSchema: {
        level: z.enum(["watch", "alert", "urgent"]),
        title: z.string().describe("One line, e.g. 'Mum asked you to call tonight'"),
        message: z.string().describe("What the family should know, in plain words"),
      },
    },
    async ({ level, title, message }) => {
      const alert = await raiseAgentAlert(store, level, title, message);
      return json({ sent: true, channel: alert.channel, title: alert.title });
    },
  );

  server.registerTool(
    "schedule_reminder",
    {
      title: "Schedule reminder",
      description: "Have Kin speak a reminder to the person later, e.g. 'take your evening tablet' or 'call Priya'.",
      inputSchema: {
        message: z.string().describe("What Kin should say when it's time"),
        inMinutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
        at: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe("Local time HH:MM (today, or tomorrow if already past)"),
      },
    },
    async ({ message, inMinutes, at }) => {
      const now = new Date();
      let due: Date;
      if (at) {
        const [h, m] = at.split(":").map(Number);
        due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
        if (due <= now) due = new Date(due.getTime() + DAY);
      } else {
        due = new Date(now.getTime() + (inMinutes ?? 60) * 60 * 1000);
      }
      const reminder: Reminder = {
        id: randomUUID(),
        createdAt: now.toISOString(),
        dueAt: due.toISOString(),
        message,
        status: "scheduled",
      };
      await store.addReminder(reminder);
      return json({ scheduled: true, dueAt: due.toString(), message });
    },
  );

  server.registerTool(
    "message_family",
    {
      title: "Message the family",
      description:
        "Pass on something the person wants their family to hear, e.g. 'tell Priya I'm feeling better'. It reaches the family by text or email and on their dashboard.",
      inputSchema: {
        text: z.string().min(1).max(500).describe("The message, in the person's own words where possible"),
        utterance,
      },
    },
    async ({ text }) => {
      const m = await messageFamily(store, text);
      return json({ sent: true, channel: m.channel, text: m.text });
    },
  );

  server.registerTool(
    "message_parent",
    {
      title: "Message the parent",
      description:
        "Leave a message for the person Kin cares for. Kin reads it aloud on their speaker at the next quiet moment, never in the middle of a conversation.",
      inputSchema: {
        text: z.string().min(1).max(500).describe("What to say to them, e.g. 'I'll call you at 7'"),
        from: z.string().optional().describe("The family member's name; defaults to the first family contact"),
      },
    },
    async ({ text, from }) => {
      const profile = await requireProfile(store);
      const m = await messageParent(store, from || profile.family[0]?.name || "Your family", text);
      return json({ queued: true, from: m.author, text: m.text });
    },
  );

  server.registerTool(
    "get_family_briefing",
    {
      title: "Get family briefing",
      description:
        "For family members asking 'how is Mum doing?': today's status, this week's patterns, and recent alerts, ready to summarize.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const profile = await requireProfile(store);
      const i = await currentInsights(store);
      const since = new Date(Date.now() - 2 * DAY).toISOString();
      const logs = await store.listLogs(since);
      const alerts = (await store.listAlerts()).filter((a) => a.ts >= since);
      const fromParent = (await store.listMessages()).filter((m) => m.from === "parent" && m.ts >= since);
      return json({
        person: profile.preferredName,
        ...briefInsights(i),
        adherenceLast7Days: i.adherence.map((a) => ({ medication: a.medication, taken: a.taken, due: a.due })),
        recentlySaid: logs.filter((l) => l.utterance).slice(-8).map((l) => ({ ts: l.ts, said: l.utterance })),
        recentAlerts: alerts.map((a) => ({ ts: a.ts, level: a.level, title: a.title, acknowledged: a.acknowledged })),
        messagesFromParent: fromParent.map((m) => ({ ts: m.ts, text: m.text })),
      });
    },
  );

  server.registerResource(
    "care-profile",
    "kin://household/profile",
    { title: "Care profile", description: "The person Kin cares for, their medications and family", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await requireProfile(store), null, 2) }],
    }),
  );

  server.registerResource(
    "care-insights",
    "kin://household/insights",
    { title: "Care insights", description: "The current two-week care picture", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await currentInsights(store), null, 2) }],
    }),
  );

  return server;
}

function pick(l: LogEntry) {
  const { medication, taken, symptom, severity, mood, sleepHours, text } = l;
  return Object.fromEntries(
    Object.entries({ medication, taken, symptom, severity, mood, sleepHours, text }).filter(([, v]) => v !== undefined),
  );
}
