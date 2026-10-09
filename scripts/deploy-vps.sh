#!/usr/bin/env bash
# SAARTHI push-button VPS deploy — run ON THE BOX (Ubuntu 22.04/24.04).
#
#   REPO_URL=https://github.com/<you>/SAARTHI.git ./scripts/deploy-vps.sh
#
# What it does (every step echoes PASS/FAIL, safe to re-run):
#   1. installs Docker engine + compose plugin if missing
#   2. opens firewall for SSH/HTTP/HTTPS (Caddy needs 80 free for ACME)
#   3. clones the repo (or fast-forward pulls it on re-runs)
#   4. creates .env from .env.example with placeholders (never overwrites
#      values you already filled in) and chmods it 600
#   5. builds + starts the container (app listens on host :8000, Caddy owns
#      :80/:443 — do NOT set WGPT_PORT on the VPS)
#   6. waits for GET /api/health (up to 10 min on first build)
#   7. warms the live adapters, then checks /api/sources for
#      imd / cap / open-meteo / stt / tts
#   8. prints the static egress IPv4 (the value the IMD form needs)
#
# Honesty note on step 7: a freshly booted process reports a configured but
# never-yet-called adapter as READY ("configured — verified on first use"),
# not LIVE — see backend/adapters/registry.py _initial_state(). So the check
# warms the weather/warnings endpoints first (which flips open-meteo, cap and
# imd to LIVE/DEMO for real) and accepts LIVE, READY or CACHED as PASS.
# stt/tts can only go LIVE after a real Sarvam call, so keyed-but-unused
# reports READY and also passes; UNCONFIGURED fails and names SARVAM_API_KEY.
# imd reporting DEMO passes only when IMD_ADAPTER=demo (fixtures by design).
set -u

# Refuse to run anywhere but a Linux server: on a Windows laptop (Git Bash)
# every step fails confusingly (no docker daemon, no ufw, no sudo).
if [ "$(uname -s)" != "Linux" ]; then
  echo "[ FAIL ] Run this ON the Ubuntu VPS over SSH, not on your laptop."
  echo "         ssh <user>@43.225.25.133, then the same command there."
  exit 1
fi

APP_DIR="${APP_DIR:-$HOME/saarthi}"
APP_PORT="${WGPT_PORT:-8000}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"

PASSES=0
FAILS=0
pass() { PASSES=$((PASSES + 1)); echo "[ PASS ] $1"; }
fail() { FAILS=$((FAILS + 1)); echo "[ FAIL ] $1"; }

DOCKER="docker"
COMPOSE="docker compose"
need_sudo_docker=false

echo "=== SAARTHI VPS deploy (target dir: $APP_DIR, app port: $APP_PORT) ==="

# --- 1. Docker ---------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  pass "docker + compose plugin present ($(docker --version))"
else
  echo "installing docker.io + compose plugin (needs sudo) ..."
  if sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git ufw curl \
    && sudo systemctl enable --now docker; then
    if docker compose version >/dev/null 2>&1; then
      pass "docker installed ($(docker --version))"
    else
      fail "docker installed but 'docker compose' still missing"
    fi
  else
    fail "apt install of docker failed"
  fi
fi
if ! docker info >/dev/null 2>&1; then
  # Freshly added to the docker group (or never added) — sudo keeps this run going.
  DOCKER="sudo docker"
  COMPOSE="sudo docker compose"
  need_sudo_docker=true
fi
if $DOCKER info >/dev/null 2>&1 && $COMPOSE version >/dev/null 2>&1; then
  pass "docker daemon reachable"
else
  fail "docker daemon unreachable (try: sudo usermod -aG docker \$USER, then re-login)"
fi

