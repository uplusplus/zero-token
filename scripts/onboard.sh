#!/bin/bash
# llmgw — Auth credential capture wizard
# Connects to Chrome via CDP, extracts cookies/bearer tokens from logged-in sessions
# Writes auth JSON to config.yaml

set -e

CDP_PORT="${CDP_PORT:-9333}"
CONFIG_FILE="${LLMGW_CONFIG:-$(dirname "$0")/../config.yaml}"
CDP_URL="http://localhost:$CDP_PORT"

echo "=========================================="
echo "  llmgw — Auth Credential Capture"
echo "=========================================="
echo ""

# ─── Check Chrome reachable ──────────────────────────────────
if ! curl -sf "$CDP_URL/json/version" > /dev/null 2>&1; then
  echo "✗ Chrome not reachable at $CDP_URL"
  echo "  Run ./scripts/start-chrome.sh first."
  exit 1
fi

echo "✓ Chrome reachable at $CDP_URL"
echo ""

# ─── Provider definitions ────────────────────────────────────
declare -A PROVIDER_DOMAINS=(
  [deepseek-web]="chat.deepseek.com"
  [claude-web]="claude.ai"
  [kimi-web]="kimi.com"
  [doubao-web]="doubao.com"
  [xiaomimo-web]="xiaomimo.ai"
  [qwen-web]="chat.qwen.ai"
  [qwen-cn-web]="chat.qwen.ai"
  [glm-web]="chatglm.cn"
  [glm-intl-web]="chat.z.ai"
  [perplexity-web]="perplexity.ai"
  [chatgpt-web]="chatgpt.com"
  [gemini-web]="gemini.google.com"
  [grok-web]="grok.com"
)

declare -A PROVIDER_NAMES=(
  [deepseek-web]="DeepSeek"
  [claude-web]="Claude"
  [kimi-web]="Kimi"
  [doubao-web]="Doubao (豆包)"
  [xiaomimo-web]="Xiaomi MiMo"
  [qwen-web]="Qwen (国际)"
  [qwen-cn-web]="Qwen (国内)"
  [glm-web]="GLM (智谱)"
  [glm-intl-web]="GLM (国际)"
  [perplexity-web]="Perplexity"
  [chatgpt-web]="ChatGPT"
  [gemini-web]="Gemini"
  [grok-web]="Grok"
)

# ─── Helper: get cookies for a domain via CDP ────────────────
get_cookies() {
  local domain="$1"
  # Use CDP /json to list pages, then Network.getCookies via WebSocket
  # Simplified: use curl to get cookies from the Chrome JSON API
  python3 - "$CDP_PORT" "$domain" << 'PYEOF'
import sys, json, http.client

port = int(sys.argv[1])
domain = sys.argv[2]

# Get list of targets (tabs)
conn = http.client.HTTPConnection("localhost", port)
conn.request("GET", "/json")
targets = json.loads(conn.getresponse().read())

# Find a tab matching the domain
ws_url = None
for t in targets:
    if t.get("type") == "page" and domain in t.get("url", ""):
        ws_url = t.get("webSocketDebuggerUrl")
        break

if not ws_url:
    # Try any page
    for t in targets:
        if t.get("type") == "page":
            ws_url = t.get("webSocketDebuggerUrl")
            break

if not ws_url:
    print("NO_TAB")
    sys.exit(1)

# Connect via WebSocket and get cookies
import asyncio
try:
    import websockets
except ImportError:
    # Fallback: just output the domain for manual extraction
    print(f"COOKIE_NEEDED:{domain}")
    sys.exit(0)

async def get_cookies_ws():
    async with websockets.connect(ws_url) as ws:
        # Enable Network
        await ws.send(json.dumps({"id": 1, "method": "Network.enable"}))
        await ws.recv()
        
        # Get all cookies
        await ws.send(json.dumps({"id": 2, "method": "Network.getAllCookies"}))
        resp = json.loads(await ws.recv())
        cookies = resp.get("result", {}).get("cookies", [])
        
        # Filter for matching domain
        matching = [c for c in cookies if domain in c.get("domain", "")]
        
        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in matching if c.get("name") and c.get("value"))
        print(cookie_str)

asyncio.run(get_cookies_ws())
PYEOF
}

