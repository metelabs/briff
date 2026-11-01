#!/bin/sh
# Healthcheck for both roles; PID 1 is tini, whose argv names the role.
# 127.0.0.1, not localhost: busybox wget tries ::1 first and fails.
if tr '\0' ' ' < /proc/1/cmdline | grep -q "worker"; then
  heartbeat=/tmp/briff-worker-heartbeat
  [ -f "$heartbeat" ] || exit 1
  age=$(( $(date +%s) - $(stat -c %Y "$heartbeat") ))
  [ "$age" -lt 180 ] || exit 1
  exit 0
fi
wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/health?probe=live" || exit 1
