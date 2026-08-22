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

# docker compose and dotenv accept CRLF files and quoted .env values. Shell
# topology checks must interpret the same simple forms before comparing a
# commander index or Discord client ID.
compose_normalize_env_value() {
  local value="${1-}"

  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if (( ${#value} >= 2 )) && { [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]] || [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; }; then
    value="${value:1:${#value}-2}"
  fi

  printf "%s" "$value"
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

# Do not infer a fallback topology when numbered bot configuration is
# malformed: reconciliation removes containers, so a guessed topology could
# otherwise delete a still-needed worker. Validate all numbered bot records
# before even deciding whether an auto deployment is split or monolith.
compose_validate_split_topology_configuration() {
  local app_dir="${1:-$(pwd)}"
  local mode bot_count=0 configured="" token="" client_id="" token_key="" client_id_key="" idx
  local token_defined client_id_defined seen_gap=0 has_numbered_config=0
  local seen_value
  local -a seen_tokens=() seen_client_ids=()

  # Numbered bots must be complete and contiguous. A gap such as BOT_1 +
  # BOT_3 would otherwise make BOT_3 invisible to compose_count_bots() and
  # turn its worker into a false orphan. The runtime also requires a numeric
  # client ID for every token, so mirror that precondition before cleanup.
  for ((idx = 1; idx <= 20; idx++)); do
    token_key="BOT_${idx}_TOKEN"
    client_id_key="BOT_${idx}_CLIENT_ID"
    token_defined=0
    client_id_defined=0
    grep -q "^${token_key}=" "${app_dir}/.env" 2>/dev/null && token_defined=1
    grep -q "^${client_id_key}=" "${app_dir}/.env" 2>/dev/null && client_id_defined=1

    if (( token_defined == 0 && client_id_defined == 0 )); then
      if (( has_numbered_config )); then
        seen_gap=1
      fi
      continue
    fi

    if (( seen_gap || idx != bot_count + 1 )); then
      printf "%s\n" "Ungueltige Bot-Konfiguration: BOT_N Eintraege muessen ohne Luecke bei BOT_1 beginnen." >&2
      return 1
    fi

    has_numbered_config=1
    token="$(compose_normalize_env_value "$(compose_read_env_value "$app_dir" "$token_key" "")")"
    client_id="$(compose_normalize_env_value "$(compose_read_env_value "$app_dir" "$client_id_key" "")")"
    if [[ -z "${token//[[:space:]]/}" ]]; then
      printf "%s\n" "Ungueltige Bot-Konfiguration: ${token_key} darf nicht leer sein." >&2
      return 1
    fi
    if [[ ! "$client_id" =~ ^[0-9]+$ ]]; then
      printf "%s\n" "Ungueltige Bot-Konfiguration: ${client_id_key} muss zusammen mit ${token_key} als numerische Discord-Client-ID gesetzt sein." >&2
      return 1
    fi
    for seen_value in "${seen_tokens[@]}"; do
      if [[ "$seen_value" == "$token" ]]; then
        printf "%s\n" "Ungueltige Bot-Konfiguration: Discord-Bot-Tokens duerfen nicht doppelt verwendet werden." >&2
        return 1
      fi
    done
    for seen_value in "${seen_client_ids[@]}"; do
      if [[ "$seen_value" == "$client_id" ]]; then
        printf "%s\n" "Ungueltige Bot-Konfiguration: Discord-Client-IDs duerfen nicht doppelt verwendet werden." >&2
        return 1
      fi
    done
    seen_tokens+=("$token")
    seen_client_ids+=("$client_id")
    bot_count=$((bot_count + 1))
  done

  mode="$(compose_determine_mode "$app_dir")"
  if (( bot_count == 0 )); then
    if [[ "$mode" == "split" ]]; then
      printf "%s\n" "Ungueltige Split-Topologie: Es ist mindestens ein vollstaendiger BOT_1_TOKEN/BOT_1_CLIENT_ID erforderlich." >&2
      return 1
    fi
    return 0
  fi

  [[ "$mode" == "split" ]] || return 0

  if grep -q '^COMMANDER_BOT_INDEX=' "${app_dir}/.env" 2>/dev/null; then
    configured="$(compose_normalize_env_value "$(compose_read_env_value "$app_dir" "COMMANDER_BOT_INDEX" "")")"
  else
    configured="1"
  fi

  if [[ ! "$configured" =~ ^[0-9]+$ ]] || (( configured < 1 || configured > bot_count )); then
    printf "%s\n" "Ungueltige Split-Topologie: COMMANDER_BOT_INDEX=${configured:-<leer>} verweist nicht auf einen konfigurierten Bot (1-${bot_count})." >&2
    return 1
  fi
}

compose_resolve_commander_index() {
  local app_dir="${1:-$(pwd)}"
  local bot_count configured

  bot_count="$(compose_count_bots "$app_dir")"
  configured="$(compose_normalize_env_value "$(compose_read_env_value "$app_dir" "COMMANDER_BOT_INDEX" "1")")"

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

  requested="$(compose_normalize_env_value "$(compose_read_env_value "$app_dir" "OMNIFM_DEPLOYMENT_MODE" "auto")")"
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

# Lists only worker containers that belong to this Compose project but are not
# part of the topology currently described by .env. Docker Compose profiles
# that are no longer enabled are not considered orphans by `up --remove-orphans`,
# so they need an explicit, profile-aware check.
compose_split_worker_container_ids() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  local worker_index="$2"
  local split_compose_file service

  if [[ ! "$worker_index" =~ ^([1-9]|1[0-9]|20)$ ]]; then
    printf "%s\n" "Ungueltiger Split-Worker-Index: ${worker_index}" >&2
    return 2
  fi

  split_compose_file="${app_dir}/docker-compose.split.yml"
  if [[ ! -f "$split_compose_file" ]]; then
    printf "%s\n" "Split-Compose-Datei fehlt: ${split_compose_file}" >&2
    return 2
  fi

  service="omnifm-worker-${worker_index}"
  # Explicitly enable only the queried profile. This lets Compose find a
  # stopped worker whose profile is no longer in COMPOSE_PROFILES, while still
  # restricting the lookup to this project's declared service and labels.
  COMPOSE_PROFILES= docker compose -f "$split_compose_file" --profile "worker-${worker_index}" \
    ps --all --quiet "$service"
}

compose_list_unexpected_split_workers() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  local mode expected_indexes=$'\n' worker_index container_ids

  mode="$(compose_determine_mode "$app_dir")"
  if [[ "$mode" == "split" ]]; then
    while IFS= read -r worker_index; do
      [[ -n "$worker_index" ]] || continue
      expected_indexes+="${worker_index}"$'\n'
    done < <(compose_worker_indexes "$app_dir")
  fi

  for ((worker_index = 1; worker_index <= 20; worker_index++)); do
    if [[ "$expected_indexes" == *$'\n'"${worker_index}"$'\n'* ]]; then
      continue
    fi

    if ! container_ids="$(compose_split_worker_container_ids "$app_dir" "$worker_index")"; then
      printf "%s\n" "Split-Worker ${worker_index} konnte nicht auf verwaiste Container geprueft werden." >&2
      return 1
    fi
    if [[ -n "${container_ids//[$'\r\n\t ']/}" ]]; then
      printf "%s\n" "omnifm-worker-${worker_index}"
    fi
  done
}

compose_reconcile_split_workers() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  local split_compose_file stale_workers service worker_index remaining_ids

  if ! compose_validate_split_topology_configuration "$app_dir"; then
    printf "%s\n" "Abbruch: Split-Topologie ist ungueltig; Worker werden nicht bereinigt." >&2
    return 1
  fi

  split_compose_file="${app_dir}/docker-compose.split.yml"
  if [[ ! -f "$split_compose_file" ]]; then
    # A repository without the optional split file cannot have Compose-managed
    # split workers to reconcile.
    return 0
  fi

  if ! stale_workers="$(compose_list_unexpected_split_workers "$app_dir")"; then
    printf "%s\n" "Abbruch: Verwaiste Split-Worker konnten nicht sicher ermittelt werden." >&2
    return 1
  fi
  [[ -n "$stale_workers" ]] || return 0

  while IFS= read -r service; do
    [[ -n "$service" ]] || continue
    if [[ ! "$service" =~ ^omnifm-worker-([1-9]|1[0-9]|20)$ ]]; then
      printf "%s\n" "Abbruch: Unerwarteter Worker-Service in der Bereinigung: ${service}" >&2
      return 1
    fi
    worker_index="${service##*-}"

    printf "%s\n" "Bereinige verwaisten Split-Worker ${service}..." >&2
    # Do not pass --volumes: only the exact Compose worker container may be
    # stopped and removed; runtime data and MongoDB volumes stay untouched.
    if ! COMPOSE_PROFILES= docker compose -f "$split_compose_file" --profile "worker-${worker_index}" \
      rm --stop --force "$service"; then
      printf "%s\n" "Abbruch: ${service} konnte nicht sicher entfernt werden." >&2
      return 1
    fi

    if ! remaining_ids="$(compose_split_worker_container_ids "$app_dir" "$worker_index")"; then
      printf "%s\n" "Abbruch: ${service} konnte nach der Bereinigung nicht erneut geprueft werden." >&2
      return 1
    fi
    if [[ -n "${remaining_ids//[$'\r\n\t ']/}" ]]; then
      printf "%s\n" "Abbruch: ${service} ist trotz Bereinigung weiterhin vorhanden." >&2
      return 1
    fi
  done <<< "$stale_workers"
}

# Returns 0 only when a currently running `omnifm` container must be stopped
# before the requested topology starts. This covers both a commander switch in
# split mode and a split -> monolith transition. A reused container could
# otherwise keep the old entrypoint and Discord identity.
#
# Return values: 0 = stop required, 1 = no stop required, 2 = unable to make
# a safe decision. An unreadable container identity is treated as "stop
# required", because that is safer than allowing a duplicate Discord gateway.
compose_running_commander_requires_stop_before_split_start() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  local mode desired_index running_services identity running_role running_index

  mode="$(compose_determine_mode "$app_dir")"

  if ! running_services="$(docker compose ps --services --filter status=running 2>/dev/null)"; then
    printf "%s\n" "Aktiver Commander konnte nicht sicher geprueft werden." >&2
    return 2
  fi
  if ! printf "%s\n" "$running_services" | grep -qx "omnifm"; then
    return 1
  fi

  if ! identity="$(docker compose exec -T omnifm sh -lc 'printf "%s\\t%s" "${BOT_PROCESS_ROLE:-}" "${COMMANDER_BOT_INDEX:-}"' 2>/dev/null)"; then
    printf "%s\n" "Aktiver Commander konnte nicht gelesen werden; stoppe ihn vor dem Split-Start vorsorglich." >&2
    return 0
  fi

  IFS=$'\t' read -r running_role running_index <<< "$identity"
  running_role="${running_role//$'\r'/}"
  running_index="${running_index//$'\r'/}"

  if [[ "$mode" == "monolith" ]]; then
    # The current monolith service deliberately has no BOT_PROCESS_ROLE.
    # Any role means this is a split-era container and must be recreated.
    if [[ -z "$running_role" ]]; then
      return 1
    fi
    printf "%s\n" "Split-zu-Monolith-Wechsel: alter Runtime-Container wird vor dem Start gestoppt." >&2
    return 0
  fi

  if ! desired_index="$(compose_resolve_commander_index "$app_dir")"; then
    printf "%s\n" "Gewuenschter Commander konnte nicht sicher bestimmt werden." >&2
    return 2
  fi
  if [[ "$running_role" != "commander" ]]; then
    printf "%s\n" "Aktiver omnifm-Container ist kein bekannter Split-Commander; stoppe ihn vor dem Split-Start vorsorglich." >&2
    return 0
  fi
  if [[ ! "$running_index" =~ ^[1-9][0-9]*$ ]]; then
    printf "%s\n" "Aktiver Commander-Index ist ungueltig; stoppe ihn vor dem Split-Start vorsorglich." >&2
    return 0
  fi
  if [[ "$running_index" != "$desired_index" ]]; then
    printf "%s\n" "Commander-Wechsel BOT_${running_index} -> BOT_${desired_index}: alter Commander wird vor den Workern gestoppt." >&2
    return 0
  fi

  return 1
}

# Returns 0 when a stopped `omnifm` container cannot safely be revived with
# `docker compose start`/`restart` for the requested topology. Unlike `up`,
# those commands do not recreate containers or apply a changed env_file.
compose_stopped_commander_requires_recreate_before_split_start() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  local mode desired_index container_ids container_id container_env running_role="" running_index="" entry

  mode="$(compose_determine_mode "$app_dir")"

  if ! container_ids="$(docker compose ps --all --quiet omnifm 2>/dev/null)"; then
    printf "%s\n" "Gestoppter Commander konnte nicht sicher geprueft werden." >&2
    return 2
  fi
  container_ids="${container_ids//$'\r'/}"
  container_ids="${container_ids//$'\n'/}"
  container_ids="${container_ids//[$'\t ']/}"
  [[ -n "$container_ids" ]] || return 1
  container_id="$container_ids"

  if ! container_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>/dev/null)"; then
    printf "%s\n" "Gestoppter Commander konnte nicht gelesen werden; Docker Compose start wird nicht fortgesetzt." >&2
    return 0
  fi
  while IFS= read -r entry; do
    case "$entry" in
      BOT_PROCESS_ROLE=*) running_role="${entry#*=}" ;;
      COMMANDER_BOT_INDEX=*) running_index="${entry#*=}" ;;
    esac
  done <<< "$container_env"
  running_role="${running_role//$'\r'/}"
  running_index="${running_index//$'\r'/}"

  if [[ "$mode" == "monolith" ]]; then
    if [[ -z "$running_role" ]]; then
      return 1
    fi
    printf "%s\n" "Gestoppter Runtime-Container gehoert zur alten Split-Topologie; Docker Compose start wird nicht fortgesetzt." >&2
    return 0
  fi

  if ! desired_index="$(compose_resolve_commander_index "$app_dir")"; then
    printf "%s\n" "Gewuenschter Commander konnte nicht sicher bestimmt werden." >&2
    return 2
  fi

  if [[ "$running_role" == "commander" && "$running_index" == "$desired_index" ]]; then
    return 1
  fi

  printf "%s\n" "Gestoppter Commander passt nicht zur angeforderten Split-Topologie; Docker Compose start wird nicht fortgesetzt." >&2
  return 0
}

