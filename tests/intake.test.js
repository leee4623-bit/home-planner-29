// 고객정보 입력(첫 화면)·설계 예시·고객정보 수정 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/intake.js');
const engine = require('../src/engine.js');
const demo = require('../data/demo.js');
const St = require('../src/store.js');

function maxDiff(a, b) {
  let mx = 0;
  assert.equal(a.length, b.length);
  a.forEach((r, i) => { for (const k in r) if (typeof r[k] === 'number') mx = Math.max(mx, Math.abs(r[k] - b[i][k])); });
  return mx;
}

test('설계 예시를 불러와 저장한 상태는 시연 데이터와 계산 결과가 같다(그래프·화면 변경이 계산을 바꾸지 않음)', () => {
  const r = I.buildState(I.exampleValues(), 'example');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const d = demo.getDemo();
  for (const pid of ['before-v1', 'after-v1']) {
    assert.ok(maxDiff(engine.runPlan(r.state, pid).rows, engine.runPlan(d, pid).rows) < 1e-9, pid);
  }
  const row = engine.rowAt(engine.runPlan(r.state, 'after-v1', { excludeBankProducts: true, assumptionOverrides: { housingRate: 0 } }), '2029-10');
  assert.ok(Math.abs(row.usable - 4166.4) < 0.05);
});

test('시연 데이터의 고객정보는 설계 예시 입력으로 만든 것과 같다', () => {
  const a = I.buildState(I.exampleValues(), 'example').state.customer;
  const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)));
  assert.deepEqual(norm(a), norm(demo.getDemo().customer));
  assert.equal(St.createStore(null).reset().customer.name, '가상 고객 B');
});

test('초기 고객정보에는 설계안(생활비 200·대출 700 상환·연금 10)을 사실처럼 넣지 않는다', () => {
  const s = I.buildState(I.exampleValues(), 'example').state;
  const c = s.customer;
  assert.equal(c.debts[0].balance, 1000);
  assert.equal(c.cash, 200);
  assert.equal(c.savings, 600);
  assert.equal(c.investment, 400);
  const before = s.plans.find((p) => p.kind === '설계 전');
  assert.equal(before.essential + before.optional, 235);
  assert.equal(before.pensionMonthly, 0);
  assert.deepEqual(before.initial, {});
  assert.equal(c.livingDetail, undefined);
  // 설계안은 계획 버전에 따로 있다
  const after = s.plans.find((p) => p.id === 'after-v1');
  assert.equal(after.essential + after.optional, 200);
  assert.equal(after.initial.repayFromCash, 700);
  assert.equal(after.pensionMonthly, 10);
  assert.equal(c.isExample, true);
});

test('예시의 기준일·설계 시작월은 고정된다(오늘 날짜와 무관)', () => {
  const s = I.buildState(I.exampleValues(), 'example').state;
  assert.equal(s.demoToday, '2026-11-03');
  assert.equal(s.plans[0].startMonth, '2026-11');
  assert.equal(s.plans[0].targetMonth, '2029-10');
});

test('직접 입력: 필수값이 비면 칸별 오류, 입력값은 바꾸지 않는다', () => {
  const v = I.emptyValues();
  v.netMonthly = '300';
  const copy = JSON.stringify(v);
  const r = I.validate(v);
  assert.equal(r.ok, false);
  for (const k of ['age', 'baseDate', 'targetMonth', 'depositTarget', 'emergencyTarget', 'lv_rent']) assert.ok(r.errors[k], k);
  assert.equal(r.errors.netMonthly, undefined);
  assert.equal(JSON.stringify(v), copy);
});

test('숫자 범위·날짜 순서·부채 조건을 검사한다', () => {
  const v = I.exampleValues();
  v.age = '10';
  v.cash = '-5';
  v.netMonthly = 'abc';
  v.targetMonth = '2026-10';
  v.debtRate = '';
  const r = I.validate(v);
  assert.match(r.errors.age, /15 이상/);
  assert.match(r.errors.cash, /0 이상/);
  assert.match(r.errors.netMonthly, /숫자/);
  assert.match(r.errors.targetMonth, /뒤여야/);
  assert.match(r.errors.debtRate, /금리/);
});

test('미확인(빈 칸)과 실제 0원을 구분한다', () => {
  const v = I.exampleValues();
  v.housing = '';      // 미확인
  v.emergency = '0';   // 실제 0원
  const s = I.buildState(v, 'manual').state;
  assert.ok(s.customer.unknown.includes('housing'));
  assert.ok(!s.customer.unknown.includes('emergency'));
  assert.equal(s.customer.housing, 0); // 계산은 0으로
  const back = I.fromState(s);
  assert.equal(back.housing, '');
  assert.equal(back.emergency, '0');
});

