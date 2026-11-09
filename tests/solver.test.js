// 역산 테스트(명세 7절 C5 포함).
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/engine.js');
const S = require('../src/solver.js');
const Sc = require('../src/scenarios.js');
const demo = require('../data/demo.js');

const ACH = '전체 목표 달성';
const applyAndJudge = (s, id, changes, opts = {}) =>
  engine.runPlan(s, id, { ...opts, planOverrides: { ...(opts.planOverrides || {}), ...changes } }).judgement;

test('C5: 역산 결과를 적용하면 판정이 "전체 목표 달성"으로 바뀐다(계획 시작월부터)', () => {
  const s = demo.getLegacyDemo();
  assert.notEqual(engine.runPlan(s, 'after-v1').judgement.status, ACH);
  const r = S.solveLivingCut(s, 'after-v1');
  assert.ok(r.feasible);
  assert.equal(applyAndJudge(s, 'after-v1', r.planChanges).status, ACH);
  // 표시값(0.1 올림)이 정확값 이상이고 차이가 0.1 미만
  assert.ok(r.cut >= r.exact && r.cut - r.exact < 0.1 + 1e-9);
  // 0.1 덜 줄이면 달성하지 못한다(최소값)
  const less = S.solveLivingCut(s, 'after-v1'); // 같은 결과로 확인
  const worse = { optional: 38 - (less.cut - 0.1) };
  assert.notEqual(applyAndJudge(s, 'after-v1', worse).status, ACH);
});

test('C5: 중간 시작(2026-12부터 절감)도 적용하면 달성', () => {
  const s = demo.getLegacyDemo();
  const r = S.solveLivingCut(s, 'after-v1', { fromMonth: '2026-12' });
  assert.ok(r.feasible);
  assert.equal(r.planChanges.budgetAdjustments.at(-1).start, '2026-12');
  assert.equal(applyAndJudge(s, 'after-v1', r.planChanges).status, ACH);
});

test('C5: 충격 시나리오가 켜진 상태에서도 적용하면 달성', () => {
  const s = demo.getLegacyDemo();
  const eo = Sc.withScenarios(s, [{ type: 'livingRise', start: '2027-01', months: 0, value: 0.05 }]);
  const r = S.solveLivingCut(s, 'after-v1', { engineOpts: eo });
  assert.ok(r.feasible);
  assert.equal(applyAndJudge(s, 'after-v1', r.planChanges, eo).status, ACH);
});

test('선택지출만으로 되면 필수생활비는 건드리지 않는다', () => {
  const s = demo.getLegacyDemo();
  s.customer.goal.depositTarget = 6000;
  const r = S.solveLivingCut(s, 'after-v1');
  assert.ok(r.feasible);
  assert.equal(r.essentialCut, 0);
  assert.equal(r.planChanges.essential, 130);
});

test('선택지출을 다 줄여도 모자라면 필수생활비를 하한까지 줄인다', () => {
  const s = demo.getLegacyDemo();
  s.customer.goal.depositTarget = 6500; // 선택지출 38을 모두 줄여도 부족
  const r = S.solveLivingCut(s, 'after-v1', { essentialFloorRatio: 0.9 });
  assert.ok(r.feasible);
  assert.equal(r.optionalCut, 38);
  assert.ok(r.essentialCut > 0);
  assert.ok(r.planChanges.essential >= 130 * 0.9 - 1e-9);
  assert.equal(applyAndJudge(s, 'after-v1', r.planChanges).status, ACH);
});

test('하한까지 줄여도 모자라면 불가능과 이유', () => {
  const s = demo.getLegacyDemo();
  s.customer.goal.depositTarget = 7000;
  const r = S.solveLivingCut(s, 'after-v1');
  assert.equal(r.feasible, false);
  assert.match(r.reason, /하한/);
});

test('고금리 부채가 목표월까지 남으면 생활비 역산은 불가능하고 이유를 알려 준다', () => {
  const r = S.solveLivingCut(demo.getLegacyDemo(), 'before-v1');
  assert.equal(r.feasible, false);
  assert.match(r.reason, /고금리 부채/);
});

test('이미 달성이면 절감액 0', () => {
  const s = demo.getLegacyDemo();
  s.customer.goal.depositTarget = 4000;
  const r = S.solveLivingCut(s, 'after-v1');
  assert.equal(r.alreadyMet, true);
  assert.equal(r.cut, 0);
});

test('대안 3가지 각각 적용하면 달성', () => {
  const s = demo.getLegacyDemo();
  const inc = S.solveExtraIncome(s, 'after-v1');
  assert.ok(inc.feasible && inc.amount > 0);
  const hook = { income: (v) => v + inc.amount };
  assert.equal(engine.runPlan(s, 'after-v1', { hooks: hook }).judgement.status, ACH);

  const lt = S.solveLowerTarget(s, 'after-v1');
  assert.ok(lt.feasible);
  assert.equal(engine.runPlan(s, 'after-v1', { goalOverrides: lt.goalChanges }).judgement.status, ACH);
  assert.ok(Math.abs(lt.reduceBy - 194.8) < 0.11);

  const d = S.solveDelay(s, 'after-v1');
  assert.equal(d.targetMonth, '2030-02');
  assert.equal(applyAndJudge(s, 'after-v1', d.planChanges, { endMonth: d.targetMonth }).status, ACH);
});

test('단순 나눗셈은 참고값으로만(부족액 ÷ 개월)', () => {
  const n = S.naiveDivision(demo.getLegacyDemo(), 'after-v1');
  assert.equal(n.months, 40);
  assert.ok(Math.abs(n.value - n.shortfall / 40) < 1e-12);
  assert.match(n.note, /참고값/);
});

test('시연 A/B/C 제안은 확정 기록을 반영해도 각각 적용하면 달성', () => {
  const s = demo.getLegacyDemo();
  const abc = s.proposals.find((p) => p.type === '설계안');
  assert.equal(abc.status, '고객에게 제시됨');
  const eo = require('../src/tracking.js').recordEngineOpts(s, abc.basePlanId, 'plan');
  // 기록을 반영하지 않으면 194.8, 반영하면 224.5 부족(제안 제목의 숫자)
  assert.match(abc.title, /224\.5/);
  assert.ok(Math.abs(engine.runPlan(s, abc.basePlanId, eo).judgement.conditions[2].shortfall - 224.5) < 0.05);
  for (const o of abc.options) {
    const j = engine.runPlan(s, abc.basePlanId, {
      ...eo,
      planOverrides: o.planChanges,
      goalOverrides: o.goalChanges,
      endMonth: o.planChanges && o.planChanges.targetMonth
    }).judgement;
    assert.equal(j.status, ACH, o.key);
  }
  assert.ok(s.proposals.some((p) => p.type === '수정안' && p.status === '확인 대기' && p.kind === '초과 지출 보완'));
});
