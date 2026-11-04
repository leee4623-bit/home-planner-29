#!/data/data/com.termux/files/usr/bin/bash
# 재무플래너 — 폰에서 서버 켜기 (Termux)
#   fp-start            서버 + 외부 접속 주소(https, cloudflared가 있으면)
#   fp-start --local    서버만(같은 와이파이 안에서만 접속)
APP="$HOME/home-planner-29"
export FP_DB="${FP_DB:-$HOME/fp-data/planner.db}"   # 데이터는 앱 폴더 밖에 보관(업데이트해도 유지)
export PORT="${PORT:-8080}"
mkdir -p "$(dirname "$FP_DB")"
command -v termux-wake-lock >/dev/null && termux-wake-lock   # 화면이 꺼져도 서버가 잠들지 않게
cd "$APP" || { echo "앱 폴더가 없습니다. setup.sh를 먼저 실행하세요."; exit 1; }
node --no-warnings server/server.js &
NODE_PID=$!
cleanup() { kill $NODE_PID 2>/dev/null; [ -n "$CF_PID" ] && kill $CF_PID 2>/dev/null; command -v termux-wake-unlock >/dev/null && termux-wake-unlock; echo "서버를 껐습니다."; }
trap cleanup EXIT INT TERM
sleep 2
kill -0 $NODE_PID 2>/dev/null || { echo "서버를 시작하지 못했습니다. 위 오류를 확인하세요."; exit 1; }
IP=$(ip -4 addr show wlan0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1)
[ -z "$IP" ] && IP=$(ifconfig wlan0 2>/dev/null | awk '/inet /{print $2}')
echo ""
echo "================ 재무플래너 서버 실행 중 ================"
echo " 이 폰에서:          http://localhost:$PORT   (크롬에서 열고 '앱 설치' 가능)"
[ -n "$IP" ] && echo " 같은 와이파이 기기: http://$IP:$PORT   (설치 아이콘은 안 생길 수 있음)"
echo " 데이터 파일:        $FP_DB"
echo " 끄려면 Ctrl+C (Termux 키보드의 CTRL 누른 뒤 C)"
if [ "$1" != "--local" ] && command -v cloudflared >/dev/null; then
  LOG="$HOME/fp-data/tunnel.log"; : > "$LOG"
  cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > "$LOG" 2>&1 &
  CF_PID=$!
  for i in $(seq 1 30); do URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1); [ -n "$URL" ] && break; sleep 1; done
  if [ -n "$URL" ]; then echo " 어디서나(https):    $URL   ← 다른 폰에서 열고 설치"; else echo " 외부 주소를 만들지 못했습니다(인터넷 연결 확인). 와이파이 주소로 접속하세요."; fi
fi
echo "========================================================"
wait $NODE_PID
