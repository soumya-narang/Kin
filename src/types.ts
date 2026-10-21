export interface Medication {
  name: string;
  dose: string;
  purpose: string;
  /** Local times the dose is due, "HH:MM" */
  times: string[];
}

export interface FamilyContact {
  name: string;
  relation: string;
  contact?: string;
}

export interface Profile {
  householdId: string;
  parentName: string;
  preferredName: string;
  age?: number;
  city?: string;
  conditions: string[];
  medications: Medication[];
  family: FamilyContact[];
  notes?: string;
}

export type LogKind = "medication" | "symptom" | "mood" | "sleep" | "note";

export interface LogEntry {
  id: string;
  ts: string;
  kind: LogKind;
  /** What the parent actually said, when the log came from conversation */
  utterance?: string;
  medication?: string;
  taken?: boolean;
  symptom?: string;
  /** 1 (mild) .. 5 (severe) */
  severity?: number;
  /** 1 (very low) .. 5 (great) */
  mood?: number;
  sleepHours?: number;
  text?: string;
}

export type CareLevel = "ok" | "watch" | "alert" | "urgent";

export interface Finding {
  code: string;
  level: CareLevel;
  title: string;
  detail: string;
}

export interface Alert {
  id: string;
  ts: string;
  level: CareLevel;
  title: string;
  message: string;
  reasons: string[];
  /** Stable key of the findings that caused it, used to avoid repeat alerts */
  key: string;
  source: "auto" | "agent";
  channel: "dashboard" | "sns";
  acknowledged: boolean;
}

export interface Reminder {
  id: string;
  createdAt: string;
  dueAt: string;
  message: string;
  status: "scheduled" | "delivered";
}
