#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; }

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   Stripe API Key - Einrichtung        ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"
echo ""

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/.env"

echo -e "  Fuer Stripe-Zahlungen brauchst du einen API-Key."
echo -e "  Hol dir deinen unter: ${CYAN}https://dashboard.stripe.com/apikeys${NC}"
echo ""
echo -e "  ${YELLOW}Hinweis:${NC} Nutze erst den ${BOLD}Test-Key${NC} (sk_test_...) zum Testen!"
echo ""

read -r -p "$(echo -e "  ${CYAN}?${NC} ${BOLD}Stripe Secret Key${NC}: ")" stripe_key

if [[ -z "$stripe_key" ]]; then
  fail "Kein Key eingegeben. Abbruch."
  exit 1
fi

if [[ ! "$stripe_key" =~ ^sk_(test|live)_ ]]; then
  echo -e "  ${YELLOW}[WARN]${NC} Key sieht ungewoehnlich aus. Erwartet: sk_test_... oder sk_live_..."
  read -r -p "$(echo -e "  ${CYAN}?${NC} Trotzdem speichern? [j/N]: ")" confirm
  if [[ "${confirm,,}" != "j" && "${confirm,,}" != "ja" && "${confirm,,}" != "y" ]]; then
    fail "Abgebrochen."
    exit 1
  fi
fi

if grep -q "^STRIPE_SECRET_KEY=" "$ENV_FILE" 2>/dev/null; then
  sed -i "s|^STRIPE_SECRET_KEY=.*|STRIPE_SECRET_KEY=${stripe_key}|" "$ENV_FILE"
  ok "Stripe Key aktualisiert in .env"
else
  echo "STRIPE_SECRET_KEY=${stripe_key}" >> "$ENV_FILE"
  ok "Stripe Key hinzugefuegt zu .env"
fi

echo ""
info "Starte Container neu damit der Key aktiv wird..."

if command -v docker >/dev/null 2>&1; then
  # The legacy direct Compose call used its interpolation default (1000).
  # Keep that ownership when this setup helper is invoked via sudo, while the
  # wrapper adds topology reconciliation before every actual start.
  export OMNIFM_CONTAINER_UID="${OMNIFM_CONTAINER_UID:-1000}"
  export OMNIFM_CONTAINER_GID="${OMNIFM_CONTAINER_GID:-1000}"

  # WICHTIG: up -d statt restart - restart liest .env NICHT neu ein!
  if bash "$APP_DIR/scripts/compose.sh" up -d --build --remove-orphans; then
    ok "Container neugestartet."
  else
    warn "Build fehlgeschlagen, versuche ohne --build..."
    if bash "$APP_DIR/scripts/compose.sh" up -d --remove-orphans; then
      ok "Container neugestartet."
    else
      fail "Container konnten nach der Stripe-Aenderung nicht sicher gestartet werden."
      exit 1
    fi
  fi
else
  echo -e "  ${YELLOW}Docker nicht gefunden. Bitte manuell neustarten: bash ./scripts/compose.sh up -d --build${NC}"
fi

echo ""
ok "Stripe eingerichtet! Zahlungen sind jetzt auf der Webseite moeglich."
echo ""
