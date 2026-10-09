#!/usr/bin/env bash
# SAARTHI Caddy setup — run ON THE BOX (Ubuntu 22.04/24.04) AFTER deploy-vps.sh.
#
#   sudo ./scripts/caddy-setup.sh <your-domain>
#   # or: sudo DOMAIN=<your-domain> ./scripts/caddy-setup.sh
#
# Writes a managed site block (reverse_proxy 127.0.0.1:8000) into
# /etc/caddy/Caddyfile between BEGIN/END SAARTHI markers, validates it and
# reloads Caddy. Idempotent: re-running with the same (or a new) domain only
# replaces the managed block; everything else in the Caddyfile is untouched.
# Every step echoes PASS/FAIL.
#
# Prerequisites: DNS A record <your-domain> -> this box's public IP, and the
# app answering on http://127.0.0.1:8000 (see deploy-vps.sh). Until DNS
# propagates, Caddy serves HTTP and retries ACME; https://<domain> works once
# DNS + port 80 (ACME challenge) are reachable.
set -u

DOMAIN="${1:-${DOMAIN:-}}"
APP_PORT="${WGPT_PORT:-8000}"
CADDYFILE="/etc/caddy/Caddyfile"
BEGIN_MARK="# BEGIN SAARTHI (managed by scripts/caddy-setup.sh — safe to re-run)"
END_MARK="# END SAARTHI"

PASSES=0
FAILS=0
pass() { PASSES=$((PASSES + 1)); echo "[ PASS ] $1"; }
fail() { FAILS=$((FAILS + 1)); echo "[ FAIL ] $1"; }

echo "=== SAARTHI Caddy setup (domain: ${DOMAIN:-<missing>}, app port: $APP_PORT) ==="

# --- 0. root -------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    echo "re-running with sudo ..."
    exec sudo DOMAIN="$DOMAIN" WGPT_PORT="$APP_PORT" bash "$0" ${DOMAIN:+"$DOMAIN"}
  else
    fail "must run as root (no sudo available)"
    echo "=== caddy setup: $PASSES passed, $FAILS failed ==="; exit 1
  fi
fi

# --- 1. domain -----------------------------------------------------------------
if [ -z "$DOMAIN" ]; then
  fail "no domain given — usage: sudo $0 <your-domain>"
  echo "=== caddy setup: $PASSES passed, $FAILS failed ==="; exit 1
fi
case "$DOMAIN" in
  *.*) pass "domain = $DOMAIN" ;;
  *)   fail "domain '$DOMAIN' looks invalid (expected like app.example.com)"
       echo "=== caddy setup: $PASSES passed, $FAILS failed ==="; exit 1 ;;
esac

# --- 2. install caddy if missing (official repo, idempotent) --------------------
if command -v caddy >/dev/null 2>&1; then
  pass "caddy present ($(caddy version))"
else
  echo "installing caddy from the official apt repo ..."
  if apt-get update \
    && apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null \
    && apt-get update && apt-get install -y caddy; then
    pass "caddy installed ($(caddy version))"
  else
    fail "caddy install failed"
  fi
fi

# --- 3. firewall (belt-and-braces; deploy-vps.sh already opens these) -----------
if command -v ufw >/dev/null 2>&1; then
  if ufw allow 80/tcp >/dev/null 2>&1 && ufw allow 443/tcp >/dev/null 2>&1; then
    pass "ufw allows 80/tcp + 443/tcp"
  else
    fail "ufw rule add failed"
  fi
else
  fail "ufw not installed (run deploy-vps.sh first)"
fi

# --- 4. write the managed site block (replace-or-append, backup on change) ------
SITE_BLOCK="$DOMAIN {
	reverse_proxy 127.0.0.1:$APP_PORT
}"
if [ -f "$CADDYFILE" ] && grep -q "BEGIN SAARTHI" "$CADDYFILE"; then
  HAVE_BLOCK=true
else
  HAVE_BLOCK=false
fi
NEW_FILE="$(mktemp)"
if [ "$HAVE_BLOCK" = true ]; then
  awk -v begin="$BEGIN_MARK" -v end="$END_MARK" -v site="$SITE_BLOCK" '
    $0 == begin { print begin; print site; print end; inblock=1; next }
    $0 == end { inblock=0; next }
    !inblock { print }
  ' "$CADDYFILE" >"$NEW_FILE"
else
  { [ -f "$CADDYFILE" ] && cat "$CADDYFILE"; printf '\n%s\n%s\n%s\n' "$BEGIN_MARK" "$SITE_BLOCK" "$END_MARK"; } >"$NEW_FILE"
fi
if [ -f "$CADDYFILE" ] && cmp -s "$CADDYFILE" "$NEW_FILE"; then
  rm -f "$NEW_FILE"
  pass "Caddyfile already has this site block (no change)"
else
  BACKUP="${CADDYFILE}.bak.$(date +%Y%m%d%H%M%S)"
  [ -f "$CADDYFILE" ] && cp "$CADDYFILE" "$BACKUP" && echo "  backed up $CADDYFILE -> $BACKUP"
  if caddy fmt --overwrite "$NEW_FILE" 2>/dev/null && cp "$NEW_FILE" "$CADDYFILE"; then
    rm -f "$NEW_FILE"
    pass "site block written for $DOMAIN -> 127.0.0.1:$APP_PORT"
  else
    rm -f "$NEW_FILE"
    fail "could not write $CADDYFILE"
  fi
fi

# --- 5. validate ---------------------------------------------------------------
if caddy validate --config "$CADDYFILE" --adapter caddyfile 2>&1 | tail -n 3; then
  if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    pass "caddy validate OK"
  else
    fail "caddy validate rejected $CADDYFILE"
  fi
else
  fail "caddy validate errored"
fi

# --- 6. reload + backend-direct sanity ------------------------------------------
if systemctl enable --now caddy >/dev/null 2>&1 && systemctl reload caddy 2>/dev/null; then
  pass "caddy reloaded"
else
  fail "caddy reload failed (try: systemctl status caddy)"
fi
if curl -sf "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
  pass "backend answers directly on 127.0.0.1:$APP_PORT"
else
  fail "backend NOT answering on 127.0.0.1:$APP_PORT (is deploy-vps.sh green?)"
fi

echo "NOTE: https://$DOMAIN needs DNS A -> this box + port 80 reachable (ACME)."
echo "  check: curl -s https://$DOMAIN/api/health"
echo "=== caddy setup: $PASSES passed, $FAILS failed ==="
[ "$FAILS" -eq 0 ]
