// npm run build: 이 앱은 번들링이 필요 없어서, 배포 전에 모든 JS 문법과 마이그레이션 파일·필수 파일을 확인합니다.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'); let n = 0;
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (['node_modules', '.git', 'docs', 'data'].includes(f)) continue; if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) { execFileSync(process.execPath, ['--check', p]); n++; } } })(root);
['public/index.html', 'public/manifest.webmanifest', 'public/sw.js', 'migrations/001_init.sql', 'render.yaml'].forEach((f) => { if (!fs.existsSync(path.join(root, f))) throw new Error('없는 파일: ' + f); });
console.log('빌드 확인 완료: JS ' + n + '개 문법 정상, 필수 파일 정상');
