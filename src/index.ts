import { randomUUID } from "node:crypto";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { KinAgent, type Speaker } from "./agent/agent.js";
import { KinMcpClient } from "./agent/mcpClient.js";
import { messageParent, takeDueSpeech } from "./care/conversation.js";
import { currentInsights, requireProfile } from "./care/engine.js";
import { config, createStore } from "./config.js";
import { buildMcpServer } from "./mcp/server.js";
import { seed } from "./seed.js";

const store = createStore();
if (!(await store.getProfile())) {
  await seed(store);
  console.log("[kin] no household found, loaded the demo household");
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- MCP server (Streamable HTTP, stateless) ----------

function requireMcpToken(req: Request, res: Response, next: NextFunction) {
  if (!config.mcpToken || req.headers.authorization === `Bearer ${config.mcpToken}`) return next();
  res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
}

app.post("/mcp", requireMcpToken, async (req, res) => {
  const server = buildMcpServer(store);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[kin] MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

const methodNotAllowed = (_req: Request, res: Response) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// ---------- Voice agent (simulated Alexa+) ----------

/** Spoken turns are short; this keeps a stray request from running up model costs */
const MAX_UTTERANCE_CHARS = 1000;

const mcp = new KinMcpClient(config.mcpUrl || `http://127.0.0.1:${config.port}/mcp`);
const agent = new KinAgent(mcp);

app.post("/api/talk", async (req, res) => {
  const { text, sessionId, speaker } = req.body as { text?: string; sessionId?: string; speaker?: Speaker };
  if (!text?.trim()) return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_UTTERANCE_CHARS) return res.status(413).json({ error: `text is limited to ${MAX_UTTERANCE_CHARS} characters` });
  const started = Date.now();
  try {
    const result = await agent.turn(sessionId || randomUUID(), speaker === "family" ? "family" : "parent", text.trim());
    res.json({ ...result, ms: Date.now() - started });
  } catch (err) {
    console.error("[kin] agent turn failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * What Kin should say on its own right now: messages from the family, due
 * reminders, or a check-in. The speaker polls this between conversations.
 */
app.get("/api/parent/due", async (_req, res) => {
  res.json({ items: await takeDueSpeech(store) });
});

// ---------- Family dashboard ----------

app.get("/api/family/overview", async (_req, res) => {
  const [profile, insights, alerts, reminders, logs, messages] = await Promise.all([
    requireProfile(store),
    currentInsights(store),
    store.listAlerts(),
    store.listReminders(),
    store.listLogs(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()),
    store.listMessages(),
  ]);
  res.json({
    profile,
    insights,
    alerts: alerts.slice(0, 20),
    reminders: reminders.filter((r) => r.status === "scheduled"),
    recent: logs.slice(-40).reverse(),
    messages: messages.slice(-30),
  });
});

const MAX_MESSAGE_CHARS = 500;

app.post("/api/family/messages", async (req, res) => {
  const { text, from } = req.body as { text?: string; from?: string };
  if (!text?.trim()) return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_MESSAGE_CHARS) return res.status(413).json({ error: `messages are limited to ${MAX_MESSAGE_CHARS} characters` });
  const profile = await requireProfile(store);
  const author = profile.family.find((f) => f.name === from)?.name ?? profile.family[0]?.name ?? "Your family";
  res.json({ message: await messageParent(store, author, text.trim()) });
});

app.post("/api/family/alerts/:id/ack", async (req, res) => {
  const alert = (await store.listAlerts()).find((a) => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: "not found" });
  await store.updateAlert({ ...alert, acknowledged: true });
  res.json({ ok: true });
});

app.get("/api/family/digest", async (_req, res) => {
  try {
    res.json({ digest: await agent.familyDigest() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Demo only: has Kin start a check-in on the speaker now instead of waiting for the morning. */
app.post("/api/demo/checkin", async (_req, res) => {
  if (!config.demoReset) return res.status(403).json({ error: "demo tools are disabled on this deployment" });
  const profile = await requireProfile(store);
  const now = new Date().toISOString();
  const message = `Hello ${profile.preferredName}, I haven't heard from you in a little while. How are you feeling?`;
  await store.addReminder({ id: `checkin:demo:${now}`, createdAt: now, dueAt: now, message, status: "scheduled" });
  res.json({ ok: true });
});

app.post("/api/demo/reset", async (_req, res) => {
  if (!config.demoReset) return res.status(403).json({ error: "demo reset is disabled on this deployment" });
  await seed(store);
  res.json({ ok: true });
});

app.get("/healthz", (_req, res) => res.json({ ok: true, llm: config.llm, model: config.modelId, storage: config.table ? "dynamodb" : "file" }));

app.use(express.static(path.resolve("public")));

app.listen(config.port, () => {
  console.log(`[kin] listening on http://localhost:${config.port}`);
  console.log(`[kin]   start here:                http://localhost:${config.port}/`);
  console.log(`[kin]   parent (simulated Alexa+): http://localhost:${config.port}/speaker.html`);
  console.log(`[kin]   family dashboard:          http://localhost:${config.port}/family.html`);
  console.log(`[kin]   MCP endpoint:              http://localhost:${config.port}/mcp`);
  console.log(`[kin]   agent: ${config.llm === "mock" ? "mock (no AWS)" : `Bedrock ${config.modelId}`}, storage: ${config.table ? `DynamoDB ${config.table}` : "local file"}`);
});
