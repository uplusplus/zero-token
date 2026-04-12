#Requires -Version 5.1
<#
.SYNOPSIS
    zero-token Windows Installer
.DESCRIPTION
    Auto-detect/install Node.js, clone repo, install deps, build, and start service
.EXAMPLE
    irm https://raw.githubusercontent.com/uplusplus/zero-token/main/install.ps1 | iex
#>

# ── Config ─────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"
$REPO_URL = "https://github.com/uplusplus/zero-token.git"
$INSTALL_DIR = "$env:USERPROFILE\zero-token"
$MIN_NODE_VER = 22
$SERVER_PORT = if ($env:SERVER_PORT) { $env:SERVER_PORT } else { "8080" }
$CDP_PORT = 9333

# ── Color output ─────────────────────────────────────────────────
function Write-Info  { param($m) Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "[  OK] $m" -ForegroundColor Green }
function Write-Warn  { param($m) Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Fail  { param($m) Write-Host "[FAIL] $m" -ForegroundColor Red }

Write-Host ""
Write-Host "+-------------------------------------+" -ForegroundColor White
Write-Host "|       zero-token  Windows Installer   |" -ForegroundColor White
Write-Host "+-------------------------------------+" -ForegroundColor White
Write-Host ""

# ── 1. Check & Install Node.js ──────────────────────────────────
function Install-NodeJs {
    Write-Info "Installing Node.js ${MIN_NODE_VER}.x ..."

    # Prefer winget (user-level)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "Installing via winget..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    }
    # Then chocolatey
    elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Info "Installing via chocolatey..."
        choco install nodejs-lts -y
    }
    # Last resort: msi download
    else {
        $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
        $msiUrl = "https://nodejs.org/dist/v22.15.0/node-v22.15.0-${arch}.msi"
        $msiPath = "$env:TEMP\nodejs-installer.msi"
        Write-Info "Downloading Node.js installer..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        Write-Info "Running installer (may need admin)..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait
        Remove-Item $msiPath -Force

        # Refresh PATH
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
        Write-Warn "Node.js v${ver} too old, need >= ${MIN_NODE_VER}"
    }
    Install-NodeJs

    # Check again
    $nodeExe = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeExe) {
        #  shell  PATH，
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
        Write-Fail "Node.js install failed, install manually: https://nodejs.org/"
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Ok "Node.js $(node -v)"
}

Check-Node

# ── 2. Check npm ──────────────────────────────────────────────
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Fail "npm not found"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "npm $(npm -v)"

# ── 3. Check Chrome ──────────────────────────────────────────
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
    Write-Warn "Chrome not found, install it then run start.bat"
}

# ── 4. Clone repo ──────────────────────────────────────────────
if (Test-Path $INSTALL_DIR) {
    Write-Info "Updating existing install..."
    Set-Location $INSTALL_DIR
    if (Test-Path ".git") {
        if (Test-Path "config.yaml") { Copy-Item config.yaml config.yaml.bak }
        # git non-zero exit should not stop script
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $fetchOut = git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch origin main 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Warn "fetch failed:`n$fetchOut" }
        $resetOut = git reset --hard origin/main 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Warn "reset failed:`n$resetOut" }
        $ErrorActionPreference = $oldEAP
        if (Test-Path "config.yaml.bak") { Move-Item config.yaml.bak config.yaml -Force }
        if ($LASTEXITCODE -eq 0) { Write-Ok "Updated" }
    }
} else {
    Write-Info "Downloading zero-token..."
    try {
        git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 clone --depth 1 $REPO_URL $INSTALL_DIR 2>$null
    } catch {
        Write-Warn "git clone failed, using mirror..."
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

# ── 5. Install deps & Build ──────────────────────────────────────
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"

Write-Info "Installing dependencies..."
npm ci 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { npm install 2>&1 | Out-Null }
Write-Ok "Dependencies installed"

Write-Info "Build project..."
$buildOut = & npx tsdown 2>$null
$buildExit = $LASTEXITCODE
if ($buildOut) { $buildOut | Write-Host }
if ($buildExit -ne 0) {
    Write-Fail "Build failed, running again to show errors..."
    npx tsdown
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "Build complete"

npm prune --omit=dev 2>$null

$ErrorActionPreference = $oldEAP

# ── 6. Create start script ──────────────────────────────────────────
$startBat = @"
@echo off
chcp 65001 >nul
cd /d "$INSTALL_DIR"
set SERVER_PORT=$SERVER_PORT
set CDP_PORT=$CDP_PORT

echo.
echo +-------------------------------------+
echo |       zero-token  Starting...       |
echo +-------------------------------------+
echo.

REM Start Chrome (debug mode)
set "CHROME="
for %%P in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) do (
    if exist %%P set "CHROME=%%P"
)

if defined CHROME (
    echo [INFO] Starting Chrome (CDP port %CDP_PORT%)...
    start "" %CHROME% --remote-debugging-port=%CDP_PORT% --user-data-dir="%USERPROFILE%\.zero-token\chrome-data" --no-first-run --no-default-browser-check --remote-allow-origins=* --no-sandbox
    timeout /t 3 /nobreak >nul

    REM Open provider login pages
    echo [INFO] Opening Provider login pages...
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
    echo [INFO] Log in to the platforms you need in Chrome tabs
    echo [INFO] Press any key after logging in...
    pause >nul

    REM Capture credentials
    echo.
    echo [INFO] Capturing login credentials...
    node scripts\onboard.mjs --all
) else (
    echo [WARN] Chrome not found, skipping Web Provider login
)

REM Open health check page
timeout /t 3 /nobreak >nul
curl -s -o nul -X PUT "http://localhost:%CDP_PORT%/json/new?http://localhost:%SERVER_PORT%/health" 2>nul

echo.
echo [INFO] Starting zero-token service (port: %SERVER_PORT%)...
echo [INFO] Press Ctrl+C to stop
echo.
node dist\server.mjs
"@
$startBat | Out-File -FilePath "$INSTALL_DIR\start.bat" -Encoding ASCII

# ── 7. Default config ──────────────────────────────────────────────
if (-not (Test-Path "$INSTALL_DIR\config.yaml")) {
    if (Test-Path "$INSTALL_DIR\config.yaml.example") {
        Copy-Item "$INSTALL_DIR\config.yaml.example" "$INSTALL_DIR\config.yaml"
    }
}

# ── Done ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "+-------------------------------------+" -ForegroundColor Green
Write-Host "|         Install Complete!                  |" -ForegroundColor Green
Write-Host "+-------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "  Install dir   $INSTALL_DIR"
Write-Host "  Start script  $INSTALL_DIR\start.bat"
Write-Host "  Config file   $INSTALL_DIR\config.yaml"
Write-Host ""
Write-Host "  Double-click start.bat to start" -ForegroundColor Cyan
Write-Host ""

# Ask to start now
$answer = Read-Host "Start now? (Y/n)"
if ($answer -ne 'n' -and $answer -ne 'N') {
    Set-Location $INSTALL_DIR
    & "$INSTALL_DIR\start.bat"
}
