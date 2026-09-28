import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function isFeishuDocUrl(value: string) {
  const url = new URL(value);
  return url.protocol === "https:" &&
    url.hostname === "feishu.doubao.com" &&
    /^\/docx\/[^/]+$/.test(url.pathname);
}

export function createMcpServer() {
  const server = new McpServer({
    name: "mcp-oauth-feishu-demo",
    version: "0.1.0"
  });

  server.registerTool(
    "feishu_validate_document_url",
    {
      title: "Validate Feishu Document URL",
      description: "Validate that a URL matches the supported https://feishu.doubao.com/docx/<token> format.",
      inputSchema: {
        url: z.string().url().describe("Feishu document URL to validate")
      },
      outputSchema: {
        url: z.string(),
        valid: z.boolean()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ url }) => {
      const valid = isFeishuDocUrl(url);
      const output = { url, valid };
      return {
        content: [{
          type: "text",
          text: valid
            ? `Valid Feishu document URL: ${url}`
            : "Invalid URL. Expected https://feishu.doubao.com/docx/<token>."
        }],
        structuredContent: output,
        isError: !valid
      };
    }
  );

  return server;
}
