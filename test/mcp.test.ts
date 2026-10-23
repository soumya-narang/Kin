import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { demoHistory, demoProfile } from "../src/seed.js";
import { FileStore } from "../src/store/fileStore.js";

let dir: string;
let client: Client;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "kin-mcp-"));
  const store = new FileStore("mcp", dir);
  await store.saveProfile(demoProfile("mcp"));
  for (const log of demoHistory()) await store.addLog(log);

  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(store).connect(serverSide);
  client = new Client({ name: "kin-test", version: "0.0.0" });
  await client.connect(clientSide);
});
after(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return res as { isError?: boolean; structuredContent?: any; content: { text: string }[] };
};

test("exposes the documented tools and resources", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_care_context",
    "get_family_briefing",
    "get_trends",
    "log_medication",
    "log_mood",
    "log_note",
    "log_sleep",
    "log_symptom",
    "message_family",
    "message_parent",
    "notify_family",
    "schedule_reminder",
  ]);
  const uris = (await client.listResources()).resources.map((r) => r.uri).sort();
  assert.deepEqual(uris, ["kin://household/insights", "kin://household/profile"]);
});

test("get_care_context describes the person and what is due", async () => {
  const res = await call("get_care_context");
  assert.equal(res.structuredContent.person.callThem, "Kamala");
  assert.deepEqual(res.structuredContent.medicationsToday.map((m: any) => m.name), ["Amlodipine", "Metformin"]);
});

test("tool inputs are validated", async () => {
  const res = await call("log_mood", { mood: 9 });
  assert.equal(res.isError, true);
});

test("a synonym is logged as dizziness, completes the pattern and notifies the family", async () => {
  // The seed has two dizzy reports this week; this is the third
  const res = await call("log_symptom", { symptom: "feeling lightheaded", severity: 2, utterance: "Dizzy again" });
  assert.equal(res.structuredContent.logged.symptom, "dizziness");
  assert.ok(res.structuredContent.familyNotified, "expected the family to be notified");
  assert.match(res.structuredContent.familyNotified.reasons.join(" "), /Amlodipine/);

  const again = await call("log_symptom", { symptom: "dizzy", severity: 2 });
  assert.equal(again.structuredContent.familyNotified, null, "cooldown should suppress a repeat alert");
});

test("family briefing includes the alert and the parent's own words", async () => {
  const res = await call("get_family_briefing");
  assert.ok(res.structuredContent.recentAlerts.length >= 1);
  assert.ok(res.structuredContent.recentlySaid.some((s: any) => /Dizzy again/.test(s.said)));
});

test("family and parent can message each other through Kin", async () => {
  const toParent = await call("message_parent", { text: "I'll call you at 7", from: "Priya" });
  assert.equal(toParent.structuredContent.queued, true);
  const ctx = await call("get_care_context");
  assert.ok(ctx.structuredContent.messagesFromFamily.some((m: any) => m.from === "Priya" && m.text === "I'll call you at 7" && !m.readAloud));

  const toFamily = await call("message_family", { text: "I'm feeling better now" });
  assert.equal(toFamily.structuredContent.sent, true);
  assert.equal(toFamily.structuredContent.channel, "dashboard"); // no SNS topic in tests
  const briefing = await call("get_family_briefing");
  assert.ok(briefing.structuredContent.messagesFromParent.some((m: any) => m.text === "I'm feeling better now"));
});

test("reminders can be scheduled by delay or clock time", async () => {
  const a = await call("schedule_reminder", { message: "Take your evening tablet", inMinutes: 30 });
  assert.equal(a.structuredContent.scheduled, true);
  const b = await call("schedule_reminder", { message: "Call Priya", at: "18:30" });
  assert.equal(b.structuredContent.scheduled, true);
  const ctx = await call("get_care_context");
  assert.equal(ctx.structuredContent.upcomingReminders.length, 2);
});
