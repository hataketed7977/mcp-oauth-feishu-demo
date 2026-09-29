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

if [[ "${CADDY_ENABLED:-false}" == "true" ]] && ! command -v caddy >/dev/null 2>&1; then
  echo "错误：CADDY_ENABLED=true，但未找到 Caddy，请先安装 Caddy，或设置 CADDY_ENABLED=false。" >&2
  exit 1
fi

CADDY_ENABLED="${CADDY_ENABLED:-false}"
CADDY_LAN="${CADDY_LAN:-false}"
if [[ "$CADDY_ENABLED" == "true" ]]; then
  if [[ "$CADDY_LAN" == "true" || -z "${CADDY_DOMAIN:-}" || "${CADDY_DOMAIN:-}" =~ ^[0-9.]+$ ]]; then
    CADDY_DOMAIN="${CADDY_DOMAIN:-10.37.70.152}"
    CADDY_CONFIG="$ROOT_DIR/Caddyfile.lan.example"
  else
    CADDY_CONFIG="$ROOT_DIR/Caddyfile"
  fi
  export CADDY_DOMAIN
  if [[ "${FRONTEND_URL:-}" != https://* || "${FEISHU_REDIRECT_URI:-}" != https://* || "${COOKIE_SECURE:-false}" != "true" ]]; then
    echo "错误：启用 Caddy HTTPS 时，请在 .env 中配置 FRONTEND_URL、FEISHU_REDIRECT_URI 为 https://，并设置 COOKIE_SECURE=true。" >&2
    exit 1
  fi
fi

PORT="${PORT:-41873}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_DIR/mcp-oauth.log") 2>&1

existing_pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$existing_pids" ]]; then
  echo "发现端口 ${PORT} 已被占用，正在停止旧进程..."
  kill $existing_pids 2>/dev/null || true

  for _ in {1..20}; do
    if ! lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done

  remaining_pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
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

FRONTEND_ADDRESS="${FRONTEND_URL:-http://localhost:${PORT}}"
echo "前端地址：${FRONTEND_ADDRESS}"
echo "MCP 地址：${FRONTEND_ADDRESS}/mcp"
echo "后端健康检查：${FRONTEND_ADDRESS}/api/health"

if [[ "$CADDY_ENABLED" == "true" ]]; then
  caddy validate --config "$CADDY_CONFIG" --adapter caddyfile
  env NODE_ENV=production PORT="$PORT" npm start &
  backend_pid=$!
  cleanup() {
    kill "$backend_pid" 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM
  echo "Caddy 配置：${CADDY_CONFIG}"
  echo "HTTPS MCP 地址：${FRONTEND_ADDRESS}/mcp"
  exec caddy run --config "$CADDY_CONFIG" --adapter caddyfile
else
  exec env NODE_ENV=production PORT="$PORT" npm start
fi
