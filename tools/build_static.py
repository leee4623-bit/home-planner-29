"""GitHub Pages용 시연판 만들기 → docs/
서버 대신 preview/mockApi.js(브라우저 안 시연 서버)를 넣고, 서비스 워커·설치는 그대로 동작합니다."""
import os, re, shutil
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(R, 'docs')
OUT = os.path.join(DOCS, 'demo')   # 서버 없는 시연판은 /demo/ 로, 첫 화면은 실제 서버로 안내
shutil.rmtree(DOCS, ignore_errors=True)
shutil.copytree(os.path.join(R, 'public'), OUT)
for f in ('admin.html', 'js/admin.js'): os.remove(os.path.join(OUT, f))  # 관리 화면은 서버판 전용
rd = lambda p: open(os.path.join(R, p), encoding='utf-8').read()
wr = lambda p, s: open(os.path.join(OUT, p), 'w', encoding='utf-8').write(s)
# 계좌 분류 규칙(서버 모듈)을 브라우저용으로
wr('js/linking.js', '(function(){var module={exports:{}};\n' + rd('server/linking/provider.js').replace("'use strict';", '') + '\nwindow.FP.Linking=module.exports;})();\n')
shutil.copy(os.path.join(R, 'public/js/data/sampleCase.js'), os.path.join(OUT, 'js/data/sampleCase.js'))
shutil.copy(os.path.join(R, 'preview/mockApi.js'), os.path.join(OUT, 'js/mockApi.js'))
wr('js/static.js', """window.FP_STATIC = true;
document.addEventListener('DOMContentLoaded', function () {
  var bar = document.createElement('div'); bar.className = 'preview-bar'; bar.setAttribute('role', 'note');
  bar.innerHTML = '<strong>시연판</strong> — 서버 없이 이 브라우저 안에서 동작합니다. 데이터는 이 기기(브라우저)에만 저장되며 <strong>다른 기기·설계사와 실시간 동기화되지 않습니다</strong>. 권한 분리도 시연용입니다(실제 동기화·보안은 서버판). <button type="button" class="link-btn" id="exportDemo">내 데이터 내보내기</button> · <button type="button" class="link-btn" id="resetDemo">시연 데이터 처음으로</button>';
  document.body.insertBefore(bar, document.body.firstChild);
  document.getElementById('exportDemo').addEventListener('click', function () {
    var d = FP.MockServer.exportData();
    if (!d) return FP.UI.toast('고객 계정으로 로그인한 뒤 내보낼 수 있습니다.', true);
    var txt = JSON.stringify(d, null, 2);
    if (!FP.UI.download('재무플래너-내보내기.json', txt, 'application/json')) FP.UI.dialog({ title: '내보내기', body: '<textarea rows="10" readonly>' + FP.UI.esc(txt) + '</textarea>' });
    else FP.UI.toast('파일을 받았습니다. 서버판의 ‘내 정보·실적 입력’ 아래 ‘기존 브라우저 데이터 가져오기’에서 내용을 확인한 뒤 가져올 수 있습니다.');
  });
  document.getElementById('resetDemo').addEventListener('click', function () {
    FP.UI.dialog({ title: '시연 데이터를 처음으로 되돌릴까요?', body: '<p>이 기기에서 저장한 계획 버전·기록·설문·알림이 모두 지워지고 처음 시연 상태로 돌아갑니다.</p>', actions: [{ text: '취소' }, { text: '처음으로', cls: 'btn-danger', onClick: function () { FP.MockServer.reset(); location.hash = ''; location.reload(); } }] });
  });
});
""")
h = rd('public/index.html')
h = h.replace('<script src="js/data/policies.js"></script>', '<script src="js/static.js"></script>\n<script src="js/data/policies.js"></script>')
h = h.replace('<script src="js/ui/app.js"></script>', '<script src="js/data/sampleCase.js"></script>\n<script src="js/linking.js"></script>\n<script src="js/mockApi.js"></script>\n<script src="js/ui/app.js"></script>')
h = h.replace('<title>재무플래너</title>', '<title>재무플래너 (시연판)</title>')
wr('index.html', h)
css = rd('public/css/styles.css') + '\n.preview-bar{background:var(--warn-bg);color:var(--fg);font-size:12.5px;padding:6px max(16px,env(safe-area-inset-right,0px)) 6px max(16px,env(safe-area-inset-left,0px));}\n'
wr('css/styles.css', css)
sw = rd('public/sw.js').replace("var VERSION = '", "var VERSION = 'static-").replace("'./js/ui/app.js',", "'./js/static.js', './js/data/sampleCase.js', './js/linking.js', './js/mockApi.js', './js/ui/app.js',")
wr('sw.js', sw)
open(os.path.join(DOCS, '.nojekyll'), 'w').close()
SERVER = 'https://home-planner-29.onrender.com/'
open(os.path.join(DOCS, 'index.html'), 'w', encoding='utf-8').write('''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>재무플래너</title><meta name="theme-color" content="#FFFFFF">
<style>body{font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#fff;color:#0F2A4A;max-width:560px;margin:0 auto;padding:40px 20px;line-height:1.6}a.btn{display:inline-block;background:#1F5FBF;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600}.muted{color:#5b6b80;font-size:14px}</style>
</head><body>
<h1>재무플래너</h1>
<p>실제 서버로 이동합니다. 고객과 설계사가 각자의 휴대폰·PC에서 같은 데이터를 실시간으로 씁니다.</p>
<p><a class="btn" id="go" href="''' + SERVER + '''">재무플래너 열기</a></p>
<p class="muted">무료 서버라 한동안 아무도 접속하지 않았다면 처음 열 때 1분 정도 걸릴 수 있습니다.<br>
앱으로 설치하려면 이동한 주소에서 설치하세요(안드로이드 ⋮ → 앱 설치, 아이폰 공유 → 홈 화면에 추가). 이 주소에서 예전에 설치한 앱은 지우고 새 주소에서 다시 설치하세요.</p>
<p class="muted">서버 없이 이 기기 안에서만 동작하는 <a href="demo/">오프라인 시연판</a>도 남겨 두었습니다(기기 간 동기화 없음).</p>
<script>
// 이 주소(github.io)에 예전 시연판 서비스 워커가 남아 있으면 정리(시연판 /demo/ 것은 유지)
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { if (r.scope.slice(-6) !== "/demo/") r.unregister(); }); });
setTimeout(function () { location.replace(''' + repr(SERVER) + '''); }, 1500);
</script>
</body></html>
''')
print('docs/ 생성 완료')
