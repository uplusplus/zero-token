@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
title llmgw Gateway

:: ─── 路径与端口 ────────────────────────────────────────────
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
set "CDP_PORT=9222"
set "SERVER_PORT=8080"
set "CHROME_DATA=%USERPROFILE%\.llmgw\chrome-data"
set "LOG_FILE=%SCRIPT_DIR%logs\llmgw.log"

:: ─── 颜色 (Windows 10+ ANSI) ─────────────────────────────
set "GREEN=[92m"
set "YELLOW=[93m"
set "RED=[91m"
set "CYAN=[96m"
set "RESET=[0m"

:: ─── 主菜单 ──────────────────────────────────────────────
:MENU
cls
echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║        llmgw  —  OpenAI 兼容网关启动面板        ║
echo  ║        Zero Token Cost via Browser LLMs         ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo    [1] 一键启动 (Chrome → 登录页 → 网关)
echo    [2] 启动 Chrome 调试模式
echo    [3] 打开平台登录页
echo    [4] 运行授权向导 (onboard)
echo    [5] 启动网关服务
echo    [6] 停止网关服务
echo    [7] 重启网关服务
echo    [8] 查看状态
echo    [9] 安装 / 构建 (npm install + build)
echo    [0] 清理重建 (dist + node_modules)
echo    [Q] 退出
echo.
set /p "choice=请选择 [1-9 / 0 / Q]: "
if /i "%choice%"=="1" goto :ONE_CLICK
if /i "%choice%"=="2" goto :START_CHROME
if /i "%choice%"=="3" goto :OPEN_LOGINS
if /i "%choice%"=="4" goto :ONBOARD
if /i "%choice%"=="5" goto :START_GATEWAY
if /i "%choice%"=="6" goto :STOP_GATEWAY
if /i "%choice%"=="7" goto :RESTART_GATEWAY
if /i "%choice%"=="8" goto :STATUS
if /i "%choice%"=="9" goto :BUILD
if /i "%choice%"=="0" goto :CLEAN_BUILD
if /i "%choice%"=="Q" goto :EOF
goto :MENU

:: ═══════════════════════════════════════════════════════════
:: [1] 一键启动
:: ═══════════════════════════════════════════════════════════
:ONE_CLICK
call :CHECK_NODE
if errorlevel 1 goto :MENU
call :CHECK_AND_BUILD
if errorlevel 1 goto :MENU
call :START_CHROME_CORE
echo.
call :OPEN_LOGINS_CORE
echo.
echo  %GREEN%已打开各平台登录页面%RESET%
echo  请在浏览器中登录需要使用的平台
echo  登录完成后按任意键继续...
pause >nul
call :ONBOARD_CORE
echo.
echo  按任意键启动网关服务...
pause >nul
call :START_GATEWAY_CORE
goto :MENU

:: ═══════════════════════════════════════════════════════════
:: [2] 启动 Chrome 调试模式
:: ═══════════════════════════════════════════════════════════
:START_CHROME
call :START_CHROME_CORE
echo.
pause
goto :MENU

:START_CHROME_CORE
echo.
echo  %CYAN%[Chrome] 检测浏览器...%RESET%

:: 检测 Chrome 路径
set "CHROME_PATH="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_PATH if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_PATH if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_PATH if exist "%ProgramFiles%\Chromium\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles%\Chromium\Application\chrome.exe"
)
if not defined CHROME_PATH if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "CHROME_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
    echo  %YELLOW%⚠ 未找到 Chrome，使用 Edge 替代%RESET%
)
if not defined CHROME_PATH if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
    echo  %YELLOW%⚠ 未找到 Chrome，使用 Edge 替代%RESET%
)

if not defined CHROME_PATH (
    echo  %RED%✗ 未找到 Chrome / Chromium / Edge%RESET%
    echo  请安装 Chrome: https://www.google.com/chrome/
    pause
    exit /b 1
)

echo  浏览器: !CHROME_PATH!
echo  数据目录: %CHROME_DATA%
echo.

:: 关闭已有调试实例
echo  %CYAN%[Chrome] 检查已有调试实例...%RESET%
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%CDP_PORT% " ^| findstr "LISTENING" 2^>nul') do (
    echo  停止旧调试进程 (PID: %%p)...
    taskkill /PID %%p /F >nul 2>&1
    timeout /t 1 /nobreak >nul
)

