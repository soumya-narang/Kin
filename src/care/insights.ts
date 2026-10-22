import type { CareLevel, Finding, LogEntry, Medication, Profile } from "../types.js";

const DAY = 24 * 60 * 60 * 1000;
/** A dose counts as missed once it is this late */
const GRACE_MS = 2 * 60 * 60 * 1000;

const LEVELS: CareLevel[] = ["ok", "watch", "alert", "urgent"];
export const levelRank = (l: CareLevel) => LEVELS.indexOf(l);
const maxLevel = (a: CareLevel, b: CareLevel) => (levelRank(a) >= levelRank(b) ? a : b);

/** Whole words only, so "fall asleep" or "phone number" don't page the family. */
const RED_FLAGS =
  /chest pain|chest tight|\b(?:fell|fall(?:en|ing)?)\b(?!\s+asleep)|\bfaint(?:ed|ing)?\b|passed out|can'?t breathe|short(?:ness)? of breath|\bstroke\b|\bnumb(?:ness)?\b|slurred|\bconfus(?:ed|ion)\b|\bbleeding\b|unconscious/i;
/** Symptoms that can be linked to missed blood-pressure medication */
const BP_SYMPTOMS = new Set(["dizziness", "headache", "blurred vision", "palpitations"]);

const SYNONYMS: [RegExp, string][] = [
  [/dizz|light ?headed|giddy|spinning|vertigo/i, "dizziness"],
  [/head ?ache|head is (hurting|paining)/i, "headache"],
  [/blur/i, "blurred vision"],
  [/tired|fatigue|weak|exhaust/i, "fatigue"],
  [/knee|joint/i, "joint pain"],
  [/palpitat|heart (racing|pounding)/i, "palpitations"],
  [/cough/i, "cough"],
  [/nause|vomit/i, "nausea"],
];

export function normalizeSymptom(raw: string): string {
  const s = raw.trim().toLowerCase();
  for (const [re, name] of SYNONYMS) if (re.test(s)) return name;
  return s;
}

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function medMatches(med: Medication, name?: string) {
  if (!name) return false;
  const a = med.name.toLowerCase();
  const b = name.toLowerCase();
  return a.includes(b) || b.includes(a);
}

export type DoseStatus = "taken" | "partial" | "missed" | "pending" | "none";

export interface DaySummary {
  date: string;
  mood?: number;
  sleepHours?: number;
  symptoms: string[];
  meds: Record<string, DoseStatus>;
  logCount: number;
}

export interface Adherence {
  medication: string;
  purpose: string;
  due: number;
  taken: number;
  missed: number;
  missedDays: string[];
}

