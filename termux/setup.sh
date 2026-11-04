#!/data/data/com.termux/files/usr/bin/bash
# 재무플래너 — 안드로이드 폰(Termux)에 서버 설치
# Termux 앱에서 한 줄 실행:
#   curl -fsSL https://raw.githubusercontent.com/leee4623-bit/home-planner-29/main/termux/setup.sh | bash
set -e
echo "[1/4] 패키지 목록 갱신"
pkg update -y >/dev/null 2>&1 || true
echo "[2/4] Node.js · git · 접속 주소 도구(cloudflared) 설치"
pkg install -y nodejs git >/dev/null
pkg install -y cloudflared >/dev/null 2>&1 || echo "  (cloudflared 설치 실패 — 같은 와이파이 안에서만 접속 가능)"
V=$(node -p "process.versions.node")
node -e "const [a,b]=process.versions.node.split('.').map(Number); if (a<22||(a===22&&b<5)) process.exit(1)" || { echo "Node $V 은(는) 너무 오래됐습니다. 'pkg upgrade' 후 다시 실행하세요."; exit 1; }
node -e "require('node:sqlite')" 2>/dev/null || { echo "이 Node($V)에는 내장 SQLite가 없습니다. 'pkg upgrade nodejs' 후 다시 실행하세요."; exit 1; }
echo "  Node $V 확인"
echo "[3/4] 앱 내려받기"
if [ -d "$HOME/home-planner-29/.git" ]; then git -C "$HOME/home-planner-29" pull -q; else git clone -q --depth 1 https://github.com/leee4623-bit/home-planner-29 "$HOME/home-planner-29"; fi
echo "[4/4] 실행 명령 등록"
mkdir -p "$HOME/fp-data" "$PREFIX/bin"
cat > "$PREFIX/bin/fp-start" <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
exec bash "$HOME/home-planner-29/termux/start.sh" "$@"
EOS
chmod +x "$PREFIX/bin/fp-start"
echo ""
echo "설치 완료. 이제 Termux에서  fp-start  를 입력하면 서버가 켜집니다."
