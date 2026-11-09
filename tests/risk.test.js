// 위험성향 설문·재진단 권고·고객 정보 변경 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/risk.js');
const St = require('../src/store.js');
const demo = require('../data/demo.js');

test('설문 10문항, 나이·소득 문항 없음', () => {
  assert.equal(R.QUESTIONS.length, 10);
  for (const q of R.QUESTIONS) {
    assert.equal(q.options.length, 5);
    assert.ok(!/나이|연령|소득|연봉|급여/.test(q.text), q.text);
  }
});

test('점수 → 유형(경계값)', () => {
  const all = (n) => Object.fromEntries(R.QUESTIONS.map((q) => [q.id, n]));
  assert.deepEqual(R.scoreSurvey(all(0)), { complete: true, score: 10, type: '안정형', answered: 10 });
  assert.equal(R.scoreSurvey(all(2)).type, '위험중립형'); // 30점
  assert.equal(R.scoreSurvey(all(4)).type, '공격투자형'); // 50점
  const a = all(1); a.q1 = 0; a.q2 = 0; // 18점
  assert.equal(R.scoreSurvey(a).score, 18);
  assert.equal(R.scoreSurvey(a).type, '안정형');
  const partial = { q1: 2 };
  assert.equal(R.scoreSurvey(partial).complete, false);
  assert.equal(R.scoreSurvey(partial).type, null);
});

test('시연 고객: 24개월 경과 + 소득 11.5% 변화 + 목적 변화 → 재진단 권고, 보수적 적용', () => {
  const r = R.review(demo.getLegacyDemo().customer, '2026-11-05');
  assert.equal(r.recommend, true);
  assert.equal(r.expired, true);
  assert.equal(r.reasons.length, 3);
  assert.equal(r.applied, '안정형(보수적 적용)');
});

test('앱 설문을 새로 하면 그 결과가 최신, 권고 해소', () => {
  const s = St.saveRiskSurvey(demo.getLegacyDemo(), { type: '위험중립형', score: 30 }, { q1: 2 });
  const r = R.review(s.customer, '2026-11-05');
  assert.equal(r.source, '앱 설문');
  assert.equal(r.recommend, false);
  assert.equal(r.applied, '위험중립형');
  assert.equal(s.customer.risk.institution.type, '위험중립형'); // 금융기관 결과는 따로 남음
});

test('성향이 없으면 보수적으로 적용', () => {
  const c = { ...demo.getLegacyDemo().customer, risk: { institution: null, appSurvey: null } };
  const r = R.review(c, '2026-11-05');
  assert.equal(r.conservative, true);
});

test('고객 정보 변경: 바뀐 항목만 이력(누가·어떤 항목·전후 값)', () => {
  const s = demo.getLegacyDemo();
  const n = s.changeLog.length;
  const r = St.updateCustomer(s, { netMonthly: 300, job: '사무직' }, '고객', { netMonthly: '월 실수령', job: '직업' });
  assert.deepEqual(r.changed, ['netMonthly']);
  assert.equal(r.state.changeLog.length, n + 1);
  const e = r.state.changeLog.at(-1);
  assert.equal(e.who, '고객');
  assert.equal(e.what, '내 정보 변경: 월 실수령');
  assert.deepEqual(e.detail, { field: 'netMonthly', before: 290, after: 300 });
});

test('예정 결제: 등록·삭제, 잘못된 값은 사람이 읽는 오류', () => {
  let s = St.addScheduledPayment(demo.getLegacyDemo(), { name: '12월 카드대금', amount: 40, kind: '선택', spendMonth: '2026-11' });
  assert.equal(s.scheduledPayments.length, 3);
  s = St.removeScheduledPayment(s, 0);
  assert.equal(s.scheduledPayments.length, 2);
  assert.throws(() => St.addScheduledPayment(s, { name: '', amount: 1 }), /이름/);
  assert.throws(() => St.addScheduledPayment(s, { name: 'x', amount: 0 }), /금액/);
});
