/*
 * 계산 엔진 검증 — 요구사항 8번 항목 중심
 * 실행: node tests/engine.test.js
 */
'use strict';
const assert = require('assert');
const C = require('../public/js/engine/calc.js');
const A = require('../public/js/engine/analysis.js');
const S = require('../public/js/data/sampleCase.js');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message); } }
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= (tol || 1e-6), (m || '') + ' 기대 ' + b + ', 실제 ' + a);
const clone = (o) => JSON.parse(JSON.stringify(o));
const today = new Date(2026, 10, 2); // 2026-11-02

console.log('계산 엔진 검증');

test('이번 달 추가 납입은 현금흐름에 한 번만 반영 (실적이 계획을 대체)', () => {
  const d = clone(S.AFTER); const t = C.ymDiff(d.basis.baseMonth, '2026-12');
  const plan = C.simulate(d);
  const planned = plan.rows[t].housingIn;
  const act = {}; act[t] = { housing: 400000, emergency: plan.rows[t].emergencyIn };
  const r = C.simulate(d, { actuals: act });
  near(r.rows[t].housingIn, 400000, 1e-6, '실적 달 주거 납입');
  near(r.rows[t].housingBal - r.rows[t - 1].housingBal * (1 + 3 / 1200), 400000, 1, '잔액 증가 = 실적 1회');
  assert.ok(Math.abs(r.rows[t].housingIn - (planned + 400000)) > 1, '계획과 실적이 합산되면 안 됨');
});

test('납입으로 생활자금이 부족해지면 표시', () => {
  const d = clone(S.AFTER);
  const sb = A.sandbox(d, [], 3000000, { today });
  assert.ok(sb.cashShort > 0, '300만원 추가 납입 시 생활자금 부족이 표시되어야 함');
  const small = A.sandbox(d, [], 10000, { today });
  assert.strictEqual(small.cashShort, 0);
});

test('가정해보기는 실제 기록에 저장되지 않음 (입력 기록 불변)', () => {
  const recs = [{ month: '2026-09', category: 'debt', amount: 650000, status: 'confirmed' }];
  const before = JSON.stringify(recs);
  A.sandbox(S.AFTER, recs, 500000, { today });
  assert.strictEqual(JSON.stringify(recs), before);
});

test('만기 이후 자금은 목표일 재원에서 제외', () => {
  const d = clone(S.AFTER); d.basis.moveMonth = '2029-08'; // 적금 만기 2029-12보다 이전
  const r = C.simulate(d);
  const p = r.products[0];
  assert.strictEqual(p.beforeTarget, false);
  assert.ok(r.warnings.some((w) => w.code === 'maturityAfterTarget'));
  for (let t = 1; t <= r.T; t++) assert.strictEqual(r.rows[t].productPayout, 0, t + '개월 지급 없음');
  assert.ok(r.at.productBal > 0, '목표일 시점 적금은 사용 제한 자산');
  near(r.at.usableHousing, r.at.housingBal + r.at.investBal, 1e-6, '사용 가능 주거자금에 적금 잔액 미포함');
  const d2 = clone(S.AFTER); const r2 = C.simulate(d2);
  assert.ok(r2.products[0].beforeTarget && r2.rows[C.ymDiff(d2.basis.baseMonth, '2029-12')].productPayout > 0, '만기가 이사월 이전이면 그 달에 주거자금으로 지급');
});

test('정부기여금은 납입액 × 기여율 (연이율로 계산하지 않음), 미확인 기여금은 제외', () => {
  const d = clone(S.AFTER); const r = C.simulate(d); const p = r.products[0];
  near(p.gov, 300000 * 36 * 0.06, 1e-6);
  const d2 = clone(S.AFTER); d2.products[0].govConfirmed = false; const r2 = C.simulate(d2);
  near(r2.products[0].gov, 0); assert.ok(r2.warnings.some((w) => w.code === 'govUnconfirmed'));
});

test('정책 혜택과 실수령 소득 중복 없음 (감면이 실수령에 반영된 경우 더하지 않음)', () => {
  const d = clone(S.BEFORE); const r = C.simulate(d);
  const endT = r.taxRelief.end;
  near(r.rows[1].salary, d.income.netMonthly, 1e-6, '감면 기간 중 실수령 그대로');
  assert.strictEqual(r.rows.reduce((s, x) => s + x.taxRefund, 0), 0, '환급 유입 없음');
});

