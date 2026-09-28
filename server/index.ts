import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, type AuthenticatedFeishuUser } from "./mcp.js";

const app = express();
const port = Number(process.env.PORT ?? 41873);
const frontendUrl = process.env.FRONTEND_URL ?? `http://localhost:5173`;
// HTTP 局域网 Demo 必须关闭 Secure；切换到 HTTPS 域名时应设置 COOKIE_SECURE=true。
const secureCookies = process.env.COOKIE_SECURE === "true";
const feishuAuthorizeUrl = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const feishuTokenUrl = "https://accounts.feishu.cn/oauth/v3/token";
const feishuUserInfoUrl = "https://open.feishu.cn/open-apis/authen/v1/user_info";
const feishuTenantKey = process.env.FEISHU_TENANT_KEY;
// Demo 使用内存保存 session；服务重启后登录状态会失效，生产环境应换成 Redis。
const sessions = new Map<string, { user: FeishuUser; expiresAt: number }>();
// [2] state 用于把 OAuth 回调和本次登录请求绑定，防止 CSRF。
const states = new Map<string, number>();

type FeishuUser = {
  name?: string;
  en_name?: string;
  avatar_url?: string;
  open_id?: string;
  union_id?: string;
  tenant_key?: string;
  email?: string;
};

app.use(express.json());
app.use(cookieParser());

type LogFields = Record<string, boolean | number | string | undefined>;

function log(level: "info" | "warn" | "error", event: string, fields: LogFields = {}) {
  const entry = { time: new Date().toISOString(), level, event, ...fields };
  const output = JSON.stringify(entry);
  if (level === "error") console.error(output);
  else console.log(output);
}

// 每个请求分配 requestId，方便把 MCP 请求、飞书校验和最终响应串起来。
app.use((req, res, next) => {
  const requestId = crypto.randomBytes(8).toString("hex");
  const startedAt = Date.now();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => {
    log("info", "http.request.completed", {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
});

function mcpAuthError(res: Response, message: string, status = 401) {
  log(status >= 500 ? "error" : "warn", "mcp.auth.failed", {
    requestId: res.locals.requestId,
    status,
    reason: message
  });
  return res.status(status)
    .set("WWW-Authenticate", 'Bearer realm="mcp"')
    .json({ error: "mcp_authentication_failed", message });
}

// 豆包工作负责 OAuth；MCP Server 只验证它转发过来的 user_access_token。
async function authenticateMcp(req: Request, res: Response, next: express.NextFunction) {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  log("info", "mcp.auth.started", {
    requestId: res.locals.requestId,
    hasAuthorization: Boolean(authorization),
    bearerFormat: Boolean(match)
  });
  if (!match) return mcpAuthError(res, "Missing Authorization: Bearer <user_access_token> header.");

  try {
    const startedAt = Date.now();
    const userResponse = await fetch(feishuUserInfoUrl, {
      headers: { Authorization: `Bearer ${match[1]}` },
      signal: AbortSignal.timeout(10_000)
    });
    const userPayload = await userResponse.json() as { data?: AuthenticatedFeishuUser; msg?: string };
    const user = userPayload.data;
    log("info", "mcp.feishu.user_info.completed", {
      requestId: res.locals.requestId,
      status: userResponse.status,
      durationMs: Date.now() - startedAt,
      hasUser: Boolean(user),
      hasOpenId: Boolean(user?.open_id),
      tenantKey: user?.tenant_key
    });
    if (!userResponse.ok || !user?.open_id) {
      return mcpAuthError(res, "Feishu user_access_token is invalid or expired.");
    }
    if (feishuTenantKey && user.tenant_key !== feishuTenantKey) {
      log("warn", "mcp.auth.tenant_mismatch", {
        requestId: res.locals.requestId,
        userTenantKey: user.tenant_key,
        configuredTenantKey: feishuTenantKey
      });
      return mcpAuthError(res, "The Feishu user does not belong to the configured tenant.", 403);
    }
    res.locals.mcpUser = user;
    log("info", "mcp.auth.succeeded", {
      requestId: res.locals.requestId,
      openId: user.open_id,
      tenantKey: user.tenant_key
    });
    return next();
  } catch (error) {
    log("error", "mcp.feishu.user_info.failed", {
      requestId: res.locals.requestId,
      reason: error instanceof Error ? error.message : "unknown error"
    });
    return mcpAuthError(res, "Unable to verify the Feishu token.", 503);
  }
}

// MCP 客户端通过 Streamable HTTP 把 JSON-RPC 请求发送到这个端点。
app.post("/mcp", authenticateMcp, async (req, res) => {
  log("info", "mcp.request.started", {
    requestId: res.locals.requestId,
    rpcMethod: typeof req.body?.method === "string" ? req.body.method : "unknown",
    rpcId: typeof req.body?.id === "string" || typeof req.body?.id === "number" ? req.body.id : undefined,
    openId: res.locals.mcpUser?.open_id
  });
  const mcpServer = createMcpServer(res.locals.mcpUser as AuthenticatedFeishuUser);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  res.on("close", () => {
    void transport.close();
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log("error", "mcp.request.failed", {
      requestId: res.locals.requestId,
      reason: error instanceof Error ? error.message : "unknown error"
    });
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP request failed" });
    }
  }
});

// 当前 Demo 使用无状态 JSON 响应；不提供独立的 SSE GET 流。
app.get("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    error: "MCP endpoint accepts POST JSON-RPC requests only"
  });
});

