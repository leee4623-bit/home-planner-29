#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[안내] Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  open https://nodejs.org
  read -p "Enter를 누르면 닫힙니다."
  exit 1
fi
echo "서버를 켜는 중입니다. 잠시 후 브라우저가 열립니다. 이 창을 닫으면 앱도 꺼집니다."
(sleep 3; open http://localhost:8080) &
node --no-warnings server/server.js
