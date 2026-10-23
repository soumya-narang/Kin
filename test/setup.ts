// Tests must never reach cloud services, whatever the developer's .env says.
// dotenv does not override variables that are already set, even to an empty string.
process.env.KIN_SNS_TOPIC_ARN = "";
process.env.KIN_TABLE = "";
process.env.KIN_LLM = "mock";
