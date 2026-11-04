/*
 * 시험용 서버 띄우기 — TEST_DATABASE_URL이 있으면 실제 Postgres, 없으면 메모리 SQLite
 *   TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/postgres?sslmode=disable node tests/api.test.js
 */
'use strict';
const { createServer } = require('../server/server.js');
const { open } = require('../server/db.js');

const TABLES = ['changes', 'idem', 'plan_offers', 'product_requests', 'products', 'product_meta', 'client_data', 'inquiries', 'eval_state', 'push_subs', 'auto_consent', 'notif_settings', 'notifications', 'revisions', 'month_closures', 'scheduled', 'baselines', 'strategy_sets', 'risk_profiles', 'sync_status', 'settings', 'transactions', 'accounts', 'records', 'plans', 'assignments', 'clients', 'sessions', 'audit', 'users'];

async function start(opts) {
  opts = opts || {};
  const url = process.env.TEST_DATABASE_URL;
  const db = await open(url ? { url } : { file: ':memory:' });
  if (url) await db.run('TRUNCATE ' + TABLES.join(', ') + ' RESTART IDENTITY CASCADE');
  const app = await createServer(Object.assign({ db, password: opts.password || 'pw-test', secureCookie: false, scheduler: false }, opts.server || {}));
  await new Promise((r) => app.server.listen(0, r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  async function login(email, password) {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FP-Request': '1' }, body: JSON.stringify({ email, password: password || opts.password || 'pw-test' }) });
    if (r.status !== 200) return null;
    return r.headers.get('set-cookie').split(';')[0];
  }
  const api = (ck) => async (m, p, b, h) => {
    const r = await fetch(base + p, { method: m, headers: Object.assign({ 'Content-Type': 'application/json', 'X-FP-Request': '1', Cookie: ck || '' }, h || {}), body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  // SSE 구독(시험용): 받은 이벤트를 배열에 쌓음
  function sse(ck, since) {
    const ctl = new AbortController(); const events = []; const waiters = [];
    const p = fetch(base + '/api/events' + (since ? '?since=' + since : ''), { headers: { Cookie: ck, Accept: 'text/event-stream' }, signal: ctl.signal }).then(async (r) => {
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = { event: 'message', data: null, id: null, at: Date.now() };
          block.split('\n').forEach((l) => { if (l.startsWith('event: ')) ev.event = l.slice(7); else if (l.startsWith('data: ')) ev.data = JSON.parse(l.slice(6)); else if (l.startsWith('id: ')) ev.id = Number(l.slice(4)); });
          if (ev.data !== null) { events.push(ev); waiters.slice().forEach((w) => w()); }
        }
      }
    }).catch(() => {});
    const waitFor = (pred, ms) => new Promise((resolve, reject) => {
      const check = () => { const e = events.find(pred); if (e) { waiters.splice(waiters.indexOf(check), 1); clearTimeout(t); resolve(e); } };
      const t = setTimeout(() => { waiters.splice(waiters.indexOf(check), 1); reject(new Error('이벤트를 받지 못함(' + (ms || 3000) + 'ms)')); }, ms || 3000);
      waiters.push(check); check();
    });
    return { events, waitFor, close: () => ctl.abort(), done: p };
  }
  async function stop() { app.stop(); app.server.closeAllConnections(); await new Promise((r) => app.server.close(r)); await db.close(); }
  return Object.assign(app, { base, login, api, sse, stopAll: stop, kind: db.kind });
}

function runner(title) {
  let passed = 0, failed = 0;
  console.log(title);
  return {
    test: async (name, fn) => { try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n    ')); } },
    done: () => { console.log('\n결과: ' + passed + '개 통과, ' + failed + '개 실패'); return failed; }
  };
}

module.exports = { start, runner };
