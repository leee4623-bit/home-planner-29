// 입력 모순 검증 테스트(명세 5절).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateState, summarize } = require('../src/validate.js');
const demo = require('../data/demo.js');

const codes = (s, opts) => validateState(s, opts).map((i) => i.code);

test('시연 데이터: 오류·경고 없음(보증금 조기 반환 참고 1건만)', () => {
  const issues = validateState(demo.getLegacyDemo());
  assert.deepEqual(summarize(issues), { error: 0, warn: 0, info: 1 });
  assert.equal(issues[0].code, 'DEPOSIT_BEFORE_MOVE');
});

test('1. 중소기업이 아닌데 감면 적용', () => {
  const s = demo.getLegacyDemo();
  s.customer.companySize = '대기업';
  assert.ok(codes(s).includes('TAX_NOT_SME'));
});

test('2. 최초 취업월과 감면 시작월이 다름', () => {
  const s = demo.getLegacyDemo();
  s.customer.taxExemption.start = '2024-03';
  assert.ok(codes(s).includes('TAX_START_MISMATCH'));
});

test('3. 최초 취업월이 미래인데 직전연도 총급여가 있음', () => {
  const s = demo.getLegacyDemo();
  s.customer.firstJob = '2027-01';
  s.customer.taxExemption.start = '2027-01';
  assert.ok(codes(s).includes('FIRSTJOB_FUTURE_GROSS'));
  s.customer.grossPrevYear = 0;
  assert.ok(!codes(s).includes('FIRSTJOB_FUTURE_GROSS'));
});

test('4. 나이는 dates.ageAt 한 곳에서 계산한다(출생 연월 오류 감지)', () => {
  const s = demo.getLegacyDemo();
  s.customer.birth = '2030-01';
  assert.ok(codes(s).includes('BIRTH_FUTURE'));
  s.customer.birth = '1997-3';
  assert.ok(codes(s).includes('YM_FORMAT'));
  // 소스에 나이 계산이 따로 있지 않은지 확인
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of fs.readdirSync(path.join(__dirname, '../src')).filter((x) => x.endsWith('.js') && x !== 'dates.js')) {
    const src = fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
    assert.ok(!/getFullYear\(\)\s*-/.test(src), `${f}에 별도 나이 계산이 있음`);
  }
});

test('5. 보증금 반환월이 이사 예정월보다 늦음', () => {
  const s = demo.getLegacyDemo();
  s.customer.depositReturn.month = '2030-03';
  const issues = validateState(s);
  const i = issues.find((x) => x.code === 'DEPOSIT_AFTER_MOVE');
  assert.equal(i.level, 'warn');
  assert.match(i.message, /2030-03/);
});

test('6. 숫자 범위: 필수생활비 > 실수령, 상환 불가, 음수, 순서 오류', () => {
  const s = demo.getLegacyDemo();
  s.plans[1].essential = 300;
  s.customer.debts[1].monthlyPayment = 5; // 이자 6.5보다 작음
  s.customer.investment = -1;
  s.plans[1].targetMonth = '2026-01';
  const c = codes(s);
  for (const k of ['ESSENTIAL_OVER_INCOME', 'DEBT_UNPAYABLE', 'NEGATIVE', 'PLAN_ORDER']) assert.ok(c.includes(k), k);
  // 오류가 경고보다 먼저 정렬된다
  const lv = validateState(s).map((i) => i.level);
  assert.deepEqual(lv, [...lv].sort((a, b) => ['error', 'warn', 'info'].indexOf(a) - ['error', 'warn', 'info'].indexOf(b)));
});

test('정책상품: 한도 초과, 만기가 이사월보다 늦음', () => {
  const s = demo.getLegacyDemo();
  s.plans[1].products[0].monthly = 60;
  s.plans[1].targetMonth = '2029-06';
  const c = codes(s);
  assert.ok(c.includes('PRODUCT_OVER_MAX'));
  assert.ok(c.includes('PRODUCT_AFTER_MOVE'));
});

test('메시지에 변수 이름이 노출되지 않는다', () => {
  const s = demo.getLegacyDemo();
  s.customer.companySize = '대기업';
  s.customer.investment = -1;
  s.customer.debts[1].monthlyPayment = 1;
  s.plans[1].essential = 300;
  for (const i of validateState(s)) {
    assert.ok(!/[a-z][A-Z]|undefined|NaN|null/.test(i.message), i.message);
  }
});
