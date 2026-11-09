// GitHub Pages가 main 브랜치의 /docs 폴더를 배포하므로, 앱 파일을 docs/에 그대로 복사한다.
// 앱 파일을 고친 뒤에는 `node scripts/sync-docs.js`를 실행한다(tests/docs-sync.test.js가 어긋남을 잡는다).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const SITE = ['index.html', 'style.css', 'sw.js', 'manifest.webmanifest', 'icons', 'src', 'data', 'tests/cases.js'];

function list(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs).sort().flatMap((n) => list(path.join(rel, n)));
  return [rel];
}

function siteFiles() {
  return SITE.flatMap(list);
}

function sync() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const rel of siteFiles()) {
    const dst = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  return siteFiles().length;
}

module.exports = { siteFiles, ROOT, OUT };
if (require.main === module) console.log('docs/에 ' + sync() + '개 파일을 복사했습니다.');
