#!/usr/bin/env bash
# Prints one unit template of deploy/systemd with its placeholders filled in
# (#201) and, for a second installation such as staging (#262), every
# omnifm-<part> unit name turned into <UNIT_PREFIX>-<part>.
#
#   UNIT_PREFIX=omnifm ROOT=... RUN_USER=... BACKEND_PORT=... FRONTEND_PORT=... \
#   NODE_BIN=... NODE_DIR=... bash scripts/render-systemd-unit.sh <template-file>
set -euo pipefail

template="${1:?template file}"
prefix="${UNIT_PREFIX:-omnifm}"
sed -e "s|__ROOT__|${ROOT:?}|g" \
    -e "s|__USER__|${RUN_USER:?}|g" \
    -e "s|__BACKEND_PORT__|${BACKEND_PORT:?}|g" \
    -e "s|__FRONTEND_PORT__|${FRONTEND_PORT:?}|g" \
    -e "s|__NODE__|${NODE_BIN:?}|g" \
    -e "s|__NODE_DIR__|${NODE_DIR:?}|g" \
    -e "s/omnifm-\(backend\|frontend\|bot\|backup\)\.\(service\|timer\)/${prefix}-\1.\2/g" \
    "$template"
