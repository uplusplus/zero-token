#!/bin/bash
# zero-token — 一键安装 & 启动脚本
# 用法: bash install.sh
#
# 修改说明：
#   1. 不再注册 systemd 服务，直接在终端前台运行
#   2. Chrome 不使用 headless 模式，前台打开供用户交互登录

set -e

# ── 配置 ─────────────────────────────────────────────────────
REPO_URL="https://github.com/uplusplus/zero-token.git"
INSTALL_DIR="/opt/zero-token"
MIN_NODE_VER=22
SERVER_PORT="${SERVER_PORT:-8080}"
CDP_PORT="${CDP_PORT:-9333}"

# ── 颜色 ─────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✘${NC} $*" >&2; }
die()   { err "$@"; exit 1; }

echo ""
echo -e "${BOLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BOLD}│       zero-token  安装程序          │${NC}"
echo -e "${BOLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── Root 检查 ─────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo &>/dev/null; then
    warn "需要 root 权限，使用 sudo 重新执行..."
    exec sudo "$0" "$@"
  else
    die "请以 root 身份运行此脚本"
  fi
fi

# ── 1. 检测 & 安装 Node.js ──────────────────────────────────
install_nodejs() {
  info "安装 Node.js ${MIN_NODE_VER}.x ..."

  if command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${MIN_NODE_VER}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y -qq nodejs
  elif command -v dnf &>/dev/null; then
    dnf install -y "https://rpm.nodesource.com/pub_${MIN_NODE_VER}.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm" 2>/dev/null || true
    dnf install -y nodejs
  elif command -v yum &>/dev/null; then
    yum install -y "https://rpm.nodesource.com/pub_${MIN_NODE_VER}.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm" 2>/dev/null || true
    yum install -y nodejs
  elif command -v brew &>/dev/null; then
    brew install node
  elif command -v pacman &>/dev/null; then
    pacman -Sy --noconfirm nodejs npm
  else
    die "无法自动安装 Node.js，请手动安装 Node.js >= ${MIN_NODE_VER}: https://nodejs.org/"
  fi
}

check_node() {
  if command -v node &>/dev/null; then
    local major
    major=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$major" -ge "$MIN_NODE_VER" ]; then
      ok "Node.js $(node -v)"
      return 0
    fi
    warn "Node.js $(node -v) 版本过低，需要 >= ${MIN_NODE_VER}"
  fi
  install_nodejs
  command -v node &>/dev/null || die "Node.js 安装失败"
  ok "Node.js $(node -v)"
}

check_node

# ── 2. 安装 & 检测 Chromium ──────────────────────────────────

