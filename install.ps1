#Requires -Version 5.1
<#
.SYNOPSIS
    zero-token Windows Installer
.DESCRIPTION
    Auto-detect/install Node.js, clone repo, install deps, build, and start service
.EXAMPLE
    irm https://raw.githubusercontent.com/uplusplus/zero-token/main/install.ps1 | iex
#>

# ── 配置 ─────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"
$REPO_URL = "https://github.com/uplusplus/zero-token.git"
$INSTALL_DIR = "$env:USERPROFILE\zero-token"
$MIN_NODE_VER = 22
$SERVER_PORT = if ($env:SERVER_PORT) { $env:SERVER_PORT } else { "8080" }
$CDP_PORT = 9333

# ── 颜色输出 ─────────────────────────────────────────────────
function Write-Info  { param($m) Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "[  OK] $m" -ForegroundColor Green }
function Write-Warn  { param($m) Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Fail  { param($m) Write-Host "[FAIL] $m" -ForegroundColor Red }

Write-Host ""
Write-Host "┌─────────────────────────────────────┐" -ForegroundColor White
Write-Host "│       zero-token  Windows 安装      │" -ForegroundColor White
Write-Host "└─────────────────────────────────────┘" -ForegroundColor White
Write-Host ""

# ── 1. 检测 & 安装 Node.js ──────────────────────────────────
function Install-NodeJs {
    Write-Info "安装 Node.js ${MIN_NODE_VER}.x ..."

    # 优先 winget（用户级）
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "使用 winget 安装..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    }
    # 其次 chocolatey
    elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Info "使用 chocolatey 安装..."
        choco install nodejs-lts -y
    }
    # 最后 msi 下载安装
    else {
        $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
        $msiUrl = "https://nodejs.org/dist/v22.15.0/node-v22.15.0-${arch}.msi"
        $msiPath = "$env:TEMP\nodejs-installer.msi"
        Write-Info "下载 Node.js 安装包..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        Write-Info "运行安装程序（可能需要管理员权限）..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait
        Remove-Item $msiPath -Force

        # 刷新 PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path", "User")
    }
}

function Check-Node {
    $nodeExe = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeExe) {
        $ver = (node -v) -replace 'v', ''
        $major = [int]($ver.Split('.')[0])
        if ($major -ge $MIN_NODE_VER) {
            Write-Ok "Node.js v${ver}"
            return
        }
        Write-Warn "Node.js v${ver} 版本过低"
    }
    Install-NodeJs

    # 再次检查
    $nodeExe = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeExe) {
        # 可能需要重启 shell 刷新 PATH，尝试常见路径
        $commonPaths = @(
            "$env:ProgramFiles\nodejs\node.exe",
            "${env:ProgramFiles(x86)}\nodejs\node.exe",
            "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
            "$env:APPDATA\npm\node.exe"
        )
        foreach ($p in $commonPaths) {
            if (Test-Path $p) {
                $env:Path += ";$(Split-Path $p)"
                break
            }
        }
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Fail "Node.js 安装失败，请手动安装: https://nodejs.org/"
        Read-Host "按 Enter 退出"
        exit 1
    }
    Write-Ok "Node.js $(node -v)"
}

Check-Node

# ── 2. 检测 npm ──────────────────────────────────────────────
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Fail "npm 未找到"
    Read-Host "按 Enter 退出"
    exit 1
}
Write-Ok "npm $(npm -v)"

# ── 3. 检测 Chrome ──────────────────────────────────────────
$chromePath = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromePath) {
    $chromePath = Get-Command chrome -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}
if (-not $chromePath) {
    $chromePath = Get-Command chromium -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if ($chromePath) {
    Write-Ok "Chrome: $chromePath"
} else {
    Write-Warn "未找到 Chrome，请手动安装后运行 start.bat 启动调试浏览器"
}

# ── 4. 克隆仓库 ──────────────────────────────────────────────
if (Test-Path $INSTALL_DIR) {
    Write-Info "更新已有安装..."
    Set-Location $INSTALL_DIR
    if (Test-Path ".git") {
        if (Test-Path "config.yaml") { Copy-Item config.yaml config.yaml.bak }
        # git 非零退出不应中断脚本
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $fetchOut = git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch origin main 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Warn "fetch 失败:`n$fetchOut" }
        $resetOut = git reset --hard origin/main 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Warn "reset 失败:`n$resetOut" }
        $ErrorActionPreference = $oldEAP
        if (Test-Path "config.yaml.bak") { Move-Item config.yaml.bak config.yaml -Force }
        if ($LASTEXITCODE -eq 0) { Write-Ok "已更新" }
    }
} else {
    Write-Info "下载 zero-token..."
    try {
        git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 clone --depth 1 $REPO_URL $INSTALL_DIR 2>$null
    } catch {
        Write-Warn "git clone 失败，使用镜像下载..."
        $zipUrl = "https://gh-proxy.com/https://github.com/uplusplus/zero-token/archive/refs/heads/main.zip"
        $zipPath = "$env:TEMP\zero-token.zip"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
        Move-Item "$env:TEMP\zero-token-main" $INSTALL_DIR
        Remove-Item $zipPath -Force
    }
    Set-Location $INSTALL_DIR
}

