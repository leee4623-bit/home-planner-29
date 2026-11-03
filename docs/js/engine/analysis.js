/*
 * 분석 엔진 — 지표·판정·충격·역산·정책 비교·실행 현황·경보
 * ------------------------------------------------------------
 * 숫자만 계산합니다(문장은 화면/설명 모듈). 모든 금액 계산은 calc.simulate를 사용합니다.
 */
(function (root) {
  'use strict';
  var C = root.FP ? root.FP.Calc : require('./calc.js');
  var P = root.FP ? root.FP.Policies : require('../data/policies.js');
  var EPS = C.EPS;
  function num(v, d) { var x = Number(v); return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function sum(arr, f) { var s = 0; arr.forEach(function (x) { s += f ? f(x) : x; }); return s; }

  // 설계사가 정한 진단 기준 (출처 기준 아님 — 화면에 '설계사 기준'으로 표시)
  var PLANNER_STANDARDS = {
    emergencyMonths: { value: 3, source: 'planner', text: '비상금 필수생활비 3개월 이상' },
    repayToIncome: { value: 20, source: 'planner', text: '월 소득 대비 원리금 상환비중 20% 이하' },
    debtToAssets: { value: 40, source: 'planner', text: '총자산 대비 부채비중 40% 이하' }
  };

  // ---------- 진단 지표 ----------
  function ratio(a, b) { return b > EPS ? a / b * 100 : null; }
  function indicators(res) {
    var r0 = res.rows[0], r1 = res.rows[1], at = res.at;
    var essential = r1.essential;
    var liquid = r0.emergencyBal + r0.housingBal;                       // 즉시 사용 가능
    var restricted = r0.depositPending + r0.productBal + r0.pension;     // 사용 제한
    var semi = r0.investBal;                                             // 매각 필요(가격 변동)
    var totalAssets = liquid + semi + restricted;
    var totalDebt = r0.debtBalance;
    var net = totalAssets - totalDebt;
    var scheduled = sum(res.data.debts, function (x) { return x.balance > 0 ? x.payment : 0; });
    var flowSurplus = r1.income - (r1.essential + r1.optional) - r1.debtPaid;
    return {
      baseYm: r0.ym, flowYm: r1.ym, targetYm: at.ym,
      income: r1.income, expense: r1.essential + r1.optional, essential: essential, debtPaid: r1.debtPaid, productContrib: r1.productContrib,
      surplus: flowSurplus,
      totalAssets: totalAssets, totalDebt: totalDebt, netWorth: net,
      liquid: liquid, semiLiquid: semi, restricted: restricted, restrictedShare: ratio(restricted, totalAssets),
      restrictedParts: { deposit: r0.depositPending, products: r0.productBal, pension: r0.pension },
      liquidMonths: essential > EPS ? liquid / essential : null,
      emergency: r0.emergencyBal, emergencyMonths: essential > EPS ? r0.emergencyBal / essential : null,
      emergencyAtTarget: at.emergencyBal, emergencyMonthsAtTarget: at.essential > EPS ? at.emergencyBal / at.essential : null,
      debtToAssets: ratio(totalDebt, totalAssets),
      debtToNet: net > EPS ? totalDebt / net * 100 : null, netNonPositive: net <= EPS,
      repayToIncome: ratio(Math.min(scheduled, totalDebt + 1e12) , r1.income),
      repayTotalToIncome: ratio(r1.debtPaid, r1.income),
      debtFree: res.debtFree, usableAtTarget: at.usableHousing, gap: res.gap, targetTotal: res.targetTotal
    };
  }

  // 지표가 해석 가능한 상태인지 문구
  function ratioState(v, kind, ind) {
    if (kind === 'debtToAssets' && ind.totalAssets <= EPS) return '총자산이 0이라 비중을 계산할 수 없습니다.';
    if (kind === 'debtToNet' && ind.netNonPositive) return '순자산이 0 이하라 부채/순자산 비율은 의미가 없습니다. 부채가 자산보다 많거나 같은 상태입니다.';
    if (kind === 'repay' && !(ind.income > EPS)) return '월 소득이 0이라 상환비중을 계산할 수 없습니다.';
    if (v === null) return '계산할 수 없음';
    return null;
  }

  // ---------- 목표 판정 ----------
  function verdict(res) {
    var at = res.at;
    var conds = [
      { id: 'debt', label: '기존 부채 상환 완료', ok: at.debtClear, value: at.debtBalance },
      { id: 'emergency', label: '비상자금 목표 확보', ok: at.emergencyOk, value: at.emergencyBal, target: res.emergencyTarget },
      { id: 'housing', label: '목표일 사용 가능 주거자금 확보', ok: at.housingOk, value: at.usableHousing, target: res.targetTotal }
    ];
    var all = conds.every(function (c) { return c.ok; });
    var label = all ? '전체 목표 달성' : at.housingOk ? '부분 충족' : '미달';
    return { conds: conds, status: all ? 'achieved' : at.housingOk ? 'partial' : 'short', label: label, ym: at.ym };
  }

  // ---------- 충격 ----------
  var SHOCK_TYPES = [
    { type: 'incomeDrop', label: '소득 감소', unit: '%', def: { start: 13, duration: 12, size: 10 }, sizeLabel: '감소율' },
    { type: 'jobLoss', label: '실직', unit: '원(실직 중 월 수입)', def: { start: 13, duration: 6, size: 1800000 }, sizeLabel: '실직 중 월 수입' },
    { type: 'expenseRise', label: '생활비 상승', unit: '%', def: { start: 1, duration: 0, size: 10 }, sizeLabel: '상승률' },
    { type: 'targetRise', label: '목표 보증금 상승', unit: '%', def: { start: 0, duration: 0, size: 15 }, sizeLabel: '상승률' },
    { type: 'investLoss', label: '투자 손실', unit: '%', def: { start: 6, duration: 0, size: 30 }, sizeLabel: '손실률' },
    { type: 'depositDelay', label: '보증금 반환 지연', unit: '개월', def: { start: 0, duration: 0, size: 3 }, sizeLabel: '지연 개월' }
  ];
  function shockImpact(data, shocks) {
    var base = C.simulate(data), sh = C.simulate(data, { shocks: shocks });
    var minE = Infinity, depleted = false;
    for (var t = 1; t <= sh.T; t++) { minE = Math.min(minE, sh.rows[t].emergencyBal); if (sh.rows[t].emergencyBal <= EPS && sh.rows[t].emergencyIn < 0) depleted = true; }
    return {
      base: base, shocked: sh, gapBase: base.gap, gap: sh.gap, gapChange: sh.gap - base.gap,
      emergencyDepleted: depleted, emergencyMin: minE, unfunded: sh.unfunded,
      debtFreeBase: base.debtFree, debtFree: sh.debtFree, delayBase: base.delay, delay: sh.delay,
      statusBase: base.status, status: sh.status
    };
  }

  // ---------- 이분 탐색(1만원 단위 올림) ----------
  function minSearch(test, hi) {
    if (!test(hi)) return null;
    if (test(0)) return 0;
    var lo = 0;
    for (var k = 0; k < 40; k++) { var mid = (lo + hi) / 2; if (test(mid)) hi = mid; else lo = mid; }
    var x = Math.ceil(hi / 10000) * 10000;
    while (!test(x) && x < hi + 20000) x += 10000;
    return test(x) ? x : null;
  }

  /*
   * 생활비 절감액 역산
   * - 시작월(start, 기준월로부터 개월)부터 매월 X원 절감. 선택 지출 → 필수생활비(최소 필수생활비까지) 순서.
   * - 절감한 돈은 부채가 남아 있으면 추가 상환, 다 갚으면 저축(비상금 → 주거자금)으로 갑니다.
   * - 최대 절감 가능액 = 선택 지출 + (필수생활비 − 최소 필수생활비)
   */
  function reverseCut(data, o) {
    o = o || {};
    var d = C.normalize(data);
    var start = Math.max(1, Math.round(num(o.start, 1)));
    if (o.minEssential !== undefined) d.expenses.minEssential = num(o.minEssential);
    var minEss = Math.min(num(d.expenses.minEssential, d.expenses.essential), d.expenses.essential);
    var maxCut = Math.max(0, num(d.expenses.optional) + num(d.expenses.essential) - minEss);
    var shocks = o.shocks || [];
    var base = C.simulate(d, { shocks: shocks });
    var remaining = Math.max(1, base.T - start + 1);
    var test = function (x) { return C.simulate(d, { shocks: shocks, cut: { amount: x, start: start } }).status === 'achieved'; };
    var req = minSearch(test, maxCut);
    var out = {
      start: start, startYm: C.ymAdd(d.basis.baseMonth, start), maxCut: maxCut, minEssential: minEss,
      reference: base.gap < 0 ? -base.gap / remaining : 0, remaining: remaining,
      alreadyAchieved: base.status === 'achieved', required: req, feasible: req !== null, baseGap: base.gap
    };
    if (req !== null && req > 0) {
      var chk = C.simulate(d, { shocks: shocks, cut: { amount: req, start: start } });
      out.check = { status: chk.status, gap: chk.gap, debtFree: chk.debtFree, conds: verdict(chk).conds };
      out.fromOptional = Math.min(req, d.expenses.optional);
      out.fromEssential = req - out.fromOptional;
    }
    // 별도 대안 (절감과 무관하게 계산)
    out.alt = alternatives(d, shocks, start);
    return out;
  }

  function alternatives(d, shocks, start) {
    var base = C.simulate(d, { shocks: shocks });
    var inc = minSearch(function (x) { return C.simulate(d, { shocks: shocks, extraIncome: { amount: x, start: start } }).status === 'achieved'; }, 10000000);
    // 목표금액 조정: 부채·비상금 조건과 별개로, 주거자금 조건만 맞추려면 목표를 얼마로 낮춰야 하나
    var housingMax = base.at.usableHousing - num(d.goals.movingCost);
    var factor = 1; (shocks || []).forEach(function (s) { if (s.type === 'targetRise') factor *= 1 + s.size / 100; });
    var targetFit = Math.max(0, Math.floor(housingMax / factor / 10000) * 10000);
    return {
      extraIncome: inc,
      targetFit: targetFit, targetCut: Math.max(0, num(d.goals.housingTarget) - targetFit),
      targetFitStillShort: !(base.at.debtClear && base.at.emergencyOk),
      extendTo: base.firstAchieved, extendBy: base.firstAchieved === null ? null : base.firstAchieved - base.T,
      extendYm: base.firstAchieved === null ? null : C.ymAdd(d.basis.baseMonth, base.firstAchieved)
    };
  }

  // 역산 결과를 계획 데이터에 적용 (새 버전으로 저장할 데이터)
  function applyCut(data, cut) {
    var d = JSON.parse(JSON.stringify(data));
    d.plan = d.plan || {};
    // 원래 생활비는 그대로 두고 '절감 계획'으로 저장 → 시작월부터 적용, 부채가 남아 있으면 추가 상환
    d.plan.cut = { amount: cut.required, startMonth: cut.startYm, minEssential: cut.minEssential, note: '생활비 절감액 역산 결과 적용' };
    d.expenses.minEssential = cut.minEssential;
    return d;
  }

  // ---------- 소득 시나리오·민감도 ----------
  function incomeScenarios(data, custom) {
    var list = [
      { id: 'r0', label: '임금 인상 없음 (연 0%)', raisePct: 0 },
      { id: 'r1', label: '보수적 인상 가정 (연 1%)', raisePct: 1 },
      { id: 'r2', label: '추가 비교 가정 (연 2%)', raisePct: 2 }
    ];
    if (custom) list.push({ id: 'custom', label: '사용자 지정', raisePct: num(custom.raisePct), promotion: custom.promotion });
    return list.map(function (s) {
      var d = JSON.parse(JSON.stringify(data));
      d.income.raisePct = s.raisePct;
      if (s.promotion !== undefined) d.income.promotion = s.promotion;
      var r = C.simulate(d);
      return { id: s.id, label: s.label, raisePct: s.raisePct, gap: r.gap, status: r.status, debtFree: r.debtFree, salaryAtTarget: r.at.salary };
    });
  }
  function sensitivity(data) {
    return [0, 5, 10, 15, 20].map(function (p) {
      var r = C.simulate(data, { shocks: p ? [{ type: 'incomeDrop', start: 1, duration: 0, size: p }] : [] });
      return { drop: p, gap: r.gap, status: r.status, unfunded: r.unfunded };
    });
  }

  // ---------- 정책 비교 ----------
  function ageAt(birthYm, ym) { return Math.floor(C.ymDiff(birthYm, ym) / 12); }
  function policyReview(data, profile) {
    var d = C.normalize(data), base = d.basis.baseMonth, res = C.simulate(d), T = res.T;
    var surplus1 = indicators(res).surplus + res.rows[1].productContrib;
    var out = [];
    var yf = P.get('youthFuture'), sme = P.get('smeSaving'), tx = P.get('taxRelief'), ls = P.get('youthLease');
    var gross = num(profile.annualGross);

    // 청년미래적금
    var yfp = d.products.filter(function (p) { return p.policyId === 'youthFuture'; })[0];
    var joinYm = yfp ? yfp.startMonth : C.ymAdd(base, 1);
    var matYm = C.ymAdd(joinYm, 36);
    var monthly = yfp ? yfp.monthly : 300000;
    out.push({
      id: 'youthFuture', policy: yf,
      checks: [
        { label: '가입 연령(만 19~34세)', result: ageAt(profile.birthMonth, joinYm) <= 34 && ageAt(profile.birthMonth, joinYm) >= 19 ? 'pass' : 'fail', detail: '가입월 기준 만 ' + ageAt(profile.birthMonth, joinYm) + '세' },
        { label: '일반형 소득(총급여 6,000만원 이하)', result: gross <= 60000000 ? 'pass' : 'fail', detail: '직전연도 총급여 ' + Math.round(gross / 10000).toLocaleString('ko-KR') + '만원 (입력값)' },
        { label: '우대형(총급여 3,600만원 이하 중소기업 재직 등)', result: 'check', detail: gross > 36000000 ? '입력 총급여가 3,600만원을 넘어 우대형 해당 가능성 낮음 — 최종 공고 기준 확인 필요' : '최종 공고의 우대형 요건 확인 필요' },
        { label: '가구소득 기준', result: 'check', detail: '확인 필요(출시 자료에 미기재)' },
        { label: '가입 시기', result: 'check', detail: '2차 모집 일정이 ‘잠정’ — ' + joinYm + ' 가입 가정' }
      ],
      maturityYm: matYm, moveYm: d.basis.moveMonth, maturityOk: C.ymDiff(matYm, d.basis.moveMonth) >= 0,
      monthly: monthly, burden: surplus1 > EPS ? monthly / surplus1 * 100 : null,
      cash: { principal: monthly * 36, gov: monthly * 36 * 0.06, interest: null, tax: '비과세(확인됨)' },
      note: '정부기여금은 납입액에 대한 매칭(6%/12%)이며 연이율이 아닙니다. 은행 금리는 확인 전이라 0%로 둡니다.'
    });

    // 중기 재직자 우대 저축공제
    var smeM = 300000, smeEnd = C.ymAdd(C.ymAdd(base, 1), 60);
    var smeAtTarget = smeM * Math.min(T, 60);
    out.push({
      id: 'smeSaving', policy: sme,
      checks: [
        { label: '중소기업 재직', result: profile.companySize === 'sme' ? 'pass' : 'fail', detail: profile.companySize === 'sme' ? '입력: 중소기업' : '입력: 중소기업 아님' },
        { label: '소속 기업 참여', result: 'check', detail: '기업 참여가 있어야 기업기여금(20%) 발생 — 확인 필요' },
        { label: '만기와 이사 시점', result: C.ymDiff(smeEnd, d.basis.moveMonth) >= 0 ? 'pass' : 'fail', detail: '지금 가입해도 만기 ' + smeEnd + ' → 이사 ' + d.basis.moveMonth + ' 이후' }
      ],
      maturityYm: smeEnd, maturityOk: C.ymDiff(smeEnd, d.basis.moveMonth) >= 0, monthly: smeM, burden: surplus1 > EPS ? smeM / surplus1 * 100 : null,
      lockedAtTarget: smeAtTarget * 1.2, housingLoss: smeAtTarget,
      note: '월 ' + Math.round(smeM / 10000) + '만원을 넣으면 목표일까지 ' + Math.round(smeAtTarget / 10000).toLocaleString('ko-KR') + '만원(+기업기여 확인 시 20%)이 만기 전 잔액으로 묶입니다. 장기 자산형성에는 유리하지만 그만큼 목표일 주거자금이 줄어듭니다. 중도해지 시 수령액·상실 혜택이 확인되지 않아 해지 시나리오는 계산하지 않습니다.'
    });

    // 소득세 감면
    var tr = d.taxRelief;
    var trRes = res.taxRelief;
    var annual = Math.min(num(tr.annualTax) * 0.9, 2000000);
    out.push({
      id: 'taxRelief', policy: tx,
      checks: [
        { label: '중소기업 취업', result: profile.companySize === 'sme' ? 'pass' : 'fail', detail: '입력: ' + (profile.companySize === 'sme' ? '중소기업' : '중소기업 아님') },
        { label: '취업 시기(2026-12-31까지 취업)', result: C.ymDiff(profile.employStart, '2026-12') >= 0 ? 'pass' : 'fail', detail: '최초 감면 대상 취업월 ' + (tr.startMonth || profile.employStart) },
        { label: '감면 기간', result: trRes ? 'pass' : 'check', detail: trRes ? (tr.startMonth + ' ~ ' + trRes.endYm + ' (기준월 이후 남은 ' + Math.max(0, trRes.end) + '개월)') : '감면 적용 여부 확인 전 — 계산에 넣지 않음' },
        { label: '실수령 반영 방식', result: tr.mode === 'inTakeHome' ? 'pass' : 'check', detail: tr.mode === 'inTakeHome' ? '급여에서 이미 감면 → 실수령에 더하지 않음, 종료 후 실수령 감소 반영' : '연말정산 환급으로 받음 → 환급월(' + tr.refundMonth + '월)에 유입' }
      ],
      annualBenefit: annual, monthlyBenefit: annual / 12,
      note: '감면액 = min(연 결정세액 추정 ' + Math.round(num(tr.annualTax) / 10000) + '만원 × 90%, 연 200만원). 누구나 받는 정액이 아니며, 26세 취업이라는 이유만으로 지금부터 5년을 적용하지 않습니다.'
    });

    // 버팀목
    out.push({ id: 'youthLease', policy: ls, loan: loanCompare(d, profile) });
    // 중복 배정 점검
    var allocated = sum(d.products, function (p) { return p.monthly; }) + num(d.plan.extraRepayment);
    var dup = allocated > surplus1 + EPS;
    return { items: out, duplicate: dup, allocated: allocated, available: surplus1 };
  }

  // 대출 활용 비교안 (기본안과 분리)
  function loanCompare(data, profile, o) {
    o = o || {};
    var d = C.normalize(data);
    var ls = P.get('youthLease');
    var deposit = num(o.deposit, d.goals.housingTarget);
    var gross = num(profile.annualGross);
    var table = ls.fields.rateTable.value, rate = null;
    for (var i = 0; i < table.length; i++) if (gross <= table[i].max) { rate = table[i].rate; break; }
    var pref = o.applySmePref && profile.companySize === 'sme' ? ls.fields.smePref.value : 0;
    var finalRate = rate === null ? null : Math.max(1.0, rate - pref);
    var maxLoan = Math.min(ls.fields.limit.value, deposit * ls.fields.ltv.value);
    var loan = Math.min(maxLoan, num(o.amount, maxLoan));
    var withLoan = JSON.parse(JSON.stringify(data));
    withLoan.goals.housingTarget = Math.max(0, deposit - loan);
    var noLoanRes = C.simulate(d), loanRes = C.simulate(withLoan);
    var moveAge = ageAt(profile.birthMonth, d.basis.moveMonth);
    return {
      eligible: [
        { label: '나이(이사 시점 만 19~34세)', result: moveAge <= 34 ? 'pass' : 'fail', detail: '만 ' + moveAge + '세' },
        { label: '연소득 5,000만원 이하', result: gross <= 50000000 ? 'pass' : 'fail', detail: Math.round(gross / 10000).toLocaleString('ko-KR') + '만원 (입력)' },
        { label: '보증금 3억원 이하·85㎡ 이하', result: deposit <= 300000000 ? 'check' : 'fail', detail: '보증금 조건 충족, 면적·주택 조건은 계약 시 확인' },
        { label: '무주택·순자산 3.37억원 이하', result: 'check', detail: '심사 시 확인' }
      ],
      deposit: deposit, loan: loan, maxLoan: maxLoan, rate: rate, pref: pref, finalRate: finalRate,
      monthlyInterest: finalRate === null ? null : loan * finalRate / 1200,
      ownNeededNoLoan: noLoanRes.targetTotal, ownNeededLoan: loanRes.targetTotal,
      noLoan: { status: noLoanRes.status, gap: noLoanRes.gap },
      withLoan: { status: loanRes.status, gap: loanRes.gap },
      existingDebtAtMove: loanRes.at.debtBalance, newDebt: loan,
      label: '대출 활용 비교안 — 무대출 목표 충족 아님. 예상 대출 가능액은 승인액이 아니며 은행·보증기관 심사로 확정됩니다.'
    };
  }

  // ---------- 고객 실행 현황 ----------
  /*
   * records: [{ month:'YYYY-MM', category:'debt'|'emergency'|'housing'|'product:<id>'|'expense', amount, status }]
   * 확정(confirmed) 기록만 실제 실적으로 사용. 'planned'(가정해보기)는 저장하지 않으므로 여기 오지 않음.
   */
  function actualsFrom(data, records) {
    var base = data.basis.baseMonth, map = {};
    (records || []).forEach(function (r) {
      if (r.status && r.status !== 'confirmed') return;
      var t = C.ymDiff(base, r.month); if (t < 1) return;
      var a = map[t] = map[t] || {};
      if (r.category.indexOf('product:') === 0) { a.products = a.products || {}; var pid = r.category.slice(8); a.products[pid] = (a.products[pid] || 0) + num(r.amount); }
      else if (r.category === 'expense:essential') a.expenseEssential = (a.expenseEssential || 0) + num(r.amount);
      else if (r.category === 'expense:optional') a.expenseOptional = (a.expenseOptional || 0) + num(r.amount);
      else a[r.category] = (a[r.category] || 0) + num(r.amount);
    });
    return map;
  }

  function execution(data, records, o) {
    o = o || {};
    var d = C.normalize(data), base = d.basis.baseMonth;
    var today = o.today || new Date();
    var todayYm = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    var c = Math.max(1, C.ymDiff(base, todayYm));
    var settings = Object.assign({ dueDay: 25, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 3, staleDays: 7 }, o.settings || {});
    var plan = C.simulate(d);
    var actuals = actualsFrom(d, records);
    var dayPassed = today.getDate() > settings.dueDay + settings.graceDays;
    // 비교 대상 달: 지난 달까지 + (예정일이 지났으면) 이번 달. 진행 중인 달은 누적·추세 계산에서 제외
    var closedTo = dayPassed ? c : c - 1;
    var recordedMonths = Object.keys(actuals).map(Number).filter(function (t) { return t <= closedTo; }).sort(function (a, b) { return a - b; });
    var last = recordedMonths.length ? recordedMonths[recordedMonths.length - 1] : 0;
    var lastAny = Object.keys(actuals).map(Number).filter(function (t) { return t <= c; }).reduce(function (m, t) { return Math.max(m, t); }, 0);

    function plannedOf(t) {
      var r = plan.rows[t]; if (!r) return null;
      var pr = {}; d.products.forEach(function (p) {
        var s = C.ymDiff(base, p.startMonth); pr[p.id] = (t >= Math.max(1, s) && t < s + num(p.termMonths)) ? num(p.monthly) : 0;
      });
      return { debt: r.debtPaid, emergency: Math.max(0, r.emergencyIn), housing: Math.max(0, r.housingIn - r.depositIn - r.productPayout), products: pr, expense: r.essential + r.optional };
    }
    function savingsOf(x) { if (!x) return 0; return num(x.emergency) + num(x.housing) + sum(Object.keys(x.products || {}), function (k) { return num(x.products[k]); }) + num(x.debt); }

    // 이번 달
    var planned = plannedOf(c), actual = actuals[c] || null;
    var items = [
      { id: 'debt', label: '부채 상환', planned: planned.debt, actual: actual && actual.debt !== undefined ? actual.debt : null },
      { id: 'emergency', label: '비상금 적립', planned: planned.emergency, actual: actual && actual.emergency !== undefined ? actual.emergency : null },
      { id: 'housing', label: '주거자금 납입', planned: planned.housing, actual: actual && actual.housing !== undefined ? actual.housing : null }
    ];
    d.products.forEach(function (p) { items.push({ id: 'product:' + p.id, label: p.name + ' 납입', planned: planned.products[p.id] || 0, actual: actual && actual.products && actual.products[p.id] !== undefined ? actual.products[p.id] : null }); });
    items.forEach(function (it) {
      it.diff = it.actual === null ? null : it.actual - it.planned;
      it.state = it.actual === null && it.planned <= EPS ? 'none' : it.actual === null ? (dayPassed ? 'missingAfterDue' : 'pending') : (it.actual + EPS >= it.planned ? 'done' : (dayPassed ? 'short' : 'partial'));
    });

    // 누적(기록이 있는 달만 비교 — 기록 없는 달은 실패로 보지 않음)
    var cumPlan = 0, cumAct = 0, noRecord = [];
    for (var t = 1; t <= closedTo; t++) {
      if (actuals[t]) { var pl = plannedOf(t); cumPlan += savingsOf(pl); cumAct += savingsOf(actuals[t]); }
      else noRecord.push(C.ymAdd(base, t));
    }

    // 예측: ① 당초 계획대로 실행 ② 최근 실행 추세 지속
    var fcPlan = C.simulate(d, { actuals: actuals });
    var recent = recordedMonths.slice(-3), rp = 0, ra = 0;
    recent.forEach(function (t) { rp += savingsOf(plannedOf(t)); ra += savingsOf(actuals[t]); });
    var factor = rp > EPS ? Math.max(0, Math.min(1.5, ra / rp)) : 1;
    var fcTrend = C.simulate(d, { actuals: actuals, trend: { from: Math.max(last, lastAny) + 1, factor: factor } });

    var expenseActual = actual && (actual.expense !== undefined || actual.expenseEssential !== undefined || actual.expenseOptional !== undefined) ? num(actual.expense) + num(actual.expenseEssential) + num(actual.expenseOptional) : null;
    return {
      base: base, c: c, ym: C.ymAdd(base, c), todayYm: todayYm, settings: settings, dueDayPassed: dayPassed,
      items: items, plan: plan, cumPlan: cumPlan, cumAct: cumAct, cumDiff: cumAct - cumPlan, recordedMonths: recordedMonths.map(function (t) { return C.ymAdd(base, t); }),
      noRecord: noRecord, lastRecorded: Math.max(last, lastAny), closedTo: closedTo, trendFactor: factor, trendBasis: recent.length,
      forecastPlan: fcPlan, forecastTrend: fcTrend, actuals: actuals,
      expense: { planned: planned.expense, actual: expenseActual }
    };
  }

  // 가정해보기: 이번 달 추가 납입 (저장 안 됨)
  function sandbox(data, records, amount, o) {
    var ex = execution(data, records, o);
    var res = C.simulate(data, { actuals: ex.actuals, sandbox: { t: ex.c, amount: amount } });
    var row = res.rows[ex.c];
    return { result: res, gapBefore: ex.forecastPlan.gap, gap: res.gap, cashShort: row.cashShort, livingCash: row.livingCash, ym: ex.ym };
  }

  // ---------- 경보 ----------
  function alerts(ex, o) {
    o = o || {};
    var s = ex.settings, list = [];
    var lastSync = o.lastSync ? new Date(o.lastSync) : null, now = o.now || new Date();
    var stale = o.linked && (!lastSync || (now - lastSync) / 864e5 > s.staleDays);
    var r = ex.forecastPlan.rows[ex.c];
    var em = r ? r.emergencyBal : 0, ess = r ? r.essential : 0;
    if (ess > 0 && em < ess * s.emergencyMinMonths - EPS) list.push({ level: 'warn', id: 'emergencyLow', cause: '비상금이 최소 기준(필수생활비 ' + s.emergencyMinMonths + '개월)보다 적습니다.', size: ess * s.emergencyMinMonths - em, action: '다음 잉여자금은 비상금부터 채우고, 추가 납입·투자 비율을 잠시 낮추세요.' });
    ex.items.forEach(function (it) {
      if (it.state === 'short') list.push({ level: 'warn', id: 'dueShort:' + it.id, cause: it.label + ' 납입 예정일(' + s.dueDay + '일 + 유예 ' + s.graceDays + '일)이 지났는데 계획보다 적습니다.', size: it.planned - it.actual, action: '이번 달 안에 부족분을 납입하거나, 어려우면 다음 달 계획을 조정하세요.' });
      if (it.state === 'missingAfterDue' && it.planned > EPS) list.push({ level: stale ? 'info' : 'check', id: 'dueUnknown:' + it.id, cause: it.label + ' 기록이 아직 없습니다. 납입 실패로 단정하지 않습니다.', size: it.planned, action: stale ? '계좌 데이터가 오래되었습니다. 거래내역을 새로 불러오세요.' : '납입했다면 기록하고, 아니라면 납입 일정을 확인하세요.' });
    });
    if (ex.cumPlan > EPS && ex.cumAct < ex.cumPlan * (1 - s.cumTolerancePct / 100)) list.push({ level: 'warn', id: 'cumShort', cause: '기록된 달의 누적 실행액이 계획보다 ' + s.cumTolerancePct + '% 넘게 적습니다.', size: ex.cumPlan - ex.cumAct, action: '부족분을 몇 달에 나눠 채우는 계획을 설계사와 정하세요.' });
    if (ex.expense.actual !== null && ex.expense.actual > ex.expense.planned * (1 + s.budgetTolerancePct / 100)) list.push({ level: 'warn', id: 'budgetOver', cause: '이번 달 생활비가 예산보다 ' + s.budgetTolerancePct + '% 넘게 많습니다.', size: ex.expense.actual - ex.expense.planned, action: '선택 지출 항목부터 줄여 다음 달 납입액을 지키세요.' });
    if (ex.plan.status === 'achieved' && ex.forecastTrend.status !== 'achieved') list.push({ level: 'warn', id: 'goalFlip', cause: '최근 실행 추세가 이어지면 주거목표가 미달로 바뀝니다.', size: Math.max(0, -ex.forecastTrend.gap), action: '실행률을 계획 수준으로 되돌리거나, 설계사와 수정안을 검토하세요.' });
    if (stale) list.push({ level: 'check', id: 'stale', cause: '연결 계좌 데이터가 ' + s.staleDays + '일 넘게 갱신되지 않았거나 조회되지 않았습니다.', size: null, action: '거래내역을 다시 불러오세요. 확인 전까지 납입 실패로 판단하지 않습니다.' });
    if (ex.noRecord.length) list.push({ level: 'info', id: 'noRecord', cause: '실행 기록이 없는 달이 ' + ex.noRecord.length + '개월 있습니다(' + ex.noRecord.slice(-3).join(', ') + ').', size: null, action: '기록이 없는 달은 0원 실적이 아니라 ‘미확인’으로 둡니다. 납입했다면 기록을 추가하세요.' });
    return list;
  }

  var Analysis = {
    PLANNER_STANDARDS: PLANNER_STANDARDS, SHOCK_TYPES: SHOCK_TYPES,
    indicators: indicators, ratioState: ratioState, verdict: verdict, shockImpact: shockImpact,
    reverseCut: reverseCut, applyCut: applyCut, alternatives: alternatives, incomeScenarios: incomeScenarios, sensitivity: sensitivity,
    policyReview: policyReview, loanCompare: loanCompare, actualsFrom: actualsFrom, execution: execution, sandbox: sandbox, alerts: alerts, ageAt: ageAt
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Analysis;
  else { root.FP = root.FP || {}; root.FP.Analysis = Analysis; }
})(this);