test('소득세 감면 종료 후 현금흐름 갱신', () => {
  const d = clone(S.BEFORE); const r = C.simulate(d); const endT = r.taxRelief.end;
  near(r.rows[endT].salary, 2900000, 1e-6);
  near(r.rows[endT + 1].salary, 2900000 - Math.min(1200000 * 0.9, 2000000) / 12, 1e-6);
  assert.ok(r.rows[endT + 1].events.includes('taxReliefEnd'));
  const d2 = clone(S.BEFORE); d2.taxRelief.mode = 'yearEndRefund'; const r2 = C.simulate(d2);
  const feb = r2.rows.find((x) => x.ym === '2027-02');
  near(feb.taxRefund, 1080000 * 12 / 12, 1e-6, '2026년 12개월분 환급');
  near(r2.rows.find((x) => x.ym === '2029-02').taxRefund, 1080000 * 10 / 12, 1e-6, '2028년은 10월까지 10개월분');
  near(r2.rows[1].salary, 2900000, 1e-6, '환급형은 실수령에서 빼지 않음');
});

test('확인되지 않은 감면은 자동 적용하지 않음', () => {
  const d = clone(S.BEFORE); d.taxRelief.confirmed = false; const r = C.simulate(d);
  assert.strictEqual(r.taxRelief, null);
});

test('역산 결과를 적용하면 세 조건을 모두 충족', () => {
  const rc = A.reverseCut(S.AFTER, { start: 4 });
  assert.ok(rc.feasible && rc.required > 0);
  const applied = A.applyCut(S.AFTER, rc); const r = C.simulate(applied);
  assert.strictEqual(r.status, 'achieved');
  const less = C.simulate(S.AFTER, { cut: { amount: rc.required - 10000, start: 4 } });
  assert.notStrictEqual(less.status, 'achieved', '1만원 적으면 미달 → 최소값');
  assert.ok(rc.required <= rc.maxCut, '절감 가능액 이내');
});

test('절감 불가능한 금액은 대안으로 제시하지 않음', () => {
  const d = clone(S.BEFORE); d.goals.housingTarget = 200000000;
  const rc = A.reverseCut(d, { start: 1 });
  assert.strictEqual(rc.feasible, false); assert.strictEqual(rc.required, null);
  assert.ok(!rc.check);
  assert.ok(rc.alt.extendBy === null || rc.alt.extendBy > 0);
  const d2 = clone(S.BEFORE); d2.expenses.minEssential = d2.expenses.essential;
  assert.strictEqual(A.reverseCut(d2, { start: 1 }).maxCut, d2.expenses.optional, '필수생활비가 최소선이면 선택지출만 절감 가능');
});

test('신규 대출 활용안은 무대출 기본안과 분리', () => {
  const L = A.loanCompare(S.AFTER, S.PROFILE, {});
  assert.ok(L.label.includes('무대출 목표 충족 아님'));
  assert.ok(L.loan > 0 && L.newDebt === L.loan);
  const plain = C.simulate(S.AFTER);
  near(L.noLoan.gap, plain.gap, 1e-6, '기본안 결과는 대출 비교와 무관하게 동일');
  assert.ok(L.withLoan.gap > L.noLoan.gap);
  assert.strictEqual(L.rate, 2.5); assert.strictEqual(L.pref, 0, '우대금리는 선택해야 적용');
  assert.strictEqual(A.loanCompare(S.AFTER, S.PROFILE, { applySmePref: true }).finalRate, 2.2);
});

test('기록이 없는 달은 실패·0원으로 단정하지 않음', () => {
  const recs = [{ month: '2026-09', category: 'debt', amount: 650000, status: 'confirmed' }, { month: '2026-09', category: 'emergency', amount: 570000, status: 'confirmed' }];
  const ex = A.execution(S.AFTER, recs, { today });
  assert.ok(ex.noRecord.includes('2026-10'));
  assert.ok(!ex.actuals[C.ymDiff('2026-08', '2026-10')], '10월은 실적 0원으로 들어가지 않음');
  assert.strictEqual(ex.cumPlan, 650000 + 570000, '누적 비교는 기록 있는 달만');
  const al = A.alerts(ex, { now: today });
  assert.ok(!al.some((a) => a.id === 'cumShort'));
  assert.ok(al.some((a) => a.id === 'noRecord' && a.level === 'info'));
  ex.items.forEach((it) => assert.notStrictEqual(it.state, 'short', '납입일 전에는 미달 확정 아님'));
});

