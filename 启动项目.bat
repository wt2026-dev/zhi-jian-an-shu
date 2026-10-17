@echo off
chcp 65001 >nul
title 智检安枢 - 一键启动
echo ============================================
echo   智检安枢 一键启动
echo ============================================
echo.

rem ---- 1. 检查 Docker 引擎 ----
docker ps >nul 2>&1
if %errorlevel%==0 (
    echo [1/3] Docker 引擎运行中
) else (
    echo [1/3] Docker 未运行，正在启动 Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    set /a wait=0
    :wait_docker
    set /a wait+=1
    timeout /t 5 /nobreak >nul
    docker ps >nul 2>&1
    if not %errorlevel%==0 (
        if %wait% lss 24 goto wait_docker
        echo [!] Docker 引擎启动超时，请检查 Docker Desktop
        pause
        exit /b 1
    )
    echo     Docker 引擎就绪（约 %wait%0 秒）
)

rem ---- 1.5 启动守护（自动防掉线/自愈） ----
powershell -Command "if (-not (Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*docker-guard.ps1*' })) { Start-Process powershell -ArgumentList '-ExecutionPolicy','Bypass','-File','C:\Users\26783\docker-guard.ps1' -WindowStyle Minimized }" >nul 2>&1

rem ---- 1.8 检查容器状态，异常则自动从备份恢复 ----
docker inspect -f "{{.State.Status}}" industrial-maintenance-app > %temp%\cst.txt 2>nul
set /p cst=<%temp%\cst.txt
if "%cst%"=="restarting" goto need_restore
if "%cst%"=="exited" goto need_restore
if "%cst%"=="dead" goto need_restore
if "%cst%"=="" goto need_restore
goto no_restore
:need_restore
echo [!] 检测到容器异常，正在从备份自动恢复（约1分钟）...
powershell -ExecutionPolicy Bypass -File "C:\Users\26783\docker-restore.ps1"
:no_restore

rem ---- 2. 等待后端就绪 ----
echo [2/3] 等待后端服务就绪...
set /a wait=0
:wait_backend
set /a wait+=1
timeout /t 5 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://localhost:3000/ > %temp%\health.txt 2>nul
set /p code=<%temp%\health.txt
if not "%code%"=="200" (
    if %wait% lss 12 goto wait_backend
    echo [!] 后端启动超时，请检查容器状态
    pause
    exit /b 1
)
echo     ✅ 后端就绪 (HTTP 200)

rem ---- 3. 打开浏览器 ----
echo [3/3] 打开管理端页面...
start http://localhost:3000/
echo.
echo ✅ 启动完成！浏览器已打开管理端
echo    账号: admin  密码: Admin@2026#Demo（各角色独立强密码见 README）
echo.
pause
