#!/bin/sh
set -eu

node /opt/mdc-extension/server.js &
extension_pid=$!

entrypoint.sh "$@" &
mdc_pid=$!

stop() {
  kill "$extension_pid" "$mdc_pid" 2>/dev/null || true
}
trap stop INT TERM
set +e
wait "$mdc_pid"
status=$?
stop
wait "$extension_pid" 2>/dev/null || true
exit "$status"
