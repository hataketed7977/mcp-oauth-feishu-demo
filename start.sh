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

if [[ ! -d node_modules ]]; then
  echo "首次启动，正在安装依赖..."
  npm ci
fi

echo "正在构建生产版本..."
npm run build

echo "服务启动：http://localhost:${PORT:-3000}"
exec env NODE_ENV=production npm start
