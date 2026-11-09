/*
 * 진단 지표(명세 4절). 기준 시점은 초기 처리 직후(시작 전 달 말).
 * 계산은 반올림하지 않고, 원인 문구에만 표시용 숫자를 쓴다.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var engine = isNode ? require('./engine.js') : root.Planner.engine;
  var fmt = isNode ? require('./format.js') : root.Planner.format;

  var EPS = 1e-9;

  // 기준값(설정값). ok: 기준 충족, warn: 주의 구간, 그 밖은 bad.
  var DEFAULT_THRESHOLDS = {
    emergencyMonths: { ok: 3, warn: 1 },      // 이상일수록 좋음
    debtRatio: { ok: 0.4, warn: 0.6 },        // 이하일수록 좋음
    debtService: { ok: 0.2, warn: 0.3 }       // 이하일수록 좋음
  };

  function num(x) {
    var n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  /** 분모가 0이면 null(화면에는 '계산 불가') */
  function div(a, b) {
    return Math.abs(b) > EPS ? a / b : null;
  }

  function higherBetter(v, t) {
    if (v === null) return 'na';
    return v >= t.ok - EPS ? 'ok' : v >= t.warn - EPS ? 'warn' : 'bad';
  }

  function lowerBetter(v, t) {
    if (v === null) return 'na';
    return v <= t.ok + EPS ? 'ok' : v <= t.warn + EPS ? 'warn' : 'bad';
  }

  /**
   * 계획 하나의 진단 지표.
   * @returns {{asOf, base:{...원값}, list:[{key,label,value,unit,status,threshold,definition,sub}]}}
   */
  function computeMetrics(state, planId, opts) {
    opts = opts || {};
    var th = Object.assign({}, DEFAULT_THRESHOLDS, (state.settings && state.settings.metricThresholds) || {});
    var input = engine.buildInput(state, planId, opts);
    var init = input.initial;
    var asOf = dates.addMonths(input.startMonth, -1) + ' 말(초기 처리 직후)';

    var income = input.netMonthly;
    var essential = input.essential;
    var living = input.essential + input.optional;
    var activeDebts = init.debts.filter(function (d) { return d.balance > EPS; });
    var contract = activeDebts.reduce(function (s, d) { return s + d.monthlyPayment; }, 0);
    var extra = activeDebts.length ? input.extraRepayment : 0;
    var productMonthly = input.products.reduce(function (s, p) { return s + p.monthly; }, 0);

    var surplus = income - living - contract - extra;
    var surplusAfterProducts = surplus - productMonthly;

    var deposit = input.depositReturn ? Math.max(0, num(input.depositReturn.amount)) : 0;
    var pension = init.pension;
    var productBalance = 0; // 기준 시점에는 상품 납입 전
    var liquid = init.emergency + init.housing;
    var saleable = init.investment;
    var restricted = deposit + pension + productBalance;
    var totalAssets = liquid + saleable + restricted + init.cashLeft;
    var totalDebt = init.debts.reduce(function (s, d) { return s + d.balance; }, 0);
    var highDebt = init.debts.reduce(function (s, d) { return s + (d.rate >= num(input.assumptions.highRateThreshold) ? d.balance : 0); }, 0);
    var netWorth = totalAssets - totalDebt;

    var emergencyMonths = div(init.emergency, essential);
    var debtRatio = div(totalDebt, totalAssets);
    var debtToNetWorth = netWorth > EPS ? totalDebt / netWorth : null;
    var dsrContract = div(contract, income);
    var dsrWithExtra = div(contract + extra, income);

    // 상환 완료월은 목표월과 상관없이 끝까지 계산해서 구한다(최대 40년)
    var long = engine.simulate(engine.buildInput(state, planId, Object.assign({}, opts, { endMonth: dates.addMonths(input.startMonth, 479) })));

    var list = [
      {
        key: 'surplus', label: '월 잉여', value: surplus, unit: '만원', status: surplus >= 0 ? 'ok' : 'bad',
        threshold: null,
        definition: '실수령 − 생활비(필수+선택) − 약정 원리금 − 추가 상환. 정책상품 납입 전 금액입니다.',
        sub: [{ label: '정책상품 납입 후', value: surplusAfterProducts, unit: '만원' }]
      },
      {
        key: 'totalAssets', label: '총자산', value: totalAssets, unit: '만원', status: 'info', threshold: null,
        definition: '비상금 + 주거자금 + 투자자산 + 반환 전 보증금 + 연금(+ 배정되지 않은 현금).',
        sub: []
      },
      {
        key: 'totalDebt', label: '총부채', value: totalDebt, unit: '만원', status: 'info', threshold: null,
        definition: '초기 처리 후 모든 부채 잔액의 합.',
        sub: [{ label: '고금리 부채', value: highDebt, unit: '만원' }]
      },
      {
        key: 'netWorth', label: '순자산', value: netWorth, unit: '만원', status: netWorth >= 0 ? 'info' : 'bad', threshold: null,
        definition: '총자산 − 총부채.',
        sub: []
      },
      {
        key: 'liquid', label: '즉시 사용 가능(현금성)', value: liquid, unit: '만원', status: 'info', threshold: null,
        definition: '비상금 + 주거자금. 가격 변동 없이 바로 쓸 수 있는 돈입니다.',
        sub: [{ label: '필수생활비 기준', value: div(liquid, essential), unit: '개월' }]
      },
      {
        key: 'saleable', label: '매각 시 사용 가능', value: saleable, unit: '만원', status: 'info', threshold: null,
        definition: '투자자산. 팔 때 가격이 변동할 수 있어 현금성과 나눠 표시합니다.',
        sub: []
      },
      {
        key: 'restricted', label: '사용 제한 자산', value: restricted, unit: '만원', status: 'info', threshold: null,
        definition: '반환 전 보증금 + 연금 + 만기 전 정책상품. 지금 바로 쓸 수 없는 돈입니다.',
        sub: [{ label: '총자산 대비', value: div(restricted, totalAssets), unit: '%' }]
      },
      {
        key: 'emergencyMonths', label: '비상자금 개월', value: emergencyMonths, unit: '개월',
        status: higherBetter(emergencyMonths, th.emergencyMonths),
        threshold: { text: th.emergencyMonths.ok + '개월 이상', value: th.emergencyMonths.ok },
        definition: '비상금 ÷ 필수생활비. 소득이 끊겨도 필수생활비를 몇 달 버틸 수 있는지입니다.',
        sub: []
      },
      {
        key: 'debtRatio', label: '부채비율', value: debtRatio, unit: '%',
        status: lowerBetter(debtRatio, th.debtRatio),
        threshold: { text: fmt.short(th.debtRatio.ok * 100) + '% 이하', value: th.debtRatio.ok },
        definition: '총부채 ÷ 총자산.',
        sub: [{ label: '부채 ÷ 순자산', value: debtToNetWorth, unit: '%' }]
      },
      {
        key: 'debtService', label: '원리금 상환비중', value: dsrContract, unit: '%',
        status: lowerBetter(dsrContract, th.debtService),
        threshold: { text: fmt.short(th.debtService.ok * 100) + '% 이하', value: th.debtService.ok },
        definition: '약정 월 원리금 ÷ 실수령. 추가 상환을 포함한 값도 함께 보여줍니다.',
        sub: [{ label: '추가 상환 포함', value: dsrWithExtra, unit: '%', status: lowerBetter(dsrWithExtra, th.debtService) }]
      },
      {
        key: 'payoff', label: '예상 부채 상환 완료월', value: long.payoff.all, unit: '월', status: 'info', threshold: null,
        definition: '월별 계산으로 구한 완료월. 40년 안에 끝나지 않으면 표시하지 않습니다.',
        sub: [{ label: '고금리 부채', value: long.payoff.high, unit: '월' }]
      }
    ];

    return {
      asOf: asOf,
      planId: planId,
      base: {
        income: income, essential: essential, living: living, contract: contract, extra: extra,
        productMonthly: productMonthly, surplus: surplus, surplusAfterProducts: surplusAfterProducts,
        totalAssets: totalAssets, totalDebt: totalDebt, highDebt: highDebt, netWorth: netWorth,
        liquid: liquid, saleable: saleable, restricted: restricted
      },
      list: list
    };
  }

  // 계획 필드 → 화면 이름
  var PLAN_FIELDS = [
    { key: 'essential', label: '필수 지출' },
    { key: 'optional', label: '선택 지출' },
    { key: 'extraRepayment', label: '추가 상환' },
    { key: 'targetMonth', label: '이사월' }
  ];

  // 지표마다 영향을 주는 계획 필드
  var CAUSES = {
    surplus: ['essential', 'optional', 'extraRepayment', 'budgetAdjustments'],
    liquid: ['essential'],
    emergencyMonths: ['essential'],
    debtService: ['extraRepayment'],
    payoff: ['extraRepayment']
  };

  function productText(products) {
    if (!products || !products.length) return '없음';
    return products.map(function (p) { return (p.policyId || '상품') + ' 월 ' + fmt.short(num(p.monthly)); }).join(', ');
  }

  /** 두 계획 사이에서 바뀐 항목을 '선택 지출 60→38' 같은 문장 조각으로. */
  function explainDiff(planA, planB) {
    var out = [];
    PLAN_FIELDS.forEach(function (f) {
      var a = planA[f.key];
      var b = planB[f.key];
      if (a === b) return;
      var show = function (v) { return typeof v === 'number' ? fmt.short(v) : String(v); };
      out.push({ key: f.key, text: f.label + ' ' + show(a) + '→' + show(b) });
    });
    var pa = productText(planA.products);
    var pb = productText(planB.products);
    if (pa !== pb) {
      out.push({ key: 'products', text: (planB.products && planB.products.length ? '정책상품 추가(월 ' + fmt.short(planB.products.reduce(function (s, p) { return s + num(p.monthly); }, 0)) + ')' : '정책상품 제외') });
    }
    if (JSON.stringify(planA.budgetAdjustments || []) !== JSON.stringify(planB.budgetAdjustments || [])) {
      out.push({ key: 'budgetAdjustments', text: '기간별 예산 조정 변경' });
    }
    return out;
  }

  /** 설계 전·후 지표를 나란히 놓고, 지표마다 원인 한 줄을 붙인다. */
  function compareMetrics(state, beforeId, afterId, opts) {
    var A = computeMetrics(state, beforeId, opts);
    var B = computeMetrics(state, afterId, opts);
    var find = function (id) { return state.plans.filter(function (p) { return p.id === id; })[0]; };
    var diffs = explainDiff(find(beforeId), find(afterId));
    var rows = A.list.map(function (m, i) {
      var b = B.list[i];
      var keys = CAUSES[m.key] || [];
      var causes = diffs.filter(function (d) { return keys.indexOf(d.key) >= 0; }).map(function (d) { return d.text; });
      var eq = function (x, y) {
        return x === y || (typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) < EPS);
      };
      // 보조값(추가 상환 포함 비중, 고금리 상환월 등)까지 같아야 '변화 없음'
      var same = eq(m.value, b.value) && m.sub.every(function (s, k) { return b.sub[k] && eq(s.value, b.sub[k].value); });
      return {
        key: m.key, label: m.label, unit: m.unit,
        before: m, after: b,
        delta: typeof m.value === 'number' && typeof b.value === 'number' ? b.value - m.value : null,
        cause: same ? '변화 없음' : causes.length ? causes.join(', ') : '계획 외 요인(자산·부채 기준값 동일)'
      };
    });
    return { asOf: A.asOf, before: A, after: B, rows: rows, diffs: diffs };
  }

  var api = {
    DEFAULT_THRESHOLDS: DEFAULT_THRESHOLDS,
    computeMetrics: computeMetrics,
    explainDiff: explainDiff,
    compareMetrics: compareMetrics
  };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.metrics = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
