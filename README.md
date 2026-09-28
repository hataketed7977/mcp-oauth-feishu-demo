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
# FRONTEND_URL=http://localhost:41873
# FEISHU_REDIRECT_URI=http://localhost:41873/api/auth/feishu/callback
npm run build
NODE_ENV=production npm start
```

此时访问 `http://localhost:41873`。飞书后台的回调地址也配置为：

`http://localhost:41873/api/auth/feishu/callback`

如果需要让其他机器访问，建议给开发机配置一个 HTTPS 域名，并将 `.env` 改为同源地址：

```env
FRONTEND_URL=https://oauth.example.com
FEISHU_REDIRECT_URI=https://oauth.example.com/api/auth/feishu/callback
```

然后用 Caddy、Nginx 或现有网关将 `oauth.example.com` 反向代理到 `127.0.0.1:41873`。OAuth 回调地址必须与飞书后台配置完全一致。

也可以直接使用启动脚本：

```bash
chmod +x start.sh
./start.sh
```

## 接口

- `GET /api/auth/feishu` 发起登录
- `GET /api/auth/feishu/callback` 处理回调并创建 session
- `GET /api/auth/session` 查询当前登录用户
- `POST /api/auth/logout` 注销当前 session
- `GET /api/health` 健康检查

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
