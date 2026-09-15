#!/usr/bin/env bash
# Launch Claude Code with the API key from .env.
# Your existing Claude Code settings / models / OmniRoute config are NOT touched.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "error: .env not found — create it and paste your API key." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "error: paste your API key into .env first (ANTHROPIC_AUTH_TOKEN=...)." >&2
  exit 1
fi

if [ -z "${ANTHROPIC_BASE_URL:-}" ]; then
  echo "note: ANTHROPIC_BASE_URL is empty in .env — Claude Code will use the" >&2
  echo "      default endpoint (api.anthropic.com). If your key is not an" >&2
  echo "      Anthropic key, fill in the base URL first." >&2
fi

# --- locate the claude binary even if it is not on this shell's PATH ---
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CLAUDE_BIN" ]; then
  for cand in "$HOME/.local/bin/claude.exe" "$HOME/.local/bin/claude.cmd" "$HOME/.local/bin/claude"; do
    if [ -e "$cand" ]; then CLAUDE_BIN="$cand"; break; fi
  done
fi
if [ -z "$CLAUDE_BIN" ]; then
  echo "error: 'claude' not found on PATH and ~/.local/bin has no claude binary." >&2
  echo "       Tip: run this from Git Bash (not PowerShell or WSL), or reinstall:" >&2
  echo "       irm https://claude.ai/install.ps1 | iex" >&2
  exit 1
fi

echo "Launching Claude Code ($CLAUDE_BIN) with the key from .env ..."
exec "$CLAUDE_BIN" "$@"
