/*
 * 추가 기능 검증 — 위험성향·A/B/C·월별 재계산·수정안·알림·Web Push
 * 실행: node --no-warnings tests/features.test.js
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const Risk = require('../public/js/engine/risk.js');
const CFG = require('../public/js/data/riskConfig.js');
const Strat = require('../public/js/engine/strategies.js');
const M = require('../public/js/engine/monthly.js');
const Calc = require('../public/js/engine/calc.js');
const S = require('../public/js/data/sampleCase.js');
const { createServer } = require('../server/server.js');
const { open } = require('../server/db.js');
const jobs = require('../server/jobs.js');
const push = require('../server/push.js');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n    ')); } }
const ANS = { q1: 'a', q2: 'a', q3: 'c', q4: 'c', q5: 'c', q6: 'b', q7: 'c', q8: 'c', q9: 'c', q10: 'c' };
const NOW = new Date(2026, 10, 3, 14, 0);

(async () => {
  console.log('추가 기능 검증');

  await test('같은 답변은 같은 기준 버전에서 같은 결과', () => {
    const a = Risk.score(ANS), b = Risk.score(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(ANS).reverse()))));
    assert.deepStrictEqual(a, b); assert.strictEqual(a.version, CFG.VERSION); assert.ok(a.complete);
  });

  await test('누락 답변은 완료로 처리하지 않고, 임의로 채우지 않음', () => {
    const a = Object.assign({}, ANS); delete a.q7;
    const r = Risk.score(a); assert.strictEqual(r.complete, false); assert.deepStrictEqual(r.missing, ['q7']); assert.strictEqual(r.type, undefined);
    const u = Object.assign({}, ANS, { q4: 'u', q5: 'u', q6: 'u' }); // 재무 여력 4문항 중 3개 ‘잘 모르겠음’
    const ru = Risk.score(u); assert.strictEqual(ru.complete, false); assert.ok(ru.insufficient.includes('cap'));
  });

  await test('모순 답변은 보완하지 않고 ‘추가 확인 필요’로 표시', () => {
    const a = Object.assign({}, ANS, { q3: 'a', q10: 'd' });
    const before = JSON.stringify(a), r = Risk.score(a);
    assert.strictEqual(r.status, 'needsReview'); assert.ok(r.flags.some((f) => f.id === 'lossVsBuy')); assert.strictEqual(JSON.stringify(a), before);
  });

  await test('위험 의향이 높아도 재무 여력·주거 핵심자금 제약 유지', () => {
    const a = { q1: 'd', q2: 'd', q3: 'd', q4: 'a', q5: 'a', q6: 'a', q7: 'a', q8: 'd', q9: 'd', q10: 'd' };
    const r = Risk.score(a);
    assert.ok(r.rawTypeId >= 3, '점수상으로는 높은 유형'); assert.ok(r.typeId <= 2, '재무 여력 제한으로 안정추구형 이하');
    assert.strictEqual(r.status, 'needsReview'); assert.ok(r.flags.some((f) => f.id === 'willVsCap'));
    assert.strictEqual(r.housingCoreMax, '안정형');
    const set = Strat.build(S.AFTER, { typeId: 5, type: '공격투자형', status: 'ok' }, S.PROFILE);
    set.options.forEach((o) => { assert.strictEqual(o.data.plan.investShare, 0, o.key + '안 투자 비율'); assert.deepStrictEqual(o.data.rates, S.AFTER.rates, '기대수익률을 올리지 않음'); });
  });

  await test('A/B/C안은 같은 초기 조건으로 계산', () => {
    const set = Strat.build(S.AFTER, null, S.PROFILE);
    assert.ok(set.sameStart);
    Strat.FIXED.forEach((p) => { const v = (o) => JSON.stringify(p.split('.').reduce((x, k) => x && x[k], o.data)); assert.strictEqual(v(set.options[0]), v(set.options[1])); assert.strictEqual(v(set.options[1]), v(set.options[2])); });
    assert.ok(new Set(set.options.map((o) => JSON.stringify(o.params))).size === 3, '세 안의 전략이 서로 다름');
    assert.ok(!JSON.stringify(set).includes('확률'), '확률 수치 없음');
  });

  const ctxBase = () => ({ data: S.AFTER, records: [{ month: '2026-10', category: 'expense:essential', amount: 1320000 }, { month: '2026-10', category: 'expense:optional', amount: 610000 }], txs: [], scheduled: [], closed: ['2026-09', '2026-10'], today: NOW, consent: {}, alertSettings: { budgetTolerancePct: 0, emergencyMinMonths: 3 } });

  await test('월중 잠정 지출을 확정 실적으로 처리하지 않음', () => {
    const c1 = ctxBase(), c2 = ctxBase();
    c2.records = c2.records.concat([{ month: '2026-11', category: 'expense:optional', amount: 3000000 }]);
    c2.scheduled = [{ month: '2026-11', amount: 420000, paid: false }];
    const r1 = M.recalc(c1), r2 = M.recalc(c2);
    assert.strictEqual(r1.forecast.gap, r2.forecast.gap, '이번 달 큰 지출이 있어도 확정 전에는 예측 불변');
    const t = M.table(c2).rows.find((r) => r.ym === '2026-11');
    assert.strictEqual(t.status, 'provisional'); assert.strictEqual(t.projected, 3000000 + 420000);
    assert.ok(!M.finalRecords(c2.records, c2.closed).some((r) => r.month === '2026-11'));
  });

  await test('덜 쓴 돈은 바로 저축으로 보지 않고, 이번 달 절약이 반복된다고 가정하지 않음', () => {
    const c = ctxBase(); c.records = [{ month: '2026-10', category: 'expense:optional', amount: 200000 }, { month: '2026-10', category: 'expense:essential', amount: 1300000 }];
    const rc = M.recalc(c), base = Calc.simulate(S.AFTER);
    assert.ok(rc.lastFinal.slack > 0);
    assert.ok(Math.abs(rc.forecast.gap - base.gap) < 1, '여유자금 확인 전 예측 = 계획');
    const p = M.proposal(c, rc, 'surplus');
    assert.ok(p.needsBalanceCheck); assert.strictEqual(p.data.extraIncome.filter((x) => x.kind === 'surplus').length, 1, '한 번만 배분');
  });

  await test('계획보다 많이 쓰면 초과분만큼 저축 감소, 필수생활비 하한 안에서 보완안', () => {
    const c = ctxBase(); c.consent = { floor: 1250000 };
    const rc = M.recalc(c);
    assert.strictEqual(rc.lastFinal.overspend, 1930000 - 1680000);
    assert.ok(rc.requiredCut > 0 && rc.requiredCut <= rc.maxCut);
    assert.strictEqual(rc.maxCut, S.AFTER.expenses.optional + (S.AFTER.expenses.essential - 1250000));
    const tooFar = Object.assign(ctxBase(), { data: Object.assign(JSON.parse(JSON.stringify(S.AFTER)), { goals: Object.assign({}, S.AFTER.goals, { housingTarget: 120000000 }) }) });
    const r2 = M.recalc(tooFar); assert.strictEqual(r2.requiredCut, null); const p2 = M.proposal(tooFar, r2, 'overspend'); assert.ok(p2.infeasible && !p2.data);
  });

  // ---------- 서버 ----------
  const { server, db } = createServer({ db: open(':memory:'), password: 'pw-test', secureCookie: false, scheduler: false });
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = async (email) => { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FP-Request': '1' }, body: JSON.stringify({ email, password: 'pw-test' }) }); return r.headers.get('set-cookie').split(';')[0]; };
  const api = (ck) => async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', 'X-FP-Request': '1', Cookie: ck }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json() }; };
  const P = api(await login('planner@demo.kr')), Cl = api(await login('client@demo.kr')), P2 = api(await login('planner2@demo.kr'));
  const cid = 1;

  await test('기존 결과 확인: 금융기관 결과와 앱 결과를 따로 저장, 변화가 있으면 재진단 권유', async () => {
    const x = (await Cl('GET', '/api/clients/1/extra')).body;
    const off = x.risk.find((r) => r.kind === 'official'); assert.ok(off && off.source && off.diagnosedAt && off.purpose);
    const reasons = Risk.resurveyReasons(off, x.snapshot, NOW); assert.ok(reasons.length >= 2, reasons.join('/'));
    assert.strictEqual((await Cl('POST', '/api/clients/1/risk/official', { type: '안정형', diagnosedAt: '2026-01-01', source: 'x' })).status, 403, '고객은 공식 결과 입력 불가');
  });

  await test('앱 설문: 서버에서 다시 채점, 누락 시 저장 거부, 과거 결과는 이력 보존', async () => {
    const bad = Object.assign({}, ANS); delete bad.q2;
    assert.strictEqual((await Cl('POST', '/api/clients/1/risk/app', { answers: bad })).status, 400);
    const ok = await Cl('POST', '/api/clients/1/risk/app', { answers: ANS }); assert.strictEqual(ok.status, 200);
    await Cl('POST', '/api/clients/1/risk/app', { answers: Object.assign({}, ANS, { q3: 'b' }) });
    const rows = (await P('GET', '/api/clients/1/extra')).body.risk;
    const apps = rows.filter((r) => r.kind === 'app'); assert.strictEqual(apps.length, 2);
    assert.ok(apps[0].answers && apps[0].result.version === CFG.VERSION && apps[0].snapshot.netMonthly);
    assert.strictEqual((await P2('GET', '/api/clients/1/extra')).status, 403);
  });

  let setId;
  await test('설계사 작성·수정 → 제시 → 고객 선택 시 새 버전·실행 기준 저장', async () => {
    const plans = (await P('GET', '/api/clients/1/plans')).body.plans; const after1 = plans.find((p) => p.kind === 'after' && p.version === 1);
    assert.strictEqual((await Cl('POST', '/api/clients/1/strategies', { basePlanId: after1.id })).status, 403);
    setId = (await P('POST', '/api/clients/1/strategies', { basePlanId: after1.id })).body.id;
    let x = (await Cl('GET', '/api/clients/1/extra')).body; assert.ok(!x.strategies.some((s) => s.id === setId), '작성 중인 안은 고객에게 안 보임');
    const ov = { B: { optionalCut: 100000 } };
    assert.strictEqual((await P('PUT', '/api/clients/1/strategies/' + setId, { overrides: ov })).status, 200);
    x = (await P('GET', '/api/clients/1/extra')).body; assert.strictEqual(x.strategies.find((s) => s.id === setId).result.options[1].params.optionalCut, 100000);
    assert.strictEqual((await Cl('POST', '/api/clients/1/strategies/' + setId + '/select', { key: 'B', confirm: true })).status, 409, '제시 전 선택 불가');
    await P('POST', '/api/clients/1/strategies/' + setId + '/present');
    assert.strictEqual((await P('PUT', '/api/clients/1/strategies/' + setId, { overrides: {} })).status, 409, '제시 후 수정 불가');
    assert.strictEqual((await Cl('POST', '/api/clients/1/strategies/' + setId + '/select', { key: 'B' })).status, 400, '확인 없이 선택 불가');
    const before = (await Cl('GET', '/api/clients/1/plans')).body.plans;
    const sel = await Cl('POST', '/api/clients/1/strategies/' + setId + '/select', { key: 'B', confirm: true }); assert.strictEqual(sel.status, 200);
    const after = (await Cl('GET', '/api/clients/1/plans')).body.plans; assert.strictEqual(after.length, before.length + 1);
    before.forEach((p) => assert.deepStrictEqual(after.find((q) => q.id === p.id).data, p.data, '이전 버전 보존'));
    x = (await Cl('GET', '/api/clients/1/extra')).body; assert.strictEqual(x.baselineId, sel.body.planId);
  });

  await test('수정안은 확인 전에 기준 계획을 바꾸지 않음', async () => {
    const bl0 = (await Cl('GET', '/api/clients/1/extra')).body.baselineId;
    jobs.evaluate(db, cid, { now: NOW });
    const x = (await Cl('GET', '/api/clients/1/extra')).body;
    assert.ok(x.revisions.some((r) => r.status === 'pending'), '확인 대기 수정안이 있어야 함');
    assert.strictEqual(x.baselineId, bl0);
    x.revisions.filter((r) => r.status === 'pending').forEach((r) => assert.strictEqual(r.appliedPlanId, null));
  });

  await test('알림 금액 = 대시보드 계산 결과, 같은 상황 중복 알림 없음', async () => {
    const ctx = jobs.context(db, cid, NOW), rc = M.recalc(ctx);
    const n = db.prepare("SELECT * FROM notifications WHERE client_id = 1 AND type = 'overspend'").get();
    assert.ok(n, '초과 지출 알림 생성');
    assert.ok(n.fact.includes(Math.round(rc.lastFinal.overspend / 10000).toLocaleString('ko-KR') + '만원'));
    if (rc.requiredCut > 0) assert.ok(n.impact.includes(Math.round(rc.requiredCut / 10000).toLocaleString('ko-KR') + '만원'), n.impact);
    const cnt = db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
    jobs.evaluate(db, cid, { now: NOW }); jobs.evaluate(db, cid, { now: NOW });
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, cnt);
  });

  await test('알림 읽음 처리·설계사 문의·수신 거부', async () => {
    const n = (await Cl('GET', '/api/clients/1/extra')).body.notifications[0];
    await Cl('POST', '/api/clients/1/notifications/' + n.id + '/read');
    assert.ok((await Cl('GET', '/api/clients/1/extra')).body.notifications.find((x) => x.id === n.id).readAt);
    await Cl('POST', '/api/clients/1/notifications/' + n.id + '/ask', { message: '절감 대신 목표일을 늦추면 어떤가요?' });
    assert.strictEqual((await P('GET', '/api/clients/1/extra')).body.inquiries.length, 1);
    // 수신 거부: 새 상황(비상금 부족)을 만들되 해당 유형을 끈 상태
    await Cl('PUT', '/api/clients/1/notif-settings', { settings: { types: { emergencyLow: false }, quietStart: '22:00', quietEnd: '08:00', push: false } });
    await Cl('PUT', '/api/clients/1/settings', { settings: { dueDay: 25, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 24, staleDays: 7 } });
    jobs.evaluate(db, cid, { now: NOW });
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'emergencyLow'").get().n, 0);
    await Cl('PUT', '/api/clients/1/notif-settings', { settings: { types: {}, quietStart: '22:00', quietEnd: '08:00', push: false } });
    jobs.evaluate(db, cid, { now: NOW });
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'emergencyLow'").get().n, 1, '다시 켜면 생성');
    await Cl('PUT', '/api/clients/1/settings', { settings: { dueDay: 25, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 3, staleDays: 7 } });
  });

  await test('자동 적용은 동의한 범위에서만 (한도 초과 시 확인 대기, 범위 안이면 새 버전)', async () => {
    // 새 상황: 기준 계획 기준으로 다시 수정안이 생기도록 이전 수정안 정리
    const bl = jobs.baselinePlan(db, cid);
    db.prepare('DELETE FROM revisions WHERE client_id = 1').run();
    await Cl('PUT', '/api/clients/1/consent', { consent: { enabled: true, monthlyLimit: 10000, floor: 1200000 } });
    db.prepare('INSERT OR IGNORE INTO records (client_id, month, category, amount, source, created_by, created_at) VALUES (1, ?, ?, ?, ?, 3, ?)').run('2026-10', 'expense:optional', 400000, 'manual', new Date().toISOString());
    jobs.evaluate(db, cid, { now: NOW });
    let rv = db.prepare("SELECT * FROM revisions WHERE client_id = 1 AND kind = 'overspend'").get();
    assert.ok(rv, '수정안 생성'); assert.strictEqual(rv.status, 'pending', '한도(1만원) 초과 → 자동 적용 안 함');
    assert.strictEqual(jobs.baselinePlan(db, cid).id, bl.id);
    db.prepare('DELETE FROM revisions WHERE client_id = 1').run();
    await Cl('PUT', '/api/clients/1/consent', { consent: { enabled: true, monthlyLimit: 1000000, floor: 1200000 } });
    const nPlans = db.prepare('SELECT COUNT(*) AS n FROM plans WHERE client_id = 1').get().n;
    jobs.evaluate(db, cid, { now: NOW });
    rv = db.prepare("SELECT * FROM revisions WHERE client_id = 1 AND kind = 'overspend'").get();
    assert.strictEqual(rv.status, 'auto'); assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM plans WHERE client_id = 1').get().n, nPlans + 1);
    const nb = jobs.baselinePlan(db, cid); assert.notStrictEqual(nb.id, bl.id);
    assert.strictEqual(nb.data.basis.moveMonth, bl.data.basis.moveMonth, '목표일은 자동으로 바뀌지 않음');
    assert.strictEqual(JSON.stringify(nb.data.products), JSON.stringify(bl.data.products), '상품 해지·추가 없음');
    assert.strictEqual(nb.data.plan.investShare, bl.data.plan.investShare, '위험 확대 없음');
    const cut = nb.data.plan.cuts[nb.data.plan.cuts.length - 1].amount;
    assert.ok(nb.data.expenses.essential - Math.max(0, cut - nb.data.expenses.optional) >= 1200000, '필수생활비 하한');
    assert.deepStrictEqual(JSON.parse(db.prepare('SELECT data FROM plans WHERE id = ?').get(bl.id).data), bl.data, '이전 버전 보존');
    await Cl('PUT', '/api/clients/1/consent', { consent: { enabled: false, monthlyLimit: 100000, floor: 0 } });
  });

  await test('수동 적용: 고객 확인 후에만, 이미 적용한 수정안은 다시 적용 불가', async () => {
    db.prepare('DELETE FROM revisions WHERE client_id = 1').run();
    db.prepare("INSERT INTO records (client_id, month, category, amount, source, created_by, created_at) VALUES (1, '2026-10', 'expense:optional', 300000, 'manual', 3, ?)").run(new Date().toISOString());
    jobs.evaluate(db, cid, { now: NOW });
    const rv = db.prepare("SELECT * FROM revisions WHERE client_id = 1 AND status = 'pending'").get(); assert.ok(rv);
    assert.strictEqual((await P('POST', '/api/clients/1/revisions/' + rv.id + '/apply')).status, 403, '설계사는 적용 불가');
    const r = await Cl('POST', '/api/clients/1/revisions/' + rv.id + '/apply'); assert.strictEqual(r.status, 200);
    assert.strictEqual(jobs.baselinePlan(db, cid).id, r.body.planId);
    assert.strictEqual((await Cl('POST', '/api/clients/1/revisions/' + rv.id + '/apply')).status, 409);
  });

  await test('월 확정: 미확인 거래·결제 전 예정이 있으면 거부', async () => {
    const r = await Cl('POST', '/api/clients/1/months/2026-11/close', { confirm: true }); assert.strictEqual(r.status, 409);
  });

  await test('Web Push: 암호화(RFC 8291) 왕복과 VAPID 서명 검증', () => {
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
    const sub = { endpoint: 'https://push.example.net/abc', keys: { p256dh: push.b64u(ua.getPublicKey()), auth: push.b64u(auth) } };
    const body = push.encrypt('{"title":"t","body":"새 알림"}', sub);
    assert.strictEqual(push.decrypt(body, ua.getPrivateKey(), ua.getPublicKey(), auth), '{"title":"t","body":"새 알림"}');
    const keys = push.loadKeys(null), h = push.vapidHeader(keys, sub.endpoint, 'mailto:a@example.com');
    const t = h.match(/t=([^,]+)/)[1].split('.'), pub = push.unb64u(keys.publicKey);
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: push.b64u(pub.subarray(1, 33)), y: push.b64u(pub.subarray(33)) }, format: 'jwk' });
    assert.ok(crypto.verify('sha256', Buffer.from(t[0] + '.' + t[1]), { key, dsaEncoding: 'ieee-p1363' }, push.unb64u(t[2])));
    assert.strictEqual(JSON.parse(push.unb64u(t[1])).aud, 'https://push.example.net');
  });

  await test('푸시 발송: 방해금지 시간엔 보류, 잠금 화면 기본 문구에 금액 없음, 거부·미구독이면 알림함만', async () => {
    db.prepare("INSERT INTO push_subs (user_id, client_id, endpoint, p256dh, auth, created_at) VALUES (3, 1, 'https://push.example.net/x', 'k', 'a', ?)").run(new Date().toISOString());
    db.prepare("UPDATE notifications SET push_state = 'pending' WHERE client_id = 1").run();
    await Cl('PUT', '/api/clients/1/notif-settings', { settings: { types: {}, quietStart: '22:00', quietEnd: '08:00', push: true, lockDetails: false } });
    const sentPayloads = []; const sender = async (s, p) => { sentPayloads.push(p); return { ok: true, status: 201 }; };
    const q = await jobs.dispatch(db, 1, null, { now: new Date(2026, 10, 3, 23, 30), sender }); assert.strictEqual(q.reason, 'quiet'); assert.strictEqual(sentPayloads.length, 0);
    const d = await jobs.dispatch(db, 1, null, { now: new Date(2026, 10, 4, 9, 0), sender }); assert.ok(d.sent > 0);
    sentPayloads.forEach((p) => { assert.ok(!/\d+만원/.test(p.body), '잠금 화면에 금액 없음: ' + p.body); assert.strictEqual(p.url, '/#inbox'); });
    db.prepare('DELETE FROM push_subs').run(); db.prepare("UPDATE notifications SET push_state = 'pending' WHERE client_id = 1").run();
    const n = await jobs.dispatch(db, 1, null, { now: new Date(2026, 10, 4, 9, 0), sender }); assert.strictEqual(n.reason, 'noSubscription');
  });

  server.close();
  console.log('\n결과: ' + passed + '개 통과, ' + failed + '개 실패');
  process.exit(failed ? 1 : 0);
})();
