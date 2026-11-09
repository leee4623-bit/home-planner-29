// docs/(GitHub Pages 배포본)가 루트의 앱 파일과 같은지 확인한다. 다르면 `node scripts/sync-docs.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { siteFiles, ROOT, OUT } = require('../scripts/sync-docs.js');

test('docs/가 앱 파일과 같다', () => {
  const diff = siteFiles().filter((rel) => {
    const dst = path.join(OUT, rel);
    return !fs.existsSync(dst) || !fs.readFileSync(dst).equals(fs.readFileSync(path.join(ROOT, rel)));
  });
  assert.deepEqual(diff, [], 'node scripts/sync-docs.js 를 실행하세요');
});
