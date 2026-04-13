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
function Write-Info  { param($m) Write-Host "  $m" -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "  $m" -ForegroundColor Green }
function Write-Warn  { param($m) Write-Host "  $m" -ForegroundColor Yellow }
function Write-Fail  { param($m) Write-Host "  $m" -ForegroundColor Red }

Write-Host ""
Write-Host "  +-------------------------------------+" -ForegroundColor White
Write-Host "  |     zero-token  Windows Installer    |" -ForegroundColor White
Write-Host "  +-------------------------------------+" -ForegroundColor White
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
        #  shell  PATH
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

# ── 3. Detect Chrome ──────────────────────────────────────────
$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromePath) {
    $cmd = Get-Command chrome -ErrorAction SilentlyContinue
    if ($cmd) { $chromePath = $cmd.Source }
}
if (-not $chromePath) {
    $cmd = Get-Command chromium -ErrorAction SilentlyContinue
    if ($cmd) { $chromePath = $cmd.Source }
}

if ($chromePath) {
    Write-Ok "Chrome: $chromePath"
} else {
    Write-Warn "Chrome not found, install Chrome then run start.bat manually"
    Write-Warn "Web-class providers will not be available"
}

# ── 4. Clone repo ──────────────────────────────────────────────
if (Test-Path $INSTALL_DIR) {
    Write-Info "Updating existing install..."
    Set-Location $INSTALL_DIR
    if (Test-Path ".git") {
        if (Test-Path "config.yaml") { Copy-Item config.yaml config.yaml.bak }
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
npm ci
if ($LASTEXITCODE -ne 0) {
    Write-Warn "npm ci failed, retrying with npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Dependency installation failed"
        $ErrorActionPreference = $oldEAP
        Read-Host "Press Enter to exit"
        exit 1
    }
}
Write-Ok "Dependencies installed"

Write-Info "Build project..."
npx tsdown
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Build failed"
    $ErrorActionPreference = $oldEAP
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "Build complete"

npm prune --omit=dev 2>$null

$ErrorActionPreference = $oldEAP

# ── 6. Default config ──────────────────────────────────────────────
if (-not (Test-Path "$INSTALL_DIR\config.yaml")) {
    if (Test-Path "$INSTALL_DIR\config.yaml.example") {
        Copy-Item "$INSTALL_DIR\config.yaml.example" "$INSTALL_DIR\config.yaml"
    }
}

# ── Done ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "  +-------------------------------------+" -ForegroundColor Green
Write-Host "  |       Install Complete!              |" -ForegroundColor Green
Write-Host "  +-------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "  Install dir    $INSTALL_DIR"
Write-Host "  Config file    $INSTALL_DIR\config.yaml"
Write-Host ""

# ── 7. Start Chrome & Open Provider Login Pages ──────────────────
if ($chromePath) {
    $chromeDataDir = "$env:USERPROFILE\.zero-token\chrome-data"

    # Create chrome data dir & clean singleton locks (separate profile = independent instance)
    New-Item -ItemType Directory -Force -Path $chromeDataDir | Out-Null
    Remove-Item "$chromeDataDir\SingletonLock" -Force -ErrorAction SilentlyContinue
    Remove-Item "$chromeDataDir\SingletonCookie" -Force -ErrorAction SilentlyContinue

    # Launch Chrome with CDP
    Write-Info "Starting Chrome (CDP port $CDP_PORT)..."
    $chromeArgs = @(
        "--remote-debugging-port=$CDP_PORT"
        "--user-data-dir=$chromeDataDir"
        "--no-first-run"
        "--no-default-browser-check"
        "--disable-background-networking"
        "--disable-sync"
        "--disable-translate"
        "--remote-allow-origins=*"
    )
    $chromeProc = Start-Process -FilePath $chromePath -ArgumentList $chromeArgs -PassThru

    # Wait for CDP to be ready
    Write-Info "Waiting for Chrome to be ready..."
    $ready = $false
    for ($i = 1; $i -le 15; $i++) {
        Start-Sleep -Seconds 1
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:$CDP_PORT/json/version" -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
    }

    if ($ready) {
        Write-Ok "Chrome CDP ready (http://localhost:$CDP_PORT)"

        # Open provider login pages via CDP
        $providerUrls = @(
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

        Write-Info "Opening provider login pages..."
        foreach ($url in $providerUrls) {
            try {
                Invoke-WebRequest -Uri "http://localhost:$CDP_PORT/json/new?$url" -Method PUT -UseBasicParsing -TimeoutSec 5 | Out-Null
            } catch { }
        }
        Write-Ok "Opened $($providerUrls.Count) provider login pages"

        Write-Host ""
        Write-Host "  Please log in to the platforms you need in Chrome tabs" -ForegroundColor Yellow
        Write-Host "  Press Enter after logging in..." -ForegroundColor Yellow
        Read-Host | Out-Null

        # Capture credentials
        if (Test-Path "$INSTALL_DIR\scripts\onboard.mjs") {
            Write-Info "Capturing login credentials..."
            Set-Location $INSTALL_DIR
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            node scripts\onboard.mjs --all
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "Credential capture failed, run manually later: cd $INSTALL_DIR && node scripts\onboard.mjs"
            }
            $ErrorActionPreference = $oldEAP
        }
    } else {
        Write-Warn "Chrome CDP not ready, skipping provider navigation"
        Write-Warn "You can start Chrome manually: `"$chromePath`" --remote-debugging-port=$CDP_PORT"
    }
} else {
    Write-Warn "Chrome not found, Web-class providers unavailable"
    Write-Warn "Install Chrome then run start.bat, or start Chrome manually with:"
    Write-Warn "  chrome --remote-debugging-port=$CDP_PORT"
}

# ── 8. Start Service ──────────────────────────────────────────
Write-Host ""
Write-Info "Starting zero-token service (port: $SERVER_PORT)..."
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

Set-Location $INSTALL_DIR
$env:NODE_ENV = "production"
$env:SERVER_PORT = $SERVER_PORT

# Open health check page in Chrome after a short delay
if ($ready -and $chromePath) {
    Start-Job -ScriptBlock {
        param($cdpPort, $serverPort)
        Start-Sleep -Seconds 3
        try {
            Invoke-WebRequest -Uri "http://localhost:$cdpPort/json/new?http://localhost:$serverPort/health" -Method PUT -UseBasicParsing -TimeoutSec 5 | Out-Null
        } catch { }
    } -ArgumentList $CDP_PORT, $SERVER_PORT | Out-Null
}

# Cleanup Chrome on exit
$cleanup = {
    param($chromePid, $chromeExe)
    if ($chromePid) {
        $p = Get-Process -Id $chromePid -ErrorAction SilentlyContinue
        if ($p) {
            Stop-Process -Id $chromePid -Force -ErrorAction SilentlyContinue
            Write-Host "  Chrome stopped" -ForegroundColor Green
        }
    }
}
try {
    node dist\server.mjs
} finally {
    if ($chromeProc -and -not $chromeProc.HasExited) {
        Write-Info "Stopping Chrome..."
        Stop-Process -Id $chromeProc.Id -Force -ErrorAction SilentlyContinue
        Write-Ok "Chrome stopped"
    }
    Write-Ok "zero-token stopped"
}
