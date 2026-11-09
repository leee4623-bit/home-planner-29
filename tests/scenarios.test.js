// 충격 시나리오·소득 가정·초과소득 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/engine.js');
const Sc = require('../src/scenarios.js');
const demo = require('../data/demo.js');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const run = (s, list, opts) => engine.runPlan(s, 'after-v1', Sc.withScenarios(s, list, opts));

test('소득 감소: 지정 기간에만 적용', () => {
  const s = demo.getLegacyDemo();
  const r = run(s, [{ type: 'incomeDrop', start: '2027-01', months: 3, value: 0.1 }]);
  assert.equal(engine.rowAt(r, '2026-12').income, 290);
  near(engine.rowAt(r, '2027-01').income, 261);
  near(engine.rowAt(r, '2027-03').income, 261);
  assert.equal(engine.rowAt(r, '2027-04').income, 290);
});

test('실직: 기간 중 대체소득으로 바뀌고, 소득 감소와 겹치면 실직이 우선', () => {
  const s = demo.getLegacyDemo();
  const r = run(s, [
    { type: 'jobLoss', start: '2027-01', months: 2, value: 120 },
    { type: 'incomeDrop', start: '2027-01', months: 12, value: 0.1 }
  ]);
  assert.equal(engine.rowAt(r, '2027-01').income, 120);
  near(engine.rowAt(r, '2027-03').income, 261);
});

test('생활비 상승: months 0이면 끝까지', () => {
  const s = demo.getLegacyDemo();
  const r = run(s, [{ type: 'livingRise', start: '2027-01', months: 0, value: 0.1 }]);
  near(engine.rowAt(r, '2027-01').optional, 38 * 1.1);
  near(engine.rowAt(r, '2029-12').essential, 130 * 1.02 ** 3 * 1.1);
});

test('투자 손실: 시작월에 한 번만', () => {
  const s = demo.getLegacyDemo();
  const base = engine.runPlan(s, 'after-v1');
  const r = run(s, [{ type: 'investmentLoss', start: '2027-06', value: 0.2 }]);
  near(engine.rowAt(r, '2027-06').investment, engine.rowAt(base, '2027-06').investment * 0.8, 1e-6);
  near(engine.rowAt(r, '2029-12').investment, engine.rowAt(base, '2029-12').investment * 0.8, 1e-6);
});

test('목표 보증금 상승·보증금 반환 지연', () => {
  const s = demo.getLegacyDemo();
  const r = run(s, [{ type: 'depositTargetRise', value: 500 }, { type: 'depositDelay', value: 6 }]);
  assert.equal(r.input.goal.depositTarget, 5500);
  assert.equal(engine.rowAt(r, '2028-08').depositReturn, 0);
  assert.equal(engine.rowAt(r, '2029-02').depositReturn, 1000);
  assert.equal(s.customer.goal.depositTarget, 5000); // 원본 상태는 그대로
});

test('보증금 반환이 이사월 뒤로 밀리면 이사 자금에서 빠진다', () => {
  const s = demo.getLegacyDemo();
  const base = engine.runPlan(s, 'after-v1');
  const r = run(s, [{ type: 'depositDelay', value: 18 }]);
  assert.ok(engine.rowAt(base, '2029-12').usable - engine.rowAt(r, '2029-12').usable > 1000);
});

test('여러 충격 동시 적용: 각각보다 부족액이 크거나 같다', () => {
  const s = demo.getLegacyDemo();
  const a = { type: 'incomeDrop', start: '2027-01', months: 6, value: 0.2 };
  const b = { type: 'livingRise', start: '2027-01', months: 0, value: 0.05 };
  const short = (r) => r.judgement.conditions[2].shortfall;
  const both = short(run(s, [a, b]));
  assert.ok(both >= short(run(s, [a])) && both >= short(run(s, [b])));
  const c = Sc.compare(s, 'after-v1', [a, b]);
  assert.match(c.sentences[0], /소득 감소 \+ 생활비 상승/);
  assert.ok(c.deltaUsable < 0);
});

test('꺼진 시나리오는 적용하지 않는다', () => {
  const s = demo.getLegacyDemo();
  const r = run(s, [{ type: 'incomeDrop', start: '2026-09', months: 0, value: 0.5, enabled: false }]);
  assert.equal(r.rows[0].income, 290);
});

test('민감도 표: −5/−10/−15/−20%에서 부족액이 커진다', () => {
  const t = Sc.sensitivityTable(demo.getLegacyDemo(), 'after-v1');
  assert.deepEqual(t.map((r) => r.cut), [0, 0.05, 0.1, 0.15, 0.2]);
  near(t[0].shortfall, 5200 - engine.rowAt(engine.runPlan(demo.getLegacyDemo(), 'after-v1'), '2029-12').usable);
  for (let i = 1; i < t.length; i++) assert.ok(t[i].shortfall >= t[i - 1].shortfall);
});

test('임금 상승: 연 2% × 반영률 0.75를 매년 1월에 적용', () => {
  const s = demo.getLegacyDemo();
  const r = engine.runPlan(s, 'after-v1', Sc.withIncomeGrowth(s, 'after-v1', 0.02));
  assert.equal(engine.rowAt(r, '2026-12').income, 290);
  near(engine.rowAt(r, '2027-01').income, 290 * 1.015);
  near(engine.rowAt(r, '2028-01').income, 290 * 1.015 ** 2);
  near(engine.rowAt(r, '2028-11').income, 281 * 1.015 ** 2);
  const z = engine.runPlan(s, 'after-v1', Sc.withIncomeGrowth(s, 'after-v1', 0));
  assert.equal(engine.rowAt(z, '2029-12').income, 281);
});

test('초과소득: 예상은 빼고, 확정은 비상금 → 고금리 부채 → 주거자금 순', () => {
  const s = demo.getLegacyDemo();
  const base = engine.runPlan(s, 'after-v1');
  const exp = engine.runPlan(s, 'after-v1', { windfalls: [{ month: '2026-10', amount: 300, status: '예상' }] });
  assert.equal(engine.rowAt(exp, '2026-10').windfall, 0);
  const r = engine.runPlan(s, 'after-v1', { windfalls: [{ month: '2026-10', amount: 300, status: '확정' }] });
  const row = engine.rowAt(r, '2026-10');
  const b = engine.rowAt(base, '2026-10');
  near(row.windfallToEmergency, 800 - b.emergency);
  near(row.windfallToDebt, 300 - row.windfallToEmergency);
  near(row.windfallToHousing, 0);
  near(row.debtHigh, b.debtHigh - row.windfallToDebt);
});
