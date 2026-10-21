import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { config } from "../config.js";
import type { Alert, Profile } from "../types.js";

const sns = config.snsTopicArn ? new SNSClient({ region: config.region }) : undefined;

/** Delivers an alert to the family. Every alert also shows on the family dashboard. */
export async function notifyFamily(profile: Profile, alert: Omit<Alert, "channel">): Promise<Alert["channel"]> {
  const body = [
    `${alert.title}`,
    "",
    alert.message,
    ...(alert.reasons.length ? ["", "Why Kin is telling you:", ...alert.reasons.map((r) => `- ${r}`)] : []),
    "",
    "Open the Kin family dashboard for the full picture.",
  ].join("\n");

  console.log(`[kin] family alert (${alert.level}) for ${profile.preferredName}: ${alert.title}`);
  if (!sns) return "dashboard";
  try {
    await sns.send(
      new PublishCommand({
        TopicArn: config.snsTopicArn,
        Subject: `Kin: ${alert.title}`.slice(0, 99),
        Message: body,
      }),
    );
    return "sns";
  } catch (err) {
    console.error("[kin] SNS publish failed, alert kept on dashboard:", (err as Error).message);
    return "dashboard";
  }
}
