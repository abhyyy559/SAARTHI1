#!/usr/bin/env bash
# ============================================================
# Claude Code <-> justworker gateway setup
# Run:   bash claude-justworker-setup.sh            (auto-pick first claude* model)
#   or:  bash claude-justworker-setup.sh <model-id>  (force a specific model)
#
# Your API key is ONLY entered by you, locally. It is never saved
# to the script or sent anywhere except api.justwoker.icu.
# ============================================================
set -uo pipefail

BASE_URL="https://api.justwoker.icu"
SETTINGS="$HOME/.claude/settings.json"
KEYFILE="$HOME/.justworker_key"     # optional: put your key in this file yourself to skip the prompt
MODEL="${1:-}"

echo "==================================================="
echo " Claude Code <-> justworker ($BASE_URL)"
echo "==================================================="

# ---------- STEP 1: API key (YOU enter it) ----------
if [ -f "$KEYFILE" ]; then
  KEY="$(tr -d '\r\n' < "$KEYFILE")"
  echo "[1/4] Using key found in $KEYFILE (length ${#KEY})"
else
  echo "[1/4] Paste your justworker API key (input is hidden), then press Enter:"
  read -rs KEY
  echo
fi
if [ -z "${KEY:-}" ]; then
  echo "  ERROR: no key entered. Aborting (nothing was changed)."
  exit 1
fi

# ---------- STEP 2: list models ----------
echo "[2/4] Fetching model list from $BASE_URL/v1/models ..."
MODELS_JSON="$(curl -sS -m 30 "$BASE_URL/v1/models" -H "Authorization: Bearer $KEY" 2>&1)"
echo "$MODELS_JSON" | node -e '
let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
try{
  const d=JSON.parse(s);const ids=(d.data||[]).map(m=>m.id);
  if(!ids.length){console.log("  (no models returned) raw:",s.slice(0,300));return}
  console.log("  Available models:");
  ids.forEach(i=>console.log("   - "+i));
  require("fs").writeFileSync(".jw_models.tmp",ids.join("\n"));
}catch(e){console.log("  Parse failed. Raw response:");console.log("  "+s.slice(0,300))}});'
echo

# ---------- STEP 3: test the Anthropic /v1/messages endpoint ----------
if [ -z "$MODEL" ]; then
  MODEL="$(grep -im1 '^claude' .jw_models.tmp 2>/dev/null || true)"
  [ -n "$MODEL" ] && echo "[3/4] Auto-selected model: $MODEL"
fi
if [ -n "$MODEL" ]; then
  echo "[3/4] Testing Anthropic-format endpoint /v1/messages with model: $MODEL ..."
  RESP="$(curl -sS -m 60 "$BASE_URL/v1/messages" \
    -H "Content-Type: application/json" \
    -H "anthropic-version: 2023-06-01" \
    -H "x-api-key: $KEY" \
    -H "Authorization: Bearer $KEY" \
    -d "{\"model\":\"$MODEL\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi in one short sentence.\"}]}" 2>&1)"
  echo "  Response: $(echo "$RESP" | head -c 300)"
  case "$RESP" in
    *'"content"'*) echo "  OK: Anthropic /v1/messages works. Claude Code can talk to this gateway."
                   MODEL_OK=1 ;;
    *)             echo "  WARNING: /v1/messages did not return Anthropic-style content."
                   echo "           Claude Code needs this endpoint; if it keeps failing, ask the"
                   echo "           gateway admin whether Anthropic-format is supported." ;;
  esac
else
  echo "[3/4] Skipped live test (no model selected)."
fi
echo

# ---------- STEP 4: write ~/.claude/settings.json ----------
echo "[4/4] Updating $SETTINGS ..."
JW_KEY="$KEY" JW_MODEL="$MODEL" node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const p=path.join(os.homedir(),".claude","settings.json");
let s={};
try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){console.log("  (existing settings unreadable, creating fresh)")}
try{fs.copyFileSync(p,p+".bak-before-justworker")}catch(e){}
s.env=Object.assign({},s.env||{},{ANTHROPIC_BASE_URL:"https://api.justwoker.icu",ANTHROPIC_AUTH_TOKEN:process.env.JW_KEY});
const m=process.env.JW_MODEL||"";
if(m){s.model=m;s.env.ANTHROPIC_MODEL=m;s.env.ANTHROPIC_SMALL_FAST_MODEL=m;}
fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n");
console.log("  Written: "+p);
console.log("  Backup : "+p+".bak-before-justworker");
if(m){console.log("  Model  : "+m)}else{console.log("  Model  : NOT SET - re-run with:  bash claude-justworker-setup.sh <model-id>")}
'
rm -f .jw_models.tmp

echo
echo "==================================================="
echo " Done. Next steps:"
echo "   1. Close ALL Claude Code windows/terminals"
echo "   2. Start it again and run:  claude"
echo "   3. Check /status - it should show ANTHROPIC_BASE_URL=$BASE_URL"
echo " To roll back: cp ~/.claude/settings.json.bak-before-justworker ~/.claude/settings.json"
echo "==================================================="