test('납입 예정일이 지나고 미달이면 경보, 그 전이면 ‘예정’', () => {
  const recs = [{ month: '2026-11', category: 'debt', amount: 300000, status: 'confirmed' }];
  const early = A.execution(S.AFTER, recs, { today: new Date(2026, 10, 10) });
  assert.strictEqual(early.items[0].state, 'partial');
  const late = A.execution(S.AFTER, recs, { today: new Date(2026, 10, 29) });
  assert.strictEqual(late.items[0].state, 'short');
  assert.ok(A.alerts(late, { now: new Date(2026, 10, 29) }).some((a) => a.id === 'dueShort:debt'));
});

test('여러 충격 동시 적용과 결과 지표', () => {
  const s = A.shockImpact(S.AFTER, [{ type: 'jobLoss', start: 13, duration: 6, size: 1800000 }, { type: 'targetRise', start: 0, duration: 0, size: 15 }]);
  assert.ok(s.gapChange < 0); assert.ok(s.delay === null || s.delay >= s.delayBase);
  assert.strictEqual(s.shocked.rows[14].unemployed, true);
  const dd = C.simulate(S.BEFORE, { shocks: [{ type: 'depositDelay', start: 0, size: 20 }] });
  assert.ok(dd.rows.every((r, t) => t > dd.T || r.depositIn === 0), '반환이 목표일 뒤로 밀리면 목표 재원 제외');
});

test('초과소득 비율 배분: 충족된 항목의 남는 몫은 다음 항목으로', () => {
  const ds = [{ balance: 100000, rate: 5 }];
  const out = C.allocate(1000000, { mode: 'ratio', order: ['emergency', 'debt', 'housing'], ratios: { emergency: 50, debt: 30, housing: 20 } }, { emergencyRoom: 200000, debts: ds });
  near(out.emergency, 200000); near(out.debt, 100000); near(out.housing, 700000);
  near(out.emergency + out.debt + out.housing, 1000000);
});

test('미확정 초과소득은 기본 계획 재원에서 제외', () => {
  const r1 = C.simulate(S.BEFORE), r2 = C.simulate(S.BEFORE, { includeExpected: true });
  assert.ok(r2.at.usableHousing + r2.at.emergencyBal > r1.at.usableHousing + r1.at.emergencyBal - 1);
  assert.strictEqual(r1.rows.reduce((s, x) => s + x.bonus, 0), 0);
});

test('지표: 분모 0·순자산 음수는 상태 문구', () => {
  const d = clone(S.BEFORE); d.assets = { cash: 0, emergencyFund: 0, investment: 0, housingFund: 0, deposit: 0, pension: 0 }; d.plan.lumpSum = 0;
  const ind = A.indicators(C.simulate(d));
  assert.strictEqual(ind.debtToAssets, null);
  assert.ok(A.ratioState(ind.debtToAssets, 'debtToAssets', ind));
  assert.ok(A.ratioState(ind.debtToNet, 'debtToNet', ind).includes('순자산'));
});

test('판정: 주거자금만 충족하면 부분 충족', () => {
  const d = clone(S.BEFORE); d.goals.housingTarget = 10000000;
  const v = A.verdict(C.simulate(d));
  assert.strictEqual(v.status, 'partial'); assert.strictEqual(v.label, '부분 충족');
});

test('승진·연간 인상 중복 여부', () => {
  const d = clone(S.BEFORE); d.taxRelief.enabled = false; d.income.raisePct = 2; d.income.raiseMonth = 3; d.income.promotion = { month: '2027-01', pct: 10, stack: false };
  const r = C.simulate(d); const mar = r.rows.find((x) => x.ym === '2027-03');
  near(mar.salary, 2900000 * (1 + 0.10 * 0.75), 1e-6, '승진 후 12개월 내 연간 인상 생략');
  d.income.promotion.stack = true; const r2 = C.simulate(d);
  near(r2.rows.find((x) => x.ym === '2027-03').salary, 2900000 * 1.075 * 1.015, 1e-6, '중복 적용');
});

console.log('\n결과: ' + passed + '개 통과, ' + failed + '개 실패');
process.exit(failed ? 1 : 0);
