"""GitHub Pages용 시연판 만들기 → docs/
서버 대신 preview/mockApi.js(브라우저 안 시연 서버)를 넣고, 서비스 워커·설치는 그대로 동작합니다."""
import os, re, shutil
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(R, 'docs')
shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(os.path.join(R, 'public'), OUT)
rd = lambda p: open(os.path.join(R, p), encoding='utf-8').read()
wr = lambda p, s: open(os.path.join(OUT, p), 'w', encoding='utf-8').write(s)
# 계좌 분류 규칙(서버 모듈)을 브라우저용으로
wr('js/linking.js', '(function(){var module={exports:{}};\n' + rd('server/linking/provider.js').replace("'use strict';", '') + '\nwindow.FP.Linking=module.exports;})();\n')
shutil.copy(os.path.join(R, 'public/js/data/sampleCase.js'), os.path.join(OUT, 'js/data/sampleCase.js'))
shutil.copy(os.path.join(R, 'preview/mockApi.js'), os.path.join(OUT, 'js/mockApi.js'))
wr('js/static.js', """window.FP_STATIC = true;
document.addEventListener('DOMContentLoaded', function () {
  var bar = document.createElement('div'); bar.className = 'preview-bar'; bar.setAttribute('role', 'note');
  bar.innerHTML = '<strong>시연판</strong> — 서버 없이 이 브라우저 안에서 동작합니다. 데이터는 이 기기에만 저장되고, 권한 분리는 시연용입니다(실제 보안은 서버판). <button type="button" class="link-btn" id="resetDemo">시연 데이터 처음으로</button>';
  document.body.insertBefore(bar, document.body.firstChild);
  document.getElementById('resetDemo').addEventListener('click', function () {
    FP.UI.dialog({ title: '시연 데이터를 처음으로 되돌릴까요?', body: '<p>이 기기에서 저장한 계획 버전·기록·설문·알림이 모두 지워지고 처음 시연 상태로 돌아갑니다.</p>', actions: [{ text: '취소' }, { text: '처음으로', cls: 'btn-danger', onClick: function () { FP.MockServer.reset(); location.hash = ''; location.reload(); } }] });
  });
});
""")
h = rd('public/index.html')
h = h.replace('<script src="js/data/policies.js"></script>', '<script src="js/static.js"></script>\n<script src="js/data/policies.js"></script>')
h = h.replace('<script src="js/ui/app.js"></script>', '<script src="js/data/sampleCase.js"></script>\n<script src="js/linking.js"></script>\n<script src="js/mockApi.js"></script>\n<script src="js/ui/app.js"></script>')
h = h.replace('<title>내집마련 플래너 29</title>', '<title>내집마련 플래너 29 (시연판)</title>')
wr('index.html', h)
css = rd('public/css/styles.css') + '\n.preview-bar{background:var(--warn-bg);color:var(--fg);font-size:12.5px;padding:6px max(16px,env(safe-area-inset-right,0px)) 6px max(16px,env(safe-area-inset-left,0px));}\n'
wr('css/styles.css', css)
sw = rd('public/sw.js').replace("var VERSION = '", "var VERSION = 'static-").replace("'./js/ui/app.js',", "'./js/static.js', './js/data/sampleCase.js', './js/linking.js', './js/mockApi.js', './js/ui/app.js',")
wr('sw.js', sw)
open(os.path.join(OUT, '.nojekyll'), 'w').close()
print('docs/ 생성 완료')
