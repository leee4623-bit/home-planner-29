// 계획 대비 실제·추세 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/tracking.js');
const St = require('../src/store.js');
const engine = require('../src/engine.js');
const demo = require('../data/demo.js');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const item = (m, k) => m.items.find((i) => i.item === k);

test('예정일 25일 + 유예 5일이 지나야 미달로 본다', () => {
  const s = T.DEFAULT_SETTINGS;
  assert.equal(T.dueInfo('2026-10', '2026-10-30', s).pastDue, false);
  assert.equal(T.dueInfo('2026-10', '2026-10-31', s).pastDue, true);
  assert.equal(T.dueInfo('2026-11', '2026-11-05', s).pastDue, false);
  assert.equal(T.dueInfo('2026-11', '2026-11-05', s).graceEnd, '2026-11-30');
});

test('시연 2026-10: 비상금 기록 없음 + 유예 지남 → 미달, 생활비 합계 193/168 → 초과', () => {
  const m = T.monthStatus(demo.getLegacyDemo(), '2026-10');
  assert.equal(m.pastDue, true);
  assert.equal(item(m, 'debt').state, '완료');
  assert.equal(item(m, 'emergency').state, '미달');
  assert.equal(item(m, 'emergency').actual, null);
  assert.equal(item(m, 'housing').state, '해당 없음');
  assert.equal(item(m, 'living').state, '초과');
  near(item(m, 'living').diff, 25);
  // 필수·선택은 판정 없이 숫자만
  assert.equal(item(m, 'optional').state, '참고');
  assert.equal(item(m, 'essential').state, '참고');
  near(item(m, 'optional').diff, 23);
});

test('생활비 판정은 합계 기준: 시연 9월(선택 42/38, 합계 172/168)은 예산 안', () => {
  const m = T.monthStatus(demo.getLegacyDemo(), '2026-09');
  assert.equal(item(m, 'living').state, '예산 안');
  assert.equal(item(m, 'optional').state, '참고');
  near(item(m, 'optional').diff, 4);
});

test('홈 체크리스트의 생활비 판정과 생활비 초과 경보가 모든 기록 달에서 일치한다', () => {
  let s = demo.getLegacyDemo();
  s = St.upsertRecord(s, '2026-11', 'optional', 70, { status: '확정' }); // 한 항목만 기록(필수는 계획값으로 채움)
  const alerts = require('../src/alerts.js').evaluateAlerts(s);
  for (const r of s.records) {
    if (r.status === '잠정') continue;
    const over = item(T.monthStatus(s, r.month), 'living').state === '초과';
    assert.equal(alerts.some((a) => a.id === 'overspend-' + r.month), over, r.month);
  }
  assert.equal(item(T.monthStatus(s, '2026-11'), 'living').partial, true);
});

test('시연 2026-11(이번 달): 기록 없으면 실패가 아니라 "아직 확인 안 됨"', () => {
  const m = T.monthStatus(demo.getLegacyDemo(), '2026-11');
  assert.equal(m.recordStatus, '잠정');
  assert.equal(m.pastDue, false);
  assert.equal(item(m, 'emergency').state, '아직 확인 안 됨');
  assert.equal(item(m, 'essential').state, '아직 확인 안 됨');
  assert.equal(item(m, 'debt').state, '완료');
  // 선택 18만 기록(필수는 계획 130으로 채움) → 148/168 예산 안, 일부 기록 표시
  assert.equal(item(m, 'living').state, '예산 안');
  assert.equal(item(m, 'living').partial, true);
});

test('이번 달에 일부만 넣으면 "진행 중", 유예가 지나면 "미달"', () => {
  const s = St.upsertRecord(demo.getLegacyDemo(), '2026-11', 'emergency', 20);
  assert.equal(item(T.monthStatus(s, '2026-11'), 'emergency').state, '진행 중');
  assert.equal(item(T.monthStatus(s, '2026-11', { today: '2026-12-01' }), 'emergency').state, '미달');
});

test('원장은 계획 시작월부터 오늘이 속한 달까지', () => {
  assert.deepEqual(T.ledger(demo.getLegacyDemo()).map((m) => m.month), ['2026-09', '2026-10', '2026-11']);
});

test('최근 추세: 확정 기록만, 항목별 평균 차이', () => {
  const d = T.trendDeviation(demo.getLegacyDemo(), 'after-v1');
  assert.deepEqual(d.months, ['2026-09', '2026-10']); // 11월은 잠정이라 제외
  near(d.optional, ((42 - 38) + (61 - 38)) / 2);
  near(d.essential, ((130 - 130) + (132 - 130)) / 2);
  near(d.debt, 0);
});

test('경로: 계획 ≥ 기록 반영 ≥ 추세(시연), 실제 선은 확정 달만 값이 있고 나머지는 끊긴다', () => {
  const s = demo.getLegacyDemo();
  const p = T.paths(s);
  const at = (r) => engine.rowAt(r, '2029-12').usable;
  assert.ok(at(p.plan) >= at(p.withRecords));
  assert.ok(at(p.withRecords) > at(p.trend));
  assert.equal(p.lastConfirmed, '2026-10');
  assert.equal(p.actual[0].status, '확정');
  assert.equal(typeof p.actual[1].usable, 'number');
  assert.equal(p.actual[2].status, '잠정');
  assert.equal(p.actual[2].usable, null);
  assert.equal(p.actual[3].usable, null); // 기록 없는 달은 0이 아니라 null
});

test('기록 반영: 10월 선택지출 +23·필수 +2만큼 그 달 잉여가 줄어든다', () => {
  const s = demo.getLegacyDemo();
  const p = T.paths(s);
  near(engine.rowAt(p.plan, '2026-10').surplus - engine.rowAt(p.withRecords, '2026-10').surplus, 25);
});

test('상환 기록이 약정보다 적으면 그만큼만 갚고 잔액이 덜 준다', () => {
  let s = demo.getLegacyDemo();
  s = St.upsertRecord(s, '2026-10', 'debt', 40, { status: '확정' });
  const r = T.replay(s, 'after-v1', 'plan');
  const base = engine.runPlan(demo.getLegacyDemo(), 'after-v1');
  near(engine.rowAt(r, '2026-10').interest + engine.rowAt(r, '2026-10').principal, 40);
  assert.ok(engine.rowAt(r, '2026-10').debtTotal > engine.rowAt(base, '2026-10').debtTotal);
});