# 验证 Chrome 路径是否可用（排除损坏的 snap）
verify_chrome() {
  local path="$1"
  [ ! -f "$path" ] && return 1

  # 排除 Ubuntu 24.04 的 snap 壳脚本（/usr/bin/chromium-browser 是个提示安装 snap 的小脚本）
  if head -c 512 "$path" 2>/dev/null | grep -q "requires the chromium snap\|snap install chromium\|command_is_valid.*snap"; then
    return 1
  fi

  # snap 包：检查 snap revision 目录是否存在
  if [[ "$path" == /snap/bin/* ]]; then
    local snap_name
    snap_name=$(basename "$path")
    local current_rev
    current_rev=$(readlink -f "/snap/$snap_name/current" 2>/dev/null || readlink "/snap/$snap_name/current" 2>/dev/null)
    [ -z "$current_rev" ] && return 1
    [ ! -f "/snap/$snap_name/$current_rev/meta/snap.yaml" ] && return 1
  fi
  return 0
}

detect_chrome() {
  # 优先使用 dpkg/原生安装的 chrome，其次 snap
  local candidates=(
    "/opt/google/chrome/google-chrome"
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/usr/bin/chromium"
    "/snap/bin/chromium"
  )
  for p in "${candidates[@]}"; do
    if verify_chrome "$p"; then
      echo "$p" && return
    fi
  done
  # command -v 兜底
  for cmd in google-chrome google-chrome-stable chromium chromium-browser; do
    local p
    p=$(command -v "$cmd" 2>/dev/null) || continue
    if verify_chrome "$p"; then
      echo "$p" && return
    fi
  done
  echo ""
}

CHROME_PATH=$(detect_chrome)

if [ -z "$CHROME_PATH" ]; then
  # 没有可用的 Chrome，尝试安装 dpkg 版
  if command -v apt-get &>/dev/null; then
    warn "未找到可用的 Chrome/Chromium，尝试安装 ..."
    apt-get update -qq 2>/dev/null || true
    if apt-get install -y -qq chromium 2>/dev/null; then
      # 不要硬编码路径，重新检测实际安装位置
      CHROME_PATH=$(detect_chrome)
      if [ -n "$CHROME_PATH" ]; then
        ok "Chromium 安装成功"
      else
        warn "apt 安装完成但未找到可用的 Chromium（可能是 snap 过渡包），尝试 snap 安装 ..."
      fi
    elif apt-get install -y -qq chromium-browser 2>/dev/null; then
      CHROME_PATH=$(detect_chrome)
      if [ -n "$CHROME_PATH" ]; then
        ok "Chromium 安装成功"
      else
        warn "apt 安装完成但未找到可用的 Chromium，尝试 snap 安装 ..."
      fi
    fi

    # 如果 apt 安装没拿到可用的 chromium，尝试 snap
    if [ -z "$CHROME_PATH" ] && command -v snap &>/dev/null; then
      info "通过 snap 安装 Chromium ..."
      snap install chromium 2>/dev/null && sleep 2
      CHROME_PATH=$(detect_chrome)
      [ -n "$CHROME_PATH" ] && ok "Chromium (snap) 安装成功"
    fi

    # 最后兜底：下载 Google Chrome .deb
    if [ -z "$CHROME_PATH" ] && command -v dpkg &>/dev/null; then
      info "尝试安装 Google Chrome ..."
      _arch=$(dpkg --print-architecture 2>/dev/null || echo "amd64")
      if curl -fsSL --connect-timeout 10 -o /tmp/google-chrome.deb \
        "https://dl.google.com/linux/direct/google-chrome-stable_current_${_arch}.deb" 2>/dev/null; then
        apt-get install -y -qq /tmp/google-chrome.deb 2>/dev/null || true
        rm -f /tmp/google-chrome.deb
        CHROME_PATH=$(detect_chrome)
        [ -n "$CHROME_PATH" ] && ok "Google Chrome 安装成功"
      fi
    fi

    if [ -z "$CHROME_PATH" ]; then
      warn "所有安装方式均失败，Web 类 Provider 不可用"
    fi
  fi
fi

if [ -n "$CHROME_PATH" ]; then
  ok "Chrome: $CHROME_PATH"
else
  warn "Web 类 Provider 需要手动安装 Chrome/Chromium"
fi

# ── 3. 克隆 & 安装 ──────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  info "更新已有安装 ..."
  cd "$INSTALL_DIR"
  if [ -d ".git" ]; then
    GIT_SSL_BACKEND=openssl git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 pull --ff-only 2>/dev/null || warn "拉取更新失败，保留当前版本"
  fi
else
  info "下载 zero-token ..."
  GIT_SSL_BACKEND=openssl git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 \
    clone --depth 1 "$REPO_URL" "$INSTALL_DIR" 2>/dev/null \
    || {
      warn "git clone 失败，使用镜像下载 ..."
      mkdir -p "$INSTALL_DIR"
      curl -fsSL --connect-timeout 15 --max-time 120 \
        "https://gh-proxy.com/${REPO_URL%.git}/archive/refs/heads/main.zip" \
        -o /tmp/zero-token.zip
      unzip -o /tmp/zero-token.zip -d /tmp/zt-extract
      mv /tmp/zt-extract/zero-token-main/* /tmp/zt-extract/zero-token-main/.* "$INSTALL_DIR/" 2>/dev/null || true
      rm -rf /tmp/zero-token.zip /tmp/zt-extract
    }
  cd "$INSTALL_DIR"
fi

info "安装依赖 ..."
npm ci 2>/dev/null || npm install
ok "依赖安装完成"

info "构建项目 ..."
npx tsdown
ok "构建完成"

npm prune --production 2>/dev/null || true

# ── 4. 默认配置 ──────────────────────────────────────────────
if [ ! -f "config.yaml" ]; then
  cp config.yaml.example config.yaml 2>/dev/null || true
fi

# ── 5. 启动准备 ──────────────────────────────────────────────

# ── 完成 ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}┌─────────────────────────────────────┐${NC}"
echo -e "${GREEN}${BOLD}│         安装完成！                  │${NC}"
echo -e "${GREEN}${BOLD}└─────────────────────────────────────┘${NC}"
echo ""
echo -e "  ${BOLD}安装目录${NC}   ${INSTALL_DIR}"
echo -e "  ${BOLD}配置文件${NC}   ${INSTALL_DIR}/config.yaml"
echo ""

# ── 6. 启动 ──────────────────────────────────────────────────

# 先启动 Chrome（前台，非 headless，供用户交互登录）
CHROME_PID=""
CHROME_DATA_DIR="${HOME}/.zero-token/chrome-data"

if [ -n "$CHROME_PATH" ]; then
  CHROME_ARGS=(
    --remote-debugging-port="$CDP_PORT"
    --user-data-dir="$CHROME_DATA_DIR"
    --no-first-run
    --no-default-browser-check
    --disable-background-networking
    --disable-sync
    --disable-translate
    --remote-allow-origins=*
    --no-sandbox
    --disable-dev-shm-usage
  )

  # 检查 Chrome 是否已经在运行（CDP 端口已监听）
  if curl -sf "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
    ok "Chrome 已在运行 (CDP: http://localhost:$CDP_PORT)，跳过启动"
  else
  # 杀掉残留 Chrome 进程（可能占着 CDP 端口）
  if ss -tlnp 2>/dev/null | grep -q ":$CDP_PORT " || netstat -tlnp 2>/dev/null | grep -q ":$CDP_PORT "; then
    warn "端口 $CDP_PORT 已被占用，清理残留 Chrome ..."
    pkill -f "remote-debugging-port=$CDP_PORT" 2>/dev/null || true
    sleep 2
  fi

  mkdir -p "$CHROME_DATA_DIR"
  # 清理 singleton lock，避免"Opening in existing browser session"导致退出
  rm -f "$CHROME_DATA_DIR/SingletonLock" "$CHROME_DATA_DIR/SingletonCookie" 2>/dev/null

  "$CHROME_PATH" "${CHROME_ARGS[@]}" > /dev/null 2>&1 &
  CHROME_PID=$!
  ok "Chrome 启动中 (PID: $CHROME_PID) ..."

    # 等待 Chrome CDP 就绪
    info "等待 Chrome 就绪 ..."
    for i in $(seq 1 15); do
      if curl -sf "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
        break
      fi
      # 检查进程是否还活着
      if ! kill -0 "$CHROME_PID" 2>/dev/null; then
        warn "Chrome 进程已退出，尝试查看错误:"
        # 重新启动一次并捕获错误输出
        "$CHROME_PATH" "${CHROME_ARGS[@]}" 2>&1 | head -20 >&2 || true
        CHROME_PID=""
        break
      fi
      sleep 1
    done
  fi

  if curl -sf "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
    ok "Chrome CDP 就绪 (http://localhost:$CDP_PORT)"

    # 自动打开各 provider 登录页
    PROVIDER_URLS=(
      "https://chat.deepseek.com"
      "https://claude.ai"
      "https://kimi.com"
      "https://doubao.com"
      "https://xiaomimo.ai"
      "https://chat.qwen.ai"
      "https://chatglm.cn"
      "https://chat.z.ai"
      "https://perplexity.ai"
      "https://chatgpt.com"
      "https://gemini.google.com"
      "https://grok.com"
    )

    info "自动打开 Provider 登录页 ..."
    for url in "${PROVIDER_URLS[@]}"; do
      curl -sf -X PUT "http://localhost:$CDP_PORT/json/new?$url" > /dev/null 2>&1 || true
    done
    ok "已打开 ${#PROVIDER_URLS[@]} 个 Provider 登录页"
  else
    warn "Chrome CDP 未就绪，跳过自动导航"
  fi

  echo ""
  echo -e "  ${YELLOW}请在各 Chrome 标签页中登录你需要的平台${NC}"
  echo -e "  ${YELLOW}登录完成后，按任意键继续...${NC}"
  read -n 1 -s -r
  echo ""
else
  warn "未找到 Chrome/Chromium，Web 类 Provider 不可用"
  warn "请手动安装 Chrome 后运行: chrome --remote-debugging-port=$CDP_PORT"
fi

# 抓取凭据
if [ -f "$INSTALL_DIR/scripts/onboard.sh" ]; then
  info "抓取登录凭据 ..."
  cd "$INSTALL_DIR"
  bash scripts/onboard.sh 2>/dev/null || warn "凭据抓取失败，可稍后手动运行: cd $INSTALL_DIR && bash scripts/onboard.sh"
fi

echo ""
info "启动 zero-token 服务 (端口: $SERVER_PORT) ..."
echo -e "  ${YELLOW}按 Ctrl+C 停止服务${NC}"
echo ""

cd "$INSTALL_DIR"
export NODE_ENV=production
export SERVER_PORT="$SERVER_PORT"

# 前台运行 — 用户 Ctrl+C 退出时同时清理 Chrome
cleanup() {
  echo ""
  info "正在停止 ..."
  if [ -n "$CHROME_PID" ] && kill -0 "$CHROME_PID" 2>/dev/null; then
    kill "$CHROME_PID" 2>/dev/null || true
    ok "Chrome 已停止"
  else
    info "Chrome 非本脚本启动，保持运行"
  fi
  ok "zero-token 已停止"
  exit 0
}
trap cleanup INT TERM

node dist/server.mjs
