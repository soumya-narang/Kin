import { randomUUID } from "node:crypto";
import type { Store } from "../store/store.js";
import type { Alert, CareLevel, Profile } from "../types.js";
import { analyze, levelRank, type Insights } from "./insights.js";
import { notifyFamily } from "./notify.js";

const DAY = 24 * 60 * 60 * 1000;
/** Don't repeat an alert for the same findings within this window */
const COOLDOWN_MS = 12 * 60 * 60 * 1000;

export async function requireProfile(store: Store): Promise<Profile> {
  const profile = await store.getProfile();
  if (!profile) throw new Error("No household profile yet. Run `npm run seed` to load the demo household.");
  return profile;
}

export async function currentInsights(store: Store, now = new Date()): Promise<Insights> {
  const profile = await requireProfile(store);
  const logs = await store.listLogs(new Date(now.getTime() - 15 * DAY).toISOString());
  return analyze(profile, logs, now);
}

export interface Evaluation {
  insights: Insights;
  escalated?: Alert;
}

/**
 * Runs after every new log. If the longitudinal picture has crossed into
 * "alert" or "urgent", Kin tells the family on its own, once per pattern.
 */
export async function evaluateAndEscalate(store: Store, now = new Date()): Promise<Evaluation> {
  const profile = await requireProfile(store);
  const insights = await currentInsights(store, now);
  const actionable = insights.findings.filter((f) => levelRank(f.level) >= levelRank("alert"));
  if (!actionable.length) return { insights };

  const key = actionable.map((f) => f.code).sort().join("|");
  const recent = await store.listAlerts();
  const duplicate = recent.some(
    (a) => a.key === key && a.source === "auto" && now.getTime() - new Date(a.ts).getTime() < COOLDOWN_MS,
  );
  if (duplicate) return { insights };

  const level = insights.level;
  const draft = {
    id: randomUUID(),
    ts: now.toISOString(),
    level,
    title: level === "urgent" ? `Urgent: ${actionable[0].title}` : actionable[0].title,
    message:
      level === "urgent"
        ? `${profile.preferredName} may need help right now. Please call them. Kin has asked them to contact emergency services if it's serious.`
        : `Kin noticed a pattern with ${profile.preferredName} over the past few days that's worth a call today.`,
    reasons: actionable.map((f) => f.detail),
    key,
    source: "auto" as const,
    acknowledged: false,
  };
  const channel = await notifyFamily(profile, draft);
  const alert: Alert = { ...draft, channel };
  await store.addAlert(alert);
  return { insights, escalated: alert };
}

export async function raiseAgentAlert(
  store: Store,
  level: CareLevel,
  title: string,
  message: string,
  now = new Date(),
): Promise<Alert> {
  const profile = await requireProfile(store);
  const draft = {
    id: randomUUID(),
    ts: now.toISOString(),
    level,
    title,
    message,
    reasons: [],
    key: `agent:${title}`,
    source: "agent" as const,
    acknowledged: false,
  };
  const channel = await notifyFamily(profile, draft);
  const alert: Alert = { ...draft, channel };
  await store.addAlert(alert);
  return alert;
}
