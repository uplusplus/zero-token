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
CDP_PORT="${CDP_PORT:-9222}"

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

# ── 2. 安装 Chromium ─────────────────────────────────────────
if command -v apt-get &>/dev/null; then
  if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null && ! command -v google-chrome &>/dev/null; then
    info "安装 Chromium ..."
    apt-get install -y -qq chromium 2>/dev/null || apt-get install -y -qq chromium-browser 2>/dev/null || warn "Chromium 安装失败，Web 类 Provider 需要手动安装 Chrome"
    ok "Chromium 就绪"
  else
    ok "Chrome/Chromium 已安装"
  fi
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

# ── 5. 检测 Chrome 路径 ──────────────────────────────────────
detect_chrome() {
  local linux_paths=(
    "/opt/google/chrome/google-chrome"
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/usr/bin/chromium"
    "/usr/bin/chromium-browser"
    "/snap/bin/chromium"
  )
  for p in "${linux_paths[@]}"; do
    [ -f "$p" ] && echo "$p" && return
  done
  for cmd in google-chrome google-chrome-stable chromium chromium-browser; do
    command -v "$cmd" >/dev/null 2>&1 && echo "$(command -v "$cmd")" && return
  done
  echo ""
}

CHROME_PATH=$(detect_chrome)

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
CHROME_DATA_DIR="/tmp/zero-token-chrome-data"

if [ -n "$CHROME_PATH" ]; then
  # 检测是否有图形环境
  HAS_DISPLAY=0
  if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
    HAS_DISPLAY=1
  fi

  info "启动 Chrome（调试模式）..."
  mkdir -p "$CHROME_DATA_DIR"

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

  if [ "$HAS_DISPLAY" -eq 0 ]; then
    # 无图形环境（服务器/WSL），使用 headless + 远程调试
    CHROME_ARGS+=(--headless --disable-gpu)
    "$CHROME_PATH" "${CHROME_ARGS[@]}" &
    CHROME_PID=$!
    ok "Chrome 已启动 (headless 模式, PID: $CHROME_PID, CDP: http://localhost:$CDP_PORT)"
    echo ""
    echo -e "  ${YELLOW}无图形环境，使用 headless 模式${NC}"
    echo -e "  ${YELLOW}请从本机浏览器打开 http://localhost:$CDP_PORT/json/version 确认 Chrome 已就绪${NC}"
    echo -e "  ${YELLOW}凭据抓取将通过脚本自动完成，完成后按任意键继续...${NC}"
  else
    # 有图形环境，前台打开 Chrome 供交互登录
    "$CHROME_PATH" "${CHROME_ARGS[@]}" &
    CHROME_PID=$!
    ok "Chrome 已启动 (PID: $CHROME_PID, CDP: http://localhost:$CDP_PORT)"
    echo ""
    echo -e "  ${YELLOW}请在 Chrome 窗口中登录你需要的平台（DeepSeek / Claude / ChatGPT 等）${NC}"
    echo -e "  ${YELLOW}登录完成后，按任意键继续...${NC}"
  fi
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
  fi
  ok "zero-token 已停止"
  exit 0
}
trap cleanup INT TERM

node dist/server.mjs