# --- 2. Firewall (Caddy needs 80/443; never lock out SSH) ----------------------
if sudo ufw allow OpenSSH >/dev/null 2>&1 \
  && sudo ufw allow 80/tcp >/dev/null 2>&1 \
  && sudo ufw allow 443/tcp >/dev/null 2>&1 \
  && sudo ufw --force enable >/dev/null 2>&1 \
  && sudo ufw status | grep -q "Status: active"; then
  pass "ufw active with OpenSSH + 80/tcp + 443/tcp"
else
  fail "ufw setup failed (check 'sudo ufw status')"
fi

# --- 3. Repo -------------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  if git -C "$APP_DIR" pull --ff-only 2>&1 | tail -n 3; then
    pass "repo updated in $APP_DIR"
  else
    fail "git pull --ff-only failed in $APP_DIR (resolve manually, then re-run)"
  fi
elif [ -e "$APP_DIR" ]; then
  fail "$APP_DIR exists but is not a git repo (move it aside, then re-run)"
else
  if [ -z "$REPO_URL" ]; then
    fail "REPO_URL is empty — re-run as: REPO_URL=https://github.com/<you>/SAARTHI.git $0"
  elif git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR" 2>&1 | tail -n 3; then
    pass "repo cloned to $APP_DIR"
  else
    fail "git clone failed (check REPO_URL + network)"
  fi
fi

# --- 4. .env (placeholders only — existing values are never overwritten) -------
FRESH_ENV=false
if [ -f "$APP_DIR/.env" ]; then
  echo ".env already exists — keeping your values, adding only missing keys."
else
  if cp "$APP_DIR/.env.example" "$APP_DIR/.env"; then
    FRESH_ENV=true
    echo "created .env from .env.example (fresh file: applying VPS defaults)."
  else
    fail "could not create .env from .env.example"
  fi
fi
if [ -f "$APP_DIR/.env" ]; then
  ensure_key() { # ensure_key KEY DEFAULT — append only if KEY is absent
    if ! grep -qE "^$1=" "$APP_DIR/.env"; then
      printf '%s=%s\n' "$1" "$2" >>"$APP_DIR/.env"
      echo "  added placeholder: $1=$2"
    fi
  }
  ensure_key "SOURCE_MODE" ""
  ensure_key "IMD_ADAPTER" "demo"
  ensure_key "FRONTEND_ORIGINS" ""
  ensure_key "CACHE_FILE" ""
  ensure_key "PORT" "8000"
  if [ "$FRESH_ENV" = true ]; then
    # Fresh box: run the hybrid chain (live CAP + Open-Meteo, IMD fixtures
    # until the key day) rather than the laptop-demo default.
    sed -i 's/^DEMO_MODE=.*/DEMO_MODE=false/' "$APP_DIR/.env"
    if grep -qE '^SOURCE_MODE=$' "$APP_DIR/.env"; then
      sed -i 's/^SOURCE_MODE=$/SOURCE_MODE=hybrid/' "$APP_DIR/.env"
    fi
  fi
  chmod 600 "$APP_DIR/.env"
  pass ".env present, 600, VPS keys ensured (fill secrets, then re-run)"
  echo "  --> edit secrets now: nano $APP_DIR/.env  (IMD_API_KEY, IMD_JWT, SARVAM_API_KEY, ...)"
else
  fail ".env still missing"
fi

# --- 5. Build + start (host :8000; Caddy owns :80/:443) ------------------------
if (cd "$APP_DIR" && $COMPOSE up -d --build 2>&1 | tail -n 5); then
  pass "compose up -d --build"
else
  fail "compose up failed (see output above)"
fi

# --- 6. Health-wait loop (up to ~10 min on first build) -------------------------
echo "waiting for http://localhost:${APP_PORT}/api/health ..."
UP=false
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${APP_PORT}/api/health" >/dev/null 2>&1; then
    UP=true
    pass "app UP after ~$((i * 10))s"
    break
  fi
  if [ $((i % 6)) -eq 0 ]; then echo "  ... still waiting ($((i * 10))s)"; fi
  sleep 10
