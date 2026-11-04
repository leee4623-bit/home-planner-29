/*
 * 상품 비교 검증 — 계산 가정·출처 표시·조회 실패 처리
 * 공시 API 응답은 시험용 가짜 서버로 흉내 냅니다(시험 안에서만 사용, 앱 화면에는 나오지 않음).
 * 실행: node --no-warnings tests/products.test.js
 */
'use strict';
const assert = require('assert');
const http = require('http');
const Prod = require('../public/js/engine/products.js');
const CD = require('../public/js/engine/clientData.js');
const S = require('../public/js/data/sampleCase.js');
const products = require('../server/products.js');
const { open } = require('../server/db.js');
const { runner } = require('./helpers');

(async () => {
  const R = runner('상품 비교 검증'); const test = R.test;
  const cd = CD.fromPlan(S.BEFORE, S.PROFILE); cd.goal.moveMonth = '2029-12';
  const sit = Prod.clientSituation(cd, new Date(2026, 10, 4));

  await test('적금 이자: 단리·복리 공식, 세금 15.4%', () => {
    const s = Prod.interest('saving', 100000, 12, 3.6, '단리');
    assert.ok(Math.abs(s - 100000 * 0.003 * 78) < 1e-6);
    const c = Prod.interest('saving', 100000, 12, 3.6, '복리'); assert.ok(c > s);
    const d = Prod.interest('deposit', 10000000, 12, 3.0, '단리'); assert.ok(Math.abs(d - 300000) < 1e-6);
  });

  const fssSaving = Prod.fromFss('saving', { dcls_month: '202610', fin_co_no: '001', kor_co_nm: '시험은행', fin_prdt_cd: 'S1', fin_prdt_nm: '시험적금', join_way: '스마트폰', spcl_cnd: '급여이체 시 0.5%p', join_deny: '1', join_member: '실명의 개인', max_limit: 500000, mtrt_int: '만기 후 1%' },
    [{ save_trm: '36', intr_rate_type_nm: '단리', intr_rate: 3.0, intr_rate2: 3.5, rsrv_type_nm: '자유적립식' }, { save_trm: '12', intr_rate_type_nm: '단리', intr_rate: 2.8, intr_rate2: 3.3, rsrv_type_nm: '정액적립식' }], '020000', '2026-11-04T00:00:00Z');

  await test('공시 상품: 출처·공시월·확인일·예금자보호 표시', () => {
    assert.ok(fssSaving.sourceUrl.startsWith('https://finlife.fss.or.kr')); assert.ok(fssSaving.sourceTitle.includes('202610'));
    assert.strictEqual(fssSaving.checkedAt, '2026-11-04T00:00:00Z'); assert.ok(/1억원/.test(fssSaving.protection)); assert.ok(fssSaving.earlyTermination);
  });
  await test('우대조건 미확인 → 기본금리만 확정, 최고금리는 조건부로 따로', () => {
    const r = Prod.evaluate(fssSaving, { monthly: 300000, months: 36, startMonth: '2026-12' }, sit);
    assert.strictEqual(r.confirmed.rate, 3.0); assert.strictEqual(r.conditional.rate, 3.5);
    const met = Prod.evaluate(fssSaving, { monthly: 300000, months: 36, startMonth: '2026-12', prefMet: { [fssSaving.id]: true } }, sit);
    assert.strictEqual(met.confirmed.rate, 3.5); assert.ok(!met.conditional);
    assert.ok(Math.abs(r.confirmed.tax - r.confirmed.interest * 0.154) < 1e-6);
  });
  await test('목표 연결: 만기 도래 여부·목표일 사용 가능 금액·감당 가능성·비상금·부채 영향', () => {
    const r = Prod.evaluate(fssSaving, { monthly: 300000, months: 36, startMonth: '2026-12' }, sit);
    assert.strictEqual(r.goal.maturity, '2029-12'); assert.strictEqual(r.goal.matures, true); assert.strictEqual(r.goal.usableAtGoal, r.confirmed.net);
    const late = Prod.evaluate(fssSaving, { monthly: 300000, months: 36, startMonth: '2027-06' }, sit);
    assert.strictEqual(late.goal.matures, false); assert.ok(late.goal.usableAtGoal <= 300000 * 36, '만기 전 해지 → 원금만'); assert.ok(/원금만/.test(late.goal.usableNote));
    assert.ok(r.goal.afford && r.goal.afford.ok !== undefined);
    assert.ok(r.goal.impact.some((t) => /신용대출|6.5%/.test(t)), '고금리 부채 비교 안내');
  });
  await test('미입력 정보가 있으면 감당 가능성을 판단하지 않음(0으로 가정하지 않음)', () => {
    const cd2 = JSON.parse(JSON.stringify(cd)); cd2.income.netMonthly = null;
    const r = Prod.evaluate(fssSaving, { monthly: 300000, months: 36 }, Prod.clientSituation(cd2, new Date(2026, 10, 4)));
    assert.strictEqual(r.goal.afford.ok, null); assert.ok(/미입력/.test(r.goal.afford.text));
  });
  await test('해당 기간 상품이 없으면 계산하지 않음', () => { assert.strictEqual(Prod.evaluate(fssSaving, { monthly: 1, months: 24 }, sit).available, false); });
  await test('정책형: 확인된 정부기여금만 확정, 은행 금리 미확인은 0% 가정과 함께 명시', () => {
    const yf = Prod.policyProducts().find((p) => p.policyId === 'youthFuture');
    const r = Prod.evaluate(yf, { monthly: 300000, months: 36 }, sit);
    assert.ok(Math.abs(r.confirmed.support - 300000 * 36 * 0.06) < 1e-6); assert.strictEqual(r.confirmed.interest, 0);
    assert.ok(r.notes.some((t) => /은행 금리/.test(t))); assert.ok(yf.sources.every((s) => s && /^https:\/\//.test(s.url)) && yf.checkedAt);
    const sm = Prod.policyProducts().find((p) => p.policyId === 'smeSaving');
    const r2 = Prod.evaluate(sm, { monthly: 300000, months: 36 }, sit);
    assert.strictEqual(r2.confirmed.support, 0, '회사 참여 미확인 → 기업 지원금 확정 계산 제외'); assert.ok(r2.conditional);
    assert.strictEqual(r2.goal.matures, false, '5년 만기 → 목표일까지 만기 안 됨');
  });
  await test('범주가 다른 상품(대출)은 수령액 비교에 넣지 않음', () => {
    const yl = Prod.policyProducts().find((p) => p.category === 'loan'); assert.strictEqual(Prod.evaluate(yl, { monthly: 1, months: 36 }, sit).available, false);
  });
  await test('계획에 반영해보기: 실행 기준 계획은 그대로, 사본으로 전후 비교', () => {
    const plan = JSON.parse(JSON.stringify(S.AFTER)); const keep = JSON.stringify(plan);
    const r = Prod.evaluate(fssSaving, { monthly: 200000, months: 36, startMonth: '2026-12' }, sit);
    const after = Prod.applyToPlan(plan, fssSaving, { monthly: 200000, months: 36 }, r);
    assert.strictEqual(JSON.stringify(plan), keep);
    const cmp = Prod.compare(plan, after, '2026-12');
    assert.ok(cmp.after.surplus < cmp.before.surplus, '월 여유자금 감소 표시'); assert.ok(typeof cmp.after.gap === 'number');
    const dep = Prod.fromFss('deposit', { fin_co_no: '2', kor_co_nm: '시험은행', fin_prdt_cd: 'D', fin_prdt_nm: '시험예금' }, [{ save_trm: '36', intr_rate_type_nm: '단리', intr_rate: 3, intr_rate2: 3 }], '020000', 'x');
    const rd = Prod.evaluate(dep, { lump: 5000000, months: 36, startMonth: '2026-09' }, sit);
    const sim = require('../public/js/engine/calc.js').simulate(Prod.applyToPlan(plan, dep, { lump: 5000000, months: 36 }, rd));
    const pp = sim.products.find((p) => p.productRef === undefined && /시험예금/.test(p.name));
    assert.ok(pp.paid && pp.beforeTarget, '목표일 전 만기'); assert.ok(Math.abs(pp.payoutAmount - (5000000 + 5000000 * 0.03 * 3 * (1 - 0.154))) < 1, '원금+세후 단리 이자가 만기에 주거자금으로');
  });

  // ---------- 서버: 공시 API 조회·실패 표시 ----------
  let mode = 'ok';
  const fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (mode === 'fail') { res.writeHead(500); return res.end(); }
    if (u.searchParams.get('auth') !== 'TESTKEY') { res.writeHead(200); return res.end(JSON.stringify({ result: { err_cd: '010', err_msg: '미등록 인증키' } })); }
    const name = u.pathname.split('/').pop();
    const base = [{ dcls_month: '202610', fin_co_no: 'F' + u.searchParams.get('topFinGrpNo'), kor_co_nm: '시험기관', fin_prdt_cd: name, fin_prdt_nm: '시험상품 ' + name, spcl_cnd: '없음' }];
    const opt = name.indexOf('Loan') >= 0 ? [{ fin_co_no: base[0].fin_co_no, fin_prdt_cd: name, lend_rate_min: 3.1, lend_rate_max: 4.2, rpay_type_nm: '만기일시', lend_rate_type_nm: '변동' }] : [{ fin_co_no: base[0].fin_co_no, fin_prdt_cd: name, save_trm: '36', intr_rate_type_nm: '단리', intr_rate: 3, intr_rate2: 3.4 }];
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ result: { err_cd: '000', max_page_no: 1, now_page_no: 1, baseList: base, optionList: opt } }));
  });
  await new Promise((r) => fake.listen(0, r));
  const fakeUrl = 'http://127.0.0.1:' + fake.address().port + '/finlifeapi';
  const db = await open({ file: ':memory:' });
  const savedKey = process.env.FSS_API_KEY;

  await test('인증키가 없으면 조회하지 않고, 상품을 지어내지 않음', async () => {
    delete process.env.FSS_API_KEY;
    await products.refresh(db, { baseUrl: fakeUrl });
    const l = await products.list(db);
    assert.strictEqual(l.products.filter((p) => p.source === 'fss').length, 0); assert.strictEqual(l.keyConfigured, false);
    assert.ok(/FSS_API_KEY/.test(l.meta['fss:deposit'].error)); assert.strictEqual(l.investment.connected, false);
  });
  await test('조회 성공 → 공시 상품 저장(확인 시각 포함)', async () => {
    process.env.FSS_API_KEY = 'TESTKEY';
    const r = await products.refresh(db, { baseUrl: fakeUrl }); assert.ok(r.deposit.ok && r.saving.ok && r.loan.ok);
    const l = await products.list(db);
    assert.ok(l.products.filter((p) => p.source === 'fss').length >= 5); assert.ok(l.meta['fss:saving'].ok && l.meta['fss:saving'].fetchedAt && !l.meta['fss:saving'].stale);
  });
  await test('조회 실패 → 이전 자료 유지 + 실패·마지막 성공 시각 표시', async () => {
    mode = 'fail';
    await products.refresh(db, { baseUrl: fakeUrl });
    const l = await products.list(db);
    assert.ok(l.products.filter((p) => p.source === 'fss').length >= 5, '이전 자료 유지');
    assert.strictEqual(l.meta['fss:saving'].ok, false); assert.ok(l.meta['fss:saving'].error); assert.ok(l.meta['fss:saving'].fetchedAt, '마지막 성공 시각');
  });
  await test('잘못된 키 응답(err_cd≠000)은 실패로 표시', async () => {
    mode = 'ok';
    const r = await products.refresh(db, { baseUrl: fakeUrl, key: 'WRONG' }); assert.strictEqual(r.saving.ok, false); assert.ok(/010/.test(r.saving.error));
  });
  if (savedKey === undefined) delete process.env.FSS_API_KEY; else process.env.FSS_API_KEY = savedKey;
  fake.close(); await db.close();
  process.exit(R.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
