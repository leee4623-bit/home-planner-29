/*
 * A/B/C 재무설계안 — 위험성향 등급이 아니라 서로 다른 실행 전략
 * ------------------------------------------------------------
 * 원칙
 *  - 세 안 모두 같은 기준 계획의 기준월·초기 자산·부채·소득·금리 가정에서 출발(비교 공정성).
 *  - 새로 모으는 주거 핵심자금은 세 안 모두 원금 보전형(투자 비율 0%). 성향이 높아도 자동으로 위험을 늘리지 않음.
 *  - 목표 부족액을 메우려고 기대수익률을 올리지 않음(금리 가정은 기준 계획 그대로).
 *  - 확률 수치(‘달성 확률 90%’ 등)는 만들지 않음. 대신 ‘불리한 상황’ 결과를 같은 계산 엔진으로 보여줌.
 *  - 목표를 충족하지 못하는 안은 그대로 ‘미충족’으로 표시.
 */
(function (root) {
  'use strict';
  var FP = root.FP || {};
  var C = FP.Calc || require('./calc.js');
  var A = FP.Analysis || require('./analysis.js');
  var P = FP.Policies || require('../data/policies.js');
  var CFG = FP.RiskConfig || require('../data/riskConfig.js');
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function r10k(x) { return Math.max(0, Math.floor(x / 10000) * 10000); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  // 같은 초기 조건을 유지하는지 확인할 항목
  var FIXED = ['basis.baseMonth', 'assets', 'debts', 'income', 'rates', 'goals.emergencyTarget', 'goals.movingCost', 'taxRelief'];
  function pick(o, path) { return path.split('.').reduce(function (a, k) { return a === undefined ? undefined : a[k]; }, o); }
  function sameStart(a, b) { return FIXED.every(function (p) { return JSON.stringify(pick(a, p)) === JSON.stringify(pick(b, p)); }); }

  function freeCash(d) {
    var sched = d.debts.reduce(function (s, x) { return s + (x.balance > 0 ? num(x.payment) : 0); }, 0);
    return num(d.income.netMonthly) - num(d.expenses.essential) - num(d.expenses.optional) - sched;
  }

  // 기본 매개변수(설계사가 바꿀 수 있음)
  function defaults(base, risk, profile) {
    var d = C.normalize(base), free = freeCash(d), baseRes = C.simulate(d);
    var startYm = C.ymAdd(d.basis.baseMonth, 1);
    var emOkYm = baseRes.emergencyOkMonth ? C.ymAdd(d.basis.baseMonth, baseRes.emergencyOkMonth + 1) : startYm;
    // B: 감당 가능한 절감 = 선택 지출의 35%까지(1만원 단위), 필수생활비는 그대로
    var affordable = r10k(num(d.expenses.optional) * 0.35);
    var yf = youthFutureOffer(d, profile, free);
    return {
      A: { optionalCut: 0, essentialCut: 0, extraRepayment: r10k(Math.max(0, free) * 0.8), extraRepaymentStart: emOkYm, product: null, moveMonth: d.basis.moveMonth, freedTo: 'otherDebt' },
      B: { optionalCut: affordable, essentialCut: 0, extraRepayment: r10k(Math.max(0, free + affordable - (yf ? yf.monthly : 0)) * 0.4), extraRepaymentStart: startYm, product: yf, moveMonth: d.basis.moveMonth, freedTo: 'savings' },
      C: null // C는 B를 바탕으로 조건 조정 — build에서 계산
    };
  }

  // 청년미래적금: 확인된 조건만으로 제안 가능 여부 판단(만기 ≤ 이사월, 연령, 일반형 소득)
  function youthFutureOffer(d, profile, free) {
    var pol = P.get('youthFuture'); if (!pol) return null;
    var existing = (d.products || []).filter(function (p) { return p.policyId === 'youthFuture'; })[0];
    var start = existing ? existing.startMonth : '2026-12'; // 2차 모집(잠정) — 확인 필요로 표시
    if (C.ymDiff(start, d.basis.baseMonth) > 0) start = C.ymAdd(d.basis.baseMonth, 1);
    var mat = C.ymAdd(start, 36);
    var age = profile && profile.birthMonth ? Math.floor(C.ymDiff(profile.birthMonth, start) / 12) : null;
    var grossOk = profile && num(profile.annualGross) > 0 && num(profile.annualGross) <= 60000000;
    if (age === null || age > 34 || age < 19 || !grossOk) return null;
    var monthly = existing ? existing.monthly : Math.min(500000, r10k(Math.max(0, free) * 0.5), 300000);
    if (monthly <= 0) return null;
    return { policyId: 'youthFuture', name: '청년미래적금(일반형)', startMonth: start, termMonths: 36, monthly: monthly, govRate: 0.06, govConfirmed: true, maturity: mat };
  }

  function apply(base, p, key) {
    var d = clone(base);
    d.expenses.optional = Math.max(0, num(d.expenses.optional) - num(p.optionalCut));
    d.expenses.essential = Math.max(num(d.expenses.minEssential), num(d.expenses.essential) - num(p.essentialCut));
    d.plan = d.plan || {};
    d.plan.extraRepayment = num(p.extraRepayment);
    d.plan.extraRepaymentStart = p.extraRepaymentStart || null;
    d.plan.freedTo = p.freedTo || 'savings';
    d.plan.investShare = 0; // 주거 핵심자금은 원금 보전형만
    delete d.plan.cut;
    d.products = (d.products || []).filter(function (x) { return x.policyId !== 'youthFuture'; });
    if (p.product && C.ymDiff(C.ymAdd(p.product.startMonth, p.product.termMonths), p.moveMonth || d.basis.moveMonth) >= 0) {
      d.products.push({ id: 'p-' + key, policyId: p.product.policyId, name: p.product.name, enabled: true, startMonth: p.product.startMonth, termMonths: p.product.termMonths, monthly: num(p.product.monthly), govRate: p.product.govRate, govConfirmed: !!p.product.govConfirmed, companyRate: 0, companyConfirmed: false, interestRate: 0, taxFree: true, paidSoFar: 0, note: '은행 금리 확인 전 0% 가정' });
    }
    if (p.moveMonth) d.basis.moveMonth = p.moveMonth;
    return d;
  }

  function card(key, title, summary, d, base, p, risk) {
    var res = C.simulate(d), v = A.verdict(res);
    var adv = C.simulate(d, { shocks: CFG.ADVERSE });
    var em = 0, hs = 0, pc = 0, n = Math.min(12, res.T);
    for (var t = 1; t <= n; t++) { var r = res.rows[t]; em += Math.max(0, r.emergencyIn); hs += Math.max(0, r.housingIn - r.depositIn - r.productPayout); pc += r.productContrib; }
    var acts = actions(base, d, p);
    // 카드에는 핵심 조건만 짧게(전체 조건·출처는 ‘정책·상품’ 탭)
    var KEY = { youthFuture: { ok: [['term', '만기 3년'], ['govRateGeneral', '정부기여 납입액의 6%(일반형)'], ['monthlyLimit', '월 50만원 한도'], ['taxFree', '이자 비과세']], check: [['recruitNext', '2차 모집 일정'], ['bankRate', '은행 금리'], ['earlyTermination', '중도해지 조건']] },
                smeSaving: { ok: [['term', '만기 5년'], ['companyRate', '기업기여 20%']], check: [['companyJoin', '기업 참여'], ['earlyTermination', '중도해지 조건']] } };
    var pols = (d.products || []).map(function (x) {
      var pol = P.get(x.policyId), f = pol ? pol.fields : {}, k = KEY[x.policyId] || { ok: [], check: [] };
      return { name: x.name, monthly: x.monthly, start: x.startMonth, maturity: C.ymAdd(x.startMonth, x.termMonths),
        confirmed: k.ok.filter(function (e) { return f[e[0]] && f[e[0]].status === 'confirmed'; }).map(function (e) { return e[1]; }),
        needsCheck: k.check.filter(function (e) { return !f[e[0]] || f[e[0]].status !== 'confirmed'; }).map(function (e) { return e[1]; }) };
    });
    return {
      key: key, title: title, summary: summary, params: p, data: d,
      budget: res.rows[1].essential + res.rows[1].optional, debtPayment: res.rows[1].debtPaid,
      monthlyEmergency: em / n, monthlyHousing: hs / n, monthlyProducts: pc / n,
      policies: pols, usable: res.at.usableHousing, target: res.targetTotal, gap: res.gap, status: res.status, verdict: v,
      debtFree: res.debtFree, moveMonth: d.basis.moveMonth, firstAchieved: res.firstAchieved,
      adverse: { label: CFG.ADVERSE_LABEL, gap: adv.gap, status: adv.status, unfunded: adv.unfunded, emergencyMin: Math.min.apply(null, adv.rows.slice(1, adv.T + 1).map(function (r) { return r.emergencyBal; })) },
      actions: acts, warnings: res.warnings
    };
  }

  function actions(base, d, p) {
    var out = [];
    var oc = num(base.expenses.optional) - num(d.expenses.optional), ec = num(base.expenses.essential) - num(d.expenses.essential);
    if (oc > 0) out.push('선택 지출을 월 ' + Math.round(oc / 10000) + '만원 줄이기');
    if (ec > 0) out.push('필수생활비를 월 ' + Math.round(ec / 10000) + '만원 줄이기');
    if (num(d.plan.extraRepayment) > 0) out.push('월 ' + Math.round(d.plan.extraRepayment / 10000) + '만원을 이자율 높은 대출에 추가 상환' + (d.plan.extraRepaymentStart && d.plan.extraRepaymentStart !== C.ymAdd(base.basis.baseMonth, 1) ? '(' + d.plan.extraRepaymentStart + '부터, 비상금 확보 후)' : ''));
    (d.products || []).forEach(function (x) { if (!(base.products || []).some(function (y) { return y.policyId === x.policyId && y.monthly === x.monthly; })) out.push(x.name + ' ' + x.startMonth + ' 가입, 월 ' + Math.round(x.monthly / 10000) + '만원 납입'); });
    if (d.basis.moveMonth !== base.basis.moveMonth) out.push('이사 예정월을 ' + base.basis.moveMonth + ' → ' + d.basis.moveMonth + '로 변경(별도 확인 필요)');
    if (num(d.goals.housingTarget) !== num(base.goals.housingTarget)) out.push('목표 보증금을 ' + Math.round(base.goals.housingTarget / 10000) + '만원 → ' + Math.round(d.goals.housingTarget / 10000) + '만원으로 조정(별도 확인 필요)');
    if (!out.length) out.push('현재 계획 그대로 실행');
    return out;
  }

  /*
   * build(base, risk, profile, overrides)
   * risk: { typeId, type, status, flags, source } | null
   * overrides: { A:{...}, B:{...}, C:{...} } — 설계사 수정값
   */
  function build(base, risk, profile, overrides) {
    base = C.normalize(base); overrides = overrides || {};
    var def = defaults(base, risk, profile);
    var pA = Object.assign({}, def.A, overrides.A || {}), pB = Object.assign({}, def.B, overrides.B || {});
    var dA = apply(base, pA, 'A'), dB = apply(base, pB, 'B');
    // C: 생활비는 줄이지 않고(B의 상환·정책 구조 유지) 목표일·목표금액 등 ‘조건’을 조정해 달성 가능성을 비교
    var free = freeCash(base);
    var pC0 = Object.assign({}, pB, { optionalCut: 0, essentialCut: 0, extraRepayment: r10k(Math.max(0, free - (pB.product ? pB.product.monthly : 0)) * 0.4), moveMonth: base.basis.moveMonth }, overrides.C || {});
    var rC0 = C.simulate(apply(base, pC0, 'C')), cMove = pC0.moveMonth, cNote;
    if (overrides.C && overrides.C.moveMonth) cNote = '설계사가 정한 목표일 ' + cMove + ' 기준';
    else if (rC0.status === 'achieved') cNote = '생활비를 줄이지 않아도 현재 목표일에 충족';
    else if (rC0.firstAchieved !== null) { cMove = C.ymAdd(base.basis.baseMonth, rC0.firstAchieved); cNote = '생활비를 줄이지 않는 대신 세 조건을 처음 충족하는 ' + cMove + '로 목표일 조정'; }
    else cNote = '목표일 조정만으로는 10년 안에 충족하지 못해 목표금액·추가 소득 조정이 필요';
    var pC = Object.assign({}, pC0, { moveMonth: cMove });
    if (pC.product && C.ymDiff(C.ymAdd(pC.product.startMonth, pC.product.termMonths), pC.moveMonth) < 0) pC.product = null;
    var dC = apply(base, pC, 'C');
    var alt = A.alternatives(apply(base, pC0, 'C0'), [], 1);
    var confirmedExtra = (base.extraIncome || []).filter(function (x) { return x.status === 'confirmed'; });
    var expectedExtra = (base.extraIncome || []).filter(function (x) { return x.status !== 'confirmed'; });

    var riskId = risk && risk.typeId ? risk.typeId : 1;
    var cards = [
      card('A', 'A안 · 안정성과 부채 상환 우선', '비상금을 먼저 채운 뒤 남는 돈을 대출 상환에 집중하고, 상환이 끝나면 그 돈을 모두 주거자금으로 모읍니다. 정책상품은 넣지 않아 현금 유동성이 가장 높습니다.', dA, base, pA, risk),
      card('B', 'B안 · 목표 저축과 생활 유지의 균형', '선택 지출을 감당 가능한 범위에서 줄이고, 상환과 저축을 나눕니다. 이사 전에 만기가 오는 정책상품만 넣습니다.', dB, base, pB, risk),
      card('C', 'C안 · 조건 조정으로 달성 가능성 개선', cNote + '. 위험자산은 주거 핵심자금과 분리된 여유자금이 있을 때만 검토합니다.', dC, base, pC, risk)
    ];
    var cC = cards[2];
    cC.compare = {
      targetFit: alt.targetFit, targetCut: alt.targetCut, extraIncome: alt.extraIncome,
      confirmedExtra: confirmedExtra.length, expectedExtra: expectedExtra.reduce(function (s, x) { return s + num(x.amount); }, 0),
      riskNote: riskId >= 3 && risk && risk.status === 'ok' && cC.gap > 0 ? '목표일 기준 여유 ' + Math.round(cC.gap / 10000) + '만원 범위 안에서만, 주거 핵심자금과 분리해 위험자산을 검토할 수 있습니다(기대수익률은 올려 잡지 않음).' : '주거 핵심자금과 분리된 여유자금이 없거나 위험성향·재무 여력 조건이 맞지 않아 위험자산 활용은 검토하지 않습니다.'
    };
    // 장점·부담
    cards[0].pros = ['비상금과 현금 유동성이 가장 높음', '이자 부담이 가장 빨리 줄어듦']; cards[0].cons = ['상환이 끝나기 전에는 주거자금이 천천히 늘어남', '정책상품 기여금을 받지 않음'];
    cards[1].pros = ['생활비 부담과 저축의 균형', cards[1].policies.length ? '정책 기여금(확인된 6% 매칭)을 받음' : '정책상품 없이 단순']; cards[1].cons = ['선택 지출을 줄이는 생활 변화 필요', cards[1].policies.length ? '만기 전 해지 조건이 확인되지 않아 상품 잔액은 이사 전까지 쓸 수 없음' : '저축 속도가 A안과 비슷할 수 있음'];
    cards[2].pros = ['목표 조건을 바꿔 달성 가능성을 높임']; cards[2].cons = ['목표일·목표금액 변경은 고객이 따로 확인해야 함', '이사가 늦어지면 현재 주거 계약 조건도 다시 확인해야 함'];
    var same = sameStart(cards[0].data, cards[1].data) && sameStart(cards[1].data, cards[2].data);
    return {
      base: { moveMonth: base.basis.moveMonth, baseMonth: base.basis.baseMonth }, risk: risk || null, sameStart: same, options: cards,
      noneAchieves: cards.every(function (c) { return c.status !== 'achieved'; }),
      riskNotice: !risk ? '위험성향 결과가 없어 가장 보수적인 기준(원금 보전형)으로만 설계했습니다. 설문 후 다시 만드세요.' : (risk.status === 'needsReview' ? '위험성향 결과에 추가 확인이 필요한 항목이 있어 위험자산 활용은 검토하지 않았습니다.' : ''),
      adverseLabel: CFG.ADVERSE_LABEL
    };
  }

  var Strategies = { build: build, apply: apply, defaults: defaults, sameStart: sameStart, FIXED: FIXED };
  if (typeof module !== 'undefined' && module.exports) module.exports = Strategies;
  else { root.FP = root.FP || {}; root.FP.Strategies = Strategies; }
})(this);
