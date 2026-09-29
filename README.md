# MCP OAuth / Feishu Login Lab

一个用于验证 Feishu OAuth 2.0 授权码登录的前后端最小工程。后端负责 state 校验、授权码换 token、用户信息查询和 HttpOnly session；前端提供登录状态展示。

## 启动

```bash
npm install
cp .env.example .env
# 填入飞书应用的 FEISHU_APP_ID 和 FEISHU_APP_SECRET
npm run dev
```

开发模式打开 http://localhost:41872。飞书应用后台的重定向 URL 需要配置为：

`http://localhost:41873/api/auth/feishu/callback`

需要给应用开通用户身份读取权限，并确保应用的 OAuth 回调域名与本地配置一致。

## 直接部署到开发机

不使用 Docker 或 Kubernetes 时，可以直接运行生产构建：

```bash
npm ci
cp .env.example .env
# 修改 .env：
# ACCESS_HOST=localhost
# HTTPS_ENABLED=false
npm run build
NODE_ENV=production npm start
```

此时访问 `http://localhost:41873`。飞书后台的回调地址也配置为：

`http://localhost:41873/api/auth/feishu/callback`

如果需要让其他机器访问，使用 `HTTPS_ENABLED=true`，并将 `ACCESS_HOST`
设置为解析到开发机的域名或局域网 IP。启动脚本会根据这两个配置自动生成
前端地址和 OAuth 回调地址。

### 使用 Caddy 提供 HTTPS

Caddy 配置在 [`Caddyfile`](./Caddyfile)。准备一个解析到开发机的域名，例如
`oauth.example.com`，并确保防火墙允许 TCP `80` 和 `443`。在 `.env` 中配置：

```env
ACCESS_HOST=oauth.example.com
HTTPS_ENABLED=true
```

然后启动：

```bash
sudo ./start.sh
```

脚本会启动 Node 后端和 Caddy。Caddy 自动申请和续期证书，Node 只监听本机
`41873`，外部只使用：

```text
https://oauth.example.com/mcp
```

脚本会自动将 OAuth 回调设置为：

```text
https://oauth.example.com/api/auth/feishu/callback
```

飞书后台和豆包 MCP 配置必须使用完全相同的 HTTPS 地址。若只在局域网用 IP
测试，可参考 [`Caddyfile.lan.example`](./Caddyfile.lan.example)，但
`tls internal` 证书需要在客户端安装并信任 Caddy 根证书，豆包环境通常不会信任，
因此公网 HTTPS 域名更适合正式接入。

局域网 IP 测试只需要配置：

```env
ACCESS_HOST=10.37.70.152
HTTPS_ENABLED=true
```

然后仍然执行：

```bash
sudo ./start.sh
```

此时地址为 `https://10.37.70.152/mcp`。`./start.sh` 不会启动 Caddy，
仍然是本机 HTTP 模式。

公网域名模式只需要把 `ACCESS_HOST` 改成域名，并保持 `HTTPS_ENABLED=true`，
Caddy 会使用公网自动证书模式。

`start.sh` 是唯一启动脚本，默认读取 `.env` 并启动本地 HTTP。启用 HTTPS
时只需要修改 `HTTPS_ENABLED=true` 和 `ACCESS_HOST`。

启用 Caddy HTTPS 后，`BACKEND_PORT` 是 Node 的内部端口，Caddy 对外使用
标准 HTTPS `443`，因此地址中的 `:443` 会被省略。例如：

```text
Node 内部：http://127.0.0.1:41873
外部访问：https://localhost
```

也可以直接使用启动脚本：

```bash
chmod +x start.sh
./start.sh
```

启动脚本会同时把日志输出到终端和 `logs/mcp-oauth.log`，查看实时日志：

```bash
tail -f logs/mcp-oauth.log
```

## 接口

- `GET /api/auth/feishu` 发起登录
- `GET /api/auth/feishu/callback` 处理回调并创建 session
- `GET /api/auth/session` 查询当前登录用户
- `POST /api/auth/logout` 注销当前 session
- `GET /api/health` 健康检查

## MCP 端点

服务同时提供 Streamable HTTP MCP 端点：

`http://10.37.70.152:41873/mcp`

按照飞书文档中的架构，豆包工作负责 OAuth 2.0，MCP Server 不负责授权页和 code 换 token。豆包工作调用 MCP 时必须携带：

```http
Authorization: Bearer <feishu_user_access_token>
```

MCP Server 收到请求后，会调用：

`GET https://open.feishu.cn/open-apis/authen/v1/user_info`

验证 token，检查 `open_id`，如果配置了 `FEISHU_TENANT_KEY` 还会校验租户；未认证请求返回 401，不会跳转前端登录页。

当前 MCP Demo 提供：

- `feishu_get_current_user`：返回经过飞书 `user_info` 验证的当前用户身份

豆包工作插件中的 OAuth 参数使用飞书固定端点：

- Authorize：`https://accounts.feishu.cn/open-apis/authen/v1/authorize`
- Token：`https://accounts.feishu.cn/oauth/v3/token`
- UserInfo：`https://open.feishu.cn/open-apis/authen/v1/user_info`

该端点使用标准 MCP Streamable HTTP，不是普通的业务 JSON API。实际读取飞书文档内容还需要接入飞书文档 API 和用户授权 token。

### MCP 排查日志

服务会输出 JSON 格式日志，可按 `requestId` 串联一次请求：

- `mcp.auth.started`：是否收到 Authorization 请求头
- `mcp.feishu.user_info.completed`：飞书身份校验的 HTTP 状态和耗时
- `mcp.auth.succeeded`：身份校验成功
- `mcp.auth.failed`：缺少 token、token 无效或租户校验失败
- `mcp.request.started` / `mcp.request.failed`：MCP JSON-RPC 请求处理状态

日志不会输出 access token、App Secret 或 Cookie。

当前 session 存储在内存中，仅适合本地测试。生产环境应替换为 Redis 或数据库，并使用 HTTPS。

## Docker

构建并启动：

```bash
docker build -t mcp-oauth-feishu-test:0.1.0 .
docker run --rm -p 41873:41873 \
  -e FEISHU_APP_ID=cli_xxx \
  -e FEISHU_APP_SECRET=xxx \
  -e FEISHU_REDIRECT_URI=http://localhost:41873/api/auth/feishu/callback \
  -e FRONTEND_URL=http://localhost:41873 \
  mcp-oauth-feishu-test:0.1.0
```

容器模式下前端和后端由同一个 Express 进程提供，访问 `http://localhost:41873`。
