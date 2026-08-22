#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=/dev/null
source "$APP_DIR/scripts/runtime-compose.sh"
refresh_omnifm_compose_env "$APP_DIR"

if [[ $# -eq 0 ]]; then
  echo "$(compose_deployment_summary "$APP_DIR")"
  echo "Beispiel: bash ./scripts/compose.sh ps"
  exit 0
fi

declare -a compose_args=("$@")
declare -a requested_profiles=()
cli_project_name=""
custom_compose_scope=0
compose_subcommand=""
dry_run_requested=0
no_recreate_requested=0

# Docker Compose has global options before its subcommand. Determine that
# subcommand positionally; scanning every argument would mistake a command
# such as `compose exec ... echo up` for a runtime start.
arg_index=0
while (( arg_index < ${#compose_args[@]} )); do
  compose_arg="${compose_args[$arg_index]}"
  case "$compose_arg" in
    --)
      arg_index=$((arg_index + 1))
      if (( arg_index < ${#compose_args[@]} )); then
        compose_subcommand="${compose_args[$arg_index]}"
      fi
      break
      ;;
    -p|--project-name)
      if (( arg_index + 1 >= ${#compose_args[@]} )); then
        echo "Abbruch: ${compose_arg} erwartet einen Projektnamen." >&2
        exit 2
      fi
      arg_index=$((arg_index + 1))
      cli_project_name="${compose_args[$arg_index]}"
      custom_compose_scope=1
      ;;
    --project-name=*)
      cli_project_name="${compose_arg#*=}"
      custom_compose_scope=1
      ;;
    -p?*)
      cli_project_name="${compose_arg#-p}"
      custom_compose_scope=1
      ;;
    --profile)
      if (( arg_index + 1 >= ${#compose_args[@]} )); then
        echo "Abbruch: --profile erwartet ein Profil." >&2
        exit 2
      fi
      arg_index=$((arg_index + 1))
      requested_profiles+=("${compose_args[$arg_index]}")
      ;;
    --profile=*)
      requested_profiles+=("${compose_arg#*=}")
      ;;
    --dry-run|--dry-run=true)
      dry_run_requested=1
      ;;
    -f|--file|--project-directory|--env-file|--ansi|--parallel|--progress|--log-level)
      if (( arg_index + 1 >= ${#compose_args[@]} )); then
        echo "Abbruch: ${compose_arg} erwartet einen Wert." >&2
        exit 2
      fi
      case "$compose_arg" in
        -f|--file|--project-directory|--env-file) custom_compose_scope=1 ;;
      esac
      arg_index=$((arg_index + 1))
      ;;
    -f?*)
      custom_compose_scope=1
      ;;
    --file=*|--project-directory=*|--env-file=*)
      custom_compose_scope=1
      ;;
    --ansi=*|--parallel=*|--progress=*|--log-level=*|--compatibility|--all-resources|--verbose)
      ;;
    -*)
      echo "Abbruch: Unbekannte globale Docker-Compose-Option vor dem Subcommand: ${compose_arg}" >&2
      exit 2
      ;;
    *)
      compose_subcommand="$compose_arg"
      break
      ;;
  esac
  arg_index=$((arg_index + 1))
done

if [[ -n "$cli_project_name" ]]; then
  export COMPOSE_PROJECT_NAME="$cli_project_name"
fi

refresh_omnifm_compose_env "$APP_DIR"

if (( dry_run_requested )); then
  exec docker compose "$@"
fi

if [[ "$compose_subcommand" == "up" ]]; then
  # `--no-recreate` is an `up` option, so inspect only the arguments after
  # the proven subcommand. A full argv scan would confuse a CLI payload such
  # as `compose run ... --no-recreate` with a runtime-reuse request.
  for ((arg_index = arg_index + 1; arg_index < ${#compose_args[@]}; arg_index++)); do
    compose_arg="${compose_args[$arg_index]}"
    case "$compose_arg" in
      --no-recreate|--no-recreate=true)
        no_recreate_requested=1
        ;;
    esac
  done
fi

# `docker compose run` always creates an additional one-off container. Without
# a proven non-runtime command override, `run omnifm` would log in a second
# commander (or worker) with the same Discord token. Use the dedicated CLI
# helpers or `compose exec` for maintenance instead.
if [[ "$compose_subcommand" == "run" ]]; then
  echo "Abbruch: docker compose run ist ueber diesen Sicherheits-Wrapper gesperrt, weil es eine doppelte Bot-Runtime starten kann. Nutze stations.sh, premium.sh oder docker compose exec fuer Wartungsbefehle." >&2
  exit 2
fi

case "$compose_subcommand" in
  up|create|start|restart)
    if (( custom_compose_scope == 1 )); then
      echo "Abbruch: Start mit eigener Compose-Datei, Environment-Datei, Projektname oder eigenem Projektverzeichnis wird von diesem Sicherheits-Wrapper nicht unterstuetzt." >&2
      exit 2
    fi
    if [[ "$compose_subcommand" == "up" && $no_recreate_requested -eq 1 ]]; then
      echo "Abbruch: docker compose up --no-recreate kann eine alte Bot-Topologie wiederbeleben. Bitte ohne --no-recreate starten." >&2
      exit 2
    fi
    for profile in "${requested_profiles[@]}"; do
      if [[ ",${COMPOSE_PROFILES:-}," != *",${profile},"* ]]; then
        echo "Abbruch: Profil ${profile} ist in der aktuellen Split-Topologie nicht aktiv und darf nicht gestartet werden." >&2
        exit 2
      fi
    done
    preflight_command="$compose_subcommand"
    if [[ "$preflight_command" == "restart" ]]; then
      preflight_command="start"
    fi
    if ! compose_prepare_split_topology_before_start "$APP_DIR" "$preflight_command"; then
      echo "Abbruch: Split-Topologie konnte vor dem Start nicht sicher vorbereitet werden." >&2
      exit 1
    fi
    bash "$APP_DIR/init-data.sh"
    ;;
esac

exec docker compose "$@"
