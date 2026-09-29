#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js，请先安装 Node.js 22 或更高版本。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "错误：未找到 npm，请先安装 npm。" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "错误：未找到 .env，请先执行：cp .env.example .env" >&2
  exit 1
fi

set -a
source .env
set +a

BACKEND_PORT="${BACKEND_PORT:-41873}"
FRONTEND_PORT="${FRONTEND_PORT:-41872}"
export BACKEND_PORT FRONTEND_PORT
HTTPS_ENABLED="${HTTPS_ENABLED:-false}"
ACCESS_HOST="${ACCESS_HOST:-localhost}"
if ! command -v caddy >/dev/null 2>&1; then
  echo "错误：启动脚本需要 Caddy，请先安装 Caddy。" >&2
  exit 1
fi

export CADDY_DOMAIN="$ACCESS_HOST"
export FRONTEND_PORT
if [[ "$HTTPS_ENABLED" == "true" ]]; then
  export FRONTEND_URL="https://${ACCESS_HOST}"
  export FEISHU_REDIRECT_URI="https://${ACCESS_HOST}/api/auth/feishu/callback"
  export COOKIE_SECURE=true
  if [[ "$ACCESS_HOST" =~ ^[0-9.]+$ || "$ACCESS_HOST" == "localhost" ]]; then
    CADDY_CONFIG="$ROOT_DIR/Caddyfile.lan.example"
    export FRONTEND_URL="https://${ACCESS_HOST}:${FRONTEND_PORT}"
    export FEISHU_REDIRECT_URI="${FRONTEND_URL}/api/auth/feishu/callback"
  else
    CADDY_CONFIG="$ROOT_DIR/Caddyfile"
  fi
else
  CADDY_CONFIG="$ROOT_DIR/Caddyfile.http.example"
  export FRONTEND_URL="http://${ACCESS_HOST}:${FRONTEND_PORT}"
  export FEISHU_REDIRECT_URI="${FRONTEND_URL}/api/auth/feishu/callback"
  export COOKIE_SECURE=false
fi

LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_DIR/mcp-oauth.log") 2>&1

existing_pids="$(lsof -tiTCP:"$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$existing_pids" ]]; then
  echo "发现后端端口 ${BACKEND_PORT} 已被占用，正在停止旧进程..."
  kill $existing_pids 2>/dev/null || true

  for _ in {1..20}; do
    if ! lsof -tiTCP:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done

  remaining_pids="$(lsof -tiTCP:"$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$remaining_pids" ]]; then
    echo "旧进程未退出，正在强制停止..."
    kill -9 $remaining_pids 2>/dev/null || true
  fi
fi

if [[ ! -d node_modules || ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  echo "正在同步 npm 依赖..."
  npm ci
fi

echo "正在构建生产版本..."
npm run build

FRONTEND_ADDRESS="${FRONTEND_URL:-http://${ACCESS_HOST}:${BACKEND_PORT}}"
echo "前端地址：${FRONTEND_ADDRESS}"
echo "MCP 地址：${FRONTEND_ADDRESS}/mcp"
echo "后端健康检查：${FRONTEND_ADDRESS}/api/health"
echo "Node 后端监听端口：${BACKEND_PORT}"
caddy validate --config "$CADDY_CONFIG" --adapter caddyfile
env NODE_ENV=production BACKEND_PORT="$BACKEND_PORT" npm start &
backend_pid=$!
cleanup() {
  kill "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
echo "Caddy 配置：${CADDY_CONFIG}"
echo "Node 后端地址：http://127.0.0.1:${BACKEND_PORT}"
echo "前端入口端口：${FRONTEND_PORT}"
exec caddy run --config "$CADDY_CONFIG" --adapter caddyfile
