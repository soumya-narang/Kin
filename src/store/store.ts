import type { Alert, LogEntry, Message, Profile, Reminder } from "../types.js";

/** Everything Kin remembers about one household, across sessions. */
export interface Store {
  getProfile(): Promise<Profile | undefined>;
  saveProfile(profile: Profile): Promise<void>;

  addLog(entry: LogEntry): Promise<void>;
  /** Logs at or after `sinceIso`, oldest first */
  listLogs(sinceIso?: string): Promise<LogEntry[]>;

  addAlert(alert: Alert): Promise<void>;
  updateAlert(alert: Alert): Promise<void>;
  /** Newest first */
  listAlerts(): Promise<Alert[]>;

  addReminder(reminder: Reminder): Promise<void>;
  updateReminder(reminder: Reminder): Promise<void>;
  listReminders(): Promise<Reminder[]>;

  addMessage(message: Message): Promise<void>;
  updateMessage(message: Message): Promise<void>;
  /** Oldest first */
  listMessages(): Promise<Message[]>;

  /** Wipe the household (used by the demo seeder) */
  clear(): Promise<void>;
}
