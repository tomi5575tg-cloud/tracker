#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if curl -sf -o /dev/null http://127.0.0.1:5173/; then
  exit 0
fi

mkdir -p /tmp/tracker
nohup npm run cockpit >/tmp/tracker/cockpit.log 2>&1 &

for _ in $(seq 1 40); do
  if curl -sf -o /dev/null http://127.0.0.1:5173/; then
    exit 0
  fi
  sleep 0.5
done

echo "cockpit failed to bind :5173" >&2
tail -n 80 /tmp/tracker/cockpit.log >&2 || true
exit 1