:: 启动 Chrome
if not exist "%CHROME_DATA%" mkdir "%CHROME_DATA%"
echo  %CYAN%[Chrome] 启动调试模式 (端口 %CDP_PORT%)...%RESET%
start "llmgw-browser" "!CHROME_PATH!" ^
    --remote-debugging-port=%CDP_PORT% ^
    --user-data-dir="%CHROME_DATA%" ^
    --no-first-run ^
    --no-default-browser-check ^
    --remote-allow-origins=* ^
    --disable-gpu ^
    --disable-dev-shm-usage

:: 等待就绪
echo  等待 Chrome 启动...
set "CDP_OK=0"
for /l %%i in (1,1,15) do (
    curl -s -o nul --connect-timeout 1 http://127.0.0.1:%CDP_PORT%/json/version >nul 2>&1
    if !errorlevel! == 0 (
        set "CDP_OK=1"
        goto :chrome_ready
    )
    echo  . | set /p "=."
    timeout /t 1 /nobreak >nul
)

:chrome_ready
echo.
if "!CDP_OK!"=="1" (
    echo  %GREEN%✓ Chrome 调试模式启动成功！%RESET%
    echo  CDP 端口: http://127.0.0.1:%CDP_PORT%
    echo  数据目录: %CHROME_DATA%
) else (
    echo  %YELLOW%⚠ Chrome 可能未完全就绪，请稍后检查%RESET%
)
exit /b 0

:: ═══════════════════════════════════════════════════════════
:: [3] 打开平台登录页
:: ═══════════════════════════════════════════════════════════
:OPEN_LOGINS
call :OPEN_LOGINS_CORE
echo.
pause
goto :MENU

:OPEN_LOGINS_CORE
echo.
echo  %CYAN%[登录] 打开各平台登录页面...%RESET%
set "URLS=https://chat.deepseek.com/ https://claude.ai/new https://chatgpt.com https://www.kimi.com https://www.doubao.com/chat/ https://chat.qwen.ai https://gemini.google.com/app https://grok.com https://chatglm.cn https://chat.z.ai/"
for %%u in (%URLS%) do (
    start "" "%%u"
    timeout /t 1 /nobreak >nul
)
echo  %GREEN%✓ 已打开 10 个平台登录页%RESET%
exit /b 0

:: ═══════════════════════════════════════════════════════════
:: [4] 运行授权向导
:: ═══════════════════════════════════════════════════════════
:ONBOARD
call :CHECK_NODE
if errorlevel 1 goto :MENU
:ONBOARD_CORE
echo.
echo  %CYAN%[Onboard] 检查 Chrome 连接...%RESET%
curl -s -o nul --connect-timeout 1 http://127.0.0.1:%CDP_PORT%/json/version >nul 2>&1
if errorlevel 1 (
    echo  %YELLOW%⚠ Chrome 调试模式未运行 (端口 %CDP_PORT%)%RESET%
    echo  请先按 [2] 启动 Chrome 调试模式
    pause
    goto :MENU
)

echo  %GREEN%Chrome 已连接%RESET%
echo.
echo  %CYAN%[Onboard] 运行授权向导...%RESET%
echo.

:: 检查 python3 (onboard.sh 依赖)
where python3 >nul 2>&1
if errorlevel 1 (
    where python >nul 2>&1
    if errorlevel 1 (
        echo  %YELLOW%⚠ 未找到 Python，onboard 需要 Python3%RESET%
        echo  安装: https://www.python.org/downloads/
        echo.
        echo  手动获取 auth:
        echo  1. 打开 Chrome DevTools (F12) → Application → Cookies
        echo  2. 复制 cookie 字符串
        echo  3. 粘贴到 config.yaml 的 providers.auth 中
        pause
        goto :MENU
    )
)

:: 尝试运行 onboard 脚本
if exist "%SCRIPT_DIR%scripts\onboard.sh" (
    echo  运行 onboard.sh...
    bash "%SCRIPT_DIR%scripts\onboard.sh"
) else (
    echo  %YELLOW%⚠ scripts\onboard.sh 不存在%RESET%
    echo.
    echo  手动获取 auth:
    echo  1. 在 Chrome 中登录各平台
    echo  2. 按 F12 → Application → Cookies
    echo  3. 复制 cookie 字符串到 config.yaml
    echo.
    echo  config.yaml 示例:
    echo    providers:
    echo      - id: deepseek-web
    echo        enabled: true
    echo        auth:
    echo          cookie: "your_cookie_here"
)
echo.
pause
goto :MENU

