#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
exec 9>.server.lock
flock 9

stop_server() {
  if [[ -f .server.pid ]]; then
    read -r pid started < .server.pid
    if [[ -r /proc/$pid/stat ]] && [[ "$(awk '{print $22}' /proc/"$pid"/stat)" == "$started" ]] && [[ "$(readlink /proc/"$pid"/cwd)" == "$root" ]]; then
      echo "Stopping server ($pid)…"
      kill "$pid"
      for ((i=0; i<100; i++)); do
        [[ -r /proc/$pid/stat ]] || break
        [[ "$(awk '{print $3}' /proc/"$pid"/stat)" == Z ]] && break
        sleep 0.1
      done
      if kill -0 "$pid" 2>/dev/null && [[ "$(awk '{print $3}' /proc/"$pid"/stat 2>/dev/null)" != Z ]]; then
        echo 'Server did not stop; refusing to start another.' >&2
        exit 1
      fi
    fi
    rm -f .server.pid
  fi
}

stop_server
[[ "${1:-start}" == stop ]] && exit 0
[[ "${1:-start}" == start ]] || { echo 'Usage: server.sh [start|stop]' >&2; exit 1; }

echo 'Building current frontend before starting server…'
bun run build
bun backend/main.ts 9>&- &
pid=$!
started=$(awk '{print $22}' /proc/"$pid"/stat)
printf '%s %s\n' "$pid" "$started" > .server.pid
flock -u 9
exec 9>&-
cleanup() {
  kill "$pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT
wait "$pid"
