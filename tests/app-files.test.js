// 앱 파일 구성 점검: index.html의 스크립트가 모두 있고, 서비스 워커가 모두 미리 받으며, ES 모듈을 쓰지 않는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test('index.html의 스크립트 파일이 모두 있다', () => {
  assert.ok(scripts.length > 20);
  for (const s of scripts) assert.ok(fs.existsSync(path.join(ROOT, s)), s);
});

test('ES 모듈·외부 주소를 쓰지 않는다(file://로 열 수 있게)', () => {
  assert.ok(!/type="module"/.test(html));
  assert.ok(!/src="https?:/.test(html));
  for (const s of scripts) {
    const src = fs.readFileSync(path.join(ROOT, s), 'utf8');
    assert.ok(!/^\s*(import|export)\s/m.test(src), s);
  }
});

test('서비스 워커가 앱 파일을 모두 미리 받는다', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  for (const f of ['index.html', 'style.css', 'manifest.webmanifest', ...scripts]) {
    assert.ok(sw.includes("'./" + f + "'"), f + ' 누락');
  }
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const i of man.icons) {
    assert.ok(fs.existsSync(path.join(ROOT, i.src)), i.src);
    assert.ok(sw.includes("'./" + i.src + "'"), i.src + ' 누락');
  }
});

// 모든 화면을 실제로 그려 보고(브라우저 없이 최소 DOM 흉내) 개발용 값이 글자로 노출되지 않는지 확인한다.
function bootApp() {
  const vm = require('node:vm');
  const target = { innerHTML: '', className: '' };
  const toast = { innerHTML: '' };
  const store = new Map();
  const ctx = {
    console,
    document: {
      readyState: 'complete',
      getElementById: (id) => (id === 'app' ? target : id === 'toast' ? toast : null),
      addEventListener() {},
      createElement: () => ({ click() {}, remove() {} }),
      body: { appendChild() {} }
    },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    location: { protocol: 'file:' },
    navigator: {},
    scrollTo() {},
    setTimeout,
    clearTimeout
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), ctx, { filename: s });
  return { P: ctx.Planner, target };
}

const BAD = /undefined|NaN|\[object Object\]|Infinity/;
function text(html) { return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' '); }

test('모든 고객·설계사 화면을 그려도 오류 화면이 없고 개발용 값이 노출되지 않는다', () => {
  const { P, target } = bootApp();
  const ui = P.ui;
  const views = [];
  for (const tab of ['home', 'record', 'plan', 'alerts']) views.push({ role: 'customer', tab });
  for (const more of [null, 'info', 'risk', 'products', 'data', 'install']) views.push({ role: 'customer', tab: 'more', more });
  for (const page of Object.keys(ui.plannerPages)) {
    if (page === 'tools') for (const tool of ['solver', 'scenario', 'income', 'policy', 'products']) views.push({ role: 'planner', plannerPage: page, tool });
    else views.push({ role: 'planner', plannerPage: page });
  }
  for (let i = 0; i < 4; i++) views.push({ role: 'customer', tab: 'home', tour: i });
  for (const v of views) {
    ui.setView(Object.assign({ tour: null, more: null }, v));
    const label = JSON.stringify(v);
    assert.ok(target.innerHTML.length > 500, label + ' 빈 화면');
    assert.ok(!target.innerHTML.includes('문제가 생겼어요'), label + ' 오류 화면');
    const t = text(target.innerHTML);
    const m = t.match(BAD);
    assert.ok(!m, label + ' 노출: …' + (m ? t.slice(Math.max(0, m.index - 40), m.index + 20) : ''));
  }
});
