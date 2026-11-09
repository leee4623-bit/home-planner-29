/*
 * 설계사 제안(A/B/C) 자동 작성과 정책상품 점검(명세 6-2 설계안·정책 조건·상품 비교).
 * A/B/C는 위험 등급이 아니라 서로 다른 실행 전략이다. 숫자는 확정 기록을 반영한 역산 결과.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var engine = isNode ? require('./engine.js') : root.Planner.engine;
  var solver = isNode ? require('./solver.js') : root.Planner.solver;
  var tracking = isNode ? require('./tracking.js') : root.Planner.tracking;
  var policy = isNode ? require('./policy.js') : root.Planner.policy;
  var policiesData = isNode ? require('../data/policies.js') : root.Planner.policies;
  var fmt = isNode ? require('./format.js') : root.Planner.format;

  var EPS = 1e-9;

  function findPlan(state, id) {
    return (state.plans || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  /**
   * 역산으로 A(생활비)·B(이사 시점)·C(목표 보증금) 제안을 만든다. 상태에 넣지는 않는다.
   * @returns {{ok, reason?, proposal?}}
   */
  function buildStrategyProposal(state, basePlanId, opts) {
    opts = opts || {};
    var plan = findPlan(state, basePlanId);
    if (!plan) return { ok: false, reason: '바탕 계획을 찾을 수 없어요.' };
    var today = tracking.today(state, opts);
    var from = dates.addMonths(today.slice(0, 7), 1);
    var eo = tracking.recordEngineOpts(state, basePlanId, 'plan');
    var base = engine.runPlan(state, basePlanId, eo);
    var j = base.judgement;
    if (j.status === '전체 목표 달성') return { ok: false, reason: '이미 전체 목표를 달성하는 계획이라 보완 제안이 필요 없어요.' };
    var housing = j.conditions.filter(function (c) { return c.key === 'housing'; })[0];
    var options = [];
    var skipped = [];

    var a = solver.solveLivingCut(state, basePlanId, { fromMonth: from, engineOpts: eo });
    if (a.feasible && a.cut > 0) {
      var cutA = Math.ceil(a.cut * 2) / 2; // 0.5만원 단위로 올림(고객이 기억하기 쉽게). 더 줄이므로 목표는 그대로 지켜진다
      var optCut = Math.min(cutA, Number(plan.optional) || 0);
      var essCut = cutA - optCut;
      options.push({
        key: 'A', name: '생활비 조정형',
        summary: from + '부터 생활비를 월 ' + fmt.short(cutA) + '만원 줄입니다(선택지출부터, 생활비 인상률 함께 적용). 이사월은 그대로 ' + plan.targetMonth + '.',
        planChanges: { budgetAdjustments: (plan.budgetAdjustments || []).concat([{ start: from, months: 0, optional: -optCut, essential: -essCut, grow: true, note: '생활비 조정형' }]) }
      });
    } else skipped.push('A(생활비): ' + (a.reason || '절감만으로는 맞출 수 없어요.'));

    var b = solver.solveDelay(state, basePlanId, { engineOpts: eo });
    if (b.feasible && b.delayMonths > 0) {
      options.push({
        key: 'B', name: '이사 시점 조정형',
        summary: '생활비는 그대로 두고 이사월을 ' + b.delayMonths + '개월 늦춥니다(' + plan.targetMonth + ' → ' + b.targetMonth + ').',
        planChanges: { targetMonth: b.targetMonth }
      });
    } else skipped.push('B(이사 시점): ' + (b.reason || '해당 없음'));

    var c = solver.solveLowerTarget(state, basePlanId, { engineOpts: eo });
    if (c.feasible && !c.alreadyMet) {
      var tgt = Math.floor(c.newDepositTarget / 10) * 10; // 10만원 단위로 내림
      options.push({
        key: 'C', name: '목표 보증금 조정형',
        summary: '생활비와 이사월은 그대로 두고 목표 보증금을 ' + fmt.short(c.current - tgt) + '만원 낮춥니다(' + fmt.short(c.current) + ' → ' + fmt.short(tgt) + ').',
        goalChanges: { depositTarget: tgt }
      });
    } else skipped.push('C(목표 보증금): ' + (c.reason || '해당 없음'));

    // 이름표를 A부터 다시 붙인다(빠진 안이 있어도 A·B·C 순서 유지)
    var keys = ['A', 'B', 'C'];
    options.forEach(function (o, i) { o.key = keys[i]; });
    if (!options.length) return { ok: false, reason: '세 전략 모두 만들 수 없어요. ' + skipped.join(' ') };

    return {
      ok: true,
      skipped: skipped,
      proposal: {
        id: 'abc-' + today + '-' + basePlanId + '-' + ((state.proposals || []).length + 1),
        type: '설계안',
        status: '작성 중',
        createdAt: today,
        basePlanId: basePlanId,
        author: '설계사',
        title: '주거 부족액 ' + fmt.short(housing.shortfall) + '만원 보완 — 세 가지 실행 전략',
        options: options,
        chosenKey: null
      }
    };
  }

  /**
   * 정책상품 넣었을 때·뺐을 때 비교와 점검(같은 돈이 두 번 배정되지 않는지 포함).
   */
  function policyCheck(state, planId) {
    var plan = findPlan(state, planId);
    var eo = tracking.recordEngineOpts(state, planId, 'plan');
    var withP = engine.runPlan(state, planId, eo);
    // 정책상품만 빼고 비교한다(은행 적금은 그대로 둠)
    var keepBank = (plan.products || []).filter(function (p) { return p.type === 'bank'; });
    var without = engine.runPlan(state, planId, Object.assign({}, eo, { planOverrides: Object.assign({}, eo.planOverrides, { products: keepBank }) }));
    var tm = withP.input.targetMonth;
    var rw = engine.rowAt(withP, tm);
    var ro = engine.rowAt(without, tm);
    var products = withP.input.products.filter(function (p) { return p.type !== 'bank'; });

    // 점검 1: 만기 전 상품 잔액은 사용 가능 주거자금에 들어가지 않는다
    var excluded = withP.rows.every(function (r) {
      var inv = withP.input.assumptions.includeInvestmentInHousing ? r.investment : 0;
      return Math.abs(r.usable - (r.housing + inv)) < 1e-6;
    });
    // 점검 2: 납입액만큼 그 달 잉여가 줄었다(다른 곳에 다시 배정되지 않음)
    var paidFromSurplus = withP.rows.every(function (r, i) {
      var o = without.rows[i];
      return !o || Math.abs((o.surplus - r.surplus) - r.productPay) < 1e-6;
    });
    // 점검 3: 만기 지급은 상품마다 한 번
    var maturityRows = withP.rows.filter(function (r) { return r.productMaturity > EPS; }).length;
    var maturityOnce = maturityRows <= products.length;

    var items = products.map(function (p) {
      var pol = policiesData.getPolicy(p.policyId);
      var elig = policy.checkEligibility(pol, state.customer, p.start);
      var maturity = dates.addMonths(p.start, p.months);
      var firstRow = engine.rowAt(withP, p.start);
      var surplusBefore = firstRow ? firstRow.surplus + firstRow.productPay : null;
      return {
        name: p.name,
        policy: pol,
        eligibility: elig,
        monthly: p.monthly,
        start: p.start,
        maturity: maturity,
        beforeMove: dates.parseYM(maturity) <= dates.parseYM(tm),
        burden: surplusBefore > EPS ? p.monthly / surplusBefore : null,
        conditional: p.conditional,
        expectedPayout: p.monthly * p.months * (1 + p.contributionRate)
      };
    });

    return {
      planId: planId,
      targetMonth: tm,
      with: { usable: rw ? rw.usable : null, judgement: withP.judgement },
      without: { usable: ro ? ro.usable : null, judgement: without.judgement },
      diff: rw && ro ? rw.usable - ro.usable : null,
      items: items,
      checks: [
        { label: '만기 전 상품 잔액은 이사 자금(사용 가능 주거자금)에 넣지 않음', ok: excluded },
        { label: '납입액만큼 그 달 잉여에서 빠짐(다른 곳에 다시 배정되지 않음)', ok: paidFromSurplus },
        { label: '만기 지급은 상품마다 한 번만 주거자금으로 옮김', ok: maturityOnce }
      ]
    };
  }

  /**
   * 정책형 저축상품 비교: 같은 월 납입액, 다음 달 가입 가정. 은행 이자는 확인 전이라 0%.
   */
  function compareSavings(state, planId, monthly, opts) {
    opts = opts || {};
    var plan = findPlan(state, planId);
    var today = tracking.today(state, opts);
    var start = opts.start || dates.addMonths(today.slice(0, 7), 1);
    var res = engine.runPlan(state, planId, tracking.recordEngineOpts(state, planId, 'plan'));
    var highLeft = res.rows.length ? engine.rowAt(res, start) : null;
    return policiesData.POLICIES.filter(function (p) { return p.kind === 'saving'; }).map(function (pol) {
      var e = policy.checkEligibility(pol, state.customer, start);
      var m = monthly;
      if (pol.monthlyMax) m = Math.min(m, pol.monthlyMax);
      if (pol.monthlyMin) m = Math.max(m, pol.monthlyMin);
      var rate = e.status === policy.STATUS.NO ? 0 : e.contributionRate;
      var maturity = dates.addMonths(start, pol.termMonths);
      return {
        id: pol.id,
        name: pol.name,
        eligibility: e,
        monthly: m,
        months: pol.termMonths,
        contributionRate: rate,
        principal: m * pol.termMonths,
        payout: m * pol.termMonths * (1 + rate),
        tax: pol.taxFree ? '비과세' : '확인 필요',
        maturity: maturity,
        targetFunding: dates.parseYM(maturity) <= dates.parseYM(plan.targetMonth),
        highDebtLeft: highLeft ? highLeft.debtHigh : 0,
        checkedAt: pol.checkedAt,
        status: pol.status
      };
    });
  }

  var api = { buildStrategyProposal: buildStrategyProposal, policyCheck: policyCheck, compareSavings: compareSavings };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.proposals = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
