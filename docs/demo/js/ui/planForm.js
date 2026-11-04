/*
 * 계획 편집 양식 정의 (경로 기반) — 입력 항목을 추가·수정하려면 이 목록만 고치면 됩니다.
 * type: money(만원 입력, 원 저장) | pct | num | int | ym | bool | select | text
 */
(function (root) {
  'use strict';
  var GROUPS = [
    { title: '기간', fields: [
      { path: 'basis.baseMonth', label: '설계 기준월', type: 'ym', help: '0개월(현재 상태)의 기준이 되는 달' },
      { path: 'basis.moveMonth', label: '이사 예정월(목표일)', type: 'ym', help: '이 달 말까지 들어온 돈만 목표 재원' },
      { path: 'basis.note', label: '기간 메모', type: 'text' }
    ] },
    { title: '소득 (실수령 기준)', fields: [
      { path: 'income.netMonthly', label: '월 실수령 급여', type: 'money', help: '세금·4대보험 공제 후. 감면이 이미 반영된 금액이면 아래 감면 방식을 ‘실수령 반영’으로' },
      { path: 'income.raisePct', label: '연간 세전 인상률', type: 'pct', help: '시뮬레이션 가정(확정 전망 아님)' },
      { path: 'income.raiseMonth', label: '연간 인상 적용 달', type: 'int', min: 1, max: 12, unit: '월' },
      { path: 'income.netPassThrough', label: '세전 인상분의 실수령 반영률', type: 'num', min: 0, max: 1, unit: '배', help: '단순화 가정: 세전 1% 인상 → 실수령 0.75% 인상(누진세·보험료 반영 근사)' },
      { path: 'income.promotion.month', label: '승진 인상 월', type: 'ym', optional: true },
      { path: 'income.promotion.pct', label: '승진 세전 인상률', type: 'pct', optional: true },
      { path: 'income.promotion.stack', label: '승진 해 연간 인상도 함께 적용', type: 'bool', help: '끄면 승진 후 12개월 안의 연간 인상은 생략' }
    ] },
    { title: '지출', fields: [
      { path: 'expenses.essential', label: '월 필수생활비', type: 'money' },
      { path: 'expenses.optional', label: '월 선택·비정기 지출', type: 'money' },
      { path: 'expenses.minEssential', label: '최소 필수생활비', type: 'money', help: '역산 시 이 아래로는 줄이지 않음' },
      { path: 'expenses.inflation', label: '연 물가상승률', type: 'pct' }
    ] },
    { title: '자산', fields: [
      { path: 'assets.cash', label: '현금·예금(목적 미지정)', type: 'money', help: '일시 상환 후 비상금 목표까지 → 나머지는 주거자금' },
      { path: 'assets.emergencyFund', label: '별도 비상금', type: 'money' },
      { path: 'assets.housingFund', label: '기존 주거자금', type: 'money' },
      { path: 'assets.investment', label: '투자자산(평가액)', type: 'money' },
      { path: 'assets.deposit', label: '반환 예정 보증금', type: 'money' },
      { path: 'assets.depositReturnMonth', label: '보증금 반환 예정월', type: 'ym', optional: true },
      { path: 'assets.pension', label: '연금 적립금', type: 'money', help: '주거자금·유동자산에서 제외' }
    ] },
    { title: '목표', fields: [
      { path: 'goals.housingTarget', label: '목표 보증금(신규 대출 없이 마련할 금액)', type: 'money' },
      { path: 'goals.movingCost', label: '이사 부대비용', type: 'money' },
      { path: 'goals.emergencyTarget', label: '비상자금 목표', type: 'money' }
    ] },
    { title: '실행 계획', fields: [
      { path: 'plan.lumpSum', label: '초기 일시 상환액', type: 'money' },
      { path: 'plan.extraRepayment', label: '월 추가 상환액', type: 'money', help: '이자율 높은 대출부터. 부채가 0이 되면 저축' },
      { path: 'plan.investShare', label: '잉여자금 중 투자 비율', type: 'pct' },
      { path: 'plan.includeInvestment', label: '목표일 투자자산을 주거자금에 포함', type: 'bool' },
      { path: 'plan.freedTo', label: '상환 끝난 대출의 상환액', type: 'select', options: [['savings', '저축으로'], ['otherDebt', '남은 대출에 추가 상환']] }
    ] },
    { title: '금리 가정', fields: [
      { path: 'rates.savingsRate', label: '예금 금리(연)', type: 'pct' },
      { path: 'rates.investReturn', label: '투자 기대수익률(연)', type: 'pct' }
    ] },
    { title: '중소기업 취업 청년 소득세 감면', fields: [
      { path: 'taxRelief.enabled', label: '감면 대상으로 검토', type: 'bool' },
      { path: 'taxRelief.confirmed', label: '대상 여부·기간 확인 완료', type: 'bool', help: '확인 전에는 계산에 넣지 않음' },
      { path: 'taxRelief.startMonth', label: '최초 감면 대상 취업월', type: 'ym', optional: true },
      { path: 'taxRelief.annualTax', label: '연 결정세액 추정(감면 전)', type: 'money', help: '감면액 = min(이 값 × 90%, 200만원)' },
      { path: 'taxRelief.mode', label: '반영 방식', type: 'select', options: [['inTakeHome', '월 급여에 이미 반영(실수령 포함)'], ['yearEndRefund', '연말정산 환급으로 받음']] },
      { path: 'taxRelief.refundMonth', label: '환급 유입 달', type: 'int', min: 1, max: 12, unit: '월' }
    ] },
    { title: '초과소득 배분 규칙', fields: [
      { path: 'allocation.mode', label: '배분 방식', type: 'select', options: [['sequential', '순서대로(부족분 먼저)'], ['ratio', '비율']] },
      { path: 'allocation.ratios.emergency', label: '비율: 비상금', type: 'pct' },
      { path: 'allocation.ratios.debt', label: '비율: 부채 추가 상환', type: 'pct' },
      { path: 'allocation.ratios.housing', label: '비율: 주거자금', type: 'pct', help: '비율 방식은 합계 100%. 충족된 항목의 남는 몫은 다음 항목으로' }
    ] }
  ];

  var LISTS = {
    debts: { title: '부채(대출별)', fields: [
      { key: 'name', label: '이름', type: 'text' }, { key: 'balance', label: '잔액', type: 'money' }, { key: 'rate', label: '연이율', type: 'pct' }, { key: 'payment', label: '월 원리금', type: 'money' }
    ], blank: function () { return { id: 'd' + Date.now().toString(36), name: '', balance: 0, rate: 0, payment: 0 }; } },
    products: { title: '정책·저축 상품', fields: [
      { key: 'name', label: '이름', type: 'text' },
      { key: 'policyId', label: '정책', type: 'select', options: [['youthFuture', '청년미래적금'], ['smeSaving', '중기 재직자 우대저축공제'], ['generic', '기타']] },
      { key: 'startMonth', label: '가입월', type: 'ym' }, { key: 'termMonths', label: '만기(개월)', type: 'int' },
      { key: 'monthly', label: '월 납입', type: 'money' }, { key: 'govRate', label: '정부기여율(납입액 대비)', type: 'num', unit: '배' },
      { key: 'govConfirmed', label: '정부기여 확인', type: 'bool' }, { key: 'companyRate', label: '기업기여율', type: 'num', unit: '배' },
      { key: 'companyConfirmed', label: '기업 참여 확인', type: 'bool' }, { key: 'interestRate', label: '은행 금리(연, 단리)', type: 'pct' },
      { key: 'taxFree', label: '비과세', type: 'bool' }
    ], blank: function () { return { id: 'p' + Date.now().toString(36), policyId: 'youthFuture', name: '청년미래적금', enabled: true, startMonth: '', termMonths: 36, monthly: 0, govRate: 0.06, govConfirmed: false, companyRate: 0, companyConfirmed: false, interestRate: 0, taxFree: true, paidSoFar: 0 }; } },
    extraIncome: { title: '초과소득(성과급·환급 등)', fields: [
      { key: 'month', label: '입금월', type: 'ym' }, { key: 'amount', label: '금액', type: 'money' },
      { key: 'kind', label: '종류', type: 'select', options: [['bonus', '성과급'], ['refund', '환급금'], ['other', '기타']] },
      { key: 'status', label: '상태', type: 'select', options: [['expected', '예상(기본 계획 재원 아님)'], ['confirmed', '확정']] }
    ], blank: function () { return { id: 'b' + Date.now().toString(36), month: '', amount: 0, kind: 'bonus', status: 'expected' }; } }
  };

  function get(o, path) { return path.split('.').reduce(function (a, k) { return a === undefined || a === null ? undefined : a[k]; }, o); }
  function set(o, path, v) { var ks = path.split('.'), cur = o; for (var i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] === undefined || cur[ks[i]] === null) cur[ks[i]] = {}; cur = cur[ks[i]]; } cur[ks[ks.length - 1]] = v; }

  root.FP = root.FP || {};
  root.FP.PlanForm = { GROUPS: GROUPS, LISTS: LISTS, get: get, set: set };
})(this);
