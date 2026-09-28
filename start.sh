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

PORT="${PORT:-41873}"

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
echo "后端健康检查：http://localhost:${PORT}/api/health"
exec env NODE_ENV=production PORT="$PORT" npm start
