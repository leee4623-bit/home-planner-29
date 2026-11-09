/*
 * 경보·수정안·자동 적용(명세 6-2 점검, 6-3 알림·내 계획).
 * - 같은 상황의 경보는 id가 같아서 한 번만 만든다.
 * - 수정안 하나는 경보 하나에만 연결한다(같은 수정안을 두 알림에 넣지 않음).
 * - 자동 적용은 고객 동의가 있을 때 '생활비 예산 조정'만, 한도·하한 안에서만.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var engine = isNode ? require('./engine.js') : root.Planner.engine;
  var tracking = isNode ? require('./tracking.js') : root.Planner.tracking;
  var store = isNode ? require('./store.js') : root.Planner.store;
  var fmt = isNode ? require('./format.js') : root.Planner.format;

  var EPS = 1e-9;
  var SEVERITY = { BAD: '경보', WARN: '주의', INFO: '안내' };
  var ALERT_STATUS = { NEW: '새 알림', READ: '읽음', RESOLVED: '해소' };
  var REVISION_MONTHS = 3;

  function num(x) {
    var n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function findPlan(state, id) {
    return (state.plans || []).filter(function (p) { return p.id === id; })[0];
  }

  /**
   * 지금 상태에서 성립하는 경보 목록(저장하지 않음).
   * @returns {Array<{id,type,severity,month,title,message,data}>}
   */
  function evaluateAlerts(state, opts) {
    opts = opts || {};
    var planId = opts.planId || state.activePlanId;
    var plan = findPlan(state, planId);
    if (!plan) return [];
    var settings = tracking.getSettings(state);
    var todayStr = tracking.today(state, opts);
    var res = engine.runPlan(state, planId);
    var ledger = tracking.ledger(state, Object.assign({}, opts, { planId: planId }));
    var alerts = [];

    // 1. 생활비 초과(확정 기록, 필수+선택 합계 기준). overspendConsecutive개월 연속일 때만 경보.
    var need = Math.max(1, Math.round(num(settings.overspendConsecutive) || 1));
    var overMonths = {};
    (state.records || []).forEach(function (r) {
      if (r.status === '잠정') return;
      var row = engine.rowAt(res, r.month);
      if (row && tracking.livingCheck(row, r, settings).state === tracking.STATE.OVER) overMonths[r.month] = true;
    });
    function streak(m) {
      var n = 0;
      while (overMonths[m]) { n++; m = dates.addMonths(m, -1); }
      return n;
    }
    (state.records || []).forEach(function (r) {
      if (r.status === '잠정') return;
      var row = engine.rowAt(res, r.month);
      if (!row) return;
      // 홈 체크리스트와 같은 판정 함수(합계 기준)
      var lc = tracking.livingCheck(row, r, settings);
      if (lc.state === tracking.STATE.OVER && streak(r.month) >= need) {
        var planned = lc.planned;
        var actual = lc.actual;
        var excess = lc.diff;
        var ess = row.essential + (lc.essentialDiff || 0);
        var opt = row.optional + (lc.optionalDiff || 0);
        alerts.push({
          id: 'overspend-' + r.month,
          type: 'overspend',
          severity: SEVERITY.WARN,
          month: r.month,
          title: r.month + ' 생활비 초과',
          message: r.month + ' 생활비가 ' + fmt.short(actual) + '만원으로 계획 ' + fmt.short(planned) + '만원보다 ' +
            fmt.short(excess) + '만원(' + fmt.short(excess / planned * 100) + '%) 많습니다' +
            ' (필수 ' + fmt.signed(ess - row.essential) + ', 선택 ' + fmt.signed(opt - row.optional) + ')' +
            (need > 1 ? ' — ' + streak(r.month) + '개월 연속 초과입니다.' : '.'),
          data: { excess: excess, essentialExcess: ess - row.essential, optionalExcess: opt - row.optional, planned: planned, actual: actual }
        });
      }
    });

    // 2. 약정 납입 미달(부채 상환·상품 납입). 예정일 + 유예기간이 지난 달만.
    ledger.forEach(function (m) {
      if (!m.pastDue) return;
      m.items.forEach(function (it) {
        if ((it.item === 'debt' || it.item === 'product') && it.state === tracking.STATE.MISSED) {
          alerts.push({
            id: 'missed-' + it.item + '-' + m.month,
            type: 'missedPayment',
            severity: SEVERITY.BAD,
            month: m.month,
            title: m.month + ' ' + it.label + ' 미달',
            message: it.actual === null
              ? m.month + ' ' + it.label + ' 기록이 유예기간(' + m.graceEnd + ')이 지나도록 없습니다. 납부했다면 기록을 입력해 주세요.'
              : m.month + ' ' + it.label + '이 ' + fmt.short(it.actual) + '만원으로 계획 ' + fmt.short(it.planned) + '만원보다 ' + fmt.short(it.planned - it.actual) + '만원 적습니다.',
            data: { item: it.item, planned: it.planned, actual: it.actual }
          });
        }
      });
    });

    // 3. 누적 저축 미달(비상금 + 주거자금). 유예기간이 지난 달까지 합산, 기록 없는 달은 0.
    var plannedSum = 0;
    var actualSum = 0;
    var missingMonths = [];
    var lastMonth = null;
    ledger.forEach(function (m) {
      if (!m.pastDue) return;
      m.items.forEach(function (it) {
        if (it.item !== 'emergency' && it.item !== 'housing') return;
        plannedSum += it.planned;
        actualSum += it.actual === null ? 0 : it.actual;
        if (it.actual === null && it.planned > EPS && missingMonths.indexOf(m.month) < 0) missingMonths.push(m.month);
      });
      lastMonth = m.month;
    });
    if (plannedSum > EPS && (plannedSum - actualSum) / plannedSum > settings.cumulativeTolerance + EPS) {
      alerts.push({
        id: 'cumulative-savings',
        type: 'cumulativeShortfall',
        severity: SEVERITY.WARN,
        month: lastMonth,
        title: '저축 누적 미달',
        message: plan.startMonth + '~' + lastMonth + ' 비상금·주거자금 적립이 계획 ' + fmt.short(plannedSum) + '만원 중 ' +
          fmt.short(actualSum) + '만원(' + fmt.short(actualSum / plannedSum * 100) + '%)입니다. 허용 범위는 ' +
          fmt.short(settings.cumulativeTolerance * 100) + '% 미달까지입니다.' +
          (missingMonths.length ? ' 기록이 없는 달: ' + missingMonths.join(', ') + '.' : ''),
        data: { planned: plannedSum, actual: actualSum, missingMonths: missingMonths }
      });
    }

    // 4. 비상금 최소 개월(기록 반영 경로의 마지막 확정 달 기준)
    //    emergencyAfterReached면 계획상 비상금 목표를 처음 채운 달 이전에는 경보하지 않는다(쌓는 중인 기간).
    var replay = tracking.replay(state, planId, 'plan');
    var emTarget = num(((state.customer || {}).goal || {}).emergencyTarget);
    var reached = null;
    if (settings.emergencyAfterReached) {
      var hit = res.rows.filter(function (x) { return x.emergency >= emTarget - 1e-6; })[0];
      reached = hit ? hit.month : '9999-12';
    }
    if (replay.lastConfirmed && (!reached || replay.lastConfirmed >= reached)) {
      var row = engine.rowAt(replay, replay.lastConfirmed);
      if (row && row.essential > EPS) {
        var months = row.emergency / row.essential;
        if (months < settings.emergencyMinMonths - EPS) {
          alerts.push({
            id: 'emergency-low',
            type: 'emergencyLow',
            severity: SEVERITY.BAD,
            month: replay.lastConfirmed,
            title: '비상금 부족',
            message: '비상금이 필수생활비 ' + fmt.num1(months) + '개월분으로 기준(' + settings.emergencyMinMonths + '개월)보다 적습니다.',
            data: { months: months }
          });
        }
      }
    }

    // 5. 실수령 소득 감소(확정 기록). incomeDropRate가 0이면 쓰지 않는다.
    var dropRate = num(settings.incomeDropRate);
    if (dropRate > 0) {
      (state.records || []).forEach(function (r) {
        if (r.status === '잠정' || r.income === undefined) return;
        var row = engine.rowAt(res, r.month);
        if (!row || row.income <= EPS) return;
        var drop = (row.income - num(r.income)) / row.income;
        if (drop >= dropRate - EPS) {
          alerts.push({
            id: 'income-drop-' + r.month,
            type: 'incomeDrop',
            severity: SEVERITY.BAD,
            month: r.month,
            title: r.month + ' 실수령 감소',
            message: r.month + ' 실수령이 ' + fmt.short(num(r.income)) + '만원으로 계획 ' + fmt.short(row.income) + '만원보다 ' +
              fmt.short(drop * 100) + '% 적습니다(기준 ' + fmt.short(dropRate * 100) + '%). 생활비 조정·연금 납입 일시 중지 같은 대응을 설계사와 점검하세요.',
            data: { planned: row.income, actual: num(r.income), drop: drop }
          });
        }
      });
    }

    return alerts;
  }

  /** 다음 달부터 3개월 동안 초과분을 선택지출 예산에서 나눠 줄이는 수정안 */
  function buildOverspendRevision(state, alert, opts) {
    opts = opts || {};
    var planId = opts.planId || state.activePlanId;
    var plan = findPlan(state, planId);
    var todayStr = tracking.today(state, opts);
    var start = dates.addMonths(todayStr.slice(0, 7), 1);
    var excess = alert.data.excess;
    var perMonth = excess / REVISION_MONTHS;
    var adj = (plan.budgetAdjustments || []).slice();
    adj.push({ start: start, months: REVISION_MONTHS, optional: -perMonth, note: '초과 지출 보완' });
    var end = dates.addMonths(start, REVISION_MONTHS - 1);
    return {
      id: 'rev-' + alert.id,
      type: '수정안',
      kind: '초과 지출 보완',
      status: '확인 대기',
      createdAt: todayStr,
      basePlanId: planId,
      title: alert.month.slice(5).replace(/^0/, '') + '월 생활비 초과분 보완',
      reason: alert.message,
      summary: '초과분 ' + fmt.short(excess) + '만원을 ' + start + '~' + end + ' 석 달 동안 선택지출 예산에서 월 ' +
        fmt.short(perMonth) + '만원씩 나눠 줄입니다.',
      planChanges: { budgetAdjustments: adj },
      alertId: alert.id,
      author: '앱(규칙 기반)'
    };
  }

  /**
   * 자동 적용 가능 여부. 생활비 예산 조정만, 월 조정 한도·필수생활비 하한 안에서만.
   * 목표일 변경·목표 금액 변경·상품 변경·상환액 변경·A/B/C 선택은 자동 적용하지 않는다.
   */
  function canAutoApply(state, proposal) {
    var consent = state.autoApplyConsent || {};
    var reasons = [];
    if (!consent.enabled) reasons.push('자동 적용에 동의하지 않았어요.');
    if (proposal.options) reasons.push('여러 안 중 고르는 제안은 직접 선택해야 해요.');
    if (proposal.goalChanges && Object.keys(proposal.goalChanges).length) reasons.push('목표 금액 변경은 자동 적용하지 않아요.');
    // 실행 기준이 바뀌었으면 지금 실행 기준 위에 얹은 변경으로 판단
    var eff = proposal.options ? null : store.effectiveChanges(state, proposal);
    var ch = eff ? eff.planChanges : proposal.planChanges || {};
    Object.keys(ch).forEach(function (k) {
      if (k !== 'budgetAdjustments') reasons.push(k === 'targetMonth' ? '목표일 변경은 자동 적용하지 않아요.'
        : k === 'products' ? '상품 가입·해지는 자동 적용하지 않아요.'
        : k === 'extraRepayment' ? '상환액 변경은 자동 적용하지 않아요.'
        : '생활비 예산 조정이 아닌 변경이 들어 있어요.');
    });
    var base = findPlan(state, eff ? eff.basePlanId : proposal.basePlanId);
    if (!base) reasons.push('바탕 계획을 찾을 수 없어요.');
    if (base && ch.budgetAdjustments) {
      var existing = JSON.stringify(base.budgetAdjustments || []);
      var added = ch.budgetAdjustments.filter(function (a) { return existing.indexOf(JSON.stringify(a)) < 0; });
      var limit = num(consent.monthlyLimit || 10);
      var floorRatio = consent.essentialFloorRatio === undefined ? 0.9 : num(consent.essentialFloorRatio);
      added.forEach(function (a) {
        var total = Math.abs(num(a.essential)) + Math.abs(num(a.optional));
        if (total > limit + EPS) reasons.push('월 조정액 ' + fmt.short(total) + '만원이 동의한 한도(' + fmt.short(limit) + '만원)를 넘어요.');
        if (num(base.essential) + num(a.essential) < num(base.essential) * floorRatio - EPS) reasons.push('필수생활비가 하한 아래로 내려가요.');
        if (num(base.optional) + num(a.optional) < -EPS) reasons.push('선택지출 예산이 0보다 작아져요.');
      });
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  /**
   * 경보를 상태에 반영한다(같은 id는 한 번만, 사라진 경보는 '해소').
   * 생활비 초과 경보에는 수정안을 하나 만들어 연결한다. 이미 연결된 수정안이 있으면 새로 만들지 않는다.
   * @returns {{state, created:[alertId], resolved:[alertId], proposalsCreated:[id]}}
   */
  function syncAlerts(state, opts) {
    opts = opts || {};
    var s = clone(state);
    s.alerts = s.alerts || [];
    s.proposals = s.proposals || [];
    var todayStr = tracking.today(s, opts);
    var current = evaluateAlerts(s, opts);
    var ids = current.map(function (a) { return a.id; });
    var created = [];
    var resolved = [];
    var proposalsCreated = [];

    current.forEach(function (a) {
      var ex = s.alerts.filter(function (x) { return x.id === a.id; })[0];
      if (ex) {
        ex.message = a.message;
        ex.data = a.data;
        ex.severity = a.severity;
        if (ex.status === ALERT_STATUS.RESOLVED) {
          ex.status = ALERT_STATUS.NEW; // 해소됐다가 다시 생긴 경우
          ex.reopenedAt = todayStr;
        }
      } else {
        var entry = Object.assign({}, a, { status: ALERT_STATUS.NEW, createdAt: todayStr, proposalId: null });
        s.alerts.push(entry);
        created.push(a.id);
      }
    });
    s.alerts.forEach(function (x) {
      if (ids.indexOf(x.id) < 0 && x.status !== ALERT_STATUS.RESOLVED) {
        x.status = ALERT_STATUS.RESOLVED;
        x.resolvedAt = todayStr;
        resolved.push(x.id);
      }
    });

    // 수정안 연결: 경보 하나 ↔ 수정안 하나
    s.alerts.forEach(function (x) {
      if (x.type !== 'overspend' || x.proposalId) return;
      var linked = s.proposals.filter(function (p) { return p.alertId === x.id; })[0];
      if (!linked) {
        linked = buildOverspendRevision(s, x, opts);
        s.proposals.push(linked);
        proposalsCreated.push(linked.id);
      }
      var usedElsewhere = s.alerts.some(function (y) { return y !== x && y.proposalId === linked.id; });
      if (!usedElsewhere) x.proposalId = linked.id;
    });

    return { state: s, created: created, resolved: resolved, proposalsCreated: proposalsCreated };
  }

  function markRead(state, alertId) {
    var s = clone(state);
    (s.alerts || []).forEach(function (a) { if (a.id === alertId && a.status === ALERT_STATUS.NEW) a.status = ALERT_STATUS.READ; });
    return s;
  }

  /** 동의가 있으면 자동 적용 가능한 '확인 대기' 수정안을 적용한다. */
  function autoApplyPending(state) {
    var s = state;
    var applied = [];
    (state.proposals || []).forEach(function (p) {
      if (p.type !== '수정안' || p.status !== '확인 대기') return;
      if (!canAutoApply(s, p).ok) return;
      s = store.applyProposal(s, p.id, { who: '자동 적용(고객 동의)' }).state;
      applied.push(p.id);
    });
    return { state: s, applied: applied };
  }

  var api = {
    SEVERITY: SEVERITY,
    ALERT_STATUS: ALERT_STATUS,
    evaluateAlerts: evaluateAlerts,
    buildOverspendRevision: buildOverspendRevision,
    canAutoApply: canAutoApply,
    syncAlerts: syncAlerts,
    markRead: markRead,
    autoApplyPending: autoApplyPending
  };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.alerts = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
