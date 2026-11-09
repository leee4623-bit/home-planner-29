// 목표 판정과 정책 자격 판정 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, judge, STATUS } = require('../src/judge.js');
const policy = require('../src/policy.js');
const { getPolicy } = require('../data/policies.js');
const demo = require('../data/demo.js');

const goal = { depositTarget: 5000, movingCost: 200, emergencyTarget: 800 };

test('세 조건 모두 충족 → 전체 목표 달성', () => {
  const r = evaluate({ debtTotal: 300, debtHigh: 0, debtLow: 300, emergency: 800, usable: 5200 }, goal, 'default');
  assert.equal(r.status, STATUS.ACHIEVED);
  assert.equal(r.excludedLowRateDebt, 300);
});

test('주거자금만 충족 → 부분 충족(미충족 항목 표시)', () => {
  const r = evaluate({ debtTotal: 100, debtHigh: 100, debtLow: 0, emergency: 500, usable: 6000 }, goal, 'default');
  assert.equal(r.status, STATUS.PARTIAL);
  assert.equal(r.label, '부분 충족(부채·비상금)');
  assert.equal(r.conditions[1].shortfall, 300);
});

test('주거자금 미충족 → 미달', () => {
  const r = evaluate({ debtTotal: 0, debtHigh: 0, debtLow: 0, emergency: 900, usable: 5000 }, goal, 'default');
  assert.equal(r.status, STATUS.UNMET);
  assert.equal(r.label, '미달(주거)');
  assert.equal(r.conditions[2].shortfall, 200);
});

test('legacy는 전체 부채로 판정한다', () => {
  const snap = { debtTotal: 100, debtHigh: 0, debtLow: 100, emergency: 900, usable: 6000 };
  assert.equal(evaluate(snap, goal, 'default').status, STATUS.ACHIEVED);
  assert.equal(evaluate(snap, goal, 'legacy').status, STATUS.PARTIAL);
  assert.equal(evaluate(snap, goal, 'legacy').excludedLowRateDebt, null);
});

test('목표월이 계산 기간 밖이면 판정 불가(사람이 읽을 수 있는 이유)', () => {
  const r = judge([], '2029-12', goal, 'default');
  assert.equal(r.status, STATUS.UNAVAILABLE);
  assert.match(r.reason, /목표월/);
});

test('청년미래적금: 김하늘은 일반형 6% (총급여 4,000 > 우대형 기준 3,600)', () => {
  const c = demo.getLegacyDemo().customer;
  const e = policy.checkEligibility(getPolicy('youth-future'), c, '2026-12');
  assert.equal(e.tier, 'general');
  assert.equal(e.contributionRate, 0.06);
  assert.equal(e.status, policy.STATUS.CHECK); // 신청 회차 확인 필요
});

test('청년미래적금: 총급여 3,600 이하 + 중소기업이면 우대형 12%, 35세면 불충족', () => {
  const c = { ...demo.getLegacyDemo().customer, grossPrevYear: 3500 };
  assert.equal(policy.checkEligibility(getPolicy('youth-future'), c, '2026-12').contributionRate, 0.12);
  const old = { ...c, birth: '1990-01' };
  assert.equal(policy.checkEligibility(getPolicy('youth-future'), old, '2026-12').status, policy.STATUS.NO);
});

test('불충족 상품은 기여율 0으로 계산한다', () => {
  const c = { ...demo.getLegacyDemo().customer, grossPrevYear: 7000 };
  const [p] = policy.resolveProducts([{ policyId: 'youth-future', monthly: 30, start: '2026-12', months: 36 }], c);
  assert.equal(p.contributionRate, 0);
  assert.equal(p.eligibility, policy.STATUS.NO);
});
