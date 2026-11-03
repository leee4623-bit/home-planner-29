/*
 * 월별 실제 지출 비교 · 자동 재계산 · 수정안 · 알림 후보
 * ------------------------------------------------------------
 * 원칙
 *  - 월중(마감 전)에는 확정 지출 + 미확인 거래 + 예정 결제를 더해 ‘잠정 결과’로만 표시. 마감(월말 정산·고객 확인) 후 ‘확정’.
 *  - 계산 엔진에 들어가는 지출 실적은 ‘확정된 달’의 지출 기록뿐(잠정 지출을 실적으로 쓰지 않음).
 *  - 덜 쓴 돈은 바로 저축 가능액으로 보지 않음: 확정 후에도 ‘여유자금 후보’로 두고 고객이 잔액을 확인해야 배분.
 *  - 이번 달 절약이 다음 달에도 반복된다고 가정하지 않음(수정안은 한 번 배분).
 *  - 자동 재계산은 숫자만 다시 계산할 뿐, 기준 계획을 바꾸지 않음. 기준 계획 변경은 수정안 → 고객 확인(또는 동의한 범위의 자동 적용).
 */
(function (root) {
  'use strict';
  var FP = root.FP || {};
  var C = FP.Calc || require('./calc.js');
  var A = FP.Analysis || require('./analysis.js');
  var EPS = 0.5;
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function man(w) { return Math.round(Math.abs(w) / 10000).toLocaleString('ko-KR') + '만원'; }
  var EXP = /^expense(:essential|:optional)?$/;

  function ymOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  // 확정된 달의 지출만 남기고, 저축·상환 기록은 그대로(실제 납입)
  function finalRecords(records, closed) {
    return (records || []).filter(function (r) { return !r.voidedAt && (!EXP.test(r.category) || closed.indexOf(r.month) >= 0); }).map(function (r) { return Object.assign({ status: 'confirmed' }, r); });
  }

  // 미확인 거래 중 지출로 보이는 것(본인 계좌 간 이체·상환·저축 납입 후보는 제외 → 중복 집계 방지)
  function pendingSpend(txs, month) {
    return (txs || []).filter(function (t) {
      if (t.confirmedAt || t.date.slice(0, 7) !== month || t.amount >= 0) return false;
      var s = t.suggested || {};
      return s.kind === 'spend' || s.kind === 'unknown';
    }).reduce(function (a, t) { return a + Math.abs(t.amount); }, 0);
  }

  /*
   * table(ctx) — 월별·항목별 계획 vs 실제
   * ctx: { data, records, txs, scheduled, closed:[ym], today }
   */
  function table(ctx) {
    var d = C.normalize(ctx.data), base = d.basis.baseMonth, plan = C.simulate(d);
    var curYm = ymOf(ctx.today || new Date()), c = Math.max(1, C.ymDiff(base, curYm));
    var rows = [];
    for (var t = 1; t <= Math.min(c, plan.T); t++) {
      var ym = C.ymAdd(base, t), pr = plan.rows[t];
      var recs = (ctx.records || []).filter(function (r) { return !r.voidedAt && r.month === ym && EXP.test(r.category); });
      var ess = recs.filter(function (r) { return r.category === 'expense:essential'; }).reduce(function (a, r) { return a + num(r.amount); }, 0);
      var opt = recs.filter(function (r) { return r.category === 'expense:optional'; }).reduce(function (a, r) { return a + num(r.amount); }, 0);
      var unspec = recs.filter(function (r) { return r.category === 'expense'; }).reduce(function (a, r) { return a + num(r.amount); }, 0);
      var hasRec = recs.length > 0;
      var closed = (ctx.closed || []).indexOf(ym) >= 0;
      var sch = (ctx.scheduled || []).filter(function (s) { return s.month === ym && !s.paid; });
      var schSum = sch.reduce(function (a, s) { return a + num(s.amount); }, 0);
      // 미확인 거래 중 예정 결제(카드대금 등)와 금액이 같은 건은 한 번만 셈
      var schAmts = sch.map(function (x) { return num(x.amount); });
      var pend = (ctx.txs || []).filter(function (tx) {
        if (tx.confirmedAt || tx.date.slice(0, 7) !== ym || tx.amount >= 0) return false;
        var sg = tx.suggested || {}; if (sg.kind !== 'spend' && sg.kind !== 'unknown') return false;
        var i = schAmts.indexOf(Math.abs(tx.amount)); if (i >= 0) { schAmts.splice(i, 1); return false; }
        return true;
      }).reduce(function (a, tx) { return a + Math.abs(tx.amount); }, 0);
      var confirmed = ess + opt + unspec;
      var planned = pr.essential + pr.optional;
      var projected = closed ? confirmed : confirmed + pend + schSum;
      rows.push({
        t: t, ym: ym, status: closed ? 'final' : (hasRec || pend || schSum ? 'provisional' : 'none'), closed: closed,
        planned: { essential: pr.essential, optional: pr.optional, total: planned },
        actual: { essential: ess, optional: opt, unspecified: unspec, total: confirmed },
        pendingTx: closed ? 0 : pend, scheduledUnpaid: closed ? 0 : schSum, scheduled: sch,
        projected: hasRec || pend || schSum ? projected : null,
        diff: hasRec || pend || schSum ? projected - planned : null
      });
    }
    return { base: base, c: c, curYm: curYm, rows: rows, plan: plan };
  }

  function minSearch(test, hi) {
    if (test(0)) return 0;
    if (!test(hi)) return null;
    var lo = 0;
    for (var k = 0; k < 36; k++) { var mid = (lo + hi) / 2; if (test(mid)) hi = mid; else lo = mid; }
    var x = Math.ceil(hi / 10000) * 10000;
    while (!test(x)) x += 10000;
    return x;
  }

  /*
   * recalc(ctx) — 현재 잔액(실적 반영)과 남은 기간 기준 재계산. 기준 계획은 바꾸지 않음.
   * ctx: table ctx + { consent:{ floor } }
   */
  function recalc(ctx) {
    var d = C.normalize(ctx.data), base = d.basis.baseMonth;
    var closed = (ctx.closed || []).slice().sort();
    var actuals = A.actualsFrom(d, finalRecords(ctx.records, closed));
    var plan = C.simulate(d), fc = C.simulate(d, { actuals: actuals });
    var curYm = ymOf(ctx.today || new Date()), c = Math.max(1, C.ymDiff(base, curYm));
    var closedTo = closed.length ? Math.max.apply(null, closed.map(function (m) { return C.ymDiff(base, m); })) : 0;
    var start = Math.max(c, closedTo + 1);                // 다음 조정 적용 월(아직 마감되지 않은 첫 달 이후)
    if (closedTo >= c) start = closedTo + 1;
    var remaining = Math.max(0, fc.T - start + 1);
    var floor = Math.max(num(ctx.consent && ctx.consent.floor), num(d.expenses.minEssential));
    var maxCut = Math.max(0, num(d.expenses.optional) + Math.max(0, num(d.expenses.essential) - floor));
    var ok = function (o) { return C.simulate(d, Object.assign({ actuals: actuals }, o)).status === 'achieved'; };
    var neededExtra = remaining > 0 ? minSearch(function (x) { return ok({ extraIncome: { amount: x, start: start } }); }, 5000000) : (fc.status === 'achieved' ? 0 : null);
    var requiredCut = remaining > 0 ? minSearch(function (x) { return ok({ cut: { amount: x, start: start } }); }, maxCut) : (fc.status === 'achieved' ? 0 : null);
    var saving = function (res) { var s = 0, n = 0; for (var t = start; t <= res.T; t++) { var r = res.rows[t]; s += Math.max(0, r.emergencyIn) + Math.max(0, r.housingIn - r.depositIn - r.productPayout) + r.productContrib; n++; } return n ? s / n : 0; };
    var plannedSaving = saving(fc);
    var budgetNow = start <= fc.T ? fc.rows[start].essential + fc.rows[start].optional : fc.rows[fc.T].essential + fc.rows[fc.T].optional;
    var lastFinal = closedTo >= 1 ? fc.rows[closedTo] : null;
    // 목표 시점을 늦출 때(같은 계획 유지)
    var firstOk = fc.firstAchieved;
    var target = num(d.goals.housingTarget), moving = num(d.goals.movingCost);
    return {
      base: base, start: start, startYm: C.ymAdd(base, start), remaining: remaining, closedTo: closedTo, closedYm: closedTo ? C.ymAdd(base, closedTo) : null,
      plan: { gap: plan.gap, status: plan.status, debtFree: plan.debtFree, emergencyAtTarget: plan.at.emergencyBal },
      forecast: { gap: fc.gap, status: fc.status, debtFree: fc.debtFree, emergencyAtTarget: fc.at.emergencyBal, usable: fc.at.usableHousing, res: fc },
      neededExtra: neededExtra, neededTotal: neededExtra === null ? null : neededExtra * remaining,
      plannedMonthlySaving: plannedSaving, neededMonthlySaving: neededExtra === null ? null : plannedSaving + neededExtra,
      budgetNow: budgetNow, requiredCut: requiredCut, maxCut: maxCut, floor: floor,
      recommendedBudget: requiredCut === null ? null : budgetNow - requiredCut,
      cutOnlyFeasible: requiredCut !== null,
      lastFinal: lastFinal ? { ym: lastFinal.ym, overspend: lastFinal.overspend, slack: lastFinal.slack, actualExpense: lastFinal.actualExpense, planned: lastFinal.essential + lastFinal.optional } : null,
      alternatives: {
        extendTo: firstOk === null ? null : C.ymAdd(base, firstOk), extendBy: firstOk === null ? null : firstOk - fc.T,
        targetFit: Math.max(0, Math.floor((fc.at.usableHousing - moving) / 10000) * 10000), targetCut: Math.max(0, target - Math.max(0, Math.floor((fc.at.usableHousing - moving) / 10000) * 10000)),
        extraIncome: neededExtra
      },
      actuals: actuals
    };
  }

  /*
   * proposal(ctx, rc, kind) — 수정안(기준 계획 후보). 적용 전까지 기준 계획은 그대로.
   * kind: 'overspend' | 'goalFlip' → 생활비 예산 조정(필수생활비 하한 준수)
   *       'surplus' → 확인된 여유자금을 사전 순서(비상금→부채→주거)로 한 번 배분
   */
  function proposal(ctx, rc, kind) {
    var d = clone(C.normalize(ctx.data)), base = d.basis.baseMonth, consent = ctx.consent || {};
    var out = { kind: kind, startYm: rc.startYm, month: rc.closedYm, changes: [], data: null, applicable: false, autoEligible: false, alternatives: rc.alternatives };
    if (kind === 'surplus') {
      var amt = rc.lastFinal ? Math.floor(rc.lastFinal.slack / 10000) * 10000 : 0;
      if (amt <= 0) return out;
      d.extraIncome = (d.extraIncome || []).concat([{ id: 's-' + rc.closedYm, month: rc.startYm, amount: amt, kind: 'surplus', status: 'confirmed', note: rc.closedYm + ' 확정 지출 후 남은 돈(고객 잔액 확인 후)' }]);
      out.amount = amt; out.data = d; out.applicable = true; out.needsBalanceCheck = true;
      out.changes.push(rc.closedYm + '에 덜 쓴 ' + man(amt) + '을 ' + rc.startYm + '에 ' + orderText(d.allocation) + ' 순서로 한 번 배분(다음 달에도 절약이 반복된다고 가정하지 않음)');
    } else {
      if (rc.requiredCut === null) { out.infeasible = true; out.changes.push('생활비 절감만으로는 목표를 지킬 수 없습니다(절감 가능 최대 월 ' + man(rc.maxCut) + ').'); return out; }
      if (rc.requiredCut === 0) { out.changes.push('예산을 바꾸지 않아도 목표를 충족합니다.'); return out; }
      d.plan.cuts = (d.plan.cuts || []).concat([{ amount: rc.requiredCut, startMonth: rc.startYm, note: (kind === 'overspend' ? rc.closedYm + ' 초과 지출 보완' : '목표 미달 보완') }]);
      out.amount = rc.requiredCut; out.data = d; out.applicable = true;
      var fromOpt = Math.min(rc.requiredCut, num(ctx.data.expenses.optional));
      var essAfter = num(ctx.data.expenses.essential) - (rc.requiredCut - fromOpt);
      out.changes.push(rc.startYm + '부터 월 생활비 예산 ' + man(rc.requiredCut) + ' 줄이기(선택 지출 ' + man(fromOpt) + (rc.requiredCut > fromOpt ? ', 필수생활비 ' + man(rc.requiredCut - fromOpt) : '') + ') → 월 ' + man(rc.recommendedBudget));
      out.changes.push('절감한 돈은 부채가 남아 있으면 추가 상환, 다 갚으면 저축으로');
      out.essentialAfter = essAfter;
      out.autoEligible = !!consent.enabled && rc.requiredCut <= num(consent.monthlyLimit) && essAfter + EPS >= Math.max(num(consent.floor), num(ctx.data.expenses.minEssential));
    }
    // 수정 전후(같은 실적 기준)
    var fin = A.actualsFrom(d, finalRecords(ctx.records, ctx.closed || []));
    var before = rc.forecast.res, after = C.simulate(d, { actuals: fin });
    var s = Math.min(rc.start, after.T);
    out.compare = {
      before: { gap: before.gap, status: before.status, debtFree: before.debtFree, budget: before.rows[s].essential + before.rows[s].optional, emergency: before.at.emergencyBal },
      after: { gap: after.gap, status: after.status, debtFree: after.debtFree, budget: after.rows[s].essential + after.rows[s].optional, emergency: after.at.emergencyBal }
    };
    return out;
  }
  function orderText(al) { var m = { emergency: '비상금 보충', debt: '부채 추가 상환', housing: '주거저축' }; return ((al && al.order) || ['emergency', 'debt', 'housing']).map(function (k) { return m[k]; }).join(' → '); }

  /*
   * notices(ctx, rc, ex, prevStatus) — 알림 후보(발생 사실 → 목표 영향 → 제안 행동). 금액은 계산 결과만 사용.
   * key가 같으면 같은 상황(중복 방지).
   */
  function notices(ctx, rc, ex, prev) {
    var out = [], s = ctx.alertSettings || {}, tol = num(s.budgetTolerancePct);
    var lf = rc.lastFinal;
    if (lf && lf.overspend > lf.planned * tol / 100 + EPS) {
      var imp, act;
      if (rc.requiredCut === null) { imp = '생활비 절감만으로는 목표일을 지키기 어렵습니다. 월 ' + (rc.neededExtra === null ? '추가 확보' : man(rc.neededExtra) + ' 추가 확보') + ', 목표일·목표금액 조정 같은 대안이 필요합니다.'; act = '대안을 확인하고 설계사와 상의해 주세요.'; }
      else if (rc.requiredCut > 0) { imp = '목표일을 유지하려면 남은 ' + rc.remaining + '개월 동안 월 생활비를 ' + man(rc.requiredCut) + ' 줄여 그만큼 상환·저축을 늘리는 수정안이 필요합니다.'; act = '변경 내용을 확인해 주세요.'; }
      else { imp = '아직 목표일 충족에는 영향이 없습니다.'; act = '다음 달 예산을 지켜 주세요.'; }
      out.push({ type: 'overspend', key: 'overspend:' + lf.ym, month: lf.ym, fact: lf.ym + ' 지출이 계획보다 ' + man(lf.overspend) + ' 많았습니다.', impact: imp, action: act, amounts: { overspend: lf.overspend, requiredCut: rc.requiredCut, neededExtra: rc.neededExtra, remaining: rc.remaining } });
    }
    if (ex) ex.items.forEach(function (it) {
      if (it.state === 'short' && /^(emergency|housing|product:)/.test(it.id)) out.push({ type: 'savingShort', key: 'savingShort:' + ex.ym + ':' + it.id, month: ex.ym, fact: ex.ym + ' ' + it.label + '이 예정일이 지났는데 계획보다 ' + man(it.planned - it.actual) + ' 적습니다.', impact: '이대로면 목표일 주거자금은 ' + (ex.forecastPlan.gap >= 0 ? man(ex.forecastPlan.gap) + ' 여유' : man(ex.forecastPlan.gap) + ' 부족') + '입니다.', action: '부족분을 이번 달 안에 납입하거나 다음 달 계획을 조정해 주세요.', amounts: { short: it.planned - it.actual, gap: ex.forecastPlan.gap } });
    });
    if (ex) {
      var r = ex.forecastPlan.rows[Math.min(ex.c, ex.forecastPlan.rows.length - 1)], minM = num(ex.settings.emergencyMinMonths);
      if (r && r.essential > 0 && r.emergencyBal < r.essential * minM - EPS) out.push({ type: 'emergencyLow', key: 'emergencyLow:' + ex.ym, month: ex.ym, fact: '비상금이 ' + man(r.emergencyBal) + '으로 최소 기준(필수생활비 ' + minM + '개월, ' + man(r.essential * minM) + ')보다 적습니다.', impact: '갑자기 지출이 생기면 주거자금을 꺼내 써야 할 수 있습니다.', action: '다음 잉여자금은 비상금부터 채워 주세요.', amounts: { emergency: r.emergencyBal, min: r.essential * minM } });
    }
    if (prev && prev === 'achieved' && rc.forecast.status !== 'achieved') out.push({ type: 'goalFlip', key: 'goalFlip:' + (rc.closedYm || rc.startYm), month: rc.closedYm, fact: '새 실적을 반영하니 목표 판정이 ‘전체 목표 달성’에서 ‘' + (rc.forecast.status === 'partial' ? '부분 충족' : '미달') + '’로 바뀌었습니다.', impact: '목표일 주거자금은 ' + (rc.forecast.gap >= 0 ? man(rc.forecast.gap) + ' 여유' : man(rc.forecast.gap) + ' 부족') + '으로 예상됩니다.', action: '수정안을 확인하거나 설계사에게 문의해 주세요.', amounts: { gap: rc.forecast.gap } });
    if (lf && lf.slack >= 10000) out.push({ type: 'surplus', key: 'surplus:' + lf.ym, month: lf.ym, fact: lf.ym + ' 확정 지출이 예산보다 ' + man(lf.slack) + ' 적었습니다.', impact: '실제로 통장에 남아 있다면 ' + orderText(ctx.data.allocation) + ' 순서로 배분해 목표에 보탤 수 있습니다(저축 가능액으로 자동 확정하지 않음).', action: '잔액을 확인한 뒤 배분 수정안을 검토해 주세요.', amounts: { slack: lf.slack } });
    return out;
  }
  function revisionNotice(rev) {
    var cmp = rev.compare;
    return { type: 'revision', key: 'revision:' + rev.id, month: rev.month, fact: '새 수정안이 만들어졌습니다(' + ({ overspend: '초과 지출 보완', goalFlip: '목표 미달 보완', surplus: '여유자금 배분' }[rev.kind] || rev.kind) + ').', impact: cmp ? '적용하면 목표일 주거자금 예상이 ‘' + (cmp.before.gap >= 0 ? man(cmp.before.gap) + ' 여유' : man(cmp.before.gap) + ' 부족') + '’에서 ‘' + (cmp.after.gap >= 0 ? man(cmp.after.gap) + ' 여유' : man(cmp.after.gap) + ' 부족') + '’로 바뀝니다.' : '', action: rev.status === 'auto' ? '동의한 범위 안에서 앱 예산에 자동 적용했습니다. 실제 계좌이체는 바뀌지 않습니다.' : '수정 전후를 비교하고 적용 또는 보류를 선택해 주세요.', amounts: cmp ? { before: cmp.before.gap, after: cmp.after.gap } : {} };
  }

  // 방해금지 시간 안인지 ('22:00'~'08:00')
  function inQuiet(qs, qe, date) {
    if (!qs || !qe) return false;
    var m = date.getHours() * 60 + date.getMinutes(), p = function (s) { var a = String(s).split(':'); return Number(a[0]) * 60 + Number(a[1] || 0); };
    var a = p(qs), b = p(qe);
    return a <= b ? (m >= a && m < b) : (m >= a || m < b);
  }

  var Monthly = { table: table, recalc: recalc, proposal: proposal, notices: notices, revisionNotice: revisionNotice, finalRecords: finalRecords, pendingSpend: pendingSpend, inQuiet: inQuiet, ymOf: ymOf, orderText: orderText };
  if (typeof module !== 'undefined' && module.exports) module.exports = Monthly;
  else { root.FP = root.FP || {}; root.FP.Monthly = Monthly; }
})(this);
