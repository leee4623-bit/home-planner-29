// 사례 보고서 최종본(2026-11-10) 중 엔진 행(row)으로 검사하지 않는 수치: 적금 비교(표 16)와 결과 카드.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/models.js');
const demo = require('../data/demo.js');

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('표 16: 월 80·21개월 세후 이자(기본 / 최대 우대)', () => {
  const rows = M.compareBank(demo.getDemo(), 'after-v1', 80, 21, 1000, '2027-07');
  const by = (id) => rows.find((r) => r.id === id);
  const expect = { 'kakao-savings': [50.2, 52.8], 'kbank-main': [48.2, 56.0], 'kb-mymind': [32.6, 40.4] };
  for (const [id, [b, p]] of Object.entries(expect)) {
    const r = by(id);
    near(r.payout - r.principal, b);
    near(r.payoutPref - r.principal, p);
    assert.equal(r.principal, 1680);
    assert.equal(r.maturity, '2029-04');
  }
  // 정기예금처럼 조건이 다른 상품은 같은 줄에서 비교하지 않는다(부록 5)
  assert.ok(!rows.some((r) => r.kind === 'deposit'));
});

test('결과 카드: 최종 기준은 원금 4,311.4, 2% 모형은 기본으로 계산하지 않고, 적금 이자는 참고로만', () => {
  const list = M.compare(demo.getDemo(), 'after-v1');
  assert.equal(list[0].key, 'A');
  near(list[0].usable, 4311.4);
  near(list[0].paydayUsable, 4203.4);
  assert.ok(!list.some((x) => x.key === 'B'));
  const c = list.find((x) => x.key === 'C');
  assert.equal(c.reference, true);
  near(c.usable - list[0].usable, 50.16);
});
