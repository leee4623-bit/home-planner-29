#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js를 설치하세요: https://nodejs.org"; open https://nodejs.org; read -p "Enter"; exit 1; }
command -v cloudflared >/dev/null || { echo "연결 도구 설치(처음 한 번): brew install cloudflared"; command -v brew >/dev/null && brew install cloudflared || { echo "Homebrew가 없으면 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ 에서 설치하세요"; read -p "Enter"; exit 1; }; }
node --no-warnings server/server.js &
SERVER=$!
trap "kill $SERVER" EXIT
sleep 3
echo "아래 https://xxxx.trycloudflare.com 주소를 휴대폰에서 여세요. 이 창을 닫으면 끊깁니다."
cloudflared tunnel --no-autoupdate --url http://localhost:8080
