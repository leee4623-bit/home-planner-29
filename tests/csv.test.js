// 거래내역 CSV 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/csv.js');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('시연 CSV: 계좌는 끝 4자리만, 금액은 만원', () => {
  const { rows, errors } = C.parseTransactions(C.DEMO_CSV, C.DEMO_OWN);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 15);
  assert.equal(rows[0].amount, 290);
  for (const r of rows) {
    assert.ok(r.from4.length <= 4 && r.to4.length <= 4);
    assert.ok(!JSON.stringify(r).includes('110-111'));
  }
});

test('분류: 급여 소득, 본인 이체는 소득·지출 아님, 비상금 이체는 저축', () => {
  const { rows } = C.parseTransactions(C.DEMO_CSV, C.DEMO_OWN);
  const by = (memo) => rows.find((r) => r.memo.startsWith(memo));
  assert.equal(by('급여').category, 'income');
  assert.equal(by('생활비 통장').category, 'ownTransfer');
  assert.equal(by('비상금').category, 'emergency');
  assert.equal(by('월세').category, 'essential');
  assert.equal(by('카드 결제(식당)').category, 'optional');
  assert.equal(by('신용대출').category, 'debt');
  assert.ok(rows.every((r) => r.confirmed === false)); // 고객이 확인해야 함
});

test('확인한 거래만 월 합계로(소득·본인 이체 제외), 시연 거래는 10월 기록과 같은 금액 + 비상금 30', () => {
  const { rows } = C.parseTransactions(C.DEMO_CSV, C.DEMO_OWN);
  assert.deepEqual(C.summarize(rows, '2026-10'), {});
  rows.forEach((r) => { r.confirmed = true; });
  const s = C.summarize(rows, '2026-10');
  near(s.essential, 132);
  near(s.optional, 61);
  near(s.debt, 65);
  near(s.emergency, 30);
  assert.equal(s.income, undefined);
  assert.equal(s.ownTransfer, undefined);
  assert.equal(rows.find((r) => r.memo === '마트 장보기').category, 'essential');
});

test('시연 거래를 10월 기록에 반영하면 생활비·상환은 그대로, 비상금만 채워진다', () => {
  const St = require('../src/store.js');
  const demo = require('../data/demo.js');
  const { rows } = C.parseTransactions(C.DEMO_CSV, C.DEMO_OWN);
  rows.forEach((r) => { r.confirmed = true; });
  let st = demo.getLegacyDemo();
  const before = St.getRecord(st, '2026-10');
  const sum = C.summarize(rows, '2026-10');
  for (const k of Object.keys(sum)) st = St.upsertRecord(st, '2026-10', k, sum[k]);
  const after = St.getRecord(st, '2026-10');
  for (const k of ['debt', 'essential', 'optional']) near(after[k], before[k]);
  near(after.emergency, 30);
});

test('따옴표 안 쉼표, BOM, 잘못된 줄', () => {
  const text = '﻿날짜,금액,적요,보낸계좌,받은계좌\n2026.11.3,"12,000","카페, 친구",1234-5678,9999\n잘못된줄,abc,,,\n';
  const { rows, errors } = C.parseTransactions(text, ['5678']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-11-03');
  assert.equal(rows[0].memo, '카페, 친구');
  assert.equal(rows[0].from4, '5678');
  assert.equal(rows[0].direction, 'out');
  assert.match(errors[0], /3번째 줄/);
});
