// 설계사 제안 자동 작성·정책 점검·상품 비교 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const Pr = require('../src/proposals.js');
const St = require('../src/store.js');
const engine = require('../src/engine.js');
const tracking = require('../src/tracking.js');
const demo = require('../data/demo.js');

const ACH = '전체 목표 달성';

test('A/B/C 자동 작성: 확정 기록 반영 기준으로 각각 적용하면 달성', () => {
  const s = demo.getLegacyDemo();
  const r = Pr.buildStrategyProposal(s, 'after-v1');
  assert.ok(r.ok);
  const p = r.proposal;
  assert.deepEqual(p.options.map((o) => o.key), ['A', 'B', 'C']);
  assert.equal(p.status, '작성 중');
  assert.match(p.title, /224\.5/);
  const eo = tracking.recordEngineOpts(s, 'after-v1', 'plan');
  for (const o of p.options) {
    const j = engine.runPlan(s, 'after-v1', {
      ...eo, planOverrides: o.planChanges, goalOverrides: o.goalChanges, endMonth: o.planChanges && o.planChanges.targetMonth
    }).judgement;
    assert.equal(j.status, ACH, o.key);
  }
  assert.equal(p.options[0].planChanges.budgetAdjustments.at(-1).start, '2026-12');
});

test('작성 → 고객에게 제시 → 고객 선택 흐름', () => {
  let s = demo.getLegacyDemo();
  const p = Pr.buildStrategyProposal(s, 'after-v1').proposal;
  s = St.addProposal(s, p);
  s = St.presentProposal(s, p.id, '설계사');
  assert.equal(St.findProposal(s, p.id).status, '고객에게 제시됨');
  const r = St.applyProposal(s, p.id, { optionKey: 'B' });
  assert.equal(St.findPlan(r.state, r.planId).targetMonth, p.options[1].planChanges.targetMonth);
});

test('이미 달성한 계획이면 제안을 만들지 않는다', () => {
  const s = St.applyProposal(demo.getLegacyDemo(), 'abc-2026-11', { optionKey: 'A' }).state;
  const r = Pr.buildStrategyProposal(s, s.activePlanId);
  assert.equal(r.ok, false);
  assert.match(r.reason, /이미/);
});

test('정책 점검: 같은 돈이 두 번 배정되지 않음, 포함/제외 차이', () => {
  const c = Pr.policyCheck(demo.getLegacyDemo(), 'after-v1');
  assert.ok(c.checks.every((k) => k.ok), JSON.stringify(c.checks));
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].maturity, '2029-12');
  assert.equal(c.items[0].beforeMove, true);
  assert.ok(Math.abs(c.items[0].expectedPayout - 1144.8) < 1e-9);
  assert.ok(c.diff > 0);
  assert.ok(c.items[0].burden > 0 && c.items[0].burden < 1);
});

test('상품 비교: 같은 납입액, 만기가 이사월보다 늦으면 목표일 재원 아님', () => {
  const list = Pr.compareSavings(demo.getLegacyDemo(), 'after-v1', 30);
  const yf = list.find((x) => x.id === 'youth-future');
  const sme = list.find((x) => x.id === 'sme-saving');
  assert.ok(Math.abs(yf.payout - 30 * 36 * 1.06) < 1e-9);
  assert.equal(yf.targetFunding, true);
  assert.equal(sme.months, 60);
  assert.equal(sme.targetFunding, false);
  assert.ok(sme.highDebtLeft > 0);
});

test('새 A/B/C를 제시하면 이전 제시안은 대체됨, 고르면 다른 제시안도 대체됨', () => {
  let s = demo.getLegacyDemo();
  const p = Pr.buildStrategyProposal(s, 'after-v1').proposal;
  s = St.addProposal(s, p);
  assert.equal(St.findProposal(s, 'abc-2026-11').status, '고객에게 제시됨'); // 작성만으로는 그대로
  s = St.presentProposal(s, p.id);
  assert.equal(St.findProposal(s, 'abc-2026-11').status, '대체됨');
  assert.equal(St.findProposal(s, 'abc-2026-11').supersededBy, p.id);
  // 반대로: 기존 안을 고르면 남아 있는 다른 제시안이 대체됨
  let t = demo.getLegacyDemo();
  const q = Pr.buildStrategyProposal(t, 'after-v1').proposal;
  t = St.addProposal(t, { ...q, status: '고객에게 제시됨' });
  t = St.applyProposal(t, 'abc-2026-11', { optionKey: 'A' }).state;
  assert.equal(St.findProposal(t, q.id).status, '대체됨');
});
