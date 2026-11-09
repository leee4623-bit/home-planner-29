// 진단 지표·숫자 표시 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/metrics.js');
const F = require('../src/format.js');
const demo = require('../data/demo.js');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const get = (r, key) => r.list.find((m) => m.key === key);

test('기준 시점은 초기 처리 직후(2026-08 말)', () => {
  const r = M.computeMetrics(demo.getLegacyDemo(), 'after-v1');
  assert.match(r.asOf, /^2026-08 말/);
});

test('설계 후 지표(손계산 값)', () => {
  const r = M.computeMetrics(demo.getLegacyDemo(), 'after-v1');
  near(get(r, 'surplus').value, 290 - 168 - 50 - 15);          // 57
  near(get(r, 'surplus').sub[0].value, 57 - 30);               // 상품 납입 후 27
  near(get(r, 'totalAssets').value, 600 + 800 + 400 + 1000 + 300);
  near(get(r, 'totalDebt').value, 900 + 1200);
  near(get(r, 'totalDebt').sub[0].value, 1200);                // 고금리
  near(get(r, 'netWorth').value, 1000);
  near(get(r, 'liquid').value, 1400);
  near(get(r, 'liquid').sub[0].value, 1400 / 130);
  near(get(r, 'restricted').value, 1300);
  near(get(r, 'restricted').sub[0].value, 1300 / 3100);
  near(get(r, 'emergencyMonths').value, 600 / 130);
  near(get(r, 'debtRatio').value, 2100 / 3100);
  near(get(r, 'debtService').value, 50 / 290);
  near(get(r, 'debtService').sub[0].value, 65 / 290);
  assert.equal(get(r, 'payoff').sub[0].value, '2028-10');
});

test('기준 판정: 비상자금 4.6개월 양호, 부채비율 67.7% 경보, 상환비중 17.2% 양호·추가 포함 22.4% 주의', () => {
  const r = M.computeMetrics(demo.getLegacyDemo(), 'after-v1');
  assert.equal(get(r, 'emergencyMonths').status, 'ok');
  assert.equal(get(r, 'debtRatio').status, 'bad');
  assert.equal(get(r, 'debtService').status, 'ok');
  assert.equal(get(r, 'debtService').sub[0].status, 'warn');
});

test('설계 전·후 비교: 원인 한 줄', () => {
  const c = M.compareMetrics(demo.getLegacyDemo(), 'before-v1', 'after-v1');
  const row = (k) => c.rows.find((r) => r.key === k);
  near(row('surplus').delta, 57 - 45);
  assert.equal(row('surplus').cause, '필수 지출 135→130, 선택 지출 60→38, 추가 상환 0→15');
  assert.equal(row('emergencyMonths').cause, '필수 지출 135→130');
  assert.equal(row('debtService').cause, '추가 상환 0→15'); // 약정분은 같고 추가 포함 비중이 바뀜
  assert.equal(row('totalAssets').cause, '변화 없음');
});

test('분모가 0이면 null(계산 불가)이고 NaN이 없다', () => {
  const s = demo.getLegacyDemo();
  Object.assign(s.customer, { netMonthly: 0, emergency: 0, housing: 0, investment: 0, cash: 0, pension: 0, debts: [] });
  s.customer.depositReturn = { amount: 0, month: '' };
  s.plans[1].essential = 0;
  const r = M.computeMetrics(s, 'after-v1');
  assert.equal(get(r, 'emergencyMonths').value, null);
  assert.equal(get(r, 'emergencyMonths').status, 'na');
  assert.equal(get(r, 'debtRatio').value, null);
  assert.equal(get(r, 'debtService').value, null);
  for (const m of r.list) if (typeof m.value === 'number') assert.ok(Number.isFinite(m.value), m.key);
});

test('숫자 표시: 소수 1자리·쉼표·부호', () => {
  assert.equal(F.num1(1234.56), '1,234.6');
  assert.equal(F.num1(-0.04), '0.0');
  assert.equal(F.num1(NaN), '—');
  assert.equal(F.short(60), '60');
  assert.equal(F.short(32.94), '32.9');
  assert.equal(F.won(4780.368), '4,780.4만원');
  assert.equal(F.signed(12.34), '+12.3');
  assert.equal(F.signed(-4), '-4.0');
  assert.equal(F.signed(0), '0.0');
  assert.equal(F.pct(0.1724), '17.2%');
});