# ── 5. 安装依赖 & 构建 ──────────────────────────────────────
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"

Write-Info "安装依赖..."
npm ci 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { npm install 2>&1 | Out-Null }
Write-Ok "依赖安装完成"

Write-Info "Build project..."
$buildOut = & npx tsdown 2>&1
$buildExit = $LASTEXITCODE
$buildOut | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) {
        $msg = $_.Exception.Message
        if ($msg -notmatch '^System\.Management\.Automation\.RemoteException$') { Write-Host $msg }
    }
    else { Write-Host $_ }
}
if ($buildExit -ne 0) {
    Write-Fail "Build failed"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "Build complete"

npm prune --omit=dev 2>$null

$ErrorActionPreference = $oldEAP

# ── 6. 创建启动脚本 ──────────────────────────────────────────
$startBat = @"
@echo off
cd /d "$INSTALL_DIR"
set SERVER_PORT=$SERVER_PORT
set CDP_PORT=$CDP_PORT

echo.
echo ┌─────────────────────────────────────┐
echo │       zero-token  启动中...         │
echo └─────────────────────────────────────┘
echo.

REM 启动 Chrome（调试模式）
set "CHROME="
for %%P in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) do (
    if exist %%P set "CHROME=%%P"
)

if defined CHROME (
    echo [INFO] 启动 Chrome (CDP port %CDP_PORT%)...
    start "" %CHROME% --remote-debugging-port=%CDP_PORT% --user-data-dir="%USERPROFILE%\.zero-token\chrome-data" --no-first-run --no-default-browser-check --remote-allow-origins=* --no-sandbox
    timeout /t 3 /nobreak >nul

    REM 打开各平台登录页
    echo [INFO] 打开 Provider 登录页...
    for %%U in (
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
    ) do (
        curl -s -o nul -X PUT "http://localhost:%CDP_PORT%/json/new?%%~U" 2>nul
    )

    echo.
    echo [INFO] 请在 Chrome 标签页中登录需要的平台
    echo [INFO] 登录完成后，按任意键继续...
    pause >nul

    REM 抓取凭据
    echo.
    echo [INFO] 抓取登录凭据...
    node scripts\onboard.mjs --all
) else (
    echo [WARN] 未找到 Chrome，跳过 Web Provider 登录
)

REM 打开健康检查页
timeout /t 3 /nobreak >nul
curl -s -o nul -X PUT "http://localhost:%CDP_PORT%/json/new?http://localhost:%SERVER_PORT%/health" 2>nul

echo.
echo [INFO] 启动 zero-token 服务 (端口: %SERVER_PORT%)...
echo [INFO] 按 Ctrl+C 停止服务
echo.
node dist\server.mjs
"@
$startBat | Out-File -FilePath "$INSTALL_DIR\start.bat" -Encoding ASCII

# ── 7. 默认配置 ──────────────────────────────────────────────
if (-not (Test-Path "$INSTALL_DIR\config.yaml")) {
    if (Test-Path "$INSTALL_DIR\config.yaml.example") {
        Copy-Item "$INSTALL_DIR\config.yaml.example" "$INSTALL_DIR\config.yaml"
    }
}

# ── 完成 ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "┌─────────────────────────────────────┐" -ForegroundColor Green
Write-Host "│         安装完成！                  │" -ForegroundColor Green
Write-Host "└─────────────────────────────────────┘" -ForegroundColor Green
Write-Host ""
Write-Host "  安装目录    $INSTALL_DIR"
Write-Host "  启动命令    $INSTALL_DIR\start.bat"
Write-Host "  配置文件    $INSTALL_DIR\config.yaml"
Write-Host ""
Write-Host "  双击 start.bat 即可启动" -ForegroundColor Cyan
Write-Host ""

# 询问是否立即启动
$answer = Read-Host "是否立即启动? (Y/n)"
if ($answer -ne 'n' -and $answer -ne 'N') {
    Set-Location $INSTALL_DIR
    & "$INSTALL_DIR\start.bat"
}
