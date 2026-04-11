#!/bin/bash
# llmgw — Start Chrome in debug mode for cookie/auth capture
# Compatible with macOS / Linux / WSL

set -e

PORT="${CDP_PORT:-9222}"
USER_DATA_DIR="${CHROME_DATA_DIR:-$HOME/.llmgw/chrome-data}"

echo "=========================================="
echo "  llmgw — Chrome Debug Launcher"
echo "=========================================="

# ─── Detect OS ───────────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Darwin*)  echo "mac" ;;
    MINGW*|MSYS*|CYGWIN*) echo "win" ;;
    *)
      if grep -qi microsoft /proc/version 2>/dev/null; then echo "wsl"
      else echo "linux"
      fi ;;
  esac
}

# ─── Detect Chrome ───────────────────────────────────────────
detect_chrome() {
  local os="$1"
  local linux_paths=(
    "/opt/google/chrome/google-chrome"
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/usr/bin/chromium"
    "/usr/bin/chromium-browser"
    "/snap/bin/chromium"
  )
  case "$os" in
    mac)
      [ -d "/Applications/Google Chrome.app" ] && echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" && return
      [ -d "/Applications/Chromium.app" ] && echo "/Applications/Chromium.app/Contents/MacOS/Chromium" && return
      command -v google-chrome 2>/dev/null && return
      ;;
    wsl|linux)
      for p in "${linux_paths[@]}"; do
        [ -f "$p" ] && echo "$p" && return
      done
      for cmd in google-chrome google-chrome-stable chromium chromium-browser; do
        command -v "$cmd" >/dev/null 2>&1 && echo "$cmd" && return
      done
      ;;
  esac
  echo ""
}

OS=$(detect_os)
CHROME_PATH=$(detect_chrome "$OS")

echo "OS:       $OS"
echo "Chrome:   ${CHROME_PATH:-NOT FOUND}"
echo "CDP port: $PORT"
echo "Data dir: $USER_DATA_DIR"
echo ""

if [ -z "$CHROME_PATH" ]; then
  echo "✗ Chrome/Chromium not found. Install it first."
  exit 1
fi

# ─── Kill existing debug Chrome ──────────────────────────────
if pgrep -f "remote-debugging-port=$PORT" > /dev/null 2>&1; then
  echo "Killing existing debug Chrome on port $PORT..."
  pkill -f "remote-debugging-port=$PORT" 2>/dev/null || true
  sleep 2
  pkill -9 -f "remote-debugging-port=$PORT" 2>/dev/null || true
  sleep 1
fi

# ─── Launch Chrome ───────────────────────────────────────────
mkdir -p "$USER_DATA_DIR"

"$CHROME_PATH" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$USER_DATA_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-sync \
  --disable-translate \
  --remote-allow-origins=* \
  &>/dev/null &

CHROME_PID=$!
echo "Chrome PID: $CHROME_PID"

# ─── Wait for CDP ready ──────────────────────────────────────
echo -n "Waiting for Chrome"
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
    echo " ✓"
    break
  fi
  echo -n "."
  sleep 1
done

if ! curl -sf "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
  echo ""
  echo "✗ Chrome failed to start. Check port $PORT."
  exit 1
fi

BROWSER=$(curl -sf "http://127.0.0.1:$PORT/json/version" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Browser','?'))" 2>/dev/null || echo "?")
echo ""
echo "✓ Chrome running: $BROWSER"
echo "  CDP: http://127.0.0.1:$PORT"
echo ""

# ─── Open login tabs ─────────────────────────────────────────
echo "Opening login tabs..."
URLS=(
  "https://chat.deepseek.com/"
  "https://claude.ai/new"
  "https://chatgpt.com"
  "https://www.kimi.com"
  "https://www.doubao.com/chat/"
  "https://chat.qwen.ai"
  "https://gemini.google.com/app"
  "https://grok.com"
  "https://chatglm.cn"
)
for url in "${URLS[@]}"; do
  "$CHROME_PATH" --remote-debugging-port="$PORT" --user-data-dir="$USER_DATA_DIR" "$url" &>/dev/null &
  sleep 0.3
done

echo "✓ Login tabs opened. Log in to each platform you want to use."
echo ""
echo "Next step: run ./scripts/onboard.sh to capture auth credentials."
echo "Stop Chrome: pkill -f 'remote-debugging-port=$PORT'"
