import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Alert, LogEntry, Message, Profile, Reminder } from "../types.js";
import type { Store } from "./store.js";

/**
 * Single-table DynamoDB store. One partition per household:
 *   pk = HH#<householdId>
 *   sk = PROFILE | LOG#<ts>#<id> | ALERT#<ts>#<id> | REMINDER#<id> | MSG#<ts>#<id>
 */
export class DynamoStore implements Store {
  private db: DynamoDBDocumentClient;
  private pk: string;

  constructor(private table: string, householdId: string, region?: string) {
    this.db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.pk = `HH#${householdId}`;
  }

  private async put(sk: string, item: object) {
    await this.db.send(new PutCommand({ TableName: this.table, Item: { pk: this.pk, sk, ...item } }));
  }

  private async query<T>(prefix: string, from?: string): Promise<T[]> {
    const items: T[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: from ? "pk = :pk AND sk BETWEEN :from AND :to" : "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: from
            ? { ":pk": this.pk, ":from": `${prefix}${from}`, ":to": `${prefix}￿` }
            : { ":pk": this.pk, ":p": prefix },
          ExclusiveStartKey,
        }),
      );
      for (const { pk, sk, ...rest } of res.Items ?? []) items.push(rest as T);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  async getProfile() {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: this.pk, sk: "PROFILE" } }));
    if (!res.Item) return undefined;
    const { pk, sk, ...profile } = res.Item;
    return profile as Profile;
  }

  saveProfile(profile: Profile) {
    return this.put("PROFILE", profile);
  }

  addLog(entry: LogEntry) {
    return this.put(`LOG#${entry.ts}#${entry.id}`, entry);
  }

  listLogs(sinceIso?: string) {
    return this.query<LogEntry>("LOG#", sinceIso);
  }

  addAlert(alert: Alert) {
    return this.put(`ALERT#${alert.ts}#${alert.id}`, alert);
  }

  updateAlert(alert: Alert) {
    return this.addAlert(alert);
  }

  async listAlerts() {
    return (await this.query<Alert>("ALERT#")).reverse();
  }

  addReminder(reminder: Reminder) {
    return this.put(`REMINDER#${reminder.id}`, reminder);
  }

  updateReminder(reminder: Reminder) {
    return this.addReminder(reminder);
  }

  async listReminders() {
    return (await this.query<Reminder>("REMINDER#")).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  addMessage(message: Message) {
    return this.put(`MSG#${message.ts}#${message.id}`, message);
  }

  updateMessage(message: Message) {
    return this.addMessage(message);
  }

  listMessages() {
    return this.query<Message>("MSG#");
  }

  async clear() {
    const res = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": this.pk },
        ProjectionExpression: "pk, sk",
      }),
    );
    const keys = (res.Items ?? []).map((i) => ({ pk: i.pk, sk: i.sk }));
    for (let i = 0; i < keys.length; i += 25) {
      await this.db.send(
        new BatchWriteCommand({
          RequestItems: { [this.table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) },
        }),
      );
    }
    if (res.LastEvaluatedKey) await this.clear();
  }
}
