import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "../config.js";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** The voice agent reaches Kin's memory only through MCP, the same way Alexa+ would. */
export class KinMcpClient {
  private client?: Client;
  private tools?: McpTool[];

  constructor(private url: string) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: "kin-voice-agent", version: "0.1.0" });
    const headers: Record<string, string> = config.mcpToken ? { Authorization: `Bearer ${config.mcpToken}` } : {};
    await client.connect(new StreamableHTTPClientTransport(new URL(this.url), { requestInit: { headers } }));
    this.client = client;
    return client;
  }

  async listTools(): Promise<McpTool[]> {
    if (this.tools) return this.tools;
    const client = await this.connect();
    const { tools } = await client.listTools();
    this.tools = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    return this.tools;
  }

  /** Calls a tool and returns its structured result (or text if there is none). */
  async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const client = await this.connect();
    try {
      const res = await client.callTool({ name, arguments: args });
      if (res.isError) return { error: textOf(res) };
      return res.structuredContent ?? textOf(res);
    } catch (err) {
      // Reconnect once if the server restarted
      this.client = undefined;
      throw err;
    }
  }
}

function textOf(res: any): string {
  return (res.content ?? []).map((c: any) => c.text ?? "").join("\n");
}
