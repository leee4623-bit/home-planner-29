/*
 * 충격 시나리오와 소득 가정(명세 6-2 설계 도구). 확률이 아니라 "이 충격이 오면"의 조건부 결과다.
 * 여러 시나리오를 동시에 켤 수 있다. 모든 함수는 엔진 옵션(hooks·overrides)을 만들 뿐 상태를 바꾸지 않는다.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var engine = isNode ? require('./engine.js') : root.Planner.engine;
  var fmt = isNode ? require('./format.js') : root.Planner.format;

  function num(x) {
    var n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * 시나리오 종류. value의 뜻은 종류마다 다르다.
   * months: 0 또는 비우면 계산 끝까지.
   */
  var SCENARIO_TYPES = {
    incomeDrop: { label: '소득 감소', valueLabel: '감소율', unit: '%', needsStart: true, needsMonths: true, defaults: { value: 0.1, months: 12 } },
    jobLoss: { label: '실직', valueLabel: '기간 중 월 대체소득(구직급여 등)', unit: '만원', needsStart: true, needsMonths: true, defaults: { value: 0, months: 3 } },
    livingRise: { label: '생활비 상승', valueLabel: '상승률', unit: '%', needsStart: true, needsMonths: true, defaults: { value: 0.1, months: 0 } },
    depositTargetRise: { label: '목표 보증금 상승', valueLabel: '상승액', unit: '만원', needsStart: false, needsMonths: false, defaults: { value: 500 } },
    investmentLoss: { label: '투자 손실', valueLabel: '손실률(한 번)', unit: '%', needsStart: true, needsMonths: false, defaults: { value: 0.2 } },
    depositDelay: { label: '보증금 반환 지연', valueLabel: '지연 개월', unit: '개월', needsStart: false, needsMonths: false, defaults: { value: 6 } }
  };

  function inWindow(ym, start, months) {
    var t = dates.parseYM(ym);
    var s = dates.parseYM(start);
    if (!Number.isFinite(s)) return false;
    var span = num(months) > 0 ? num(months) : Infinity;
    return t >= s && t < s + span;
  }

  /** 같은 종류의 훅을 차례로 이어 붙인다. */
  function chain(fns) {
    fns = fns.filter(function (f) { return typeof f === 'function'; });
    if (!fns.length) return undefined;
    return function (v, ctx) {
      for (var i = 0; i < fns.length; i++) v = fns[i](v, ctx);
      return v;
    };
  }

  function mergeHooks(list) {
    var out = {};
    ['income', 'living', 'investment', 'debtBudget', 'pension'].forEach(function (k) {
      var h = chain(list.map(function (x) { return x && x[k]; }));
      if (h) out[k] = h;
    });
    return out;
  }

  /**
   * 켜진 시나리오 목록 → 엔진 옵션 조각 { hooks, goalOverrides, customerOverrides }
   * 소득 감소와 실직이 겹치면 실직(대체소득)이 우선한다.
   */
  function toEngineOptions(state, list) {
    var on = (list || []).filter(function (s) { return s && s.enabled !== false && SCENARIO_TYPES[s.type]; });
    var hooks = [];
    var goalOverrides = {};
    var customerOverrides = {};
    var c = state.customer || {};

    on.filter(function (s) { return s.type === 'incomeDrop'; }).forEach(function (s) {
      hooks.push({ income: function (inc, ctx) { return inWindow(ctx.month, s.start, s.months) ? inc * (1 - num(s.value)) : inc; } });
    });
    on.filter(function (s) { return s.type === 'jobLoss'; }).forEach(function (s) {
      hooks.push({ income: function (inc, ctx) { return inWindow(ctx.month, s.start, s.months) ? num(s.value) : inc; } });
    });
    // 소득 감소·실직 기간의 대응(선택): 생활비를 정한 금액으로 줄이고(필수 먼저, 나머지는 선택), 연금 납입을 멈춘다.
    on.filter(function (s) { return (s.type === 'incomeDrop' || s.type === 'jobLoss') && (s.living > 0 || s.pausePension); }).forEach(function (s) {
      var h = {};
      if (num(s.living) > 0) {
        h.living = function (lv, ctx) {
          if (!inWindow(ctx.month, s.start, s.months)) return lv;
          var total = num(s.living);
          var ess = Math.min(lv.essential, total);
          return { essential: ess, optional: Math.max(0, total - ess) };
        };
      }
      if (s.pausePension) h.pension = function (p, ctx) { return inWindow(ctx.month, s.start, s.months) ? 0 : p; };
      hooks.push(h);
    });
    on.filter(function (s) { return s.type === 'livingRise'; }).forEach(function (s) {
      hooks.push({
        living: function (lv, ctx) {
          if (!inWindow(ctx.month, s.start, s.months)) return lv;
          var f = 1 + num(s.value);
          return { essential: lv.essential * f, optional: lv.optional * f };
        }
      });
    });
    on.filter(function (s) { return s.type === 'investmentLoss'; }).forEach(function (s) {
      hooks.push({ investment: function (inv, ctx) { return ctx.month === s.start ? inv * (1 - num(s.value)) : inv; } });
    });
    var rise = on.filter(function (s) { return s.type === 'depositTargetRise'; }).reduce(function (a, s) { return a + num(s.value); }, 0);
    if (rise) goalOverrides.depositTarget = num((c.goal || {}).depositTarget) + rise;
    var delay = on.filter(function (s) { return s.type === 'depositDelay'; }).reduce(function (a, s) { return a + Math.round(num(s.value)); }, 0);
    if (delay && c.depositReturn && dates.isValidYM(c.depositReturn.month)) {
      customerOverrides.depositReturn = { amount: c.depositReturn.amount, month: dates.addMonths(c.depositReturn.month, delay) };
    }

    return { hooks: mergeHooks(hooks), goalOverrides: goalOverrides, customerOverrides: customerOverrides };
  }

  /** 기존 엔진 옵션에 시나리오 옵션을 합친다. */
  function withScenarios(state, list, opts) {
    opts = opts || {};
    var s = toEngineOptions(state, list);
    return Object.assign({}, opts, {
      hooks: mergeHooks([opts.hooks, s.hooks]),
      goalOverrides: Object.assign({}, opts.goalOverrides, s.goalOverrides),
      customerOverrides: Object.assign({}, opts.customerOverrides, s.customerOverrides)
    });
  }

  function housingShort(result) {
    var h = result.judgement.conditions.filter(function (x) { return x.key === 'housing'; })[0];
    return h ? h.shortfall : null;
  }

  /** 기준 결과와 충격 결과를 비교하고 규칙 기반 문장을 붙인다. */
  function compare(state, planId, list, opts) {
    var base = engine.runPlan(state, planId, opts);
    var shocked = engine.runPlan(state, planId, withScenarios(state, list, opts));
    var tm = base.input.targetMonth;
    var bRow = engine.rowAt(base, tm);
    var sRow = engine.rowAt(shocked, tm);
    var dUsable = bRow && sRow ? sRow.usable - bRow.usable : null;
    var maxDeficit = shocked.rows.reduce(function (m, r) { return Math.max(m, r.deficit); }, 0);
    var minEm = shocked.rows.reduce(function (m, r) { return Math.min(m, r.emergency); }, Infinity);
    var names = (list || []).filter(function (s) { return s && s.enabled !== false && SCENARIO_TYPES[s.type]; })
      .map(function (s) { return SCENARIO_TYPES[s.type].label; });

    var sentences = [];
    if (!names.length) {
      sentences.push('켜진 충격이 없습니다.');
    } else {
      sentences.push(base.judgement.label === shocked.judgement.label
        ? names.join(' + ') + ' 충격이 와도 이사월(' + tm + ') 판정은 ' + shocked.judgement.label + '로 같습니다.'
        : names.join(' + ') + ' 충격이 오면 이사월(' + tm + ') 판정이 ' + base.judgement.label + '에서 ' + shocked.judgement.label + '로 바뀝니다.');
      if (dUsable !== null) sentences.push('사용 가능 주거자금이 ' + fmt.short(Math.abs(dUsable)) + '만원 ' + (dUsable < 0 ? '줄어듭니다.' : '늘어납니다.'));
      var hs = housingShort(shocked);
      if (hs > 0) sentences.push('주거자금이 ' + fmt.short(hs) + '만원 모자랍니다.');
      if (maxDeficit > 0) sentences.push('비상금과 주거자금으로도 메우지 못하는 달이 생깁니다(최대 월 ' + fmt.short(maxDeficit) + '만원).');
      else if (Number.isFinite(minEm) && minEm < num((state.customer.goal || {}).emergencyTarget) - 1e-9) {
        sentences.push('충격 기간에 비상금이 최저 ' + fmt.short(minEm) + '만원까지 줄어듭니다.');
      }
    }
    return { base: base, shocked: shocked, deltaUsable: dUsable, maxDeficit: maxDeficit, sentences: sentences };
  }

  /** 소득 감소 민감도 표(기본 −5/−10/−15/−20%, 전 기간 적용) */
  function sensitivityTable(state, planId, cuts, opts) {
    cuts = cuts || [0.05, 0.1, 0.15, 0.2];
    var base = engine.runPlan(state, planId, opts);
    var bRow = engine.rowAt(base, base.input.targetMonth);
    var rows = [{ cut: 0, usable: bRow ? bRow.usable : null, shortfall: housingShort(base), status: base.judgement.label, delta: 0 }];
    cuts.forEach(function (cut) {
      var r = engine.runPlan(state, planId, Object.assign({}, opts, { incomeCut: cut }));
      var row = engine.rowAt(r, r.input.targetMonth);
      rows.push({
        cut: cut,
        usable: row ? row.usable : null,
        shortfall: housingShort(r),
        status: r.judgement.label,
        delta: row && bRow ? row.usable - bRow.usable : null
      });
    });
    return rows;
  }

  /**
   * 임금 상승 가정: 연 상승률 × 실수령 반영률(기본 0.75)을 시작월 이후 매년 1월에 적용.
   * 감면 종료 차감 후 금액에 곱한다(차감액 9만원에 대한 상승분 차이는 무시할 만큼 작음).
   * @param {number} rate 0, 0.01, 0.02 또는 사용자 지정
   */
  function incomeGrowthHook(rate, startMonth, reflect) {
    var r = num(rate) * (reflect === undefined ? 0.75 : num(reflect));
    var s = dates.parseYM(startMonth);
    // 시작월 다음에 오는 첫 1월(시작월이 1월이면 이듬해 1월)
    var firstJan = s + (12 - (s % 12));
    return {
      income: function (inc, ctx) {
        var t = dates.parseYM(ctx.month);
        var jan = t >= firstJan ? Math.floor((t - firstJan) / 12) + 1 : 0; // (시작월, t] 사이 1월의 수
        return inc * Math.pow(1 + r, jan);
      }
    };
  }

  /** 임금 상승 가정을 엔진 옵션에 합친다. */
  function withIncomeGrowth(state, planId, rate, opts, reflect) {
    opts = opts || {};
    var plan = state.plans.filter(function (p) { return p.id === planId; })[0];
    return Object.assign({}, opts, { hooks: mergeHooks([opts.hooks, incomeGrowthHook(rate, plan.startMonth, reflect)]) });
  }

  var api = {
    SCENARIO_TYPES: SCENARIO_TYPES,
    toEngineOptions: toEngineOptions,
    withScenarios: withScenarios,
    mergeHooks: mergeHooks,
    compare: compare,
    sensitivityTable: sensitivityTable,
    incomeGrowthHook: incomeGrowthHook,
    withIncomeGrowth: withIncomeGrowth
  };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.scenarios = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
