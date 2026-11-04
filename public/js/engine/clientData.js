/*
 * 고객 입력 정보(client_data) — 고객이 직접 입력·수정하는 사실 정보
 * ------------------------------------------------------------
 * - 값이 null이면 ‘아직 입력하지 않음’, 0이면 ‘실제 0원’입니다(구분해서 저장).
 * - 계획(설계사 작성)과 분리해서 저장하고, 설계사가 ‘최신 정보로 다시 계산’할 때만 계획에 반영합니다.
 * - 항목 정의(FIELDS)는 입력 화면·변경 요약·계획 반영에 함께 쓰입니다.
 */
(function (root) {
  'use strict';
  var FIELDS = [
    { sec: 'basic', path: 'profile.name', label: '이름', type: 'text' },
    { sec: 'basic', path: 'profile.birthMonth', label: '출생 연월', type: 'ym' },
    { sec: 'basic', path: 'profile.employStart', label: '최초 취업 연월', type: 'ym' },
    { sec: 'basic', path: 'profile.job', label: '직종', type: 'text' },
    { sec: 'basic', path: 'profile.companySize', label: '회사 규모', type: 'select', options: [['sme', '중소기업'], ['mid', '중견기업'], ['large', '대기업'], ['public', '공공기관'], ['other', '기타']] },
    { sec: 'basic', path: 'profile.region', label: '근무 지역', type: 'text' },
    { sec: 'basic', path: 'goal.moveMonth', label: '이사 예정월(목표일)', type: 'ym' },
    { sec: 'basic', path: 'goal.housingTarget', label: '목표 보증금(대출 없이 마련할 금액)', type: 'money' },
    { sec: 'basic', path: 'goal.movingCost', label: '이사 부대비용', type: 'money' },
    { sec: 'income', path: 'profile.annualGross', label: '직전연도 총급여(세전)', type: 'money' },
    { sec: 'income', path: 'income.netMonthly', label: '월 실수령 급여', type: 'money' },
    { sec: 'income', path: 'expenses.essential', label: '월 필수생활비', type: 'money' },
    { sec: 'income', path: 'expenses.optional', label: '월 선택·비정기 지출', type: 'money' },
    { sec: 'income', path: 'taxRelief.applied', label: '중소기업 취업자 소득세 감면 적용', type: 'select', options: [['yes', '적용 받는 중'], ['no', '적용 안 됨'], ['unknown', '모름']] },
    { sec: 'income', path: 'taxRelief.startMonth', label: '감면 대상 최초 취업월', type: 'ym' },
    { sec: 'asset', path: 'assets.cash', label: '현금·예금(목적 미지정)', type: 'money' },
    { sec: 'asset', path: 'assets.emergencyFund', label: '따로 모은 비상금', type: 'money' },
    { sec: 'asset', path: 'goal.emergencyTarget', label: '비상금 목표', type: 'money' },
    { sec: 'asset', path: 'assets.housingFund', label: '주거자금(청약·적금 등)', type: 'money' },
    { sec: 'asset', path: 'assets.investment', label: '투자자산 평가액', type: 'money' },
    { sec: 'asset', path: 'assets.deposit', label: '돌려받을 보증금', type: 'money' },
    { sec: 'asset', path: 'assets.depositReturnMonth', label: '보증금 반환 예정월', type: 'ym' },
    { sec: 'asset', path: 'assets.pension', label: '연금 적립금', type: 'money' }
  ];
  var LISTS = {
    debts: { sec: 'asset', label: '부채', fields: [['name', '이름', 'text'], ['balance', '잔액', 'money'], ['rate', '연이율', 'pct'], ['payment', '월 원리금', 'money']] },
    products: { sec: 'product', label: '가입한 정책·저축 상품', fields: [['name', '상품명', 'text'], ['policyId', '종류', 'select', [['youthFuture', '청년미래적금'], ['smeSaving', '중기 재직자 우대저축공제'], ['generic', '기타 적금']]], ['startMonth', '가입월', 'ym'], ['termMonths', '만기(개월)', 'int'], ['monthly', '월 납입액', 'money']] }
  };

  function get(o, p) { return p.split('.').reduce(function (a, k) { return a === undefined || a === null ? undefined : a[k]; }, o); }
  function set(o, p, v) { var ks = p.split('.'), c = o; for (var i = 0; i < ks.length - 1; i++) { if (c[ks[i]] === undefined || c[ks[i]] === null) c[ks[i]] = {}; c = c[ks[i]]; } c[ks[ks.length - 1]] = v; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function label(path) { var f = FIELDS.filter(function (x) { return x.path === path; })[0]; return f ? f.label : (LISTS[path] ? LISTS[path].label : path); }
  function fmt(path, v) {
    if (v === null || v === undefined || v === '') return '미입력';
    var f = FIELDS.filter(function (x) { return x.path === path; })[0];
    if (LISTS[path]) return v.length + '건';
    if (f && f.type === 'money') return Math.round(v / 10000).toLocaleString('ko-KR') + '만원';
    if (f && f.type === 'select') { var o = f.options.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : v; }
    return String(v);
  }

  // 계획 데이터 → 고객 입력 정보 초기값(시연 데이터·처음 가져오기)
  function fromPlan(plan, profile) {
    var d = {
      profile: clone(profile || {}), goal: { moveMonth: plan.basis.moveMonth, housingTarget: plan.goals.housingTarget, movingCost: plan.goals.movingCost, emergencyTarget: plan.goals.emergencyTarget },
      income: { netMonthly: plan.income.netMonthly }, expenses: { essential: plan.expenses.essential, optional: plan.expenses.optional },
      assets: clone(plan.assets), debts: clone(plan.debts || []),
      products: (plan.products || []).filter(function (p) { return p.enrolled; }).map(function (p) { return { id: p.id, name: p.name, policyId: p.policyId, startMonth: p.startMonth, termMonths: p.termMonths, monthly: p.monthly }; }),
      taxRelief: { applied: plan.taxRelief && plan.taxRelief.enabled ? (plan.taxRelief.confirmed ? 'yes' : 'unknown') : 'no', startMonth: plan.taxRelief ? plan.taxRelief.startMonth || null : null }
    };
    delete d.profile.incomeBasis;
    return d;
  }

  // 고객 최신 정보를 계획에 반영(설계사가 ‘최신 정보로 다시 계산’할 때). null(미입력)은 계획 값을 그대로 둠.
  // 설계 후 계획의 생활비는 ‘합의한 예산’이므로 고객이 입력한 현재 생활비로 바꾸지 않음(opts.kind === 'after').
  function pairsFor(opts) {
    var map = [['goal.moveMonth', 'basis.moveMonth'], ['goal.housingTarget', 'goals.housingTarget'], ['goal.movingCost', 'goals.movingCost'], ['goal.emergencyTarget', 'goals.emergencyTarget'], ['income.netMonthly', 'income.netMonthly']];
    if (!opts || opts.kind !== 'after') map.push(['expenses.essential', 'expenses.essential'], ['expenses.optional', 'expenses.optional']);
    ['cash', 'emergencyFund', 'housingFund', 'investment', 'deposit', 'depositReturnMonth', 'pension'].forEach(function (k) { map.push(['assets.' + k, 'assets.' + k]); });
    return map;
  }
  function applyToPlan(plan, cd, opts) {
    var d = clone(plan);
    var map = pairsFor(opts);
    map.forEach(function (m) { var v = get(cd, m[0]); if (v !== null && v !== undefined && v !== '') set(d, m[1], v); });
    if (Array.isArray(cd.debts)) d.debts = clone(cd.debts);
    if (Array.isArray(cd.products)) {
      var held = cd.products.map(function (p) { return Object.assign({ enabled: true, enrolled: true, govRate: p.policyId === 'youthFuture' ? 0.06 : 0, govConfirmed: p.policyId === 'youthFuture', companyRate: 0, companyConfirmed: false, interestRate: 0, taxFree: p.policyId === 'youthFuture', paidSoFar: 0 }, clone(p)); });
      var ids = held.map(function (p) { return p.policyId; });
      d.products = (d.products || []).filter(function (p) { return p.policyId === 'generic' ? false : ids.indexOf(p.policyId) < 0; }).concat(held);
    }
    if (cd.taxRelief && cd.taxRelief.applied) {
      d.taxRelief = d.taxRelief || {};
      if (cd.taxRelief.applied === 'yes') { d.taxRelief.enabled = true; d.taxRelief.confirmed = true; if (cd.taxRelief.startMonth) d.taxRelief.startMonth = cd.taxRelief.startMonth; }
      else if (cd.taxRelief.applied === 'no') { d.taxRelief.enabled = false; d.taxRelief.confirmed = false; }
      else { d.taxRelief.confirmed = false; }
    }
    return d;
  }

  // 실행 계획과 고객 최신 정보의 차이(미입력 제외)
  function diff(plan, cd, opts) {
    var applied = applyToPlan(plan, cd, opts), out = [];
    var pairs = pairsFor(opts);
    pairs.forEach(function (p) { var a = get(plan, p[1]), b = get(applied, p[1]); if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: p[0], label: label(p[0]), plan: fmt(p[0], a), client: fmt(p[0], b) }); });
    if (JSON.stringify(plan.debts || []) !== JSON.stringify(applied.debts || [])) out.push({ path: 'debts', label: '부채', plan: (plan.debts || []).length + '건', client: (applied.debts || []).length + '건(내용 변경)' });
    var pk = function (x) { return JSON.stringify((x.products || []).map(function (p) { return [p.policyId, p.startMonth, p.monthly]; })); };
    if (pk(plan) !== pk(applied)) out.push({ path: 'products', label: '정책·저축 상품', plan: (plan.products || []).length + '건', client: (applied.products || []).length + '건(내용 변경)' });
    return out;
  }

  // 변경 요약: 두 버전의 고객 정보 비교
  function changes(a, b) {
    var out = [];
    FIELDS.forEach(function (f) { var x = get(a, f.path), y = get(b, f.path); if (JSON.stringify(x === undefined ? null : x) !== JSON.stringify(y === undefined ? null : y)) out.push({ path: f.path, label: f.label, from: fmt(f.path, x), to: fmt(f.path, y) }); });
    Object.keys(LISTS).forEach(function (k) { if (JSON.stringify(a[k] || []) !== JSON.stringify(b[k] || [])) out.push({ path: k, label: LISTS[k].label, from: fmt(k, a[k] || []), to: fmt(k, b[k] || []) }); });
    return out;
  }

  var CD = { FIELDS: FIELDS, LISTS: LISTS, get: get, set: set, fromPlan: fromPlan, applyToPlan: applyToPlan, diff: diff, changes: changes, label: label, fmt: fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = CD;
  else { root.FP = root.FP || {}; root.FP.ClientData = CD; }
})(this);