:: ═══════════════════════════════════════════════════════════
:: [5] 启动网关服务
:: ═══════════════════════════════════════════════════════════
:START_GATEWAY
call :CHECK_NODE
if errorlevel 1 goto :MENU
call :CHECK_AND_BUILD
if errorlevel 1 goto :MENU
:START_GATEWAY_CORE
echo.
echo  %CYAN%[Gateway] 启动服务...%RESET%

:: 停止旧实例
call :STOP_GATEWAY_CORE >nul 2>&1

:: 确保日志目录
if not exist "%SCRIPT_DIR%logs" mkdir "%SCRIPT_DIR%logs"

echo  配置文件: %SCRIPT_DIR%config.yaml
echo  日志文件: %LOG_FILE%
echo  端口: %SERVER_PORT%
echo.

:: 启动 (后台)
start /b "llmgw-gateway" node "%SCRIPT_DIR%dist\server.mjs" > "%LOG_FILE%" 2>&1

:: 等待就绪
echo  %CYAN%[Gateway] 等待就绪...%RESET%
set "GW_OK=0"
for /l %%i in (1,1,30) do (
    curl -s -o nul --connect-timeout 1 http://127.0.0.1:%SERVER_PORT%/health >nul 2>&1
    if !errorlevel! == 0 (
        set "GW_OK=1"
        echo.
        echo  %GREEN%Gateway 已就绪 (%%i 秒)%RESET%
        goto :gw_ready
    )
    echo  . | set /p "=."
    timeout /t 1 /nobreak >nul
)

:gw_ready
echo.
if "!GW_OK!"=="1" (
    set "HEALTH_URL=http://127.0.0.1:%SERVER_PORT%/health"
    echo  %GREEN%✓ llmgw Gateway 已启动%RESET%
    echo.
    echo  端点:
    echo    POST http://127.0.0.1:%SERVER_PORT%/v1/chat/completions
    echo    GET  http://127.0.0.1:%SERVER_PORT%/v1/models
    echo    GET  !HEALTH_URL!
    echo.
    echo  正在打开健康检查页面...
    start "" "!HEALTH_URL!"
) else (
    echo  %YELLOW%⚠ Gateway 未在 30s 内就绪%RESET%
    echo  查看日志: %LOG_FILE%
    echo  手动检查: http://127.0.0.1:%SERVER_PORT%/health
)
echo.
pause
goto :MENU

:: ═══════════════════════════════════════════════════════════
:: [6] 停止网关服务
:: ═══════════════════════════════════════════════════════════
:STOP_GATEWAY
call :STOP_GATEWAY_CORE
echo.
pause
goto :MENU

:STOP_GATEWAY_CORE
echo.
echo  %CYAN%[Gateway] 停止服务...%RESET%

:: 通过端口查找并停止
set "FOUND=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%SERVER_PORT% " ^| findstr "LISTENING" 2^>nul') do (
    echo  停止占用端口 %SERVER_PORT% 的进程 (PID: %%p)...
    taskkill /PID %%p /F >nul 2>&1
    set "FOUND=1"
    timeout /t 1 /nobreak >nul
)

:: 按窗口标题兜底
taskkill /FI "WINDOWTITLE eq llmgw-gateway*" /F >nul 2>&1

if "!FOUND!"=="1" (
    echo  %GREEN%✓ Gateway 已停止%RESET%
) else (
    echo  %YELLOW%Gateway 未在运行%RESET%
)
exit /b 0

:: ═══════════════════════════════════════════════════════════
:: [7] 重启网关服务
:: ═══════════════════════════════════════════════════════════
:RESTART_GATEWAY
call :CHECK_NODE
if errorlevel 1 goto :MENU
call :STOP_GATEWAY_CORE
timeout /t 2 /nobreak >nul
goto :START_GATEWAY_CORE

:: ═══════════════════════════════════════════════════════════
:: [8] 查看状态
:: ═══════════════════════════════════════════════════════════
:STATUS
echo.
echo  ══════════════════════════════════════
echo   llmgw 系统状态
echo  ══════════════════════════════════════
echo.

:: Node.js
where node >nul 2>&1
if !errorlevel! == 0 (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do echo   Node.js:  %%v
) else (
    echo   %RED%Node.js:  未安装%RESET%
)

