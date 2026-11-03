/*
 * 공모전용 가상 고객 사례
 * ------------------------------------------------------------
 * 모든 금액·직업 정보는 가상입니다(실제 인물·통계에서 가져오지 않음).
 * 서버 첫 실행 시 데모 데이터로 저장되며, 테스트에서도 사용합니다.
 *  - before: 설계 전 계획(현재 습관 유지)
 *  - after : 설계 후 계획(설계사 수정안)
 */
(function (root) {
  'use strict';

  var PROFILE = {
    name: '김하늘(가상)',
    birthMonth: '1997-05',
    household: '미혼 1인 가구, 경제적으로 독립',
    employStart: '2023-11',
    job: '사무직 (가상)',
    companySize: 'sme',
    region: '수도권 (가상)',
    annualGross: 40000000,
    incomeBasis: 'virtual' // 'virtual' = 공모전용 가상 고객의 소득 가정 (비교 통계 미연결)
  };

  var BEFORE = {
    basis: { baseMonth: '2026-08', moveMonth: '2029-08', note: '설계일 2026-08 (29세) → 36개월 뒤 이사(32세)' },
    income: { netMonthly: 2900000, raisePct: 0, raiseMonth: 1, netPassThrough: 0.75, promotion: null },
    expenses: { essential: 1350000, optional: 600000, minEssential: 1150000, inflation: 2.0 },
    assets: { cash: 9000000, emergencyFund: 0, investment: 4000000, housingFund: 8000000, deposit: 10000000, depositReturnMonth: '2028-08', pension: 3000000 },
    debts: [
      { id: 'd1', name: '학자금 대출', balance: 9000000, rate: 1.7, payment: 150000 },
      { id: 'd2', name: '신용대출', balance: 15000000, rate: 6.5, payment: 350000 }
    ],
    goals: { housingTarget: 50000000, movingCost: 2000000, emergencyTarget: 8000000 },
    rates: { savingsRate: 3.0, investReturn: 4.0 },
    plan: { lumpSum: 3000000, extraRepayment: 0, investShare: 0, includeInvestment: true, freedTo: 'savings' },
    products: [],
    taxRelief: { enabled: true, confirmed: true, startMonth: '2023-11', years: 5, rate: 0.9, annualCap: 2000000, annualTax: 1200000, mode: 'inTakeHome', refundMonth: 2,
      note: '가상 사례: 급여명세서에 감면이 이미 반영되어 있다고 가정(실수령에 포함)' },
    extraIncome: [
      { id: 'b1', month: '2027-01', amount: 1500000, kind: 'bonus', status: 'expected', note: '연말 성과급(미확정)' }
    ],
    allocation: { mode: 'sequential', order: ['emergency', 'debt', 'housing'], ratios: { emergency: 30, debt: 30, housing: 40 } },
    loanOption: { enabled: false }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var AFTER = clone(BEFORE);
  AFTER.basis.moveMonth = '2029-12';
  AFTER.basis.note = '청년미래적금 만기(2029-12)에 맞춰 이사월을 1개월 조정 — 32세 유지';
  AFTER.expenses.optional = 380000;
  AFTER.expenses.essential = 1300000;
  AFTER.plan.extraRepayment = 150000;
  AFTER.products = [
    { id: 'p1', policyId: 'youthFuture', name: '청년미래적금(일반형)', enabled: true, startMonth: '2026-12', termMonths: 36, monthly: 300000,
      govRate: 0.06, govConfirmed: true, companyRate: 0, companyConfirmed: false, interestRate: 0, taxFree: true, paidSoFar: 0,
      note: '2차 모집(2026-12 잠정) 가입 가정 · 은행 금리 확인 전이라 0% 가정 · 직전연도 총급여 4,000만원 → 우대형(3,600만원 이하) 아님' }
  ];

  var Sample = { PROFILE: PROFILE, BEFORE: BEFORE, AFTER: AFTER, clone: clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = Sample;
  else { root.FP = root.FP || {}; root.FP.Sample = Sample; }
})(this);
