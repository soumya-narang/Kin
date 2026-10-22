import { randomUUID } from "node:crypto";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { KinAgent, type Speaker } from "./agent/agent.js";
import { KinMcpClient } from "./agent/mcpClient.js";
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

/** Reminders that are due now; the voice UI polls this and speaks them unprompted. */
app.get("/api/parent/due", async (_req, res) => {
  const now = new Date().toISOString();
  const due = (await store.listReminders()).filter((r) => r.status === "scheduled" && r.dueAt <= now);
  for (const r of due) await store.updateReminder({ ...r, status: "delivered" });
  res.json({ reminders: due.map((r) => r.message) });
});

// ---------- Family dashboard ----------

app.get("/api/family/overview", async (_req, res) => {
  const [profile, insights, alerts, reminders, logs] = await Promise.all([
    requireProfile(store),
    currentInsights(store),
    store.listAlerts(),
    store.listReminders(),
    store.listLogs(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()),
  ]);
  res.json({
    profile,
    insights,
    alerts: alerts.slice(0, 20),
    reminders: reminders.filter((r) => r.status === "scheduled"),
    recent: logs.slice(-25).reverse(),
  });
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

app.post("/api/demo/reset", async (_req, res) => {
  if (!config.demoReset) return res.status(403).json({ error: "demo reset is disabled on this deployment" });
  await seed(store);
  res.json({ ok: true });
});

app.get("/healthz", (_req, res) => res.json({ ok: true, llm: config.llm, model: config.modelId, storage: config.table ? "dynamodb" : "file" }));

app.use(express.static(path.resolve("public")));

app.listen(config.port, () => {
  console.log(`[kin] listening on http://localhost:${config.port}`);
  console.log(`[kin]   parent (simulated Alexa+): http://localhost:${config.port}/`);
  console.log(`[kin]   family dashboard:          http://localhost:${config.port}/family.html`);
  console.log(`[kin]   MCP endpoint:              http://localhost:${config.port}/mcp`);
  console.log(`[kin]   agent: ${config.llm === "mock" ? "mock (no AWS)" : `Bedrock ${config.modelId}`}, storage: ${config.table ? `DynamoDB ${config.table}` : "local file"}`);
});
