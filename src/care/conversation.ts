import { randomUUID } from "node:crypto";
import type { Store } from "../store/store.js";
import type { LogEntry, Message, Profile, Reminder } from "../types.js";
import { requireProfile } from "./engine.js";
import { dayKey } from "./insights.js";
import { sendFamilyMessage } from "./notify.js";

const MIN = 60 * 1000;
/** A dose is nudged this long after it's due, well before it counts as missed */
const NUDGE_AFTER = 30 * MIN;
/** ...and not after this, so a late visit doesn't open with a stale question */
const NUDGE_UNTIL = 3 * 60 * MIN;
/** How long something Kin said counts as context for the person's reply */
const JUST_SAID = 30 * MIN;

/** Something the speaker should say without being asked. */
export interface Spoken {
  kind: "message" | "reminder" | "checkin";
  /** The full sentence Kin speaks */
  text: string;
  author?: string;
  /** For messages, just what the family wrote, for the screen */
  body?: string;
}

export async function messageParent(store: Store, author: string, text: string, now = new Date()): Promise<Message> {
  const message: Message = { id: randomUUID(), ts: now.toISOString(), from: "family", author, text };
  await store.addMessage(message);
  return message;
}

export async function messageFamily(store: Store, text: string, now = new Date()): Promise<Message> {
  const profile = await requireProfile(store);
  const channel = await sendFamilyMessage(profile, text);
  const message: Message = { id: randomUUID(), ts: now.toISOString(), from: "parent", author: profile.preferredName, text, channel };
  await store.addMessage(message);
  return message;
}

const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

/**
 * The check-ins Kin would start on its own right now: a morning hello if
 * nothing has been heard yet, and a gentle nudge for a dose that's a little
 * late. Each one has a stable id so it is said at most once.
 */
export function dueCheckins(profile: Profile, todaysLogs: LogEntry[], now = new Date()): { id: string; text: string }[] {
  const date = dayKey(now);
  const out: { id: string; text: string }[] = [];
  const name = profile.preferredName;

  if (now.getHours() >= 7 && now.getHours() < 11 && todaysLogs.length === 0) {
    out.push({ id: `checkin:${date}:morning`, text: `Good morning, ${name}. How did you sleep last night?` });
  }

  for (const med of profile.medications) {
    const taken = todaysLogs.filter(
      (l) => l.kind === "medication" && l.taken && l.medication?.toLowerCase().includes(med.name.toLowerCase()),
    ).length;
    med.times.forEach((time, doseIndex) => {
      const [h, m] = time.split(":").map(Number);
      const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
      const late = now.getTime() - due;
      if (late < NUDGE_AFTER || late > NUDGE_UNTIL || taken > doseIndex) return;
      out.push({
        id: `nudge:${date}:${med.name}:${time}`,
        text: `${name}, it's a little past ${clock(time)}. Have you had your ${med.name} yet?`,
      });
    });
  }
  return out;
}

/**
 * Everything the speaker should say now, in order: messages from the family
 * first, then due reminders, then at most one check-in. Marks each as said.
 */
export async function takeDueSpeech(store: Store, now = new Date()): Promise<Spoken[]> {
  const profile = await requireProfile(store);
  const nowIso = now.toISOString();
  const spoken: Spoken[] = [];

  for (const m of await store.listMessages()) {
    if (m.from !== "family" || m.deliveredAt) continue;
    await store.updateMessage({ ...m, deliveredAt: nowIso });
    spoken.push({ kind: "message", author: m.author, body: m.text, text: `${profile.preferredName}, a message from ${m.author}: ${m.text}` });
  }

  const reminders = await store.listReminders();
  for (const r of reminders) {
    if (r.status !== "scheduled" || r.dueAt > nowIso) continue;
    await store.updateReminder({ ...r, status: "delivered" });
    spoken.push({ kind: r.id.startsWith("checkin:") ? "checkin" : "reminder", text: r.message });
  }

  if (!spoken.length) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const said = new Set(reminders.map((r) => r.id));
    const next = dueCheckins(profile, await store.listLogs(today), now).find((c) => !said.has(c.id));
    if (next) {
      const record: Reminder = { id: next.id, createdAt: nowIso, dueAt: nowIso, message: next.text, status: "delivered" };
      await store.addReminder(record);
      spoken.push({ kind: "checkin", text: next.text });
    }
  }
  return spoken;
}

/** What Kin said unprompted in the last half hour, so the agent knows what a reply is answering. */
export async function recentlySaidByKin(store: Store, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - JUST_SAID).toISOString();
  const reminders = (await store.listReminders()).filter((r) => r.status === "delivered" && r.dueAt >= since && r.dueAt <= now.toISOString());
  const messages = (await store.listMessages()).filter((m) => m.from === "family" && m.deliveredAt && m.deliveredAt >= since);
  return [...reminders.map((r) => r.message), ...messages.map((m) => `Read out a message from ${m.author}: "${m.text}"`)];
}
