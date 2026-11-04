/*
 * 배포 관련 검증: 관리자 API, 시연/운영 계정 분리, 세션 비밀키, (Postgres) 마이그레이션·백업 복구·서버 재시작 후 유지
 *   node --no-warnings tests/deploy.test.js
 *   TEST_DATABASE_URL=postgres://… node --no-warnings tests/deploy.test.js   (Postgres 항목 포함)
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { start, runner } = require('./helpers');
const { createServer } = require('../server/server.js');
const { open, migratePg } = require('../server/db.js');

(async () => {
  const R = runner('배포 검증'); const test = R.test;
  process.env.SESSION_SECRET = 'test-secret-'.repeat(4);
  process.env.FP_ADMIN_TOKEN = 'admin-token-for-test-only';

  // ---------- 관리자 API · 운영 모드 ----------
  const app = await start({ password: 'demo-pass-1', server: { demo: false } });
  const adm = (method, op, body, tok) => fetch(app.base + '/api/admin/' + op, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (tok === undefined ? process.env.FP_ADMIN_TOKEN : tok) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
  await test('운영 모드(FP_DEMO=0): 빈 DB에 시연 계정을 만들지 않음', async () => { assert.strictEqual(app.seeded, null); assert.strictEqual((await adm('GET', 'list')).body.users.length, 0); });
  await test('관리자 토큰이 틀리면 401', async () => { assert.strictEqual((await adm('GET', 'list', null, 'wrong')).status, 401); });
  await test('관리자 API로 계정 생성·배정 → 로그인·권한 동작', async () => {
    assert.strictEqual((await adm('POST', 'users', { email: 'p@real.kr', name: '실제설계사', role: 'planner', password: 'planner-pw-1' })).status, 200);
    assert.strictEqual((await adm('POST', 'users', { email: 'c@real.kr', name: '실제고객', role: 'client', password: 'short' })).status, 400, '8자 미만 비밀번호 거부');
    assert.strictEqual((await adm('POST', 'users', { email: 'c@real.kr', name: '실제고객', role: 'client', password: 'client-pw-1' })).status, 200);
    assert.strictEqual((await adm('POST', 'users', { email: 'x@real.kr', name: '관리자?', role: 'admin', password: 'xxxxxxxx1' })).status, 400, '정해진 역할만');
    const P = app.api(await app.login('p@real.kr', 'planner-pw-1'));
    assert.deepStrictEqual((await P('GET', '/api/clients')).body.clients, []);
    await adm('POST', 'assign', { planner: 'p@real.kr', client: 'c@real.kr' });
    assert.strictEqual((await P('GET', '/api/clients')).body.clients.length, 1);
  });
  await test('세션 토큰은 SESSION_SECRET HMAC으로만 저장', async () => {
    const ck = await app.login('c@real.kr', 'client-pw-1'); const tok = decodeURIComponent(ck.split('=')[1]);
    const rows = (await app.db.all('SELECT token_hash FROM sessions')).map((r) => r.token_hash);
    assert.ok(rows.includes(crypto.createHmac('sha256', process.env.SESSION_SECRET).update(tok).digest('hex')));
    assert.ok(!rows.includes(crypto.createHash('sha256').update(tok).digest('hex')));
  });
  await app.stopAll();

  await test('운영 모드에서는 시연 계정(공용 비밀번호) 로그인 차단', async () => {
    const a = await start({ password: 'demo-pass-1' }); // 시연 모드로 시연 계정 생성
    assert.ok(await a.login('client@demo.kr', 'demo-pass-1'));
    const a2 = await createServer({ db: a.db, password: 'demo-pass-1', secureCookie: false, scheduler: false, demo: false });
    await new Promise((r) => a2.server.listen(0, r));
    const r = await fetch('http://127.0.0.1:' + a2.server.address().port + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FP-Request': '1' }, body: JSON.stringify({ email: 'client@demo.kr', password: 'demo-pass-1' }) });
    assert.strictEqual(r.status, 401); assert.ok(/시연 모드/.test((await r.json()).error));
    assert.strictEqual(Number((await a.db.get('SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.demo = 1')).n), 0, '남은 시연 세션 정리');
    a2.server.close(); await a.stopAll();
  });
  await test('운영 환경(NODE_ENV=production)에서 SESSION_SECRET이 없으면 시작하지 않음', async () => {
    const out = execFileSync(process.execPath, ['--no-warnings', '-e', "require('./server/server.js').createServer({ dbFile: ':memory:', scheduler: false }).then(()=>console.log('started'),(e)=>console.log('refused:'+e.message))"], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { NODE_ENV: 'production', SESSION_SECRET: '', DATABASE_URL: '' }) }).toString();
    assert.ok(out.startsWith('refused:') && /SESSION_SECRET/.test(out), out);
  });

  // ---------- Postgres ----------
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const sch = 'fp_deploy_test';
    const admin = await open({ url });
    await admin.run('DROP SCHEMA IF EXISTS ' + sch + ' CASCADE'); await admin.run('DROP SCHEMA IF EXISTS ' + sch + '_r CASCADE');
    await admin.run('CREATE SCHEMA ' + sch); await admin.run('CREATE SCHEMA ' + sch + '_r');
    const u1 = url + (url.includes('?') ? '&' : '?') + 'options=' + encodeURIComponent('-c search_path=' + sch);
    const u2 = url + (url.includes('?') ? '&' : '?') + 'options=' + encodeURIComponent('-c search_path=' + sch + '_r');
    await test('마이그레이션: 빈 DB에 적용 → 다시 실행해도 변경 없음', async () => {
      const c = require('../server/pg.js').createClient(u1);
      const a = await migratePg(c); const b = await migratePg(c); c.end();
      assert.strictEqual(a.applied.length, a.total); assert.strictEqual(b.applied.length, 0);
    });
    let vapid1;
    await test('서버를 껐다 켜도(재시작) 저장한 데이터·로그인·푸시 키 유지', async () => {
      const s1 = await createServer({ dbUrl: u1, password: 'demo-pass-1', secureCookie: false, scheduler: false });
      await new Promise((r) => s1.server.listen(0, r)); const b1 = 'http://127.0.0.1:' + s1.server.address().port;
      const lg = async (b) => (await fetch(b + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FP-Request': '1' }, body: JSON.stringify({ email: 'client@demo.kr', password: 'demo-pass-1' }) })).headers.get('set-cookie').split(';')[0];
      const ck = await lg(b1);
      const H = { 'Content-Type': 'application/json', 'X-FP-Request': '1', Cookie: ck };
      const me = await (await fetch(b1 + '/api/me', { headers: H })).json(); const cid = me.user.clientId;
      const d = await (await fetch(b1 + '/api/clients/' + cid + '/data', { headers: H })).json();
      assert.strictEqual((await fetch(b1 + '/api/clients/' + cid + '/data', { method: 'PATCH', headers: H, body: JSON.stringify({ baseVersion: d.version, set: { 'income.netMonthly': 3210000 } }) })).status, 200);
      vapid1 = s1.pushKeys.publicKey;
      s1.stop(); s1.server.closeAllConnections(); await new Promise((r) => s1.server.close(r)); await s1.db.close();
      const s2 = await createServer({ dbUrl: u1, password: 'demo-pass-1', secureCookie: false, scheduler: false });
      await new Promise((r) => s2.server.listen(0, r)); const b2 = 'http://127.0.0.1:' + s2.server.address().port;
      const H2 = Object.assign({}, H, { Cookie: await lg(b2) });
      const d2 = await (await fetch(b2 + '/api/clients/' + cid + '/data', { headers: H2 })).json();
      assert.strictEqual(d2.data.income.netMonthly, 3210000); assert.strictEqual(d2.version, d.version + 1);
      assert.strictEqual(s2.pushKeys.publicKey, vapid1, '푸시 키 유지');
      assert.strictEqual(s2.seeded, null, '재시작 때 시연 데이터를 다시 만들지 않음');
      s2.stop(); s2.server.closeAllConnections(); await new Promise((r) => s2.server.close(r)); await s2.db.close();
    });
    await test('백업 → 빈 DB에 복구 → 같은 데이터, 기존 데이터가 있는 DB에는 복구 거부', async () => {
      const f = path.join(require('os').tmpdir(), 'fp-backup-test.json');
      const run = (u, args) => execFileSync(process.execPath, ['--no-warnings', 'server/backup.js', ...args], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { DATABASE_URL: u }) }).toString();
      assert.ok(/백업 완료/.test(run(u1, ['export', f])));
      assert.ok(/복구 완료/.test(run(u2, ['restore', f])));
      let refused = false; try { run(u1, ['restore', f]); } catch (e) { refused = /이미 계정/.test(String(e.stderr)); }
      assert.ok(refused, '데이터가 있는 DB에는 복구하지 않음');
      const a = await open({ url: u1 }), b = await open({ url: u2 });
      for (const t of ['users', 'clients', 'plans', 'records', 'client_data', 'changes']) assert.strictEqual(JSON.stringify(await a.all('SELECT * FROM ' + t + ' ORDER BY 1')), JSON.stringify(await b.all('SELECT * FROM ' + t + ' ORDER BY 1')), t);
      const ins = await b.run('INSERT INTO audit (user_id, action, target, at) VALUES (?,?,?,?)', null, 't', null, 'x'); assert.ok(ins.id > 0, '복구 후 번호 이어서 발급');
      await a.close(); await b.close(); fs.unlinkSync(f);
    });
    await admin.run('DROP SCHEMA ' + sch + ' CASCADE'); await admin.run('DROP SCHEMA ' + sch + '_r CASCADE'); await admin.close();
  } else console.log('  (TEST_DATABASE_URL 없음: Postgres 항목 건너뜀)');
  process.exit(R.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
