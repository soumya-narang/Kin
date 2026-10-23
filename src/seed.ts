import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { config, createStore } from "./config.js";
import type { Store } from "./store/store.js";
import type { LogEntry, Message, Profile } from "./types.js";

export const demoProfile = (householdId: string): Profile => ({
  householdId,
  parentName: "Kamala Iyer",
  preferredName: "Kamala",
  age: 74,
  city: "Pune",
  conditions: ["Hypertension", "Type 2 diabetes", "Knee osteoarthritis"],
  medications: [
    { name: "Amlodipine", dose: "5 mg", purpose: "blood pressure", times: ["08:00"] },
    { name: "Metformin", dose: "500 mg", purpose: "diabetes", times: ["08:30", "20:30"] },
  ],
  family: [
    { name: "Priya", relation: "daughter", contact: "Lives in Bengaluru" },
    { name: "Arjun", relation: "son", contact: "Lives in Seattle" },
  ],
  notes: "Lives alone since 2023. Morning walk in the society garden. Enjoys bhajans and talking about her grandchildren.",
});

/**
 * Two weeks of history. The first ten days are steady; over the last four,
 * Amlodipine gets missed, dizziness shows up, and mood and sleep slip.
 * The next dizziness report completes the pattern and Kin alerts the family.
 */
export function demoHistory(now = new Date()): LogEntry[] {
  const logs: LogEntry[] = [];
  const at = (daysAgo: number, h: number, m = 0) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m);
    return d.toISOString();
  };
  const add = (e: Omit<LogEntry, "id">) => logs.push({ id: randomUUID(), ...e });

  for (let d = 13; d >= 1; d--) {
    const late = d <= 4;
    const missedAmlodipine = d === 3 || d === 1;

    if (!missedAmlodipine) add({ ts: at(d, 8, 5), kind: "medication", medication: "Amlodipine", taken: true, utterance: "Took my BP tablet." });
    add({ ts: at(d, 8, 40), kind: "medication", medication: "Metformin", taken: true, utterance: "Had my sugar tablet after breakfast." });
    add({ ts: at(d, 20, 35), kind: "medication", medication: "Metformin", taken: true });

    const sleep = late ? [0, 5, 5, 6, 6][d] : [7, 7.5, 6.5, 7][d % 4];
    add({ ts: at(d, 8, 10), kind: "sleep", sleepHours: sleep, utterance: late ? "Didn't sleep very well." : "Slept okay." });

    const mood = late ? [0, 2, 3, 3, 3][d] : [4, 4, 5, 4][d % 4];
    add({
      ts: at(d, 11, 0),
      kind: "mood",
      mood,
      utterance: late ? (d === 1 ? "Feeling a bit low today, the house is very quiet." : "I'm alright, just tired.") : "Feeling good, went for my walk.",
    });

    if (d === 9) add({ ts: at(d, 17, 0), kind: "note", text: "Neighbour Mrs. Kulkarni visited for tea.", utterance: "Mrs. Kulkarni came over for tea!" });
    if (d === 6) add({ ts: at(d, 18, 0), kind: "symptom", symptom: "joint pain", severity: 2, utterance: "My knee is a little stiff today." });
  }

  add({ ts: at(3, 10, 30), kind: "symptom", symptom: "dizziness", severity: 2, utterance: "I felt a little dizzy after my bath." });
  add({ ts: at(1, 9, 45), kind: "symptom", symptom: "dizziness", severity: 3, utterance: "Felt dizzy again when I got up from the sofa." });

  return logs.sort((a, b) => a.ts.localeCompare(b.ts));
}

/** A short exchange from earlier in the week, so the family's conversation isn't empty. */
export function demoMessages(now = new Date()): Message[] {
  const at = (daysAgo: number, h: number, m = 0) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m).toISOString();
  return [
    { id: randomUUID(), ts: at(5, 19, 10), from: "family", author: "Priya", text: "Riya's school play is on Sunday. I'll send you the video, Amma!", deliveredAt: at(5, 19, 12) },
    { id: randomUUID(), ts: at(5, 19, 14), from: "parent", author: "Kamala", text: "I can't wait to see it. Tell Riya I'm very proud of her.", channel: "dashboard" },
  ];
}

export async function seed(store: Store, now = new Date()) {
  await store.clear();
  await store.saveProfile(demoProfile(config.householdId));
  for (const log of demoHistory(now)) await store.addLog(log);
  for (const message of demoMessages(now)) await store.addMessage(message);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = createStore();
  await seed(store);
  console.log(`Seeded household "${config.householdId}" with ${demoHistory().length} log entries${config.table ? ` in DynamoDB table ${config.table}` : " in ./data"}.`);
}
