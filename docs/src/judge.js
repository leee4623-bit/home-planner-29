/* 목표 판정(명세 3절 '목표 판정'). 엔진에 의존하지 않는 순수 함수. */
(function (root) {
  'use strict';

  var EPS = 1e-9;

  var STATUS = {
    ACHIEVED: '전체 목표 달성',
    PARTIAL: '부분 충족',
    UNMET: '미달',
    UNAVAILABLE: '판정 불가'
  };

  var SHORT = { debt: '부채', emergency: '비상금', housing: '주거' };

  function num(x) {
    var n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * 한 시점(월별 행)의 세 조건 판정.
   * @param {object} snap  {debtTotal, debtHigh, debtLow, emergency, usable}
   * @param {object} goal  {depositTarget, movingCost, emergencyTarget}
   * @param {string} debtRule 'default' | 'legacy'(legacy는 전체 부채로 판정)
   */
  function evaluate(snap, goal, debtRule) {
    goal = goal || {};
    var legacy = debtRule === 'legacy';
    var debtRemain = Math.max(0, num(legacy ? snap.debtTotal : snap.debtHigh));
    var emTarget = num(goal.emergencyTarget);
    var houseTarget = num(goal.depositTarget) + num(goal.movingCost);
    var em = num(snap.emergency);
    var usable = num(snap.usable);

    var conditions = [
      {
        key: 'debt',
        label: legacy ? '부채 상환 완료' : '고금리 부채 상환 완료',
        met: debtRemain <= EPS,
        value: debtRemain,
        target: 0,
        shortfall: debtRemain <= EPS ? 0 : debtRemain
      },
      {
        key: 'emergency',
        label: '비상금 확보',
        met: em >= emTarget - EPS,
        value: em,
        target: emTarget,
        shortfall: Math.max(0, emTarget - em)
      },
      {
        key: 'housing',
        label: '주거자금 확보',
        met: usable >= houseTarget - EPS,
        value: usable,
        target: houseTarget,
        shortfall: Math.max(0, houseTarget - usable)
      }
    ];

    var unmet = conditions.filter(function (c) { return !c.met; });
    var housingMet = conditions[2].met;
    var status = unmet.length === 0 ? STATUS.ACHIEVED : housingMet ? STATUS.PARTIAL : STATUS.UNMET;
    var label = unmet.length === 0
      ? status
      : status + '(' + unmet.map(function (c) { return SHORT[c.key]; }).join('·') + ')';

    return {
      status: status,
      label: label,
      conditions: conditions,
      unmetKeys: unmet.map(function (c) { return c.key; }),
      // 기본 모드에서 판정에서 빠지는 저금리 부채 잔액(화면에 "조건 제외 — 잔액 ○○만원"으로 표시)
      excludedLowRateDebt: legacy ? null : Math.max(0, num(snap.debtLow))
    };
  }

  /**
   * 월별 행 목록에서 targetMonth 말 기준으로 판정한다.
   */
  function judge(rows, targetMonth, goal, debtRule) {
    var row = null;
    for (var i = 0; rows && i < rows.length; i++) {
      if (rows[i].month === targetMonth) { row = rows[i]; break; }
    }
    if (!row) {
      return {
        status: STATUS.UNAVAILABLE,
        label: STATUS.UNAVAILABLE,
        month: targetMonth,
        conditions: [],
        unmetKeys: [],
        excludedLowRateDebt: null,
        reason: '목표월이 계산 기간 안에 없습니다. 시작월과 목표월을 확인해 주세요.'
      };
    }
    var r = evaluate(row, goal, debtRule);
    r.month = targetMonth;
    return r;
  }

  var api = { STATUS: STATUS, evaluate: evaluate, judge: judge };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.judge = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
