import "dotenv/config";
import { DynamoStore } from "./store/dynamoStore.js";
import { FileStore } from "./store/fileStore.js";
import type { Store } from "./store/store.js";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  householdId: env.KIN_HOUSEHOLD_ID || "demo",
  mcpToken: env.KIN_MCP_TOKEN || "",
  /** The demo reset endpoint wipes the care record; turn it off on a public deployment */
  demoReset: env.KIN_DISABLE_DEMO_RESET !== "true",
  llm: (env.KIN_LLM || "bedrock") as "bedrock" | "anthropic" | "openai" | "mock",
  openaiBaseUrl: env.KIN_OPENAI_BASE_URL || "https://api.groq.com/openai/v1",
  openaiApiKey: env.KIN_OPENAI_API_KEY || "",
  openaiReasoning: env.KIN_OPENAI_REASONING || "",
  openaiModel: env.KIN_OPENAI_MODEL || "llama-3.3-70b-versatile",
  anthropicModel: env.KIN_ANTHROPIC_MODEL || "claude-sonnet-5-5",
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