export interface Insights {
  generatedAt: string;
  level: CareLevel;
  findings: Finding[];
  adherence: Adherence[];
  symptomCounts: Record<string, number>;
  days: DaySummary[];
  checkedInToday: boolean;
  headline: string;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/**
 * Turns raw daily logs into longitudinal findings. This is deterministic on
 * purpose: the language model explains and acts on findings, it doesn't invent them.
 */
export function analyze(profile: Profile, logs: LogEntry[], now = new Date(), windowDays = 14): Insights {
  const today = startOfDay(now);
  const days: DaySummary[] = [];
  const byDay = new Map<string, LogEntry[]>();
  for (const l of logs) {
    const k = dayKey(new Date(l.ts));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(l);
  }

  const adherence: Adherence[] = profile.medications.map((m) => ({
    medication: m.name,
    purpose: m.purpose,
    due: 0,
    taken: 0,
    missed: 0,
    missedDays: [],
  }));

  for (let i = windowDays - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * DAY);
    const key = dayKey(date);
    const entries = byDay.get(key) ?? [];
    const moods = entries.filter((e) => e.kind === "mood" && e.mood).map((e) => e.mood!);
    const sleeps = entries.filter((e) => e.kind === "sleep" && e.sleepHours != null).map((e) => e.sleepHours!);
    const summary: DaySummary = {
      date: key,
      mood: avg(moods),
      sleepHours: sleeps.at(-1),
      symptoms: [...new Set(entries.filter((e) => e.kind === "symptom").map((e) => e.symptom!))],
      meds: {},
      logCount: entries.length,
    };

    profile.medications.forEach((med, idx) => {
      const dueTimes = med.times.map((t) => {
        const [h, mi] = t.split(":").map(Number);
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, mi);
      });
      const dueNow = dueTimes.filter((t) => t.getTime() + GRACE_MS <= now.getTime()).length;
      const takenCount = entries.filter((e) => e.kind === "medication" && e.taken && medMatches(med, e.medication)).length;
      const taken = Math.min(takenCount, med.times.length);
      let status: DoseStatus;
      if (dueNow === 0) status = taken > 0 ? "taken" : "pending";
      else if (taken >= dueNow) status = "taken";
      else if (taken > 0) status = "partial";
      else status = "missed";
      summary.meds[med.name] = status;

      // Adherence is measured over the last 7 days
      if (i < 7) {
        const a = adherence[idx];
        const counted = Math.min(taken, dueNow);
        a.due += dueNow;
        a.taken += counted;
        a.missed += dueNow - counted;
        if (dueNow - counted > 0) a.missedDays.push(key);
      }
    });
    days.push(summary);
  }

  const findings: Finding[] = [];
  const weekAgo = new Date(today.getTime() - 6 * DAY).toISOString();
  const recentSymptoms = logs.filter((l) => l.kind === "symptom" && l.ts >= weekAgo);
  const symptomCounts: Record<string, number> = {};
  for (const s of recentSymptoms) symptomCounts[s.symptom!] = (symptomCounts[s.symptom!] ?? 0) + 1;

  // Red flags in the last 24h
  const dayAgo = new Date(now.getTime() - DAY).toISOString();
  for (const s of logs.filter((l) => l.kind === "symptom" && l.ts >= dayAgo)) {
    const text = `${s.symptom} ${s.text ?? ""} ${s.utterance ?? ""}`;
    if (RED_FLAGS.test(text) || (s.severity ?? 0) >= 5) {
      findings.push({
        code: `red_flag:${s.symptom}`,
        level: "urgent",
        title: `Possible emergency: ${s.symptom}`,
        detail: `Reported "${s.utterance ?? s.symptom}" at ${new Date(s.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
      });
    } else if ((s.severity ?? 0) >= 4) {
      findings.push({
        code: `severe:${s.symptom}`,
        level: "alert",
        title: `Severe ${s.symptom}`,
        detail: `Rated ${s.severity}/5 in the last 24 hours.`,
      });
    }
  }

  // Missed medication
  for (const a of adherence) {
    if (a.missed >= 2) {
      findings.push({
        code: `med_missed:${a.medication}`,
        level: "watch",
        title: `${a.medication} doses missed`,
        detail: `${a.missed} of ${a.due} doses of ${a.medication} (${a.purpose}) missed in the last 7 days.`,
      });
    }
  }

  // Recurring symptoms
  for (const [symptom, count] of Object.entries(symptomCounts)) {
    if (count >= 3) {
      findings.push({
        code: `symptom_repeat:${symptom}`,
        level: "watch",
        title: `${cap(symptom)} keeps coming up`,
        detail: `Mentioned ${count} times in the last 7 days.`,
      });
    }
  }

  // The pattern no single conversation can see: symptoms that line up with missed BP doses
  const bpMeds = adherence.filter((a) => /blood pressure|hypertension|\bbp\b/i.test(a.purpose) && a.missed >= 1);
  for (const [symptom, count] of Object.entries(symptomCounts)) {
    if (!BP_SYMPTOMS.has(symptom) || count < 3) continue;
    for (const med of bpMeds) {
      const symptomDays = new Set(recentSymptoms.filter((s) => s.symptom === symptom).map((s) => dayKey(new Date(s.ts))));
      const overlap = med.missedDays.filter((d) => symptomDays.has(d) || symptomDays.has(nextDay(d))).length;
      if (overlap >= 1) {
        findings.push({
          code: `pattern:${symptom}+${med.medication}`,
          level: "alert",
          title: `${cap(symptom)} is lining up with missed ${med.medication}`,
          detail: `${cap(symptom)} was reported ${count} times this week, and ${overlap} of those episodes came on or right after a day ${med.medication} (${med.purpose}) was missed. Worth a call, and a check with the doctor.`,
        });
      }
    }
  }

  // Mood drift
  const recentMood = avg(days.slice(-3).map((d) => d.mood).filter((m): m is number => m != null));
  const baselineMood = avg(days.slice(-10, -3).map((d) => d.mood).filter((m): m is number => m != null));
  if (recentMood != null && baselineMood != null && baselineMood - recentMood >= 1) {
    findings.push({
      code: "mood_drop",
      level: "watch",
      title: "Mood is lower than usual",
      detail: `Averaging ${recentMood.toFixed(1)}/5 over the last 3 days, down from ${baselineMood.toFixed(1)}/5.`,
    });
  }

  // Sleep drift
  const recentSleep = avg(days.slice(-3).map((d) => d.sleepHours).filter((s): s is number => s != null));
  const baselineSleep = avg(days.slice(-10, -3).map((d) => d.sleepHours).filter((s): s is number => s != null));
  if (recentSleep != null && baselineSleep != null && baselineSleep - recentSleep >= 1.5) {
    findings.push({
      code: "sleep_drop",
      level: "watch",
      title: "Sleeping less",
      detail: `About ${recentSleep.toFixed(1)}h a night lately, down from ${baselineSleep.toFixed(1)}h.`,
    });
  }

  const checkedInToday = (byDay.get(dayKey(now)) ?? []).length > 0;
  if (!checkedInToday && now.getHours() >= 12) {
    findings.push({
      code: "quiet_day",
      level: "watch",
      title: "No check-in yet today",
      detail: `Nothing heard from ${profile.preferredName} since yesterday.`,
    });
  }

  findings.sort((a, b) => levelRank(b.level) - levelRank(a.level));
  const level = findings.reduce<CareLevel>((l, f) => maxLevel(l, f.level), "ok");
  const headline =
    level === "ok"
      ? `${profile.preferredName} is doing well. Nothing unusual this week.`
      : findings[0].title;

  return {
    generatedAt: now.toISOString(),
    level,
    findings,
    adherence,
    symptomCounts,
    days,
    checkedInToday,
    headline,
  };
}

function nextDay(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + 1));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
