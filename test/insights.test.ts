import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze } from "../src/care/insights.js";
import { demoHistory, demoProfile } from "../src/seed.js";
import type { LogEntry } from "../src/types.js";

const profile = demoProfile("test");
// Midday, after every morning dose is past its grace period
const noon = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 13, 0);

const symptom = (text: string, now: Date, name = "insomnia", severity = 2): LogEntry => ({
  id: text,
  ts: now.toISOString(),
  kind: "symptom",
  symptom: name,
  severity,
  utterance: text,
});

test("seeded history is on watch before the next dizzy spell", () => {
  const now = noon();
  const i = analyze(profile, demoHistory(now), now);
  assert.equal(i.level, "watch");
  assert.ok(i.findings.some((f) => f.code === "med_missed:Amlodipine"));
  assert.ok(i.findings.some((f) => f.code === "mood_drop"));
  assert.ok(i.findings.some((f) => f.code === "sleep_drop"));
  assert.ok(!i.findings.some((f) => f.code.startsWith("pattern:")));
});

test("a third dizzy report completes the missed-dose pattern and raises an alert", () => {
  const now = noon();
  const logs = [...demoHistory(now), symptom("Dizzy again", now, "dizziness", 2)];
  const i = analyze(profile, logs, now);
  const pattern = i.findings.find((f) => f.code === "pattern:dizziness+Amlodipine");
  assert.ok(pattern, "expected the dizziness + missed Amlodipine pattern");
  assert.equal(pattern.level, "alert");
  assert.equal(i.level, "alert");
});

test("dizziness without any missed blood-pressure dose is not linked to the medication", () => {
  const now = noon();
  const logs = demoHistory(now);
  // Fill in the Amlodipine doses the seed skipped, plus this morning's
  for (const d of [0, 1, 3]) {
    const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, 8, 5).toISOString();
    logs.push({ id: `a${d}`, ts, kind: "medication", medication: "Amlodipine", taken: true });
  }
  logs.push(symptom("Dizzy again", now, "dizziness", 2));
  const i = analyze(profile, logs, now);
  assert.ok(!i.findings.some((f) => f.code.startsWith("pattern:")));
});

for (const phrase of ["I fell in the kitchen", "I have chest pain", "I feel faint", "My left arm is numb"]) {
  test(`red flag: "${phrase}" is urgent`, () => {
    const now = noon();
    const i = analyze(profile, [symptom(phrase, now, "complaint")], now);
    assert.equal(i.level, "urgent");
  });
}

for (const phrase of ["I couldn't fall asleep last night", "I fell asleep on the sofa", "My phone number is wrong"]) {
  test(`not a red flag: "${phrase}"`, () => {
    const now = noon();
    const i = analyze(profile, [symptom(phrase, now)], now);
    assert.notEqual(i.level, "urgent");
  });
}

test("severity 5 is urgent even without a red-flag phrase", () => {
  const now = noon();
  const i = analyze(profile, [symptom("It really hurts", now, "knee pain", 5)], now);
  assert.equal(i.level, "urgent");
});

test("a missed dose only counts once it is past the grace period", () => {
  const early = new Date();
  early.setHours(8, 30, 0, 0); // Amlodipine due 08:00, grace is 2h
  const i = analyze(profile, [], early);
  const today = i.days.at(-1)!;
  assert.equal(today.meds["Amlodipine"], "pending");
});

test("a quiet afternoon is flagged, a quiet morning is not", () => {
  const day = new Date();
  const afternoon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 15, 0);
  const morning = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
  assert.ok(analyze(profile, [], afternoon).findings.some((f) => f.code === "quiet_day"));
  assert.ok(!analyze(profile, [], morning).findings.some((f) => f.code === "quiet_day"));
});
