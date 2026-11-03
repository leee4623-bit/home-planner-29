"""claude.ai 미리보기용 한 파일 만들기 → dist/preview.html
서버 대신 preview/mockApi.js(브라우저 안 시연 서버)를 넣습니다."""
import os, re
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(R, p), encoding='utf-8').read()
html = rd('public/index.html')
body = html.split('<body>')[1].split('<script src="js/data/policies.js">')[0]
body = body.replace('(비밀번호는 README·서버 실행 화면 참고)', '(미리보기 비밀번호: demo-2026!)')
banner = ('<div class="preview-bar" role="note">미리보기 — 실제 서버 대신 이 브라우저 안의 시연 서버로 동작합니다. '
          '데이터는 이 브라우저에만 저장되고, 실제 보안(서버 권한 검사)은 배포본이 담당합니다. '
          '<button type="button" class="link-btn" id="resetDemo">시연 데이터 처음으로</button></div>')
body = body.replace('<header class="masthead">', banner + '\n<header class="masthead">', 1)
scripts = re.findall(r'<script src="(js/[^"]+)"></script>', html.split('<body>')[1])
order = []
for s in scripts:
    order.append('public/' + s)
    if s == 'js/ui/components.js':
        order += ['@linking', 'public/js/data/sampleCase.js', 'preview/mockApi.js']
js = []
for f in order:
    if f == '@linking':
        js.append('(function(){var module={exports:{}};\n' + rd('server/linking/provider.js').replace("'use strict';", '') + '\nwindow.FP.Linking=module.exports;})();')
    else:
        js.append(rd(f))
css = rd('public/css/styles.css') + '\n.preview-bar{background:var(--warn-bg);color:var(--fg);font-size:12.5px;padding:6px max(16px,env(safe-area-inset-right,0px)) 6px max(16px,env(safe-area-inset-left,0px));}\n'
reset = "document.getElementById('resetDemo').addEventListener('click',function(){FP.UI.dialog({title:'시연 데이터를 처음으로 되돌릴까요?',body:'<p>이 브라우저에서 저장한 계획 버전·기록·거래가 모두 지워지고 처음 시연 상태로 돌아갑니다.</p>',actions:[{text:'취소'},{text:'처음으로',cls:'btn-danger',onClick:function(){FP.MockServer.reset();location.hash='';location.reload();}}]});});"
out = ('<title>내집마련 플래너 29</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
       '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">\n'
       '<style>\n' + css + '\n</style>\n' + body + '\n<script>window.FP_PREVIEW = true;</script>\n<script>\n' + '\n'.join(j for j in js if 'fonts.googleapis' not in j or 'createElement' not in j) + '\n' + reset + '\n</script>\n')
os.makedirs(os.path.join(R, 'dist'), exist_ok=True)
open(os.path.join(R, 'dist/preview.html'), 'w', encoding='utf-8').write(out)
print('dist/preview.html', len(out))
