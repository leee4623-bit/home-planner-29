/*
 * 서버 검증: 권한 분리, 버전 보존, 기록 중복 방지, 거래 분류
 * 실행: node tests/api.test.js
 */
'use strict';
const assert = require('assert');
const { createServer } = require('../server/server.js');
const { open } = require('../server/db.js');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message); } }

(async () => {
  const { server } = createServer({ db: open(':memory:'), password: 'test-pass-1', secureCookie: false });
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function login(email) {
    const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FP-Request': '1' }, body: JSON.stringify({ email, password: 'test-pass-1' }) });
    assert.strictEqual(res.status, 200, email + ' 로그인 실패');
    return res.headers.get('set-cookie').split(';')[0];
  }
  function api(cookie) {
    return async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-FP-Request': '1', Cookie: cookie || '' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() };
    };
  }
  console.log('서버 검증');
  const P = api(await login('planner@demo.kr')), P2 = api(await login('planner2@demo.kr')), Cl = api(await login('client@demo.kr')), O = api(await login('other@demo.kr'));
  const myClients = (await P('GET', '/api/clients')).body.clients; const cid = myClients[0].id;
  const otherCid = (await O('GET', '/api/clients')).body.clients[0].id;

  await test('로그인하지 않으면 401', async () => { assert.strictEqual((await api('')('GET', '/api/clients')).status, 401); });
  await test('틀린 비밀번호는 401', async () => {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FP-Request': '1' }, body: JSON.stringify({ email: 'planner@demo.kr', password: 'x' }) });
    assert.strictEqual(r.status, 401);
  });
  await test('CSRF 헤더 없는 변경 요청은 403', async () => {
    const r = await fetch(base + '/api/logout', { method: 'POST' }); assert.strictEqual(r.status, 403);
  });
  await test('설계사는 배정된 고객만 목록에 보임', async () => { assert.deepStrictEqual(myClients.map((c) => c.id), [cid]); });
  await test('배정되지 않은 설계사는 고객 계획 조회 403', async () => { assert.strictEqual((await P2('GET', '/api/clients/' + cid + '/plans')).status, 403); });
  await test('고객은 다른 고객 기록 조회 403', async () => { assert.strictEqual((await Cl('GET', '/api/clients/' + otherCid + '/records')).status, 403); });
  await test('고객은 계획을 저장할 수 없음 403', async () => { assert.strictEqual((await Cl('POST', '/api/clients/' + cid + '/plans', { kind: 'after', data: {} })).status, 403); });
  await test('설계사는 실행 기록을 입력할 수 없음 403', async () => { assert.strictEqual((await P('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'housing', amount: 1 })).status, 403); });

  await test('계획 저장은 새 버전 추가 — 이전 버전과 설계 전 계획은 그대로', async () => {
    const before = (await P('GET', '/api/clients/' + cid + '/plans')).body.plans;
    const after1 = before.find((p) => p.kind === 'after' && p.version === 1);
    const changed = JSON.parse(JSON.stringify(after1.data)); changed.expenses.optional = 111111;
    const r = await P('POST', '/api/clients/' + cid + '/plans', { kind: 'after', label: '2차', data: changed });
    assert.strictEqual(r.body.version, 2);
    const now = (await P('GET', '/api/clients/' + cid + '/plans')).body.plans;
    assert.strictEqual(now.length, before.length + 1);
    assert.deepStrictEqual(now.find((p) => p.kind === 'after' && p.version === 1).data, after1.data);
    assert.deepStrictEqual(now.find((p) => p.kind === 'before').data, before.find((p) => p.kind === 'before').data);
  });
  await test('잘못된 계획(비율 합계≠100)은 저장 거부', async () => {
    const plans = (await P('GET', '/api/clients/' + cid + '/plans')).body.plans; const d = plans[0].data;
    d.allocation = { mode: 'ratio', order: ['emergency', 'debt', 'housing'], ratios: { emergency: 50, debt: 30, housing: 30 } };
    const r = await P('POST', '/api/clients/' + cid + '/plans', { kind: 'after', data: d }); assert.strictEqual(r.status, 400);
  });

  await test('같은 달·항목 기록을 다시 입력하면 이전 기록은 대체(한 번만 반영)', async () => {
    await Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'housing', amount: 200000 });
    await Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'housing', amount: 250000 });
    const recs = (await Cl('GET', '/api/clients/' + cid + '/records')).body.records.filter((x) => x.month === '2026-11' && x.category === 'housing');
    assert.strictEqual(recs.filter((x) => !x.voidedAt).length, 1);
    assert.strictEqual(recs.find((x) => !x.voidedAt).amount, 250000);
  });

  await test('거래는 제안만 하고, 확인 전에는 실적이 아님 / 본인 계좌 간 이체 쌍은 한 번만 반영', async () => {
    const csv = '날짜,금액,적요,보낸계좌,받은계좌\n2026-11-12,-300000,주거자금 이체,110-1234-1001,333-22-2002\n2026-11-12,300000,주거자금 입금,110-1234-1001,333-22-2002\n2026-11-15,-50000,편의점,110-1234-1001,';
    const imp = await Cl('POST', '/api/clients/' + cid + '/transactions/import', { csv });
    assert.strictEqual(imp.body.added, 3);
    const again = await Cl('POST', '/api/clients/' + cid + '/transactions/import', { csv });
    assert.strictEqual(again.body.duplicates, 3, '같은 파일을 다시 가져오면 중복 무시');
    const txs = (await Cl('GET', '/api/clients/' + cid + '/transactions')).body.transactions;
    const out = txs.find((t) => t.amount === -300000), inn = txs.find((t) => t.amount === 300000);
    assert.strictEqual(out.suggested.kind, 'ownTransfer'); assert.ok(!out.confirmedAt);
    const recsBefore = (await Cl('GET', '/api/clients/' + cid + '/records')).body.records.filter((x) => !x.voidedAt).length;
    const c1 = await Cl('POST', '/api/clients/' + cid + '/transactions/' + out.id + '/confirm', { classification: 'housing' });
    assert.strictEqual(c1.status, 409, '직접 입력 기록이 있으면 대체 여부를 물어야 함');
    await Cl('POST', '/api/clients/' + cid + '/transactions/' + out.id + '/confirm', { classification: 'housing', replaceManual: true });
    await Cl('POST', '/api/clients/' + cid + '/transactions/' + inn.id + '/confirm', { classification: 'housing' });
    const recs = (await Cl('GET', '/api/clients/' + cid + '/records')).body.records.filter((x) => !x.voidedAt && x.month === '2026-11' && x.category === 'housing');
    assert.strictEqual(recs.length, 1); assert.strictEqual(recs[0].amount, 300000);
    assert.ok((await Cl('GET', '/api/clients/' + cid + '/records')).body.records.filter((x) => !x.voidedAt).length === recsBefore, '수동 기록 대체 후 활성 기록 수 동일');
  });
  await test('계좌번호는 끝 4자리만 저장', async () => {
    await Cl('POST', '/api/clients/' + cid + '/accounts', { label: '청년미래적금', number: '123-456-789012', purpose: 'product:p1' });
    const acc = (await Cl('GET', '/api/clients/' + cid + '/accounts')).body.accounts;
    assert.ok(acc.some((a) => a.masked === '****9012')); assert.ok(!JSON.stringify(acc).includes('789012'));
  });
  await test('경보 설정 범위 검사', async () => {
    assert.strictEqual((await Cl('PUT', '/api/clients/' + cid + '/settings', { settings: { dueDay: 40, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 3, staleDays: 7 } })).status, 400);
  });
  await test('정적 파일은 상위 폴더로 벗어날 수 없음', async () => {
    const r = await fetch(base + '/../server/db.js'); assert.notStrictEqual(r.status, 200);
  });
  server.close();
  console.log('\n결과: ' + passed + '개 통과, ' + failed + '개 실패');
  process.exit(failed ? 1 : 0);
})();
