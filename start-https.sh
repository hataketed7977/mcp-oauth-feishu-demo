#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v caddy >/dev/null 2>&1; then
  echo "错误：未找到 Caddy，请先安装 Caddy 2。" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "错误：未找到 .env，请先执行：cp .env.example .env" >&2
  exit 1
fi

set -a
source .env
set +a

if [[ -z "${CADDY_DOMAIN:-}" ]]; then
  echo "错误：请在 .env 中配置 CADDY_DOMAIN，例如 oauth.example.com" >&2
  exit 1
fi

if [[ "${CADDY_DOMAIN}" == *"10.37.70.152"* || "${CADDY_DOMAIN}" == "localhost" ]]; then
  echo "错误：CADDY_DOMAIN 应该是解析到本机的域名，不要填 IP 或 localhost。" >&2
  exit 1
fi

caddy validate --config "$ROOT_DIR/Caddyfile" --adapter caddyfile

START_HTTPS=1 ./start.sh &
backend_pid=$!

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "HTTPS 地址：https://${CADDY_DOMAIN}"
echo "MCP 地址：https://${CADDY_DOMAIN}/mcp"
echo "飞书 OAuth 回调：https://${CADDY_DOMAIN}/api/auth/feishu/callback"

caddy run --config "$ROOT_DIR/Caddyfile" --adapter caddyfile
