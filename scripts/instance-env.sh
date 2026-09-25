# shellcheck shell=bash
# Sourced by start.sh, stop.sh and update.sh (#262). A second installation on
# the same server - staging - carries an instance.env in its checkout:
#
#   OMNIFM_INSTANCE=staging   systemd units omnifm-staging-backend, ...
#   FRONTEND_PORT=3100
#   BACKEND_PORT=8101
#
# Production has no instance.env: units omnifm-backend, ..., ports 3000/8001.
# Expects ROOT to be set.
if [ -f "$ROOT/instance.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/instance.env"
  set +a
fi
OMNIFM_INSTANCE="${OMNIFM_INSTANCE:-}"
if [ -n "$OMNIFM_INSTANCE" ] && ! [[ "$OMNIFM_INSTANCE" =~ ^[a-z0-9][a-z0-9-]{0,19}$ ]]; then
  printf '[error] OMNIFM_INSTANCE in instance.env: nur a-z, 0-9 und -, hoechstens 20 Zeichen.\n' >&2
  exit 1
fi
# Read by the scripts that source this file.
# shellcheck disable=SC2034
UNIT_PREFIX="omnifm${OMNIFM_INSTANCE:+-$OMNIFM_INSTANCE}"
