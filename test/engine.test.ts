import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { evaluateAndEscalate } from "../src/care/engine.js";
import { demoHistory, demoProfile } from "../src/seed.js";
import { FileStore } from "../src/store/fileStore.js";

let dir: string;
let store: FileStore;
const noon = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 13, 0);
};

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "kin-engine-"));
});
after(() => rm(dir, { recursive: true, force: true }));

async function freshHousehold(id: string) {
  store = new FileStore(id, dir);
  await store.saveProfile(demoProfile(id));
  for (const log of demoHistory(noon())) await store.addLog(log);
}

test("no alert while the picture is only on watch", async () => {
  await freshHousehold("watch");
  const { escalated, insights } = await evaluateAndEscalate(store, noon());
  assert.equal(escalated, undefined);
  assert.equal(insights.level, "watch");
  assert.equal((await store.listAlerts()).length, 0);
});

test("the completing symptom alerts the family once, with reasons", async () => {
  await freshHousehold("pattern");
  const now = noon();
  await store.addLog({ id: "d", ts: now.toISOString(), kind: "symptom", symptom: "dizziness", severity: 2, utterance: "Dizzy again" });

  const first = await evaluateAndEscalate(store, now);
  assert.ok(first.escalated);
  assert.equal(first.escalated.level, "alert");
  assert.equal(first.escalated.channel, "dashboard"); // no SNS topic configured in tests
  assert.ok(first.escalated.reasons.some((r) => /Amlodipine/.test(r)));

  const second = await evaluateAndEscalate(store, new Date(now.getTime() + 60 * 60 * 1000));
  assert.equal(second.escalated, undefined, "same findings inside the 12h cooldown must not re-alert");
  assert.equal((await store.listAlerts()).length, 1);

  const later = await evaluateAndEscalate(store, new Date(now.getTime() + 13 * 60 * 60 * 1000));
  assert.ok(later.escalated, "alert is allowed again after the cooldown");
});

test("a fall escalates immediately as urgent", async () => {
  await freshHousehold("fall");
  const now = noon();
  await store.addLog({ id: "f", ts: now.toISOString(), kind: "symptom", symptom: "fall", severity: 4, utterance: "I fell in the kitchen" });
  const { escalated } = await evaluateAndEscalate(store, now);
  assert.equal(escalated?.level, "urgent");
  assert.match(escalated!.title, /^Urgent:/);
});

test("file store keeps logs ordered and survives a reload", async () => {
  await freshHousehold("persist");
  await store.addLog({ id: "early", ts: "2000-01-01T00:00:00.000Z", kind: "note", text: "old" });
  const logs = await store.listLogs();
  assert.equal(logs[0].id, "early");

  const reopened = new FileStore("persist", dir);
  assert.equal((await reopened.listLogs()).length, logs.length);
  assert.equal((await reopened.getProfile())?.preferredName, "Kamala");
});
