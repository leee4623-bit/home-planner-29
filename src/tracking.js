/*
 * 계획 대비 실제(명세 6-2 실행, 6-3 홈 체크리스트, 6-5 차트).
 * - 기록이 없으면 '실패'가 아니라 '아직 확인 안 됨'. 예정일 + 유예기간이 지나야 미달로 본다.
 * - 실제 경로는 '확정' 기록만 반영한다. '잠정' 기록은 표시만 하고 계산에 넣지 않는다.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var engine = isNode ? require('./engine.js') : root.Planner.engine;

  var EPS = 1e-9;
  var DONE_TOL = 0.05; // 표시 단위(0.1) 미만 차이는 같은 금액으로 본다

  var DEFAULT_SETTINGS = {
    paymentDay: 25,          // 납입 예정일(매월 며칠)
    graceDays: 5,            // 유예기간(일)
    cumulativeTolerance: 0.1, // 누적 저축 미달 허용 비율
    overspendTolerance: 0.1,  // 생활비 초과 허용 비율
    emergencyMinMonths: 3,    // 비상금 최소 개월(필수생활비 기준)
    overspendConsecutive: 1,  // 생활비 초과가 몇 달 연속일 때 경보(1 = 한 달만 넘어도)
    emergencyAfterReached: false, // true면 계획상 비상금 목표를 처음 채운 달부터만 비상금 부족 경보
    incomeDropRate: 0,        // 기록한 실수령이 계획보다 이 비율 이상 적으면 경보(0 = 쓰지 않음)
    trendMonths: 3            // 최근 추세에 쓰는 확정 기록 개월 수
  };

  var STATE = {
    DONE: '완료',
    IN_PROGRESS: '진행 중',
    UNCHECKED: '아직 확인 안 됨',
    MISSED: '미달',
    NONE: '해당 없음',
    WITHIN: '예산 안',
    OVER: '초과',
    REFERENCE: '참고' // 필수·선택 항목별 숫자(판정은 생활비 합계 한 줄에서만)
  };

  var SAVING_ITEMS = [
    { key: 'debt', label: '부채 상환' },
    { key: 'emergency', label: '비상금' },
    { key: 'housing', label: '주거자금' },
    { key: 'product', label: '상품 납입' },
    { key: 'pension', label: '연금 납입' }
  ];
  var SPENDING_ITEMS = [
    { key: 'essential', label: '필수 지출' },
    { key: 'optional', label: '선택 지출' }
  ];

  function num(x) {
    var n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  function getSettings(state) {
    var s = Object.assign({}, DEFAULT_SETTINGS, (state && state.settings && state.settings.alerts) || {});
    return s;
  }

  function today(state, opts) {
    if (opts && opts.today) return opts.today;
    if (state && state.demoToday) return state.demoToday;
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  }

  /** 그 달의 납입 예정일 + 유예기간이 지났는가 */
  function dueInfo(month, todayStr, settings) {
    var y = Number(month.slice(0, 4));
    var mo = Number(month.slice(5, 7));
    var due = Date.UTC(y, mo - 1, num(settings.paymentDay));
    var limit = due + num(settings.graceDays) * 86400000;
    var t = parseDate(todayStr);
    var iso = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
    return { dueDate: iso(due), graceEnd: iso(limit), pastDue: Number.isFinite(t) && t > limit };
  }

  function recordMap(state, onlyConfirmed) {
    var map = {};
    (state.records || []).forEach(function (r) {
      if (!onlyConfirmed || r.status !== '잠정') map[r.month] = r;
    });
    return map;
  }

  /** 계획 행에서 항목별 계획값 */
  function plannedFor(row) {
    if (!row) return null;
    return {
      debt: row.interest + row.principal,
      emergency: Math.max(0, row.emergencyIn),
      housing: Math.max(0, row.housingIn),
      product: row.productPay,
      pension: num(row.pensionPay),
      income: row.income,
      essential: row.essential,
      optional: row.optional
    };
  }

  /**
   * 생활비 판정(필수+선택 합계 기준). 홈 체크리스트와 생활비 초과 경보가 같은 함수를 쓴다.
   * 한 항목만 기록했으면 나머지는 계획값으로 채워 비교한다. 둘 다 없으면 '아직 확인 안 됨'.
   * @returns {{planned, actual, diff, ratio, state, essentialDiff, optionalDiff, recorded}}
   */
  function livingCheck(row, rec, settings) {
    var hasE = !!rec && rec.essential !== undefined;
    var hasO = !!rec && rec.optional !== undefined;
    var planned = row.essential + row.optional;
    if (!hasE && !hasO) {
      return { planned: planned, actual: null, diff: null, ratio: null, state: STATE.UNCHECKED, essentialDiff: null, optionalDiff: null, recorded: false };
    }
    var ess = hasE ? num(rec.essential) : row.essential;
    var opt = hasO ? num(rec.optional) : row.optional;
    var actual = ess + opt;
    var over = actual > planned * (1 + num(settings.overspendTolerance)) + EPS;
    return {
      planned: planned,
      actual: actual,
      diff: actual - planned,
      ratio: planned > EPS ? (actual - planned) / planned : null,
      state: over ? STATE.OVER : STATE.WITHIN,
      essentialDiff: hasE ? ess - row.essential : null,
      optionalDiff: hasO ? opt - row.optional : null,
      recorded: true,
      partial: hasE !== hasO // 한 항목만 기록됨(나머지는 계획값으로 채움)
    };
  }

  function planResult(state, planId, opts) {
    var plan = (state.plans || []).filter(function (p) { return p.id === planId; })[0];
    var end = opts && opts.endMonth;
    return engine.runPlan(state, planId, end && plan && dates.parseYM(end) > dates.parseYM(plan.targetMonth) ? { endMonth: end } : {});
  }

  /**
   * 한 달의 계획 대비 실제(홈 체크리스트·실행 원장).
   * @returns {{month, recordStatus, dueDate, graceEnd, pastDue, items:[{item,label,kind,planned,actual,diff,state}]}}
   */
  function monthStatus(state, month, opts) {
    opts = opts || {};
    var planId = opts.planId || state.activePlanId;
    var settings = getSettings(state);
    var res = opts.planResult || planResult(state, planId);
    var row = engine.rowAt(res, month);
    var planned = plannedFor(row);
    var rec = recordMap(state, false)[month] || null;
    var due = dueInfo(month, today(state, opts), settings);
    var items = [];

    if (planned) {
      SAVING_ITEMS.forEach(function (it) {
        var p = planned[it.key];
        var a = rec && rec[it.key] !== undefined ? num(rec[it.key]) : null;
        var st;
        if (p <= EPS && a === null) st = STATE.NONE;
        else if (a === null) st = due.pastDue ? STATE.MISSED : STATE.UNCHECKED;
        else if (a >= p - DONE_TOL) st = STATE.DONE;
        else st = due.pastDue ? STATE.MISSED : STATE.IN_PROGRESS;
        items.push({ item: it.key, label: it.label, kind: 'saving', planned: p, actual: a, diff: a === null ? null : a - p, state: st });
      });
      // 실수령 소득: 기록이 있으면 계획 대비 감소율로 판정(경보 기준과 같음)
      var inc = rec && rec.income !== undefined ? num(rec.income) : null;
      var incState = inc === null ? STATE.UNCHECKED
        : (num(settings.incomeDropRate) > 0 && inc < planned.income * (1 - num(settings.incomeDropRate)) - EPS ? STATE.MISSED : STATE.DONE);
      items.push({ item: 'income', label: '실수령 소득', kind: 'income', planned: planned.income, actual: inc, diff: inc === null ? null : inc - planned.income, state: incState });
      // 생활비: 판정은 합계 한 줄, 필수·선택은 숫자만(참고)
      var lc = livingCheck(row, rec, settings);
      items.push({
        item: 'living', label: '생활비(필수+선택)', kind: 'livingTotal',
        planned: lc.planned, actual: lc.actual, diff: lc.diff, ratio: lc.ratio, state: lc.state, partial: !!lc.partial
      });
      SPENDING_ITEMS.forEach(function (it) {
        var p = planned[it.key];
        var a = rec && rec[it.key] !== undefined ? num(rec[it.key]) : null;
        items.push({ item: it.key, label: it.label, kind: 'spending', planned: p, actual: a, diff: a === null ? null : a - p, state: a === null ? STATE.UNCHECKED : STATE.REFERENCE });
      });
    }

    return {
      month: month,
      planId: planId,
      inPlan: !!row,
      recordStatus: rec ? rec.status || '확정' : null,
      dueDate: due.dueDate,
      graceEnd: due.graceEnd,
      pastDue: due.pastDue,
      items: items
    };
  }

  /** 실행 원장: 계획 시작월부터 오늘이 속한 달까지 */
  function ledger(state, opts) {
    opts = opts || {};
    var planId = opts.planId || state.activePlanId;
    var res = planResult(state, planId);
    var t = today(state, opts).slice(0, 7);
    var plan = (state.plans || []).filter(function (p) { return p.id === planId; })[0];
    var out = [];
    for (var m = plan.startMonth; dates.parseYM(m) <= dates.parseYM(t) && dates.parseYM(m) <= dates.parseYM(plan.targetMonth); m = dates.addMonths(m, 1)) {
      out.push(monthStatus(state, m, Object.assign({}, opts, { planId: planId, planResult: res })));
    }
    return out;
  }

  /**
   * 최근 확정 기록 N개월의 계획 대비 평균 차이(항목별, 기록이 있는 달만 평균).
   * @returns {{essential, optional, debt, months:[...]}}
   */
  function trendDeviation(state, planId, opts) {
    var settings = getSettings(state);
    var res = planResult(state, planId);
    var confirmed = (state.records || [])
      .filter(function (r) { return r.status !== '잠정' && engine.rowAt(res, r.month); })
      .sort(function (a, b) { return a.month < b.month ? -1 : 1; })
      .slice(-settings.trendMonths);
    var out = { essential: 0, optional: 0, debt: 0, months: confirmed.map(function (r) { return r.month; }) };
    ['essential', 'optional', 'debt'].forEach(function (k) {
      var sum = 0;
      var n = 0;
      confirmed.forEach(function (r) {
        if (r[k] === undefined) return;
        sum += num(r[k]) - plannedFor(engine.rowAt(res, r.month))[k];
        n++;
      });
      out[k] = n ? sum / n : 0;
    });
    return out;
  }

  /**
   * 기록을 반영해 다시 계산한다.
   * mode 'plan': 마지막 확정 기록 다음 달부터는 계획대로 / 'trend': 최근 추세가 이어진다고 가정
   */
  function replay(state, planId, mode, opts) {
    opts = opts || {};
    var eo = recordEngineOpts(state, planId, mode, opts.engineOpts);
    var result = engine.runPlan(state, planId, eo);
    result.lastConfirmed = eo._lastConfirmed;
    result.deviation = eo._deviation;
    return result;
  }

  /**
   * 기록 반영 엔진 옵션(역산·제안 비교에서도 같은 기준으로 계산하려고 분리).
   * 다른 훅(시나리오 등)이 있으면 기록 훅을 먼저 적용하고 이어 붙인다.
   */
  function recordEngineOpts(state, planId, mode, baseOpts) {
    baseOpts = baseOpts || {};
    var recs = recordMap(state, true);
    var months = Object.keys(recs).sort();
    var last = months.length ? months[months.length - 1] : null;
    var dev = mode === 'trend' ? trendDeviation(state, planId) : null;
    var after = function (ym) { return last !== null && dates.parseYM(ym) > dates.parseYM(last); };
    var hooks = {
      living: function (lv, ctx) {
        var r = recs[ctx.month];
        if (r) {
          return {
            essential: r.essential !== undefined ? num(r.essential) : lv.essential,
            optional: r.optional !== undefined ? num(r.optional) : lv.optional
          };
        }
        if (dev && after(ctx.month)) {
          return { essential: Math.max(0, lv.essential + dev.essential), optional: Math.max(0, lv.optional + dev.optional) };
        }
        return lv;
      },
      debtBudget: function (budget, ctx) {
        var r = recs[ctx.month];
        if (r && r.debt !== undefined) return num(r.debt);
        if (dev && after(ctx.month)) return Math.max(0, budget + dev.debt);
        return budget;
      },
      // 확정 기록의 실수령·연금 납입은 그 달 계산에 그대로 쓴다.
      income: function (inc, ctx) {
        var r = recs[ctx.month];
        return r && r.income !== undefined ? num(r.income) : inc;
      },
      pension: function (p, ctx) {
        var r = recs[ctx.month];
        return r && r.pension !== undefined ? num(r.pension) : p;
      }
    };
    var other = baseOpts.hooks || {};
    var merged = {};
    ['living', 'debtBudget', 'income', 'investment', 'pension'].forEach(function (k) {
      var a = hooks[k];
      var b = other[k];
      if (a && b) merged[k] = function (v, ctx) { return b(a(v, ctx), ctx); };
      else if (a || b) merged[k] = a || b;
    });
    var out = Object.assign({}, baseOpts, { hooks: merged });
    // 결과에 붙일 정보(엔진은 모르는 키라 무시함)
    Object.defineProperty(out, '_lastConfirmed', { value: last, enumerable: false });
    Object.defineProperty(out, '_deviation', { value: dev, enumerable: false });
    return out;
  }

  /**
   * 차트·실행 화면용 묶음.
   * - plan: 계획 그대로(설계 후 예상)
   * - withRecords: 기록 반영 후 계획대로
   * - trend: 기록 반영 후 최근 추세가 이어질 때
   * - actual: 확정 기록이 있는 달만 값, 나머지는 null(선을 끊음)
   */
  function paths(state, opts) {
    opts = opts || {};
    var planId = opts.planId || state.activePlanId;
    var plan = planResult(state, planId);
    var withRecords = replay(state, planId, 'plan', opts);
    var trend = replay(state, planId, 'trend', opts);
    var confirmed = recordMap(state, true);
    var all = recordMap(state, false);
    var actual = withRecords.rows.map(function (r) {
      if (confirmed[r.month]) return { month: r.month, usable: r.usable, emergency: r.emergency, debtTotal: r.debtTotal, status: '확정' };
      if (all[r.month]) return { month: r.month, usable: null, status: '잠정' };
      return { month: r.month, usable: null, status: null };
    });
    return {
      planId: planId,
      plan: plan,
      withRecords: withRecords,
      trend: trend,
      actual: actual,
      lastConfirmed: withRecords.lastConfirmed,
      deviation: trend.deviation
    };
  }

  var api = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    STATE: STATE,
    getSettings: getSettings,
    dueInfo: dueInfo,
    plannedFor: plannedFor,
    livingCheck: livingCheck,
    monthStatus: monthStatus,
    ledger: ledger,
    trendDeviation: trendDeviation,
    replay: replay,
    recordEngineOpts: recordEngineOpts,
    paths: paths,
    today: today
  };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.tracking = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