test('직접 입력한 고객은 설계 전 계획만 만들고, 시작월은 기준일의 달', () => {
  const v = I.exampleValues();
  v.name = '홍길동';
  v.baseDate = '2027-02-10';
  const s = I.buildState(v, 'manual').state;
  assert.equal(s.plans.length, 1);
  assert.equal(s.activePlanId, 'before-v1');
  assert.equal(s.plans[0].startMonth, '2027-02');
  assert.equal(s.demoToday, undefined);
  assert.equal(s.customer.isExample, undefined);
});

test('저장한 상태를 입력값으로 되돌리면 예시 값과 같다(수정 화면)', () => {
  const s = I.buildState(I.exampleValues(), 'example').state;
  const back = I.fromState(s);
  const ex = I.exampleValues();
  for (const k of Object.keys(ex)) assert.equal(String(back[k]), String(ex[k]), k);
  assert.deepEqual(I.diffFromExample(back), []);
});

test('고객정보 수정: 설계 전은 새 입력으로 맞추고, 설계안의 수동 조정값은 그대로 두며 재검토를 알린다', () => {
  const s = I.buildState(I.exampleValues(), 'example').state;
  const v = I.fromState(s);
  v.lv_food = '70';
  v.netMonthly = '300';
  const r = I.applyEdit(s, v, '고객');
  assert.equal(r.ok, true);
  const before = r.state.plans.find((p) => p.id === 'before-v1');
  const after = r.state.plans.find((p) => p.id === 'after-v1');
  assert.equal(before.essential, 193);
  assert.equal(after.essential, 165); // 수동 조정값 유지
  assert.equal(after.initial.repayFromCash, 700);
  assert.deepEqual(r.changed.sort(), ['식비·생필품', '월 실수령액'].sort());
  assert.ok(r.notices.some((n) => /설계안 「설계 후 1차/.test(n) && /다시 검토/.test(n)));
  assert.equal(r.state.review.at(-1).dismissed, false);
  // 두 화면이 쓰는 계산이 새 고객정보로 바뀐다
  const u0 = engine.rowAt(engine.runPlan(s, 'after-v1'), '2029-10').usable;
  const u1 = engine.rowAt(engine.runPlan(r.state, 'after-v1'), '2029-10').usable;
  assert.ok(u1 < u0 - 100);
  // 받은 상태는 바꾸지 않는다
  assert.equal(s.customer.netMonthly, 320);
});

test('고객정보 수정: 바뀐 것이 없으면 그대로', () => {
  const s = I.buildState(I.exampleValues(), 'example').state;
  const r = I.applyEdit(s, I.fromState(s));
  assert.equal(r.ok, true);
  assert.equal(r.state, s);
  assert.deepEqual(r.notices, []);
});

test('고객정보 수정: 오류가 있으면 상태를 바꾸지 않는다', () => {
  const s = I.buildState(I.exampleValues(), 'example').state;
  const v = I.fromState(s);
  v.netMonthly = '';
  const r = I.applyEdit(s, v);
  assert.equal(r.ok, false);
  assert.ok(r.errors.netMonthly);
  assert.equal(r.state, null);
});

test('입력칸 내용 확인: 빈 양식은 내용 없음, 하나라도 쓰면 있음', () => {
  assert.equal(I.hasContent(I.emptyValues()), false);
  const v = I.emptyValues();
  v.cash = '0';
  assert.equal(I.hasContent(v), true);
  assert.equal(I.hasContent(I.exampleValues()), true);
});

test('자가진단 응답은 재무 수치(customer)와 따로 저장하고, 공식 투자성향 진단으로 표시하지 않는다', () => {
  const s = I.buildState(I.exampleValues(), 'example').state;
  assert.equal(s.selfCheck.official, false);
  assert.match(s.selfCheck.note, /공식 투자성향 진단이 아닙니다/);
  assert.equal(s.selfCheck.answers.lossTolerance, '원금손실은 피하고 싶다');
  assert.equal(s.customer.preferences, undefined);
  assert.equal(s.customer.lossTolerance, undefined);
  assert.deepEqual(s.selfCheck, demo.getDemo().selfCheck);
  // 자가진단만 바꾸면 계산은 그대로
  const v = I.fromState(s);
  v.spendFlex = '조금 줄일 수 있다';
  const r = I.applyEdit(s, v);
  assert.equal(r.state.selfCheck.answers.spendFlex, '조금 줄일 수 있다');
  assert.ok(r.notices.some((n) => /계산 결과는 그대로/.test(n)));
  assert.equal(engine.rowAt(engine.runPlan(r.state, 'after-v1'), '2029-10').usable, engine.rowAt(engine.runPlan(s, 'after-v1'), '2029-10').usable);
});
