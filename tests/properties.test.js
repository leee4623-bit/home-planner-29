// 명세 7절 C. 성질 테스트. C3·C4는 tests/store.test.js, C5는 tests/solver.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/engine.js');
const demo = require('../data/demo.js');

function housingShortfall(state, planId, opts) {
  const r = engine.runPlan(state, planId, opts);
  return r.judgement.conditions.find((c) => c.key === 'housing').shortfall;
}

test('C1: 실수령 감소율 0→5→10→15→20%일수록 목표일 부족액은 줄어들지 않는다', () => {
  const s = demo.getLegacyDemo();
  for (const planId of ['before-v1', 'after-v1']) {
    for (const debtRule of ['default', 'legacy']) {
      const cuts = [0, 0.05, 0.1, 0.15, 0.2];
      const sf = cuts.map((incomeCut) => housingShortfall(s, planId, { debtRule, incomeCut }));
      for (let i = 1; i < sf.length; i++) {
        assert.ok(sf[i] >= sf[i - 1] - 1e-9, `${planId}/${debtRule}: ${cuts[i]} 감소 시 부족액 ${sf[i]} < ${sf[i - 1]}`);
      }
    }
  }
});

test('C1 보강: 1%p 간격으로도 단조 증가', () => {
  const s = demo.getLegacyDemo();
  let prev = -Infinity;
  for (let p = 0; p <= 40; p++) {
    const sf = housingShortfall(s, 'after-v1', { incomeCut: p / 100 });
    assert.ok(sf >= prev - 1e-9, `${p}%에서 감소`);
    prev = sf;
  }
});

function emptyState() {
  return {
    customer: {
      name: '', birth: '', firstJob: '', companySize: '', grossPrevYear: 0, netMonthly: 0,
      taxExemption: { applied: false, start: '', end: '', monthlyEffect: 0 },
      cash: 0, emergency: 0, housing: 0, investment: 0, pension: 0,
      depositReturn: { amount: 0, month: '' },
      debts: [{ name: '', balance: 0, rate: 0, monthlyPayment: 0 }],
      goal: { depositTarget: 0, movingCost: 0, emergencyTarget: 0 }
    },
    plans: [{ id: 'p', startMonth: '2026-09', targetMonth: '2029-12', essential: 0, optional: 0, extraRepayment: 0,
      products: [{ policyId: 'youth-future', monthly: 0, start: '2026-12', months: 0 }] }],
    initial: { repayFromCash: 0, emergencyFromCash: 0 },
    assumptions: {}
  };
}

function assertAllFinite(obj, path = '') {
  if (typeof obj === 'number') {
    assert.ok(Number.isFinite(obj), `${path} = ${obj}`);
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'function') continue;
      assertAllFinite(v, `${path}.${k}`);
    }
  }
}

test('C2: 빈 양식(모두 0)에서 NaN·Infinity가 나오지 않는다', () => {
  for (const debtRule of ['default', 'legacy']) {
    const r = engine.runPlan(emptyState(), 'p', { debtRule });
    assert.equal(r.rows.length, 40);
    assertAllFinite(r.rows, 'rows');
    assertAllFinite(r.judgement, 'judgement');
    assert.equal(r.judgement.status, '전체 목표 달성'); // 목표 0이면 모두 충족
  }
});

test('C2 보강: 값이 빠지거나 문자열이어도 NaN이 나오지 않는다', () => {
  const s = emptyState();
  s.customer.netMonthly = '';
  s.customer.debts = undefined;
  s.plans[0].essential = 'abc';
  s.plans[0].products = undefined;
  s.initial = undefined;
  s.assumptions = undefined;
  const r = engine.runPlan(s, 'p');
  assertAllFinite(r.rows, 'rows');
});

test('C2 보강: 목표월이 시작월보다 앞이면 빈 결과 + 판정 불가', () => {
  const s = emptyState();
  s.plans[0].targetMonth = '2026-01';
  const r = engine.runPlan(s, 'p');
  assert.equal(r.rows.length, 0);
  assert.equal(r.judgement.status, '판정 불가');
});

