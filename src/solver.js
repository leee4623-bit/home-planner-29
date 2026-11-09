/*
 * 역산(명세 6-2 생활비 역산). 이분탐색으로 "전체 목표 달성"에 필요한 최소값을 찾는다.
 * 결과의 planChanges를 계획에 적용하면 판정이 "전체 목표 달성"이 된다(명세 7절 C5).
 * 표시값은 0.1만원 단위로 '올림'해서, 화면에 보인 숫자를 그대로 적용해도 목표가 지켜지게 한다.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var engine = isNode ? require('./engine.js') : root.Planner.engine;
  var judgeMod = isNode ? require('./judge.js') : root.Planner.judge;
  var scenarios = isNode ? require('./scenarios.js') : root.Planner.scenarios;

  var ITER = 50;
  var ACHIEVED = judgeMod.STATUS.ACHIEVED;

  function num(x) {
    var n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  function ceil1(x) { return Math.ceil(x * 10 - 1e-9) / 10; }
  function floor1(x) { return Math.floor(x * 10 + 1e-9) / 10; }

  function findPlan(state, planId) {
    var p = (state.plans || []).filter(function (x) { return x.id === planId; })[0];
    if (!p) throw new Error('계획을 찾을 수 없습니다: ' + planId);
    return p;
  }

  function merge(opts, extra) {
    var o = Object.assign({}, opts, extra);
    o.planOverrides = Object.assign({}, opts && opts.planOverrides, extra && extra.planOverrides);
    return o;
  }

  function run(state, planId, opts) {
    return engine.runPlan(state, planId, opts);
  }

  function housingShort(j) {
    var h = j.conditions.filter(function (c) { return c.key === 'housing'; })[0];
    return h ? h.shortfall : 0;
  }

  var REASONS = {
    debt: '목표월까지 고금리 부채가 남아 있어 생활비나 소득만으로는 목표를 모두 채울 수 없습니다. 추가 상환액을 늘리거나 목표 시점을 늦춰야 합니다.',
    limit: '선택지출을 모두 줄이고 필수생활비를 하한까지 낮춰도 목표에 닿지 않습니다.',
    unavailable: '시작월과 목표월을 먼저 확인해 주세요.'
  };

  function failReason(j) {
    if (j.status === judgeMod.STATUS.UNAVAILABLE) return REASONS.unavailable;
    if (j.unmetKeys.indexOf('debt') >= 0) return REASONS.debt;
    return REASONS.limit;
  }

  /** 단조 증가 조건 ok(x)가 참이 되는 최소 x를 [lo, hi]에서 찾는다(ok(hi)는 참이라고 가정). */
  function bisect(ok, lo, hi) {
    for (var i = 0; i < ITER; i++) {
      var mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }

  /**
   * 생활비 역산: 목표 시점을 지키기 위한 최소 월 절감액.
   * 선택지출부터 줄이고, 그래도 모자라면 필수생활비를 하한까지 줄인다.
   * opts:
   *   fromMonth: 절감 시작월(기본: 계획 시작월 → 기준 생활비 자체를 바꿈)
   *   essentialFloorRatio: 필수생활비 하한 비율(기본 0.9) / essentialFloor: 하한 금액(우선)
   *   engineOpts: 엔진 옵션(debtRule, 시나리오 등)
   */
  function solveLivingCut(state, planId, opts) {
    opts = opts || {};
    var plan = findPlan(state, planId);
    var eo = opts.engineOpts || {};
    var ess = num(plan.essential);
    var opt = num(plan.optional);
    var floor = opts.essentialFloor !== undefined ? num(opts.essentialFloor) : ess * (opts.essentialFloorRatio === undefined ? 0.9 : num(opts.essentialFloorRatio));
    floor = Math.min(ess, Math.max(0, floor));
    var maxCut = opt + (ess - floor);
    var from = opts.fromMonth && dates.parseYM(opts.fromMonth) > dates.parseYM(plan.startMonth) ? opts.fromMonth : null;

    function changesFor(cut) {
      var optCut = Math.min(cut, opt);
      var essCut = Math.max(0, cut - optCut);
      if (!from) return { optional: opt - optCut, essential: ess - essCut };
      var adj = (plan.budgetAdjustments || []).slice();
      adj.push({ start: from, months: 0, optional: -optCut, essential: -essCut, grow: true, note: '생활비 역산' });
      return { budgetAdjustments: adj };
    }
    function judgeAt(cut) {
      return run(state, planId, merge(eo, { planOverrides: changesFor(cut) })).judgement;
    }
    function ok(cut) { return judgeAt(cut).status === ACHIEVED; }

    var base = judgeAt(0);
    var months = from ? dates.diffMonths(from, plan.targetMonth) + 1 : dates.diffMonths(plan.startMonth, plan.targetMonth) + 1;
    if (base.status === ACHIEVED) {
      return { feasible: true, alreadyMet: true, cut: 0, exact: 0, optionalCut: 0, essentialCut: 0, floor: floor, maxCut: maxCut, fromMonth: from || plan.startMonth, months: months, planChanges: null, before: base, after: base };
    }
    var atMax = judgeAt(maxCut);
    if (atMax.status !== ACHIEVED) {
      return { feasible: false, reason: failReason(atMax), maxCut: maxCut, floor: floor, fromMonth: from || plan.startMonth, months: months, before: base, atMax: atMax };
    }
    var exact = bisect(ok, 0, maxCut);
    var cut = Math.min(ceil1(exact), maxCut);
    if (!ok(cut)) cut = exact; // 올림이 한도를 넘어 잘린 드문 경우
    var optionalCut = Math.min(cut, opt);
    return {
      feasible: true,
      alreadyMet: false,
      cut: cut,
      exact: exact,
      optionalCut: optionalCut,
      essentialCut: cut - optionalCut,
      floor: floor,
      maxCut: maxCut,
      fromMonth: from || plan.startMonth,
      months: months,
      planChanges: changesFor(cut),
      before: base,
      after: judgeAt(cut)
    };
  }

  /** 참고값: 주거 부족액 ÷ 남은 개월(이자·생활비 상승·비상금 우선 배분을 반영하지 않음) */
  function naiveDivision(state, planId, opts) {
    opts = opts || {};
    var plan = findPlan(state, planId);
    var j = run(state, planId, opts.engineOpts || {}).judgement;
    var from = opts.fromMonth || plan.startMonth;
    var months = dates.diffMonths(from, plan.targetMonth) + 1;
    var short = housingShort(j);
    return {
      value: months > 0 ? short / months : null,
      shortfall: short,
      months: months,
      note: '참고값입니다. 이자, 생활비 상승, 비상금 우선 배분을 반영하지 않은 단순 나눗셈이라 실제 필요액과 다릅니다.'
    };
  }

  /** 대안 1: 월 추가 소득(fromMonth부터 매달) */
  function solveExtraIncome(state, planId, opts) {
    opts = opts || {};
    var plan = findPlan(state, planId);
    var eo = opts.engineOpts || {};
    var from = opts.fromMonth || plan.startMonth;
    function optsFor(x) {
      var hook = { income: function (inc, ctx) { return dates.parseYM(ctx.month) >= dates.parseYM(from) ? inc + x : inc; } };
      return Object.assign({}, eo, { hooks: scenarios.mergeHooks([eo.hooks, hook]) });
    }
    function judgeAt(x) { return run(state, planId, optsFor(x)).judgement; }
    function ok(x) { return judgeAt(x).status === ACHIEVED; }
    var base = judgeAt(0);
    if (base.status === ACHIEVED) return { feasible: true, alreadyMet: true, amount: 0, fromMonth: from };
    var hi = 10;
    while (!ok(hi) && hi < 100000) hi *= 2;
    if (!ok(hi)) return { feasible: false, reason: failReason(judgeAt(hi)), fromMonth: from };
    var exact = bisect(ok, 0, hi);
    var amount = ceil1(exact);
    if (!ok(amount)) amount = exact;
    return { feasible: true, alreadyMet: false, amount: amount, exact: exact, fromMonth: from };
  }

  /** 대안 2: 목표 보증금 낮추기(주거 부족액만큼). 다른 조건이 미충족이면 그것만으로는 전체 달성이 아님. */
  function solveLowerTarget(state, planId, opts) {
    opts = opts || {};
    var eo = opts.engineOpts || {};
    var r = run(state, planId, eo);
    var j = r.judgement;
    var cur = num(r.input.goal.depositTarget);
    var short = housingShort(j);
    var newTarget = Math.max(0, floor1(cur - short));
    var after = run(state, planId, merge(eo, { goalOverrides: Object.assign({}, eo.goalOverrides, { depositTarget: newTarget }) })).judgement;
    return {
      feasible: after.status === ACHIEVED,
      alreadyMet: short <= 0,
      current: cur,
      newDepositTarget: newTarget,
      reduceBy: cur - newTarget,
      reason: after.status === ACHIEVED ? null : failReason(after),
      goalChanges: { depositTarget: newTarget }
    };
  }

  /** 대안 3: 목표 시점 늦추기(최대 maxMonths개월) */
  function solveDelay(state, planId, opts) {
    opts = opts || {};
    var plan = findPlan(state, planId);
    var eo = opts.engineOpts || {};
    var maxMonths = opts.maxMonths || 120;
    for (var k = 0; k <= maxMonths; k++) {
      var tm = dates.addMonths(plan.targetMonth, k);
      var j = run(state, planId, merge(eo, { planOverrides: { targetMonth: tm }, endMonth: tm })).judgement;
      if (j.status === ACHIEVED) {
        return { feasible: true, alreadyMet: k === 0, delayMonths: k, targetMonth: tm, planChanges: { targetMonth: tm } };
      }
    }
    return { feasible: false, reason: '목표 시점을 ' + maxMonths + '개월 늦춰도 목표에 닿지 않습니다.' };
  }

  /** 설계 도구 화면용: 역산 결과와 대안 3가지, 참고값을 한 번에 */
  function solveAll(state, planId, opts) {
    return {
      livingCut: solveLivingCut(state, planId, opts),
      extraIncome: solveExtraIncome(state, planId, opts),
      lowerTarget: solveLowerTarget(state, planId, opts),
      delay: solveDelay(state, planId, opts),
      naive: naiveDivision(state, planId, opts)
    };
  }

  var api = {
    solveLivingCut: solveLivingCut,
    naiveDivision: naiveDivision,
    solveExtraIncome: solveExtraIncome,
    solveLowerTarget: solveLowerTarget,
    solveDelay: solveDelay,
    solveAll: solveAll
  };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.solver = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
