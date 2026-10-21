import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Alert, LogEntry, Profile, Reminder } from "../types.js";
import type { Store } from "./store.js";

interface Household {
  profile?: Profile;
  logs: LogEntry[];
  alerts: Alert[];
  reminders: Reminder[];
}

const empty = (): Household => ({ logs: [], alerts: [], reminders: [] });

/** Local JSON file store, for development and offline demos. */
export class FileStore implements Store {
  private file: string;
  private cache?: Household;
  private writing = Promise.resolve();

  constructor(householdId: string, dir = path.resolve("data")) {
    this.file = path.join(dir, `${householdId}.json`);
  }

  private async load(): Promise<Household> {
    if (this.cache) return this.cache;
    try {
      this.cache = { ...empty(), ...JSON.parse(await readFile(this.file, "utf8")) };
    } catch {
      this.cache = empty();
    }
    return this.cache!;
  }

  private async save() {
    const data = JSON.stringify(this.cache, null, 2);
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(this.file, data);
    });
    await this.writing;
  }

  async getProfile() {
    return (await this.load()).profile;
  }

  async saveProfile(profile: Profile) {
    (await this.load()).profile = profile;
    await this.save();
  }

  async addLog(entry: LogEntry) {
    const h = await this.load();
    h.logs.push(entry);
    h.logs.sort((a, b) => a.ts.localeCompare(b.ts));
    await this.save();
  }

  async listLogs(sinceIso?: string) {
    const logs = (await this.load()).logs;
    return sinceIso ? logs.filter((l) => l.ts >= sinceIso) : [...logs];
  }

  async addAlert(alert: Alert) {
    (await this.load()).alerts.push(alert);
    await this.save();
  }

  async updateAlert(alert: Alert) {
    const h = await this.load();
    h.alerts = h.alerts.map((a) => (a.id === alert.id ? alert : a));
    await this.save();
  }

  async listAlerts() {
    return [...(await this.load()).alerts].sort((a, b) => b.ts.localeCompare(a.ts));
  }

  async addReminder(reminder: Reminder) {
    (await this.load()).reminders.push(reminder);
    await this.save();
  }

  async updateReminder(reminder: Reminder) {
    const h = await this.load();
    h.reminders = h.reminders.map((r) => (r.id === reminder.id ? reminder : r));
    await this.save();
  }

  async listReminders() {
    return [...(await this.load()).reminders].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  async clear() {
    this.cache = empty();
    await this.save();
  }
}
