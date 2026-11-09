/*
 * 계산 조건별 결과(보고서 표 2·표 19). 같은 납입 계획을 서로 다른 조건으로 계산하므로 합산하지 않는다.
 *  A. 원금 기준 검증: 주거자금 수익률 0%, 은행 적금 이자도 빼고 원금만
 *  B. 공통 비교모형: 세후 연 유효수익률(기본 2%)로 월별 반복 계산, 은행 적금은 같은 돈이 주거계좌에 들어간 것으로 봄
 *  C. 실제 상품 적용 예시: 계획에 넣은 은행 적금의 조사일 기본금리가 가입 시에도 같다는 조건(주거 유동자금 이자 0%)
 * 그리고 '지급일 예상 가용자금': 목표월의 마지막 월말 납입을 잔금일 전에 쓸 수 없다고 볼 때의 금액.
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var engine = isNode ? require('./engine.js') : root.Planner.engine;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var bank = isNode ? require('../data/products.js') : root.Planner.bankProducts;

  function num(x) { var n = Number(x); return Number.isFinite(n) ? n : 0; }

  function summary(result, label, condition) {
    var tm = result.input.targetMonth;
    var row = engine.rowAt(result, tm);
    var goal = result.input.goal;
    var target = num(goal.depositTarget) + num(goal.movingCost);
    var usable = row ? row.usable : null;
    // 목표월 월말에 주거자금으로 들어간 이번 달 납입분(잉여 배분 + 보증금·만기 제외)
    var lastIn = row ? Math.max(0, row.housingIn) : 0;
    return {
      key: label, condition: condition, usable: usable, target: target,
      diff: usable === null ? null : usable - target,
      lastMonthIn: lastIn,
      paydayUsable: usable === null ? null : usable - lastIn,
      paydayDiff: usable === null ? null : usable - lastIn - target,
      judgement: result.judgement, result: result
    };
  }

  function hasBank(state, planId) {
    var plan = (state.plans || []).filter(function (p) { return p.id === planId; })[0];
    return !!plan && (plan.products || []).some(function (p) { return p.type === 'bank'; });
  }

  /** A·B·C 세 조건 결과. opts는 엔진 옵션(기록 반영 등)에 합쳐진다. */
  function compare(state, planId, opts) {
    opts = opts || {};
    var a = Object.assign({}, state.assumptions);
    var rateB = a.compareRate === undefined ? 0.02 : num(a.compareRate);
    var merge = function (extra, ao) { return Object.assign({}, opts, extra, { assumptionOverrides: Object.assign({}, opts.assumptionOverrides, ao) }); };
    var A = engine.runPlan(state, planId, merge({ excludeBankProducts: true }, { housingRate: 0 }));
    var B = engine.runPlan(state, planId, merge({ excludeBankProducts: true }, { housingRate: rateB, rateBasis: 'effective' }));
    var out = [
      summary(A, 'A', '원금 기준 검증 · 주거자금 수익률 0%'),
      summary(B, 'B', '공통 비교모형 · 세후 연 ' + Math.round(rateB * 1000) / 10 + '% 유효수익률, 월별 반복 계산(특정 상품의 만기금 아님)')
    ];
    if (hasBank(state, planId)) {
      var C = engine.runPlan(state, planId, merge({}, { housingRate: 0 }));
      var names = C.input.products.filter(function (p) { return p.type === 'bank'; }).map(function (p) { return p.name + ' 월 ' + p.monthly + '(조사일 기본금리 연 ' + Math.round(p.rate * 10000) / 100 + '%가 가입 시에도 같다는 조건)'; });
      out.push(summary(C, 'C', '실제 상품 적용 예시 · ' + names.join(', ') + ' + 나머지는 이자 0%인 주거 유동자금'));
    }
    return out;
  }

  /**
   * 은행 예·적금 비교(같은 월 납입·기간·세금 가정). 적금 이자 근사 = 월 납입 × 연이율 × n(n+1)/24, 세후 = × (1 − 15.4%)
   * 예금 이자 = 원금 × 연이율 × 개월/12 × (1 − 15.4%). 우대금리는 조건 충족을 확인할 때만 적용(조건부로 따로 표시).
   */
  function compareBank(state, planId, monthly, months, lump, start) {
    var plan = (state.plans || []).filter(function (p) { return p.id === planId; })[0];
    var tax = bank.TAX.rate;
    return bank.PRODUCTS.map(function (p) {
      var r = bank.rateFor(p, months);
      var row = { id: p.id, name: p.bank + ' ' + p.name, use: p.use, kind: p.kind, source: p.source, checkedAt: p.checkedAt, conditions: p.conditions, caution: p.caution, months: months };
      if (p.kind === 'demand') { row.note = '수시 입출금 — 금리 변동형이라 목표 재원 계산에 넣지 않음(참고 금리 연 ' + (p.rates[0].base * 100).toFixed(2) + '%)'; return row; }
      if (!r) { row.note = months + '개월 금리가 조사 자료에 없음'; return row; }
      var interest = function (rate) {
        return p.kind === 'deposit' ? lump * rate * months / 12 : monthly * rate * months * (months + 1) / 24;
      };
      var principal = p.kind === 'deposit' ? lump : monthly * months;
      row.principal = principal;
      row.baseRate = r.base;
      row.prefRate = r.pref;
      row.payout = principal + interest(r.base) * (1 - tax);
      row.payoutPref = r.pref ? principal + interest(r.pref) * (1 - tax) : null;
      row.maturity = dates.addMonths(start, months);
      row.targetFunding = plan ? dates.parseYM(row.maturity) <= dates.parseYM(plan.targetMonth) : null;
      return row;
    });
  }

  var api = { compare: compare, compareBank: compareBank, hasBank: hasBank };
  if (isNode) module.exports = api;
  else { root.Planner = root.Planner || {}; root.Planner.models = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