done
if [ "$UP" != true ]; then
  fail "/api/health never returned 200 (try: cd $APP_DIR && $COMPOSE logs --tail=50)"
fi

# --- 7. Warm adapters, then check /api/sources ----------------------------------
# Best-effort warmers: real fetches that flip READY -> LIVE/DEMO for the
# keyless and fixture adapters (stt/tts need a real Sarvam call, so a keyed
# READY is the highest honest state here and also passes).
curl -s "http://localhost:${APP_PORT}/api/weather/current?lat=17.385&lon=78.4867" >/dev/null 2>&1 || echo "  (warmer: /api/weather/current unreachable)"
curl -s "http://localhost:${APP_PORT}/api/weather/warnings?district=Hyderabad" >/dev/null 2>&1 || echo "  (warmer: /api/weather/warnings unreachable)"
SOURCES_JSON="$(curl -s "http://localhost:${APP_PORT}/api/sources" || true)"
IMD_ADAPTER_VAL="$(grep -E '^IMD_ADAPTER=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d ' ')"
if [ -z "$SOURCES_JSON" ]; then
  fail "/api/sources unreachable"
else
  echo "$SOURCES_JSON" | python3 -c 'import json,sys; [print("%s|%s|%s" % (s["name"], s["status"], s.get("detail","")[:100])) for s in json.load(sys.stdin)["sources"]]' 2>/dev/null > /tmp/saarthi_sources.txt \
    || fail "could not parse /api/sources (is python3 installed?)"
  check_source() { # check_source NAME — PASS on LIVE/READY/CACHED (+ DEMO-by-design for imd)
    line="$(grep -E "^$1\\|" /tmp/saarthi_sources.txt || true)"
    status="$(echo "$line" | cut -d'|' -f2)"
    detail="$(echo "$line" | cut -d'|' -f3-)"
    case "$status" in
      LIVE | READY | CACHED)
        pass "$1 = $status ($detail)"
        ;;
      DEMO)
        if [ "$1" = "imd" ] && [ "$IMD_ADAPTER_VAL" = "demo" ]; then
          pass "imd = DEMO (fixtures by design, IMD_ADAPTER=demo — set live + key on key day)"
        else
          fail "$1 = DEMO ($detail)"
        fi
        ;;
      "")
        fail "$1 missing from /api/sources"
        ;;
      *)
        if [ "$1" = "stt" ] || [ "$1" = "tts" ]; then
          fail "$1 = $status — set SARVAM_API_KEY in $APP_DIR/.env, restart, re-run"
        elif [ "$1" = "imd" ]; then
          fail "$1 = $status — set IMD_API_KEY + IMD_JWT (or IMD_ADAPTER=demo for fixtures)"
        elif [ "$1" = "cap" ]; then
          fail "$1 = $status — set CAP_FEED_URLS in $APP_DIR/.env, restart, re-run"
        else
          fail "$1 = $status ($detail)"
        fi
        ;;
    esac
  }
  for src in imd cap open-meteo stt tts; do check_source "$src"; done
fi

# --- 8. Static egress IP (the value the IMD whitelist form needs) ---------------
IP_A="$(curl -4 -s --max-time 10 ifconfig.me || true)"
IP_B="$(curl -4 -s --max-time 10 ipinfo.io/ip || true)"
if [ -n "$IP_A" ] && [ "$IP_A" = "$IP_B" ]; then
  pass "static egress IP = $IP_A (submit THIS to the IMD form)"
else
  fail "egress IP mismatch/empty (ifconfig.me='$IP_A', ipinfo.io='$IP_B')"
fi

echo "=== deploy done: $PASSES passed, $FAILS failed ==="
if [ "$need_sudo_docker" = true ]; then
  echo "NOTE: docker needed sudo — run 'sudo usermod -aG docker \$USER' then re-login to drop sudo."
fi
[ "$FAILS" -eq 0 ]
