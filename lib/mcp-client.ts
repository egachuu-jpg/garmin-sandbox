import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Singleton map — persists across requests within the same Node.js process
const clients = new Map<string, Client>();

const MCP_SERVERS = [
  {
    id: 'taxuspt',
    // Installed from git into a venv (see nixpacks.toml). PYTHON_BIN points at
    // that venv's interpreter in production; falls back to system python locally.
    // This is the only Garmin MCP: 110+ tools (health reads + workout writes).
    // The Node @nicolasvegam MCP was dropped — it uses garth OAuth1/OAuth2 tokens,
    // incompatible with this lib's DI-OAuth2 tokens, so it couldn't share auth.
    command: process.env.PYTHON_BIN || 'python',
    args: ['-m', 'garmin_mcp'],
  },
] as const;

async function getClient(server: (typeof MCP_SERVERS)[number]): Promise<Client | null> {
  if (clients.has(server.id)) return clients.get(server.id)!;

  try {
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
      ),
      GARMIN_EMAIL: process.env.GARMIN_EMAIL!,
      GARMIN_PASSWORD: process.env.GARMIN_PASSWORD!,
    };

    const transport = new StdioClientTransport({
      command: server.command,
      args: [...server.args],
      env,
    });

    const client = new Client(
      { name: `coach-${server.id}`, version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    clients.set(server.id, client);
    console.log(`[MCP] Connected: ${server.id}`);
    return client;
  } catch (err) {
    console.error(`[MCP] Failed to connect to ${server.id}:`, err);
    return null;
  }
}

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: object;
};

export async function getAllTools(): Promise<AnthropicTool[]> {
  const tools: AnthropicTool[] = [];

  for (const server of MCP_SERVERS) {
    const client = await getClient(server);
    if (!client) continue;

    try {
      const { tools: mcpTools } = await client.listTools();
      for (const tool of mcpTools) {
        tools.push({
          name: `${server.id}__${tool.name}`,
          description: tool.description ?? '',
          input_schema: tool.inputSchema as object,
        });
      }
    } catch (err) {
      console.error(`[MCP] Failed to list tools for ${server.id}:`, err);
    }
  }

  return tools;
}

export async function executeTool(
  fullName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const sep = fullName.indexOf('__');
  if (sep === -1) throw new Error(`Invalid tool name: ${fullName}`);

  const serverId = fullName.slice(0, sep);
  const toolName = fullName.slice(sep + 2);

  const server = MCP_SERVERS.find(s => s.id === serverId);
  if (!server) throw new Error(`Unknown MCP server: ${serverId}`);

  const client = await getClient(server);
  if (!client) throw new Error(`MCP server ${serverId} is not available`);

  const result = await client.callTool({ name: toolName, arguments: input });
  return result.content;
}
