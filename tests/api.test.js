/*
 * 서버 검증: 권한 분리, 버전 보존, 기록 중복 방지, 거래 분류, 고객 정보 저장·충돌, 실시간 전달(SSE), 계획 제시·선택
 * 실행: node --no-warnings tests/api.test.js            (메모리 SQLite)
 *       TEST_DATABASE_URL=postgres://... node tests/api.test.js   (실제 Postgres)
 */
'use strict';
const assert = require('assert');
const { start, runner } = require('./helpers');
const admin = require('../server/admin.js');

(async () => {
  const R = runner('서버 검증');
  const test = R.test;
  const app = await start({ password: 'test-pass-1' });
  const { api, login, db } = app;
  console.log('  (DB: ' + app.kind + ')');
  // 미배정 설계사는 시연 계정이 아니라 관리자 기능으로 만든 시험 계정
  await admin.addUser(db, { email: 'free@test.kr', name: '미배정(시험)', role: 'planner', password: 'free-pass-123' });
  const P = api(await login('planner@demo.kr')), Free = api(await login('free@test.kr', 'free-pass-123')), Cl = api(await login('client@demo.kr')), O = api(await login('other@demo.kr'));
  const myClients = (await P('GET', '/api/clients')).body.clients; const cid = myClients[0].id;
  const otherCid = (await O('GET', '/api/clients')).body.clients[0].id;

  await test('로그인하지 않으면 401', async () => { assert.strictEqual((await api('')('GET', '/api/clients')).status, 401); });
  await test('틀린 비밀번호는 401', async () => { assert.strictEqual(await login('planner@demo.kr', 'x'), null); });
  await test('이전 버전의 미배정 시연 계정(planner2@demo.kr)은 만들지 않거나 로그인 불가', async () => { assert.strictEqual(await login('planner2@demo.kr'), null); });
  await test('CSRF 헤더 없는 변경 요청은 403', async () => { const r = await fetch(app.base + '/api/logout', { method: 'POST' }); assert.strictEqual(r.status, 403); });
  await test('설계사는 배정된 고객만 목록에 보임', async () => { assert.deepStrictEqual(myClients.map((c) => c.id), [cid]); });
  await test('배정이 없는 설계사는 빈 목록 + 고객 데이터 403', async () => {
    assert.deepStrictEqual((await Free('GET', '/api/clients')).body.clients, []);
    for (const p of ['/plans', '/data', '/records', '/extra', '/history']) assert.strictEqual((await Free('GET', '/api/clients/' + cid + p)).status, 403, p);
    assert.strictEqual((await Free('GET', '/api/sync?since=0')).body.changes.length, 0);
  });
  await test('고객은 다른 고객 기록·정보 조회 403', async () => {
    assert.strictEqual((await Cl('GET', '/api/clients/' + otherCid + '/records')).status, 403);
    assert.strictEqual((await Cl('PATCH', '/api/clients/' + otherCid + '/data', { baseVersion: 0, set: { 'income.netMonthly': 1 } })).status, 403);
  });
  await test('고객은 계획을 저장할 수 없음 403 / 설계사는 고객 정보·실적을 수정할 수 없음 403', async () => {
    assert.strictEqual((await Cl('POST', '/api/clients/' + cid + '/plans', { kind: 'after', data: {} })).status, 403);
    assert.strictEqual((await P('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'housing', amount: 1 })).status, 403);
    assert.strictEqual((await P('PATCH', '/api/clients/' + cid + '/data', { baseVersion: 1, set: { 'income.netMonthly': 1 } })).status, 403);
  });

  // ---------- 고객 정보 ----------
  await test('고객 정보: 불러오기 → 바뀐 항목만 저장 → 버전 증가, 미입력(null)과 0원 구분', async () => {
    const d0 = (await Cl('GET', '/api/clients/' + cid + '/data')).body;
    assert.strictEqual(d0.version, 1); assert.strictEqual(d0.data.income.netMonthly, 2900000);
    const r = await Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: 1, set: { 'income.netMonthly': 3000000, 'assets.pension': 0, 'profile.region': null } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.version, 2); assert.strictEqual(r.body.changed.length, 3);
    const d1 = (await P('GET', '/api/clients/' + cid + '/data')).body;
    assert.strictEqual(d1.data.assets.pension, 0); assert.strictEqual(d1.data.profile.region, null); assert.strictEqual(d1.data.assets.cash, d0.data.assets.cash, '안 바꾼 항목은 그대로');
    const bad = await Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: 2, set: { 'income.netMonthly': -5 } }); assert.strictEqual(bad.status, 400);
    const unk = await Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: 2, set: { 'role': 'planner' } }); assert.strictEqual(unk.status, 400, '정의되지 않은 항목(역할 등)은 거부');
  });
  await test('같은 값 재전송은 버전·이력을 늘리지 않음(중복 저장 안전)', async () => {
    const h0 = (await Cl('GET', '/api/clients/' + cid + '/history')).body.history.length;
    const r = await Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: 1, set: { 'income.netMonthly': 3000000 } });
    assert.strictEqual(r.status, 200); assert.ok(r.body.unchanged); assert.strictEqual(r.body.version, 2);
    assert.strictEqual((await Cl('GET', '/api/clients/' + cid + '/history')).body.history.length, h0);
  });
  await test('동시 수정: 다른 기기가 먼저 바꾼 항목은 409(조용히 덮어쓰지 않음), 다른 항목은 병합', async () => {
    const a = await Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: 1, set: { 'income.netMonthly': 3100000 } });
    assert.strictEqual(a.status, 409); assert.strictEqual(a.body.code, 'conflict'); assert.strictEqual(a.body.conflicts[0].path, 'income.netMonthly');
    const b = await Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: 1, set: { 'assets.cash': 9500000 } });
    assert.strictEqual(b.status, 200, '그 사이 바뀌지 않은 항목은 저장'); assert.strictEqual(b.body.version, 3);
    // 정확히 같은 순간 두 요청
    const [x, y] = await Promise.all([Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: 3, set: { 'expenses.optional': 500000 } }), Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: 3, set: { 'expenses.optional': 450000 } })]);
    assert.deepStrictEqual([x.status, y.status].sort(), [200, 409]);
    const d = (await Cl('GET', '/api/clients/' + cid + '/data')).body; assert.strictEqual(d.version, 4);
  });
  await test('변경 이력: 변경자·시각·항목·버전 기록', async () => {
    const h = (await P('GET', '/api/clients/' + cid + '/history')).body.history;
    const last = h.find((e) => e.entity === 'client_data');
    assert.ok(last.actorName && last.actorRole === 'client' && last.at && last.version >= 2 && last.items.length);
    assert.ok(last.items[0].label && last.items[0].to);
  });

  // ---------- 계획 ----------
  await test('계획 저장은 새 버전 추가 — 이전 버전과 설계 전 계획은 그대로', async () => {
    const before = (await P('GET', '/api/clients/' + cid + '/plans')).body.plans;
    const after1 = before.find((p) => p.kind === 'after' && p.version === 1);
    const changed = JSON.parse(JSON.stringify(after1.data)); changed.expenses.optional = 111111;
    const dv = (await P('GET', '/api/clients/' + cid + '/data')).body.version;
    const r = await P('POST', '/api/clients/' + cid + '/plans', { kind: 'after', label: '2차', data: changed, dataVersion: dv });
    assert.strictEqual(r.body.version, 2);
    const now = (await P('GET', '/api/clients/' + cid + '/plans')).body.plans;
    assert.strictEqual(now.length, before.length + 1);
    assert.deepStrictEqual(now.find((p) => p.kind === 'after' && p.version === 1).data, after1.data);
  });
  await test('설계사 초안은 고객에게 보이지 않음, 실행 기준은 그대로', async () => {
    const cp = (await Cl('GET', '/api/clients/' + cid + '/plans')).body.plans;
    assert.ok(!cp.some((p) => p.kind === 'after' && p.version === 2), '초안 비공개');
    const x = (await Cl('GET', '/api/clients/' + cid + '/extra')).body; assert.strictEqual(cp.find((p) => p.id === x.baselineId).version, 1);
  });
  await test('작성 중 고객 정보가 바뀌면 저장 시 ‘분석 기준 정보 변경’ 409 → 확인 후 저장 가능', async () => {
    const plans = (await P('GET', '/api/clients/' + cid + '/plans')).body.plans; const p1 = plans.find((p) => p.kind === 'after' && p.version === 1);
    const r = await P('POST', '/api/clients/' + cid + '/plans', { kind: 'after', data: p1.data, dataVersion: 1 });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.body.code, 'staleBasis'); assert.ok(r.body.items.length >= 1);
    const ok = await P('POST', '/api/clients/' + cid + '/plans', { kind: 'after', data: p1.data, dataVersion: 1, acknowledgeStale: true }); assert.strictEqual(ok.status, 200);
  });
  await test('잘못된 계획(비율 합계≠100)은 저장 거부', async () => {
    const plans = (await P('GET', '/api/clients/' + cid + '/plans')).body.plans; const d = plans[0].data;
    d.allocation = { mode: 'ratio', order: ['emergency', 'debt', 'housing'], ratios: { emergency: 50, debt: 30, housing: 30 } };
    assert.strictEqual((await P('POST', '/api/clients/' + cid + '/plans', { kind: 'after', data: d })).status, 400);
  });
  await test('계획 제시 → 고객에게 알림·표시 → 선택 전 실행 기준 불변 → 선택 시 실행 기준', async () => {
    const plans = (await P('GET', '/api/clients/' + cid + '/plans')).body.plans; const v2 = plans.find((p) => p.kind === 'after' && p.version === 2);
    const bl0 = (await Cl('GET', '/api/clients/' + cid + '/extra')).body.baselineId;
    assert.strictEqual((await Cl('POST', '/api/clients/' + cid + '/offers', { planId: v2.id })).status, 403, '고객은 제시 불가');
    const of = await P('POST', '/api/clients/' + cid + '/offers', { planId: v2.id, note: '선택지출 조정안' }); assert.strictEqual(of.status, 200);
    const x = (await Cl('GET', '/api/clients/' + cid + '/extra')).body;
    assert.ok(x.offers.some((o) => o.id === of.body.id && o.status === 'presented'));
    assert.ok(x.notifications.some((n) => n.key === 'offer:' + of.body.id), '고객 알림');
    assert.ok((await Cl('GET', '/api/clients/' + cid + '/plans')).body.plans.some((p) => p.id === v2.id), '제시된 계획은 고객에게 보임');
    assert.strictEqual(x.baselineId, bl0, '선택 전 실행 기준 불변');
    assert.strictEqual((await Cl('POST', '/api/clients/' + cid + '/offers/' + of.body.id + '/accept', {})).status, 400, '확인 없이 선택 불가');
    assert.strictEqual((await P('POST', '/api/clients/' + cid + '/offers/' + of.body.id + '/accept', { confirm: true })).status, 403, '설계사가 대신 선택 불가');
    const [a1, a2] = await Promise.all([Cl('POST', '/api/clients/' + cid + '/offers/' + of.body.id + '/accept', { confirm: true }), Cl('POST', '/api/clients/' + cid + '/offers/' + of.body.id + '/accept', { confirm: true })]);
    assert.strictEqual(a1.status, 200); assert.strictEqual(a2.status, 200);
    const x2 = (await Cl('GET', '/api/clients/' + cid + '/extra')).body; assert.strictEqual(x2.baselineId, v2.id);
    assert.strictEqual(x2.baselines.filter((b) => b.planId === v2.id).length, 1, '중복 선택해도 실행 기준 기록 1건');
  });

  // ---------- 실적 ----------
  await test('같은 달·항목 기록을 다시 입력하면 이전 기록은 대체(한 번만 반영), 같은 값 재전송은 무시', async () => {
    await Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'housing', amount: 200000 });
    await Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'housing', amount: 250000 });
    const again = await Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'housing', amount: 250000 }); assert.ok(again.body.unchanged);
    const recs = (await Cl('GET', '/api/clients/' + cid + '/records')).body.records.filter((x) => x.month === '2026-11' && x.category === 'housing');
    assert.strictEqual(recs.filter((x) => !x.voidedAt).length, 1); assert.strictEqual(recs.find((x) => !x.voidedAt).amount, 250000);
    assert.strictEqual(recs.length, 2, '같은 값 재전송은 새 기록을 만들지 않음');
  });
  await test('Idempotency-Key: 네트워크 재시도는 한 번만 처리하고 같은 응답', async () => {
    const h = { 'Idempotency-Key': 'rec-2026-11-emergency-1' };
    const [a, b] = await Promise.all([Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'emergency', amount: 330000 }, h), Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'emergency', amount: 330000 }, h)]);
    assert.ok([a.status, b.status].includes(200));
    const c = await Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'emergency', amount: 330000 }, h);
    assert.strictEqual(c.status, 200); assert.strictEqual(c.headers.get('idempotent-replay'), 'true');
    const recs = (await Cl('GET', '/api/clients/' + cid + '/records')).body.records.filter((x) => x.month === '2026-11' && x.category === 'emergency');
    assert.strictEqual(recs.length, 1);
  });
  await test('확정된 달의 실적은 확인 없이 바꾸지 않음', async () => {
    assert.strictEqual((await Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-09', category: 'debt', amount: 1 })).status, 409);
  });

  await test('거래는 제안만 하고, 확인 전에는 실적이 아님 / 본인 계좌 간 이체 쌍은 한 번만 반영', async () => {
    const csv = '날짜,금액,적요,보낸계좌,받은계좌\n2026-11-12,-300000,주거자금 이체,110-1234-1001,333-22-2002\n2026-11-12,300000,주거자금 입금,110-1234-1001,333-22-2002\n2026-11-15,-50000,편의점,110-1234-1001,';
    const imp = await Cl('POST', '/api/clients/' + cid + '/transactions/import', { csv });
    assert.strictEqual(imp.body.added, 3);
    assert.strictEqual((await Cl('POST', '/api/clients/' + cid + '/transactions/import', { csv })).body.duplicates, 3, '같은 파일을 다시 가져오면 중복 무시');
    const txs = (await Cl('GET', '/api/clients/' + cid + '/transactions')).body.transactions;
    const out = txs.find((t) => t.amount === -300000), inn = txs.find((t) => t.amount === 300000);
    assert.strictEqual(out.suggested.kind, 'ownTransfer'); assert.ok(!out.confirmedAt);
    const recsBefore = (await Cl('GET', '/api/clients/' + cid + '/records')).body.records.filter((x) => !x.voidedAt).length;
    assert.strictEqual((await Cl('POST', '/api/clients/' + cid + '/transactions/' + out.id + '/confirm', { classification: 'housing' })).status, 409, '직접 입력 기록이 있으면 대체 여부를 물어야 함');
    await Cl('POST', '/api/clients/' + cid + '/transactions/' + out.id + '/confirm', { classification: 'housing', replaceManual: true });
    await Cl('POST', '/api/clients/' + cid + '/transactions/' + inn.id + '/confirm', { classification: 'housing' });
    const recs = (await Cl('GET', '/api/clients/' + cid + '/records')).body.records.filter((x) => !x.voidedAt && x.month === '2026-11' && x.category === 'housing');
    assert.strictEqual(recs.length, 1); assert.strictEqual(recs[0].amount, 300000);
    assert.strictEqual((await Cl('GET', '/api/clients/' + cid + '/records')).body.records.filter((x) => !x.voidedAt).length, recsBefore);
  });
  await test('계좌번호는 끝 4자리만 저장', async () => {
    await Cl('POST', '/api/clients/' + cid + '/accounts', { label: '청년미래적금', number: '123-456-789012', purpose: 'product:p1' });
    const acc = (await Cl('GET', '/api/clients/' + cid + '/accounts')).body.accounts;
    assert.ok(acc.some((a) => a.masked === '****9012')); assert.ok(!JSON.stringify(acc).includes('789012'));
  });
  await test('경보 설정 범위 검사', async () => {
    assert.strictEqual((await Cl('PUT', '/api/clients/' + cid + '/settings', { settings: { dueDay: 40, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 3, staleDays: 7 } })).status, 400);
  });

  // ---------- 실시간 ----------
  await test('실시간(SSE): 고객 저장 → 배정 설계사에게 수초 안에 전달(변경 항목 포함), 다른 고객·미배정 설계사에게는 전달 안 됨', async () => {
    const pCk = await login('planner@demo.kr'), fCk = await login('free@test.kr', 'free-pass-123'), oCk = await login('other@demo.kr');
    const sp = app.sse(pCk), sf = app.sse(fCk), so = app.sse(oCk);
    await Promise.all([sp.waitFor((e) => e.event === 'ready'), sf.waitFor((e) => e.event === 'ready'), so.waitFor((e) => e.event === 'ready')]);
    const v = (await Cl('GET', '/api/clients/' + cid + '/data')).body.version;
    const t0 = Date.now();
    const r = await Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: v, set: { 'expenses.essential': 1290000 } }); assert.strictEqual(r.status, 200);
    const ev = await sp.waitFor((e) => e.event === 'change' && e.data.entity === 'client_data' && e.data.version === r.body.version, 3000);
    const ms = ev.at - t0; console.log('    · 저장 요청 시작 → 설계사 수신 ' + ms + 'ms');
    assert.ok(ms < 3000); assert.strictEqual(ev.data.items[0].path, 'expenses.essential'); assert.strictEqual(ev.data.actorRole, 'client');
    await new Promise((x) => setTimeout(x, 300));
    assert.ok(!sf.events.some((e) => e.event === 'change'), '미배정 설계사 수신 없음');
    assert.ok(!so.events.some((e) => e.event === 'change' && e.data.clientId === cid), '다른 고객 수신 없음');
    sp.close(); sf.close(); so.close();
  });
  await test('실시간: 설계사 제시 → 고객 화면에 즉시 전달 / 설계사 초안 저장은 고객에게 전달 안 됨', async () => {
    const cCk = await login('client@demo.kr'); const sc = app.sse(cCk); await sc.waitFor((e) => e.event === 'ready');
    const plans = (await P('GET', '/api/clients/' + cid + '/plans')).body.plans; const p1 = plans.find((p) => p.kind === 'after' && p.version === 1);
    const dv = (await P('GET', '/api/clients/' + cid + '/data')).body.version;
    const dr = await P('POST', '/api/clients/' + cid + '/plans', { kind: 'after', label: '초안', data: p1.data, dataVersion: dv });
    const of = await P('POST', '/api/clients/' + cid + '/offers', { planId: dr.body.id });
    const ev = await sc.waitFor((e) => e.event === 'change' && e.data.entity === 'offer' && e.data.ref && e.data.ref.offerId === of.body.id);
    assert.ok(ev);
    assert.ok(!sc.events.some((e) => e.event === 'change' && e.data.entity === 'plan'), '초안 이벤트 비공개');
    sc.close();
  });
  await test('연결 복구: 끊긴 동안의 변경을 마지막 번호 이후로 다시 받음(SSE Last-Event-ID/since, 주기 조회 동일)', async () => {
    const pCk = await login('planner@demo.kr');
    const latest = (await P('GET', '/api/sync?since=0')).body.latest;
    const v = (await Cl('GET', '/api/clients/' + cid + '/data')).body.version;
    await Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: v, set: { 'goal.movingCost': 2500000 } });
    await Cl('POST', '/api/clients/' + cid + '/records', { month: '2026-11', category: 'debt', amount: 700000 });
    const sp = app.sse(pCk, latest);
    await sp.waitFor((e) => e.event === 'ready');
    const got = sp.events.filter((e) => e.event === 'change').map((e) => e.data.entity);
    assert.ok(got.includes('client_data') && got.includes('record'), got.join(','));
    const poll = (await P('GET', '/api/sync?since=' + latest)).body.changes.map((e) => e.entity);
    assert.ok(poll.includes('client_data') && poll.includes('record'));
    sp.close();
  });
  await test('배정 해제 시 기존 실시간 구독에서도 즉시 차단', async () => {
    await admin.assign(db, 'free@test.kr', cid);
    const fCk = await login('free@test.kr', 'free-pass-123'); const sf = app.sse(fCk); await sf.waitFor((e) => e.event === 'ready');
    const F = api(fCk); assert.strictEqual((await F('GET', '/api/clients/' + cid + '/data')).status, 200, '배정 후 조회 가능');
    await admin.unassign(db, 'free@test.kr', cid);
    await sf.waitFor((e) => e.event === 'revoked' && e.data.clientId === cid, 2000);
    const v = (await Cl('GET', '/api/clients/' + cid + '/data')).body.version;
    await Cl('PATCH', '/api/clients/' + cid + '/data', { baseVersion: v, set: { 'goal.movingCost': 2600000 } });
    await new Promise((x) => setTimeout(x, 300));
    assert.ok(!sf.events.some((e) => e.event === 'change' && e.data.clientId === cid && e.data.version === v + 1), '해제 후 전달 없음');
    assert.strictEqual((await F('GET', '/api/clients/' + cid + '/data')).status, 403);
    sf.close();
  });
  await test('기존 브라우저(시연판) 데이터 가져오기: 미리보기로 내용 확인 → 확인해야 저장', async () => {
    const file = { format: 'fp-export-1', exportedAt: '2026-11-01T00:00:00Z', demo: true, clientData: { assets: { pension: 3500000 }, goal: { movingCost: 2600000 } }, records: [{ month: '2026-11', category: 'income', amount: 100000 }] };
    const pv = await Cl('POST', '/api/clients/' + cid + '/import/preview', { file });
    assert.strictEqual(pv.status, 200); assert.ok(pv.body.fields.some((f) => f.path === 'assets.pension')); assert.ok(!pv.body.fields.some((f) => f.path === 'goal.movingCost'), '같은 값은 목록에서 제외'); assert.strictEqual(pv.body.records.length, 1);
    assert.strictEqual((await Cl('POST', '/api/clients/' + cid + '/import/commit', { file })).status, 400, '확인 없이는 저장 안 함');
    const c = await Cl('POST', '/api/clients/' + cid + '/import/commit', { file, confirm: true }); assert.strictEqual(c.status, 200); assert.strictEqual(c.body.fields, 1);
    assert.strictEqual((await Cl('GET', '/api/clients/' + cid + '/data')).body.data.assets.pension, 3500000);
    assert.strictEqual((await P('POST', '/api/clients/' + cid + '/import/commit', { file, confirm: true })).status, 403);
  });
  await test('관리자 API: 토큰이 없으면 사용 불가', async () => {
    const r = await fetch(app.base + '/api/admin/list'); assert.ok([401, 404].includes(r.status));
  });
  await test('정적 파일은 상위 폴더로 벗어날 수 없음', async () => { const r = await fetch(app.base + '/../server/db.js'); assert.notStrictEqual(r.status, 200); });

  await app.stopAll();
  process.exit(R.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