:: npm
where npm >nul 2>&1
if !errorlevel! == 0 (
    for /f "tokens=*" %%v in ('npm --version 2^>nul') do echo   npm:      %%v
) else (
    echo   %YELLOW%npm:      未安装%RESET%
)

:: Chrome CDP
curl -s -o nul --connect-timeout 1 http://127.0.0.1:%CDP_PORT%/json/version >nul 2>&1
if !errorlevel! == 0 (
    echo   %GREEN%Chrome:   CDP 运行中 (端口 %CDP_PORT%)%RESET%
) else (
    echo   %YELLOW%Chrome:   未运行%RESET%
)

:: Gateway
curl -s -o nul --connect-timeout 1 http://127.0.0.1:%SERVER_PORT%/health >nul 2>&1
if !errorlevel! == 0 (
    echo   %GREEN%Gateway:  运行中 (端口 %SERVER_PORT%)%RESET%
    echo   Health:   http://127.0.0.1:%SERVER_PORT%/health

    :: 显示 models
    for /f "tokens=*" %%m in ('curl -s http://127.0.0.1:%SERVER_PORT%/v1/models 2^>nul ^| node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const ms=(d.data||[]).map(m=>m.id);console.log(ms.length?ms.join(', '):'无')}catch{console.log('解析失败')}" 2^>nul') do (
        echo   Models:   %%m
    )
) else (
    echo   %YELLOW%Gateway:  未运行%RESET%
)

:: 配置文件
if exist "%SCRIPT_DIR%config.yaml" (
    echo   %GREEN%配置:     config.yaml 已存在%RESET%
) else (
    echo   %YELLOW%配置:     config.yaml 不存在%RESET%
)

:: 构建状态
if exist "%SCRIPT_DIR%dist" (
    echo   %GREEN%构建:     dist/ 已构建%RESET%
) else (
    echo   %YELLOW%构建:     未构建%RESET%
)

:: node_modules
if exist "%SCRIPT_DIR%node_modules" (
    echo   %GREEN%依赖:     node_modules 已安装%RESET%
) else (
    echo   %YELLOW%依赖:     未安装%RESET%
)

echo.
pause
goto :MENU

:: ═══════════════════════════════════════════════════════════
:: [9] 安装 / 构建
:: ═══════════════════════════════════════════════════════════
:BUILD
call :CHECK_NODE
if errorlevel 1 goto :MENU
echo.

echo  %CYAN%[Build] 安装依赖...%RESET%
call npm install
if errorlevel 1 (
    echo  %RED%✗ npm install 失败%RESET%
    pause
    goto :MENU
)
echo  %GREEN%✓ 依赖安装完成%RESET%
echo.

echo  %CYAN%[Build] 编译项目...%RESET%
call npm run build
if errorlevel 1 (
    echo  %RED%✗ npm run build 失败%RESET%
    pause
    goto :MENU
)
echo  %GREEN%✓ 构建完成%RESET%
echo.
pause
goto :MENU

:: ═══════════════════════════════════════════════════════════
:: [0] 清理重建
:: ═══════════════════════════════════════════════════════════
:CLEAN_BUILD
call :CHECK_NODE
if errorlevel 1 goto :MENU
echo.

:: 先停止网关
call :STOP_GATEWAY_CORE >nul 2>&1

echo  %CYAN%[Clean] 清理旧构建...%RESET%
if exist "%SCRIPT_DIR%dist" rmdir /s /q "%SCRIPT_DIR%dist"
if exist "%SCRIPT_DIR%node_modules" rmdir /s /q "%SCRIPT_DIR%node_modules"
echo  %GREEN%✓ 已清理 dist/ 和 node_modules/%RESET%
echo.

goto :BUILD

:: ═══════════════════════════════════════════════════════════
:: 工具函数
:: ═══════════════════════════════════════════════════════════
:CHECK_NODE
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo  %RED%✗ 未找到 Node.js%RESET%
    echo  请安装 Node.js 22+: https://nodejs.org
    echo.
    pause
    exit /b 1
)
exit /b 0

:CHECK_AND_BUILD
if not exist "%SCRIPT_DIR%dist" (
    echo.
    echo  %YELLOW%⚠ 项目未构建 (dist/ 不存在)%RESET%
    echo  正在自动构建...
    echo.
    call :BUILD
    if not exist "%SCRIPT_DIR%dist" (
        echo  %RED%✗ 构建失败，无法启动%RESET%
        pause
        exit /b 1
    )
)
exit /b 0
