@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 내집마련 플래너 서버
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [안내] Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 더블클릭하세요.
  start https://nodejs.org
  pause
  exit /b
)
echo.
echo 서버를 켜는 중입니다. 잠시 후 브라우저가 자동으로 열립니다.
echo 이 검은 창을 닫으면 앱도 꺼집니다.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8080"
node --no-warnings server\server.js
echo.
echo 서버가 멈췄습니다. 위의 메시지를 확인하세요.
pause
