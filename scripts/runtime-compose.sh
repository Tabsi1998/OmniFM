#!/usr/bin/env bash

compose_read_env_value() {
  local app_dir="${1:-$(pwd)}"
  local key="$2"
  local default="${3:-}"
  local env_file="${app_dir}/.env"
  local value=""

  if [[ -f "$env_file" ]]; then
    value="$(grep "^${key}=" "$env_file" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  fi

  printf "%s" "${value:-$default}"
}

compose_count_bots() {
  local app_dir="${1:-$(pwd)}"
  local count=0

  while [[ $count -lt 20 ]]; do
    if grep -q "^BOT_$((count + 1))_TOKEN=" "${app_dir}/.env" 2>/dev/null; then
      count=$((count + 1))
    else
      break
    fi
  done

  printf "%s" "$count"
}

compose_resolve_commander_index() {
  local app_dir="${1:-$(pwd)}"
  local bot_count configured

  bot_count="$(compose_count_bots "$app_dir")"
  configured="$(compose_read_env_value "$app_dir" "COMMANDER_BOT_INDEX" "1")"

  if [[ "$configured" =~ ^[0-9]+$ ]] && (( configured >= 1 && configured <= bot_count )); then
    printf "%s" "$configured"
    return 0
  fi

  if (( bot_count >= 1 )); then
    printf "%s" "1"
    return 0
  fi

  printf "%s" "1"
}

compose_determine_mode() {
  local app_dir="${1:-$(pwd)}"
  local requested bot_count

  requested="$(compose_read_env_value "$app_dir" "OMNIFM_DEPLOYMENT_MODE" "auto")"
  requested="$(printf "%s" "$requested" | tr '[:upper:]' '[:lower:]' | xargs)"

  case "$requested" in
    split)
      if [[ -f "${app_dir}/docker-compose.split.yml" ]]; then
        printf "%s" "split"
      else
        printf "%s" "monolith"
      fi
      ;;
    monolith|single|legacy)
      printf "%s" "monolith"
      ;;
    *)
      bot_count="$(compose_count_bots "$app_dir")"
      if (( bot_count > 1 )) && [[ -f "${app_dir}/docker-compose.split.yml" ]]; then
        printf "%s" "split"
      else
        printf "%s" "monolith"
      fi
      ;;
  esac
}

compose_worker_indexes() {
  local app_dir="${1:-$(pwd)}"
  local bot_count commander_idx idx

  bot_count="$(compose_count_bots "$app_dir")"
  commander_idx="$(compose_resolve_commander_index "$app_dir")"

  for ((idx = 1; idx <= bot_count; idx++)); do
    if (( idx != commander_idx )); then
      printf "%s\n" "$idx"
    fi
  done
}

compose_worker_profiles_csv() {
  local app_dir="${1:-$(pwd)}"
  local -a profiles=()
  local idx

  while IFS= read -r idx; do
    [[ -n "$idx" ]] || continue
    profiles+=("worker-${idx}")
  done < <(compose_worker_indexes "$app_dir")

  local IFS=","
  printf "%s" "${profiles[*]}"
}

compose_expected_worker_count() {
  local app_dir="${1:-$(pwd)}"
  local bot_count

  bot_count="$(compose_count_bots "$app_dir")"
  if (( bot_count <= 1 )); then
    printf "%s" "0"
  else
    printf "%s" "$((bot_count - 1))"
  fi
}

refresh_omnifm_compose_env() {
  local app_dir="${1:-$(pwd)}"
  local mode profiles_csv

  export OMNIFM_COMPOSE_APP_DIR="$app_dir"
  if command -v id >/dev/null 2>&1; then
    export OMNIFM_CONTAINER_UID="${OMNIFM_CONTAINER_UID:-$(id -u)}"
    export OMNIFM_CONTAINER_GID="${OMNIFM_CONTAINER_GID:-$(id -g)}"
  else
    export OMNIFM_CONTAINER_UID="${OMNIFM_CONTAINER_UID:-1000}"
    export OMNIFM_CONTAINER_GID="${OMNIFM_CONTAINER_GID:-1000}"
  fi
  mode="$(compose_determine_mode "$app_dir")"
  export OMNIFM_DEPLOYMENT_ACTIVE="$mode"

  if [[ "$mode" == "split" ]]; then
    export COMPOSE_FILE="${app_dir}/docker-compose.split.yml"
    profiles_csv="$(compose_worker_profiles_csv "$app_dir")"
    if [[ -n "$profiles_csv" ]]; then
      export COMPOSE_PROFILES="$profiles_csv"
    else
      unset COMPOSE_PROFILES
    fi
  else
    export COMPOSE_FILE="${app_dir}/docker-compose.yml"
    unset COMPOSE_PROFILES
  fi
}

compose_runtime_services() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  local mode idx

  mode="${OMNIFM_DEPLOYMENT_ACTIVE:-$(compose_determine_mode "$app_dir")}"
  printf "%s\n" "omnifm"

  if [[ "$mode" != "split" ]]; then
    return 0
  fi

  while IFS= read -r idx; do
    [[ -n "$idx" ]] || continue
    printf "%s\n" "omnifm-worker-${idx}"
  done < <(compose_worker_indexes "$app_dir")
}

compose_worker_services() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  local mode idx

  mode="${OMNIFM_DEPLOYMENT_ACTIVE:-$(compose_determine_mode "$app_dir")}"
  if [[ "$mode" != "split" ]]; then
    return 0
  fi

  while IFS= read -r idx; do
    [[ -n "$idx" ]] || continue
    printf "%s\n" "omnifm-worker-${idx}"
  done < <(compose_worker_indexes "$app_dir")
}

prepare_omnifm_runtime_data() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  bash "${app_dir}/init-data.sh"
}

compose_deployment_summary() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  local mode bot_count commander_idx worker_count

  mode="$(compose_determine_mode "$app_dir")"
  bot_count="$(compose_count_bots "$app_dir")"
  commander_idx="$(compose_resolve_commander_index "$app_dir")"
  worker_count="$(compose_expected_worker_count "$app_dir")"

  if [[ "$mode" == "split" ]]; then
    printf "%s" "Split-Modus: Commander=BOT_${commander_idx}, Worker=${worker_count}, Bots gesamt=${bot_count}"
  else
    printf "%s" "Einzelcontainer-Modus: Bots gesamt=${bot_count}"
  fi
}
