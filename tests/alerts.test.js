// 경보·수정안·자동 적용 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/alerts.js');
const St = require('../src/store.js');
const demo = require('../data/demo.js');

test('시연 경보: 10월 생활비 초과 1건 + 저축 누적 미달 1건', () => {
  const list = A.evaluateAlerts(demo.getLegacyDemo());
  assert.deepEqual(list.map((a) => a.id).sort(), ['cumulative-savings', 'overspend-2026-10']);
  const o = list.find((a) => a.type === 'overspend');
  assert.ok(Math.abs(o.data.excess - 25) < 1e-9);
  assert.match(o.message, /193만원.*168만원.*25만원/);
  const c = list.find((a) => a.type === 'cumulativeShortfall');
  assert.match(c.message, /기록이 없는 달: 2026-10/);
});

test('9월(선택 42, 합계 172)은 생활비 합계 기준 허용 범위 안이라 경보 없음', () => {
  assert.ok(!A.evaluateAlerts(demo.getLegacyDemo()).some((a) => a.id === 'overspend-2026-09'));
});

test('잠정 기록은 초과 경보를 만들지 않는다', () => {
  const s = St.upsertRecord(demo.getLegacyDemo(), '2026-11', 'optional', 90); // 잠정 유지
  assert.ok(!A.evaluateAlerts(s).some((a) => a.id === 'overspend-2026-11'));
});

test('시연 수정안은 규칙으로 만든 수정안과 같다', () => {
  const s = demo.getLegacyDemo();
  const alert = A.evaluateAlerts(s).find((a) => a.type === 'overspend');
  const gen = A.buildOverspendRevision(s, alert);
  const stored = s.proposals.find((p) => p.id === gen.id);
  for (const k of ['id', 'kind', 'title', 'reason', 'summary', 'alertId', 'basePlanId', 'status']) assert.equal(stored[k], gen[k], k);
  assert.deepEqual(stored.planChanges, gen.planChanges);
});

test('같은 상황의 경보는 한 번만, 수정안은 경보 하나에만 연결', () => {
  const s = demo.getLegacyDemo();
  const r1 = A.syncAlerts(s);
  assert.equal(r1.created.length, 2);
  assert.deepEqual(r1.proposalsCreated, []); // 시연 수정안을 재사용
  const r2 = A.syncAlerts(r1.state);
  assert.deepEqual(r2.created, []);
  assert.equal(r2.state.alerts.length, 2);
  const linked = r2.state.alerts.map((a) => a.proposalId).filter(Boolean);
  assert.deepEqual(linked, ['rev-overspend-2026-10']);
  assert.equal(new Set(linked).size, linked.length);
  assert.equal(r2.state.proposals.filter((p) => p.alertId === 'overspend-2026-10').length, 1);
});

test('새 초과가 생기면 수정안을 하나 만들고, 다시 동기화해도 늘지 않는다', () => {
  let s = St.upsertRecord(demo.getLegacyDemo(), '2026-11', 'optional', 90, { status: '확정' });
  s = St.upsertRecord(s, '2026-11', 'essential', 130);
  const r1 = A.syncAlerts(s);
  assert.deepEqual(r1.proposalsCreated, ['rev-overspend-2026-11']);
  const r2 = A.syncAlerts(r1.state);
  assert.deepEqual(r2.proposalsCreated, []);
  assert.equal(r2.state.proposals.filter((p) => p.alertId === 'overspend-2026-11').length, 1);
});

test('상황이 사라지면 해소, 읽음 표시는 유지', () => {
  let s = A.syncAlerts(demo.getLegacyDemo()).state;
  s = A.markRead(s, 'overspend-2026-10');
  s = St.upsertRecord(s, '2026-10', 'optional', 38);
  s = St.upsertRecord(s, '2026-10', 'emergency', 57);
  s = St.upsertRecord(s, '2026-09', 'emergency', 57);
  const r = A.syncAlerts(s);
  assert.deepEqual(r.resolved.sort(), ['cumulative-savings', 'overspend-2026-10']);
  assert.ok(r.state.alerts.every((a) => a.status === '해소'));
});

test('약정 상환 기록이 없고 유예가 지나면 미달 경보', () => {
  let s = St.upsertRecord(demo.getLegacyDemo(), '2026-11', 'debt', '');
  const list = A.evaluateAlerts(s, { today: '2026-12-01' });
  assert.ok(list.some((a) => a.id === 'missed-debt-2026-11'));
  assert.ok(!A.evaluateAlerts(s).some((a) => a.id === 'missed-debt-2026-11')); // 11-05에는 아직
});

test('자동 적용: 동의 없으면 안 됨, 동의하면 한도 안 생활비 조정만', () => {
  const s = demo.getLegacyDemo();
  const rev = s.proposals.find((p) => p.type === '수정안');
  assert.equal(A.canAutoApply(s, rev).ok, false);
  const ok = St.setAutoApplyConsent(s, { enabled: true, monthlyLimit: 10 });
  assert.equal(A.canAutoApply(ok, rev).ok, true);
  const tight = St.setAutoApplyConsent(s, { enabled: true, monthlyLimit: 5 });
  assert.match(A.canAutoApply(tight, rev).reasons.join(), /한도/);
  const abc = s.proposals.find((p) => p.type === '설계안');
  assert.equal(A.canAutoApply(ok, abc).ok, false);
  const dateChange = { ...rev, planChanges: { targetMonth: '2030-02' } };
  assert.match(A.canAutoApply(ok, dateChange).reasons.join(), /목표일/);
  const floor = { ...rev, planChanges: { budgetAdjustments: [{ start: '2026-12', months: 3, essential: -20 }] } };
  const big = St.setAutoApplyConsent(s, { enabled: true, monthlyLimit: 50 });
  assert.match(A.canAutoApply(big, floor).reasons.join(), /하한/);
});

test('자동 적용 실행: 새 버전이 생기고 이력에 "자동 적용(고객 동의)"', () => {
  const s = St.setAutoApplyConsent(demo.getLegacyDemo(), { enabled: true, monthlyLimit: 10 });
  const r = A.autoApplyPending(s);
  assert.deepEqual(r.applied, ['rev-overspend-2026-10']);
  assert.equal(r.state.activePlanId, 'after-v2');
  assert.ok(r.state.changeLog.some((c) => c.who === '자동 적용(고객 동의)'));
  assert.equal(A.autoApplyPending(demo.getLegacyDemo()).applied.length, 0);
});

test('자동 적용 검사도 지금 실행 기준 기준으로 한다', () => {
  let s = St.applyProposal(demo.getLegacyDemo(), 'abc-2026-11', { optionKey: 'A' }).state;
  s = St.setAutoApplyConsent(s, { enabled: true, monthlyLimit: 10 });
  const rev = s.proposals.find((p) => p.type === '수정안');
  assert.equal(A.canAutoApply(s, rev).ok, true);
  const r = A.autoApplyPending(s);
  assert.deepEqual(r.applied, ['rev-overspend-2026-10']);
  assert.equal(r.state.plans.at(-1).budgetAdjustments.length, 2);
});
