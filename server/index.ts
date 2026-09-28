import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";

const app = express();
const port = Number(process.env.PORT ?? 41873);
const frontendUrl = process.env.FRONTEND_URL ?? `http://localhost:5173`;
const feishuAuthorizeUrl = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const feishuTokenUrl = "https://accounts.feishu.cn/oauth/v3/token";
const feishuUserInfoUrl = "https://open.feishu.cn/open-apis/authen/v1/user_info";
// 教程示例使用内存保存 session；服务重启后登录状态会失效，生产环境应换成 Redis。
const sessions = new Map<string, { user: FeishuUser; expiresAt: number }>();
// state 用于把 OAuth 回调和本次登录请求绑定，防止 CSRF。
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

// 前端启动时调用这个接口，用 Cookie 判断用户是否已经登录。
app.get("/api/auth/session", (req, res) => {
  const session = getSession(req);
  res.json({ authenticated: Boolean(session), user: session?.user ?? null });
});

app.get("/api/auth/feishu", (_req, res) => {
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET || !process.env.FEISHU_REDIRECT_URI) {
    return configError(res);
  }
  // 每次登录都生成一次性 state，并设置 10 分钟有效期。
  const state = crypto.randomBytes(24).toString("hex");
  states.set(state, Date.now() + 10 * 60 * 1000);
  const url = new URL(feishuAuthorizeUrl);
  url.searchParams.set("client_id", process.env.FEISHU_APP_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", process.env.FEISHU_REDIRECT_URI);
  url.searchParams.set("state", state);
  return res.redirect(url.toString());
});

app.get("/api/auth/feishu/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  const stateExpiry = state ? states.get(state) : undefined;
  // 飞书回调必须同时带回有效 code 和原始 state。
  if (!code || !state || !stateExpiry || stateExpiry < Date.now()) {
    return res.status(400).send("OAuth state 或授权 code 无效，请重新发起登录。");
  }
  states.delete(state);
  try {
    // 服务端用一次性授权码换取 user_access_token，App Secret 不会暴露给前端。
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
    // 再用 user_access_token 查询当前授权用户的基本身份信息。
    const userResponse = await fetch(feishuUserInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const userPayload = await userResponse.json() as { data?: FeishuUser; msg?: string };
    if (!userResponse.ok || !userPayload.data) throw new Error(userPayload.msg ?? "获取 Feishu 用户信息失败");
    // 不把 Feishu token 放到浏览器，服务端只下发随机 session id 的 HttpOnly Cookie。
    const sessionId = crypto.randomBytes(32).toString("hex");
    sessions.set(sessionId, { user: userPayload.data, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
    res.cookie("oauth_session", sessionId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 });
    return res.redirect(`${frontendUrl}/?login=success`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth 登录失败";
    return res.redirect(`${frontendUrl}/?error=${encodeURIComponent(message)}`);
  }
});

// 注销时同时删除服务端 session 和浏览器 Cookie。
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

app.listen(port, () => console.log(`OAuth test server listening on http://localhost:${port}`));
