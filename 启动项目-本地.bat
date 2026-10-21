@echo off
chcp 65001 >nul
title 智检安枢 - 本地启动（无 Docker）
cd /d "%~dp0"

echo ============================================
echo   智检安枢 本地启动（不使用 Docker）
echo   前端 + 后端 + 嵌入式数据库（PGlite）
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [!] 未找到 node，请先安装 Node.js 20+
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [1/3] 首次运行，正在安装依赖（约 1-3 分钟）...
    call npm install
    if errorlevel 1 (
        echo [!] 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo [1/3] 依赖已就绪
)

echo [2/3] 启动服务...
echo       就绪后会自动打开浏览器 http://localhost:3000/
echo       关闭本窗口即停止服务
echo.

rem 后台等待端口就绪后再打开浏览器，避免"页面打不开"的错觉
rem 设 ZJAS_NO_BROWSER=1 可跳过自动开浏览器（自动化验证用）
if not "%ZJAS_NO_BROWSER%"=="1" (
    start "" powershell -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/' -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3000/'; break}catch{Start-Sleep -Seconds 2}}"
)

echo [3/3] 运行中（Ctrl+C 停止）
echo.
call npm run dev

echo.
echo [!] 服务已退出
pause
