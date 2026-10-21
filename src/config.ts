import "dotenv/config";
import { DynamoStore } from "./store/dynamoStore.js";
import { FileStore } from "./store/fileStore.js";
import type { Store } from "./store/store.js";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  householdId: env.KIN_HOUSEHOLD_ID || "demo",
  mcpToken: env.KIN_MCP_TOKEN || "",
  llm: (env.KIN_LLM || "bedrock") as "bedrock" | "mock",
  region: env.AWS_REGION || "us-east-1",
  modelId: env.KIN_MODEL_ID || "us.amazon.nova-pro-v1:0",
  mcpUrl: env.KIN_MCP_URL || "",
  table: env.KIN_TABLE || "",
  snsTopicArn: env.KIN_SNS_TOPIC_ARN || "",
};

export function createStore(): Store {
  return config.table
    ? new DynamoStore(config.table, config.householdId, config.region)
    : new FileStore(config.householdId);
}
