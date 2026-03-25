#!/usr/bin/env bash
# Start uvicorn; free the port first if something is already listening (fixes Errno 48).
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
if command -v lsof >/dev/null 2>&1; then
  pids=$(lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${pids}" ]]; then
    echo "Port ${PORT} in use; stopping: ${pids}" >&2
    kill -TERM ${pids} 2>/dev/null || true
    sleep 0.5
    pids=$(lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
    if [[ -n "${pids}" ]]; then
      kill -KILL ${pids} 2>/dev/null || true
    fi
  fi
fi
exec ./.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port "$PORT" --log-level debug