compose_stop_running_commander_for_topology_change() {
  local running_services

  if ! docker compose stop -t 20 omnifm >/dev/null 2>&1; then
    printf "%s\n" "Commander konnte vor dem Topologie-Wechsel nicht sauber gestoppt werden." >&2
    return 1
  fi
  if ! running_services="$(docker compose ps --services --filter status=running 2>/dev/null)"; then
    printf "%s\n" "Commander konnte nach dem Stop nicht sicher geprueft werden." >&2
    return 1
  fi
  if printf "%s\n" "$running_services" | grep -qx "omnifm"; then
    printf "%s\n" "Commander ist trotz Stop-Anforderung noch aktiv. Topologie-Start wird nicht fortgesetzt." >&2
    return 1
  fi
}

# Reconcile profile-disabled workers and prevent a changing or unknown old
# commander from overlapping with newly started split workers. Call this
# immediately before every command path that can start split services.
compose_prepare_split_topology_before_start() {
  local app_dir="${1:-${OMNIFM_COMPOSE_APP_DIR:-$(pwd)}}"
  local startup_command="${2:-up}"
  local stop_check_status stopped_check_status

  refresh_omnifm_compose_env "$app_dir"
  if ! compose_validate_split_topology_configuration "$app_dir"; then
    printf "%s\n" "Split-Topologie ist ungueltig; Start wird nicht fortgesetzt." >&2
    return 1
  fi

  if [[ "$startup_command" == "create" ]]; then
    compose_reconcile_split_workers "$app_dir"
    return $?
  fi

  # `docker compose start` reuses stopped containers. Refuse a topology
  # change instead of restarting an old commander with stale environment.
  if [[ "$startup_command" == "start" || "$startup_command" == "restart" ]]; then
    if compose_running_commander_requires_stop_before_split_start "$app_dir"; then
      printf "%s\n" "Topologie-Wechsel mit Docker Compose ${startup_command} ist nicht sicher. Bitte docker compose up -d verwenden." >&2
      return 1
    else
      stop_check_status=$?
    fi
    if (( stop_check_status != 1 )); then
      printf "%s\n" "Topologie-Start wird abgebrochen, weil der aktive Commander nicht sicher geprueft werden konnte." >&2
      return 1
    fi

    if compose_stopped_commander_requires_recreate_before_split_start "$app_dir"; then
      printf "%s\n" "Topologie-Wechsel mit Docker Compose ${startup_command} ist nicht sicher. Bitte docker compose up -d verwenden." >&2
      return 1
    else
      stopped_check_status=$?
    fi
    if (( stopped_check_status != 1 )); then
      printf "%s\n" "Topologie-Start wird abgebrochen, weil der gestoppte Commander nicht sicher geprueft werden konnte." >&2
      return 1
    fi
  fi

  if ! compose_reconcile_split_workers "$app_dir"; then
    return 1
  fi

  if [[ "$startup_command" == "start" || "$startup_command" == "restart" ]]; then
    return 0
  fi

  if compose_running_commander_requires_stop_before_split_start "$app_dir"; then
    compose_stop_running_commander_for_topology_change || return 1
    return 0
  else
    stop_check_status=$?
  fi

  if (( stop_check_status == 1 )); then
    return 0
  fi

  printf "%s\n" "Topologie-Start wird abgebrochen, weil der aktive Commander nicht sicher geprueft werden konnte." >&2
  return 1
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
