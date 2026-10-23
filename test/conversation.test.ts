import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { dueCheckins, messageFamily, messageParent, recentlySaidByKin, takeDueSpeech } from "../src/care/conversation.js";
import { demoProfile } from "../src/seed.js";
import { FileStore } from "../src/store/fileStore.js";
import type { LogEntry } from "../src/types.js";

const profile = demoProfile("conv");
const at = (h: number, m = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
};
const took = (med: string, when: Date): LogEntry => ({ id: med + when.getTime(), ts: when.toISOString(), kind: "medication", medication: med, taken: true });

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "kin-conv-"));
});
after(() => rm(dir, { recursive: true, force: true }));

async function household(id: string) {
  const store = new FileStore(id, dir);
  await store.saveProfile(demoProfile(id));
  return store;
}

test("a quiet morning gets a hello; a morning with news does not", () => {
  assert.ok(dueCheckins(profile, [], at(7, 15)).some((c) => c.id.endsWith(":morning")));
  assert.ok(!dueCheckins(profile, [took("Metformin", at(7, 0))], at(7, 15)).some((c) => c.id.endsWith(":morning")));
  assert.ok(!dueCheckins(profile, [], at(14, 0)).some((c) => c.id.endsWith(":morning")));
});

test("a dose is nudged from 30 minutes late until 3 hours late, and not once taken", () => {
  const amlo = (now: Date, logs: LogEntry[] = []) => dueCheckins(profile, logs, now).filter((c) => c.id.includes("Amlodipine"));
  assert.equal(amlo(at(8, 15)).length, 0, "too early");
  assert.equal(amlo(at(8, 45)).length, 1);
  assert.match(amlo(at(8, 45))[0].text, /Amlodipine/);
  assert.equal(amlo(at(11, 30)).length, 0, "too late to ask");
  assert.equal(amlo(at(8, 45), [took("Amlodipine", at(8, 5))]).length, 0, "already taken");
});

test("the second Metformin dose is nudged even after the first was taken", () => {
  const evening = dueCheckins(profile, [took("Metformin", at(8, 40))], at(21, 10)).filter((c) => c.id.includes("Metformin"));
  assert.deepEqual(evening.map((c) => c.id.split(":").at(-2) + ":" + c.id.split(":").at(-1)), ["20:30"]);
});

test("speaker hears family messages once, and they become context for the reply", async () => {
  const store = await household("deliver");
  await messageParent(store, "Priya", "I'll call you at 7");
  const first = await takeDueSpeech(store, at(14, 0));
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, "message");
  assert.match(first[0].text, /a message from Priya: I'll call you at 7/);
  assert.equal((await takeDueSpeech(store, at(14, 1))).length, 0, "not repeated");
  const said = await recentlySaidByKin(store, at(14, 5));
  assert.ok(said.some((s) => /Priya/.test(s)));
});

test("a check-in is said at most once", async () => {
  const store = await household("checkin");
  const now = at(8, 50);
  const first = await takeDueSpeech(store, now);
  assert.equal(first[0]?.kind, "checkin");
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) for (const s of await takeDueSpeech(store, now)) ids.add(s.text);
  assert.ok(![...ids].includes(first[0].text), "the same check-in must not repeat");
});

test("a message from the parent is stored for the family", async () => {
  const store = await household("relay");
  const m = await messageFamily(store, "I'm feeling better now");
  assert.equal(m.from, "parent");
  assert.equal(m.author, "Kamala");
  assert.equal((await store.listMessages()).length, 1);
});
