import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type AuthenticatedFeishuUser = {
  name?: string;
  en_name?: string;
  avatar_url?: string;
  open_id: string;
  union_id?: string;
  tenant_key?: string;
  email?: string;
};

export function createMcpServer(user: AuthenticatedFeishuUser) {
  const server = new McpServer({
    name: "mcp-oauth-feishu-demo",
    version: "0.1.0"
  });

  server.registerTool(
    "feishu_get_current_user",
    {
      title: "Get Current Feishu User",
      description: "Return the Feishu identity verified from the Bearer token sent by the MCP client.",
      inputSchema: {},
      outputSchema: {
        open_id: z.string(),
        name: z.string().optional(),
        email: z.string().optional(),
        tenant_key: z.string().optional()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const output = {
        open_id: user.open_id,
        ...(user.name ? { name: user.name } : {}),
        ...(user.email ? { email: user.email } : {}),
        ...(user.tenant_key ? { tenant_key: user.tenant_key } : {})
      };
      return {
        content: [{
          type: "text",
          text: JSON.stringify(output, null, 2)
        }],
        structuredContent: output,
      };
    }
  );

  return server;
}
