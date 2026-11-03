@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 휴대폰으로 열기
where node >nul 2>nul
if errorlevel 1 (
  echo [안내] Node.js가 없습니다. https://nodejs.org 에서 LTS를 설치한 뒤 다시 실행하세요.
  start https://nodejs.org
  pause
  exit /b
)
set "CF=cloudflared"
where cloudflared >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
  if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
)
if "%CF%"=="cloudflared" (
  where cloudflared >nul 2>nul
  if errorlevel 1 (
    echo 처음 한 번만 연결 도구(cloudflared^)를 설치합니다...
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
    if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
  )
)
echo.
echo 1) 앱 서버를 새 창에서 켭니다. (그 창도 닫지 마세요)
start "재무플래너 서버" cmd /k node --no-warnings server\server.js
timeout /t 3 >nul
echo 2) 휴대폰용 주소를 만듭니다. 아래에 나오는
echo    https://xxxx.trycloudflare.com  주소를 휴대폰에서 여세요.
echo    (카카오톡 나에게 보내기로 보내면 편합니다. 이 창을 닫으면 주소가 끊깁니다)
echo.
"%CF%" tunnel --no-autoupdate --url http://localhost:8080
echo.
echo 연결이 끊겼습니다. 위 메시지를 확인하세요.
pause