# ─── Helper: extract bearer token from page via CDP ──────────
extract_bearer() {
  local domain="$1"
  python3 - "$CDP_PORT" "$domain" << 'PYEOF'
import sys, json, http.client, asyncio

port = int(sys.argv[1])
domain = sys.argv[2]

conn = http.client.HTTPConnection("localhost", port)
conn.request("GET", "/json")
targets = json.loads(conn.getresponse().read())

ws_url = None
for t in targets:
    if t.get("type") == "page" and domain in t.get("url", ""):
        ws_url = t.get("webSocketDebuggerUrl")
        break

if not ws_url:
    print("")
    sys.exit(0)

try:
    import websockets
except ImportError:
    print("")
    sys.exit(0)

async def extract():
    async with websockets.connect(ws_url) as ws:
        # Try to extract bearer from page context
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": """
            (function() {
                // Try localStorage
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const val = localStorage.getItem(key);
                    if (val && (val.includes('Bearer') || val.includes('bearer') || key.includes('token') || key.includes('auth'))) {
                        try {
                            const parsed = JSON.parse(val);
                            if (parsed.accessToken) return parsed.accessToken;
                            if (parsed.token) return parsed.token;
                            if (parsed.bearer) return parsed.bearer;
                        } catch(e) {}
                    }
                }
                // Try sessionStorage
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    const val = sessionStorage.getItem(key);
                    if (val && (key.includes('token') || key.includes('auth'))) {
                        try {
                            const parsed = JSON.parse(val);
                            if (parsed.accessToken) return parsed.accessToken;
                            if (parsed.token) return parsed.token;
                        } catch(e) {}
                    }
                }
                return '';
            })()
            """,
            "returnByValue": True
        }}))
        resp = json.loads(await ws.recv())
        result = resp.get("result", {}).get("result", {}).get("value", "")
        print(result)

asyncio.run(extract())
PYEOF
}

# ─── Main menu ────────────────────────────────────────────────
echo "Select providers to capture auth for:"
echo ""
PS3="Enter numbers (space-separated) or 'all': "

options=()
for key in deepseek-web claude-web kimi-web doubao-web xiaomimo-web qwen-web qwen-cn-web glm-web glm-intl-web chatgpt-web gemini-web grok-web; do
  options+=("$key")
done
options+=("all" "quit")

select opt in "${options[@]}"; do
  if [ "$opt" = "quit" ]; then
    echo "Bye."
    exit 0
  elif [ "$opt" = "all" ]; then
    SELECTED=("${options[@]:0:${#options[@]}-2}")
    break
  elif [ -n "$opt" ]; then
    SELECTED=("$opt")
    break
  fi
done

echo ""
echo "Capturing auth for: ${SELECTED[*]}"
echo ""

# ─── Capture credentials ─────────────────────────────────────
AUTH_JSON="{}"

for provider in "${SELECTED[@]}"; do
  domain="${PROVIDER_DOMAINS[$provider]}"
  name="${PROVIDER_NAMES[$provider]:-$provider}"
  
  echo "── $name ($provider) ──"
  
  COOKIE=$(get_cookies "$domain" 2>/dev/null || echo "")
  BEARER=$(extract_bearer "$domain" 2>/dev/null || echo "")
  
  if [ -n "$COOKIE" ] && [ "$COOKIE" != "NO_TAB" ]; then
    echo "  Cookie: ${COOKIE:0:60}..."
    
    # Build auth JSON for this provider
    AUTH_ENTRY="{\"cookie\":\"$COOKIE\""
    [ -n "$BEARER" ] && AUTH_ENTRY="$AUTH_ENTRY,\"bearer\":\"$BEARER\""
    AUTH_ENTRY="$AUTH_ENTRY}"
    
    echo "  ✓ Captured"
    
    # Append to config.yaml (or print for manual paste)
    echo ""
    echo "  # Add to config.yaml:"
    echo "  # - id: $provider"
    echo "  #   enabled: true"
    echo "  #   auth: '$AUTH_ENTRY'"
    echo ""
  else
    echo "  ✗ No active tab found. Log in at https://$domain first."
    echo ""
  fi
done

echo "=========================================="
echo "Copy the auth lines above into your config.yaml"
echo "under the 'providers:' section."
echo "=========================================="
