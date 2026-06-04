#!/usr/bin/env bash
# 首次克隆本仓库后：检查环境 + 构建 AutoOffice CLI
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export ECOSYSTEM_ROOT="${ECOSYSTEM_ROOT:-$(dirname "$ROOT")}"
export KNOWLEVER_ROOT="${KNOWLEVER_ROOT:-$ECOSYSTEM_ROOT/KnowLever}"
export AUTOOFFICE_DIR="${AUTOOFFICE_DIR:-$ECOSYSTEM_ROOT/AutoOffice}"

echo "ECOSYSTEM_ROOT=$ECOSYSTEM_ROOT"
echo "KNOWLEVER_ROOT=$KNOWLEVER_ROOT"
echo "AUTOOFFICE_DIR=$AUTOOFFICE_DIR"

if [[ -d "$AUTOOFFICE_DIR" ]]; then
  (cd "$AUTOOFFICE_DIR" && npm install && npm run build)
fi

echo ""
echo "Next:"
echo "  npm run compile -- --topic demo-parity"
echo "  npm run home"
