/*
 * 계산 조건별 결과(보고서 표 2·16, 부록 6). 같은 납입 계획을 서로 다른 조건으로 계산하므로 합산하지 않는다.
 *  A. 원금 기준(최종 판단 기준): 주거자금 수익률 0%, 적금 이자 제외
 *  C. 적금 이자 참고: 계획에 넣은 은행 적금의 조사일 기본금리 세후 이자를 더한 값(재원에는 넣지 않음)
 * 과거의 세후 연 2% 비교모형(B)은 최종 기준에서 제외했다(보고서 부록 6). compare(…, {withB:true})로만 계산한다.
 * '마지막 월 적립 제외': 목표월의 마지막 월말 적립을 잔금일 전에 쓸 수 없다고 볼 때의 금액.
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

  /** A(원금, 최종 기준)와 C(적금 이자 참고). opts는 엔진 옵션(기록 반영 등)에 합쳐진다. */
  function compare(state, planId, opts) {
    opts = opts || {};
    var a = Object.assign({}, state.assumptions);
    var merge = function (extra, ao) { return Object.assign({}, opts, extra, { assumptionOverrides: Object.assign({}, opts.assumptionOverrides, ao) }); };
    var A = engine.runPlan(state, planId, merge({ excludeBankProducts: true }, { housingRate: 0 }));
    var out = [summary(A, 'A', '원금 기준(최종 판단 기준) · 수익률 0%, 적금 이자 제외')];
    if (opts.withB) {
      var rateB = a.compareRate === undefined ? 0.02 : num(a.compareRate);
      var B = engine.runPlan(state, planId, merge({ excludeBankProducts: true }, { housingRate: rateB, rateBasis: 'effective' }));
      out.push(summary(B, 'B', '과거 비교모형 · 세후 연 ' + Math.round(rateB * 1000) / 10 + '%(최종 기준에서 제외)'));
    }
    if (hasBank(state, planId)) {
      var C = engine.runPlan(state, planId, merge({ includeBankInterest: true }, { housingRate: 0 }));
      var names = C.input.products.filter(function (p) { return p.type === 'bank'; }).map(function (p) { return p.name + ' 월 ' + p.monthly + '(조사일 기본금리 연 ' + Math.round(p.rate * 10000) / 100 + '%)'; });
      var r = summary(C, 'C', '적금 세후 이자 참고 · ' + names.join(', ') + ' — 이자는 목표 재원에 넣지 않음');
      r.reference = true;
      out.push(r);
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