function configError(res: Response) {
  return res.status(500).json({
    error: "server_not_configured",
    message: "请先在 .env 中配置 FEISHU_APP_ID、FEISHU_APP_SECRET 和 FEISHU_REDIRECT_URI。"
  });
}

function getSession(req: Request) {
  const id = req.cookies.oauth_session as string | undefined;
  const session = id ? sessions.get(id) : undefined;
  if (session && session.expiresAt > Date.now()) return session;
  if (id) sessions.delete(id);
  return undefined;
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// [1] 前端启动时调用这个接口，用 Cookie 判断用户是否已经登录。
app.get("/api/auth/session", (req, res) => {
  const session = getSession(req);
  res.json({ authenticated: Boolean(session), user: session?.user ?? null });
});

app.get("/api/auth/feishu", (_req, res) => {
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET || !process.env.FEISHU_REDIRECT_URI) {
    log("error", "oauth.config.missing", { requestId: res.locals.requestId });
    return configError(res);
  }
  // [2] 每次登录都生成一次性 state，并设置 10 分钟有效期。
  const state = crypto.randomBytes(24).toString("hex");
  states.set(state, Date.now() + 10 * 60 * 1000);
  const url = new URL(feishuAuthorizeUrl);
  url.searchParams.set("client_id", process.env.FEISHU_APP_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", process.env.FEISHU_REDIRECT_URI);
  url.searchParams.set("state", state);
  log("info", "oauth.authorize.redirect", {
    requestId: res.locals.requestId,
    redirectUri: process.env.FEISHU_REDIRECT_URI
  });
  return res.redirect(url.toString());
});

app.get("/api/auth/feishu/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  const stateExpiry = state ? states.get(state) : undefined;
  log("info", "oauth.callback.received", {
    requestId: res.locals.requestId,
    hasCode: Boolean(code),
    hasState: Boolean(state)
  });
  // [3] 飞书回调必须同时带回有效 code 和原始 state。
  if (!code || !state || !stateExpiry || stateExpiry < Date.now()) {
    return res.status(400).send("OAuth state 或授权 code 无效，请重新发起登录。");
  }
  states.delete(state);
  try {
    // [4] 服务端用一次性授权码换取 user_access_token，App Secret 不会暴露给前端。
    const tokenStartedAt = Date.now();
    const tokenResponse = await fetch(feishuTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: process.env.FEISHU_APP_ID,
        client_secret: process.env.FEISHU_APP_SECRET,
        redirect_uri: process.env.FEISHU_REDIRECT_URI
      })
    });
    log("info", "oauth.token.completed", {
      requestId: res.locals.requestId,
      status: tokenResponse.status,
      durationMs: Date.now() - tokenStartedAt
    });
    const tokenPayload = await tokenResponse.json() as {
      code?: number;
      msg?: string;
      error_description?: string;
      access_token?: string;
      data?: { access_token?: string };
    };
    const accessToken = tokenPayload.access_token ?? tokenPayload.data?.access_token;
    if (!tokenResponse.ok || !accessToken) {
      throw new Error(tokenPayload.msg ?? tokenPayload.error_description ?? "获取 Feishu access token 失败");
    }
    // [5] 再用 user_access_token 查询当前授权用户的基本身份信息。
    const userStartedAt = Date.now();
    const userResponse = await fetch(feishuUserInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const userPayload = await userResponse.json() as { data?: FeishuUser; msg?: string };
    log("info", "oauth.user_info.completed", {
      requestId: res.locals.requestId,
      status: userResponse.status,
      durationMs: Date.now() - userStartedAt,
      openId: userPayload.data?.open_id
    });
    if (!userResponse.ok || !userPayload.data) throw new Error(userPayload.msg ?? "获取 Feishu 用户信息失败");
    // [6] 不把 Feishu token 放到浏览器，服务端只下发随机 session id 的 HttpOnly Cookie。
    const sessionId = crypto.randomBytes(32).toString("hex");
    sessions.set(sessionId, { user: userPayload.data, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
    res.cookie("oauth_session", sessionId, { httpOnly: true, sameSite: "lax", secure: secureCookies, maxAge: 8 * 60 * 60 * 1000 });
    log("info", "oauth.session.created", {
      requestId: res.locals.requestId,
      openId: userPayload.data.open_id,
      secureCookie: secureCookies
    });
    return res.redirect(`${frontendUrl}/?login=success`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth 登录失败";
    log("error", "oauth.callback.failed", {
      requestId: res.locals.requestId,
      reason: message
    });
    return res.redirect(`${frontendUrl}/?error=${encodeURIComponent(message)}`);
  }
});

// [7] 注销时同时删除服务端 session 和浏览器 Cookie。
app.post("/api/auth/logout", (req, res) => {
  const id = req.cookies.oauth_session as string | undefined;
  if (id) sessions.delete(id);
  res.clearCookie("oauth_session");
  res.status(204).end();
});

if (process.env.NODE_ENV === "production") {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  // 生产环境由 Express 同时提供 Vite 构建后的静态前端和 API。
  app.use(express.static(path.resolve(currentDir, "../dist")));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.resolve(currentDir, "../dist/index.html")));
}

app.listen(port, () => log("info", "server.started", {
  port,
  nodeEnv: process.env.NODE_ENV ?? "development",
  mcpPath: "/mcp",
  tenantValidation: Boolean(feishuTenantKey)
}));
