// 엔진 단위 테스트(정답표에 없는 규칙을 고정한다).
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/engine.js');
const dates = require('../src/dates.js');
const demo = require('../data/demo.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('초기 처리: 현금 300은 최고 금리 부채(신용대출)에, 600은 비상금에', () => {
  const s = demo.getLegacyDemo();
  const init = engine.applyInitial(s.customer, s.initial);
  assert.equal(init.debts[0].balance, 900);
  assert.equal(init.debts[1].balance, 1200);
  assert.equal(init.emergency, 600);
  assert.equal(init.cashLeft, 0);
});

test('초기 처리: 현금이 부족하면 상환 먼저, 상환액이 잔액보다 크면 다음 부채로', () => {
  const init = engine.applyInitial(
    { cash: 500, debts: [{ balance: 100, rate: 0.01, monthlyPayment: 1 }, { balance: 200, rate: 0.09, monthlyPayment: 1 }] },
    { repayFromCash: 250, emergencyFromCash: 600 }
  );
  assert.equal(init.debts[1].balance, 0);
  assert.equal(init.debts[0].balance, 50);
  assert.equal(init.toEmergency, 250);
  assert.equal(init.emergencyShort, 350);
});

test('입력 상태를 바꾸지 않는다', () => {
  const s = demo.getLegacyDemo();
  const before = JSON.stringify(s);
  engine.runPlan(s, 'after-v1');
  engine.runPlan(s, 'after-v1', { debtRule: 'legacy' });
  assert.equal(JSON.stringify(s), before);
});

test('m=1이 시작월, 생활비 인상은 13·25·37번째 달', () => {
  const r = engine.runPlan(demo.getLegacyDemo(), 'after-v1');
  assert.equal(r.rows[0].month, '2026-09');
  assert.equal(r.rows[0].m, 1);
  near(r.rows[11].essential, 130);
  near(r.rows[12].essential, 130 * 1.02);
  near(r.rows[24].essential, 130 * 1.02 ** 2);
  near(r.rows[36].essential, 130 * 1.02 ** 3);
});

test('기본 모드: 저금리 부채만 남으면 추가 상환액 15는 저축으로 넘어간다', () => {
  const s = demo.getLegacyDemo();
  const d = engine.runPlan(s, 'after-v1');
  const l = engine.runPlan(s, 'after-v1', { debtRule: 'legacy' });
  const dRow = engine.rowAt(d, '2028-12');
  const lRow = engine.rowAt(l, '2028-12');
  near(dRow.interest + dRow.principal, 15);      // 학자금 약정분만
  near(lRow.interest + lRow.principal, 30);      // 약정 15 + 추가 15
  assert.ok(dRow.surplus > lRow.surplus);
});

test('부채를 모두 갚으면 상환 예산은 0', () => {
  const s = demo.getLegacyDemo();
  s.customer.debts = [{ name: '소액', balance: 20, rate: 0.1, monthlyPayment: 15 }];
  s.initial.repayFromCash = 0;
  const r = engine.runPlan(s, 'after-v1');
  // 1월: 이자 0.1667 + 약정 14.83 + 추가 5.0 = 20.0 상환 → 완제. 2월부터 0
  near(r.rows[0].debtTotal, 0);
  assert.equal(r.rows[1].interest + r.rows[1].principal, 0);
  assert.equal(r.payoff.all, '2026-09');
});

test('잉여가 음수면 비상금 → 주거자금 순으로 차감하고 남으면 미충당 적자', () => {
  const s = demo.getLegacyDemo();
  s.customer.emergency = 0;
  s.customer.housing = 0;
  s.customer.cash = 0;
  s.customer.investment = 0;
  s.customer.debts = [];
  s.customer.netMonthly = 100;
  const r = engine.runPlan(s, 'after-v1', { excludeProducts: true });
  const row = r.rows[0];
  near(row.surplus, 100 - 168);
  near(row.deficit, 68);
  assert.equal(row.emergency, 0);
  assert.equal(row.housing, 0);
});

test('상품 만기월은 시작월 + 기간이며 그 달에는 납입하지 않는다', () => {
  const r = engine.runPlan(demo.getLegacyDemo(), 'after-v1');
  assert.equal(engine.rowAt(r, '2029-11').productPay, 30);
  assert.equal(engine.rowAt(r, '2029-12').productPay, 0);
  near(engine.rowAt(r, '2029-12').productMaturity, 36 * 30 * 1.06);
  assert.equal(engine.rowAt(r, '2029-12').productBalance, 0);
});

test('비상금이 목표에 도달한 뒤에도 이자는 비상금에 남는다', () => {
  const r = engine.runPlan(demo.getLegacyDemo(), 'after-v1');
  near(engine.rowAt(r, '2029-12').emergency, 800 * 1.0025 ** 36, 1e-6);
});

test('사건 목록: 감면 종료·보증금 반환·고금리 상환·상품 만기·이사', () => {
  const r = engine.runPlan(demo.getLegacyDemo(), 'after-v1');
  const byType = Object.fromEntries(r.events.map((e) => [e.type, e.month]));
  assert.equal(byType.taxExemptionEnd, '2028-11');
  assert.equal(byType.depositReturn, '2028-08');
  assert.equal(byType.highDebtPaidOff, '2028-10');
  assert.equal(byType.productMaturity, '2029-12');
  assert.equal(byType.emergencyReached, '2026-12');
  assert.equal(byType.move, '2029-12');
});

test('없는 계획 id는 사람이 읽을 수 있는 오류', () => {
  assert.throws(() => engine.runPlan(demo.getLegacyDemo(), 'nope'), /계획을 찾을 수 없습니다/);
});

test('dates: 월 연산과 나이', () => {
  assert.equal(dates.addMonths('2026-12', 36), '2029-12');
  assert.equal(dates.diffMonths('2026-09', '2029-12'), 39);
  assert.ok(Number.isNaN(dates.parseYM('2026-13')));
  assert.equal(dates.ageAt('1997-03', '2026-12'), 29);
  assert.equal(dates.ageAt('1997-03', '2026-02'), 28);
  assert.equal(dates.ageAt('', '2026-02'), null);
});
