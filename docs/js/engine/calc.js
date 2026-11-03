/*
 * 월별 재무 계산 엔진 v2 (화면·서버와 분리 — 브라우저와 Node 모두에서 실행)
 * =====================================================================
 * [시간]  0개월 = 기준월(설계 기준일이 속한 달)의 말 상태. t개월 = 기준월 + t 의 말.
 *         목표일 = 이사 예정월(moveMonth)의 말. 목표일 이후에 들어오는 돈은 목표 재원에서 제외.
 * [단위]  원. 계산 중 반올림하지 않음.
 * [이율]  연이율 ÷ 12 = 월이율. 부채 이자 = 월초 잔액 × 월이율. 예금은 월 복리.
 * [상환]  대출별 월 상환액 = 원리금 합계. 마지막 달은 남은 금액만.
 *         월 추가 상환·초과소득 상환은 이자율 높은 대출부터.
 * [0개월] 초기 일시 상환(현금 → 부채) → 현금은 비상금 목표까지 → 남는 현금은 주거자금.
 *         별도 비상금(emergencyFund)은 비상금으로 시작.
 * [매월]  소득 − 생활비 − 부채 상환 − 정책상품 납입 = 잉여자금
 *         잉여자금 배분: ① 비상금(목표까지) → ② 투자(비율) → ③ 주거자금
 *         적자: 비상금 → 주거자금 → 투자 순으로 꺼내 쓰고, 그래도 모자라면 '미충당 적자'.
 *         정책상품·반환 전 보증금·연금은 꺼내 쓰지 않음(사용 제한 자산).
 * [상품]  납입은 가입월부터 만기 전월까지. 만기월에 원금 + 확인된 기여금 + 이자를 주거자금으로 지급.
 *         정부·기업 기여금은 '납입액 × 기여율'(이자율 아님). 확인 안 된 기여금은 지급액에 넣지 않음.
 *         만기 전 잔액은 사용 제한 자산(주거자금 아님).
 * [소득]  실수령 기준. 세전 인상률 × 실수령 반영률(단순화 가정)로 실수령 인상.
 *         연간 인상: 매년 지정한 달. 승진 인상: 지정 월. 중복 적용 여부는 promotion.stack.
 *         초과소득(성과급·환급)은 반복 급여와 별도. 'confirmed'만 기본 계획 재원.
 * [감면]  소득세 감면 inTakeHome: 실수령에 이미 반영 → 더하지 않고, 종료 다음 달부터 실수령에서 뺌.
 *         yearEndRefund: 실수령에 미반영 → 다음 해 환급월에 유입(과세기간별 한도 적용).
 * [실적]  actuals[t]가 있으면 그 달은 계획 대신 실제 납입액을 사용(같은 달에 두 번 반영하지 않음).
 *         기록이 없는 달은 실패나 0원으로 보지 않고 계획 또는 추세 가정으로 채운 '미확인' 달로 표시.
 */
(function (root) {
  'use strict';
  var EPS = 0.5;
  var MAX = 120;

  // ---------- 날짜 ----------
  function ymParse(s) { var p = String(s || '').split('-'); return { y: +p[0], m: +p[1] }; }
  function ymAdd(s, n) { var a = ymParse(s); var t = a.y * 12 + (a.m - 1) + n; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); }
  function ymDiff(a, b) { var x = ymParse(a), y = ymParse(b); return (y.y * 12 + y.m) - (x.y * 12 + x.m); }
  function ymMonth(s) { return ymParse(s).m; }
  function ymYear(s) { return ymParse(s).y; }
  function ymValid(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || '')); }

  function num(v, d) { var x = Number(v); return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function pos(v) { return Math.max(0, num(v)); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- 입력 정리 ----------
  function normalize(d) {
    d = copy(d || {});
    d.basis = d.basis || {};
    d.income = d.income || {};
    d.expenses = d.expenses || {};
    d.assets = d.assets || {};
    d.goals = d.goals || {};
    d.rates = d.rates || {};
    d.debts = (d.debts || []).map(function (x, i) { return { id: x.id || ('d' + i), name: x.name || '부채', balance: pos(x.balance), rate: pos(x.rate), payment: pos(x.payment) }; });
    d.products = (d.products || []).filter(function (p) { return p.enabled !== false; });
    d.extraIncome = d.extraIncome || [];
    d.allocation = d.allocation || { mode: 'sequential', order: ['emergency', 'debt', 'housing'], ratios: { emergency: 0, debt: 0, housing: 100 } };
    d.taxRelief = d.taxRelief || { enabled: false };
    d.plan = d.plan || {};
    return d;
  }

  function totalDebt(ds) { var s = 0; for (var i = 0; i < ds.length; i++) s += ds[i].balance; return s; }
  function payHighest(ds, amount) {
    var order = ds.map(function (_, i) { return i; }).sort(function (a, b) { return ds[b].rate - ds[a].rate || ds[a].balance - ds[b].balance; });
    var left = amount, paid = 0;
    for (var k = 0; k < order.length && left > EPS; k++) {
      var d = ds[order[k]]; if (d.balance <= EPS) continue;
      var p = Math.min(left, d.balance); d.balance -= p; if (d.balance < EPS) d.balance = 0; left -= p; paid += p;
    }
    return paid;
  }

  // 충격(여러 개 동시 적용 가능): {type, start(개월), duration(개월, 0=끝까지), size}
  function shockActive(s, t) { return t >= s.start && (s.duration <= 0 || t < s.start + s.duration); }

  /*
   * simulate(data, opts)
   * opts.shocks      충격 목록
   * opts.actuals     { t: { debt, emergency, housing, products:{id:금액}, expense } } — 실제 기록(원)
   * opts.trend       { from: t, factor } — t부터 저축성 배분을 factor배로(최근 추세 지속 가정)
   * opts.sandbox     { t, amount } — 가정해보기: t월 주거자금 추가 납입(저장 안 됨)
   * opts.cut         { amount, start } (없으면 data.plan.cut = {amount, startMonth} 사용) — 생활비 절감(선택지출 → 필수생활비(최소선까지) 순). 절감액은 부채가 남아 있으면 추가 상환
   * opts.extraIncome { amount, start } — 월 추가 소득(대안 계산용). 부채가 남아 있으면 추가 상환
   * opts.includeExpected  예상(미확정) 초과소득까지 포함
   * opts.moveMonth   목표 시점 변경 계산용
   * opts.targetOverride 주거자금 목표 변경 계산용
   */
  function simulate(data, opts) {
    opts = opts || {};
    var d = normalize(data);
    var base = d.basis.baseMonth;
    var moveMonth = opts.moveMonth || d.basis.moveMonth;
    var T = Math.max(0, ymDiff(base, moveMonth));
    var H = MAX; // 목표일 이후 상환 완료·달성 시점을 찾기 위해 10년까지 계산
    var shocks = (opts.shocks || []).map(function (s) { return { type: s.type, start: Math.max(0, Math.round(num(s.start))), duration: Math.max(0, Math.round(num(s.duration))), size: num(s.size) }; });
    var warnings = [];

    var inc = d.income, ex = d.expenses, as = d.assets, g = d.goals, rt = d.rates, pl = d.plan;
    var pass = num(inc.netPassThrough, 0.75);
    // 저장된 계획의 생활비 절감(역산 적용분) — opts.cut이 있으면 그것으로 대체
    // 생활비 절감 계획: plan.cut(역산 적용분) + plan.cuts(월별 재계산 수정안 누적) + opts.cut(계산용)
    var cutList = [];
    if (pl.cut && ymValid(pl.cut.startMonth)) cutList.push({ amount: pos(pl.cut.amount), start: Math.max(1, ymDiff(base, pl.cut.startMonth)) });
    (pl.cuts || []).forEach(function (c) { if (ymValid(c.startMonth)) cutList.push({ amount: pos(c.amount), start: Math.max(1, ymDiff(base, c.startMonth)) }); });
    if (opts.cut) cutList.push({ amount: pos(opts.cut.amount), start: Math.max(1, Math.round(num(opts.cut.start, 1))) });
    function cutAt(t) { var s2 = 0; cutList.forEach(function (c) { if (t >= c.start) s2 += c.amount; }); return s2; }
    var saveR = num(rt.savingsRate) / 1200;
    var invR = num(rt.investReturn) / 1200;
    var targetFactor = 1, depositDelay = 0;
    shocks.forEach(function (s) {
      if (s.type === 'targetRise') targetFactor *= 1 + s.size / 100;
      if (s.type === 'depositDelay') depositDelay += Math.round(s.size);
    });
    var housingTarget = opts.targetOverride !== undefined ? opts.targetOverride : pos(g.housingTarget);
    var targetTotal = housingTarget * targetFactor + pos(g.movingCost);
    var emergencyTarget = pos(g.emergencyTarget);

    // ---- 0개월 ----
    var debts = d.debts.map(function (x) { return { id: x.id, name: x.name, balance: x.balance, rate: x.rate, payment: x.payment, paidOff: x.balance <= EPS ? 0 : null }; });
    var debt0 = totalDebt(debts);
    var cash = pos(as.cash);
    var lumpWanted = pos(pl.lumpSum);
    var lump = Math.min(lumpWanted, cash, debt0);
    if (lumpWanted > lump + EPS) warnings.push({ code: 'lumpCapped', text: '초기 일시 상환액이 현금 또는 부채보다 커서 ' + Math.round(lump / 10000) + '만원만 상환했습니다.' });
    payHighest(debts, lump);
    debts.forEach(function (x) { if (x.balance <= EPS && x.paidOff === null) x.paidOff = 0; });
    cash -= lump;
    var emergency = pos(as.emergencyFund);
    var topUp = Math.min(cash, Math.max(0, emergencyTarget - emergency));
    emergency += topUp; cash -= topUp;
    var housing = pos(as.housingFund) + cash;
    var invest = pos(as.investment);
    var pension = pos(as.pension);
    var depositIdx = as.depositReturnMonth && ymValid(as.depositReturnMonth) ? ymDiff(base, as.depositReturnMonth) + depositDelay : 0;
    var depositPending = pos(as.deposit);
    var depositIn0 = 0;
    if (depositIdx <= 0 && depositPending > 0) { housing += depositPending; depositIn0 = depositPending; depositPending = 0; }

    // 정책상품 상태
    var prods = d.products.map(function (p) {
      var start = ymDiff(base, p.startMonth);
      var term = Math.round(pos(p.termMonths));
      return {
        id: p.id, name: p.name || '정책상품', policyId: p.policyId, start: start, term: term, maturity: start + term,
        monthly: pos(p.monthly), govRate: p.govConfirmed ? pos(p.govRate) : 0, govPending: p.govConfirmed ? 0 : pos(p.govRate),
        companyRate: p.companyConfirmed ? pos(p.companyRate) : 0, rate: pos(p.interestRate) / 100, taxFree: !!p.taxFree,
        principal: pos(p.paidSoFar), gov: 0, company: 0, interest: 0, paid: false, payoutMonth: null, payoutAmount: 0, contribs: []
      };
    });
    prods.forEach(function (p) {
      if (p.maturity > T) warnings.push({ code: 'maturityAfterTarget', product: p.id, text: p.name + '의 만기(' + ymAdd(base, p.maturity) + ')가 이사 예정월(' + moveMonth + ')보다 늦어 목표일 주거자금에 넣지 않았습니다.' });
      if (p.govPending > 0) warnings.push({ code: 'govUnconfirmed', product: p.id, text: p.name + '의 기여금 조건이 확인되지 않아 지급액에 넣지 않았습니다(확인 필요).' });
    });

    // 소득세 감면
    var tr = d.taxRelief, trStart = null, trEnd = null, trMonthly = 0;
    if (tr.enabled && tr.confirmed && ymValid(tr.startMonth)) {
      trStart = ymDiff(base, tr.startMonth);
      trEnd = trStart + Math.round(num(tr.years, 5)) * 12 - 1;
      trMonthly = Math.min(pos(tr.annualTax) * num(tr.rate, 0.9), pos(tr.annualCap) || Infinity) / 12;
    }

    var rows = [];
    rows.push(row(0, {
      income: 0, salary: 0, taxRefund: 0, bonus: 0, essential: 0, optional: 0, interest: 0, principal: lump, debtPaid: lump,
      debtBalance: totalDebt(debts), productContrib: 0, productPayout: 0, productBal: prodBal(), emergencyIn: emergency - pos(as.emergencyFund),
      emergencyBal: emergency, housingIn: (housing - pos(as.housingFund)), housingBal: housing, investIn: 0, investBal: invest,
      depositIn: depositIn0, depositPending: depositPending, pension: pension, surplus: 0, unfunded: 0, livingCash: null, cashShort: 0,
      actual: false, events: depositIn0 ? ['deposit'] : []
    }));

    var salaryFactor = 1, lastPromo = -999, debtFreeFlag = false;
    var unfundedTotal = 0, deficitMonths = [];

    for (var t = 1; t <= H; t++) {
      var ym = ymAdd(base, t), cm = ymMonth(ym), events = [];
      var act = opts.actuals && opts.actuals[t];

      // 급여 인상
      if (inc.promotion && ymValid(inc.promotion.month) && ymDiff(base, inc.promotion.month) === t) { salaryFactor *= 1 + num(inc.promotion.pct) / 100 * pass; lastPromo = t; events.push('promotion'); }
      if (num(inc.raisePct) && cm === Math.round(num(inc.raiseMonth, 1))) {
        var skip = inc.promotion && inc.promotion.stack === false && t - lastPromo < 12;
        if (!skip) salaryFactor *= 1 + num(inc.raisePct) / 100 * pass;
      }
      var salary = pos(inc.netMonthly) * salaryFactor;
      // 소득세 감면 종료(실수령 반영형)
      if (trStart !== null && tr.mode === 'inTakeHome' && t > trEnd) salary -= trMonthly;
      if (trStart !== null && t === trEnd + 1) events.push('taxReliefEnd');
      var unemployed = false;
      shocks.forEach(function (s) {
        if (!shockActive(s, t)) return;
        if (s.type === 'incomeDrop') salary *= 1 - s.size / 100;
        if (s.type === 'jobLoss') unemployed = true;
      });
      if (unemployed) { var js = shocks.filter(function (s) { return s.type === 'jobLoss' && shockActive(s, t); })[0]; salary = pos(js.size); }
      // 연말정산 환급형 감면: 환급월에 전년도 감면분 유입
      var taxRefund = 0;
      if (trStart !== null && tr.mode === 'yearEndRefund' && cm === Math.round(num(tr.refundMonth, 2))) {
        var prevY = ymYear(ym) - 1, months = 0;
        for (var k = trStart; k <= trEnd; k++) if (ymYear(ymAdd(base, k)) === prevY) months++;
        taxRefund = Math.min(pos(tr.annualTax) * num(tr.rate, 0.9) * months / 12, pos(tr.annualCap) || Infinity);
        if (taxRefund > 0) events.push('taxRefund');
      }
      var extraIn = (opts.extraIncome && t >= opts.extraIncome.start) ? pos(opts.extraIncome.amount) : 0;
      var income = salary + taxRefund + extraIn;

      // 생활비
      var yr = Math.floor((t - 1) / 12);
      var priceIdx = Math.pow(1 + num(ex.inflation) / 100, yr);
      var ess = pos(ex.essential), opt = pos(ex.optional), cutAmt = 0;
      if (cutAt(t) > 0) {
        cutAmt = cutAt(t);
        var co = Math.min(cutAmt, opt); opt -= co;
        var ce = Math.min(cutAmt - co, Math.max(0, ess - pos(ex.minEssential))); ess -= ce;
        cutAmt = co + ce;
      }
      var expFactor = 1;
      shocks.forEach(function (s) { if (s.type === 'expenseRise' && shockActive(s, t)) expFactor *= 1 + s.size / 100; });
      var essential = ess * priceIdx * expFactor, optional = opt * priceIdx * expFactor;
      var expense = essential + optional;

      // 예금 이자·투자 수익
      emergency *= 1 + saveR; housing *= 1 + saveR; invest *= 1 + invR;
      shocks.forEach(function (s) { if (s.type === 'investLoss' && s.start === t) { invest *= Math.max(0, 1 - s.size / 100); events.push('investLoss'); } });

      // 보증금 반환
      var depositIn = 0;
      if (t === depositIdx && depositPending > 0) { depositIn = depositPending; housing += depositPending; depositPending = 0; events.push('deposit'); }

      // 부채
      var interest = 0, scheduled = 0, freed = 0, totalDue = 0;
      var dues = debts.map(function (x) {
        if (x.balance <= EPS) { freed += x.payment; return 0; }
        var it = x.balance * x.rate / 1200; interest += it; x._int = it;
        var due = Math.min(x.payment, x.balance + it); totalDue += due; return due;
      });
      var debtPaid = 0;
      if (act && act.debt !== undefined) {
        var D = pos(act.debt), sc = totalDue > 0 ? Math.min(1, D / totalDue) : 0;
        debts.forEach(function (x, i) { if (x.balance > EPS) { x.balance = x.balance + x._int - dues[i] * sc; if (x.balance < EPS) x.balance = 0; } });
        debtPaid = totalDue * sc + payHighest(debts, Math.max(0, D - totalDue));
      } else {
        debts.forEach(function (x, i) { if (x.balance > EPS) { x.balance = x.balance + x._int - dues[i]; if (x.balance < EPS) x.balance = 0; } });
        scheduled = totalDue;
        var exStart = pl.extraRepaymentStart && ymValid(pl.extraRepaymentStart) ? ymDiff(base, pl.extraRepaymentStart) : 0;
        var pool = (t >= exStart ? pos(pl.extraRepayment) : 0) + (pl.freedTo === 'otherDebt' ? freed : 0) + cutAmt + extraIn;
        if (opts.trend && t >= opts.trend.from) pool *= opts.trend.factor;
        var extraPaid = totalDebt(debts) > EPS ? payHighest(debts, pool) : 0;
        debtPaid = scheduled + extraPaid;
      }
      debts.forEach(function (x) { if (x.balance <= EPS && x.paidOff === null) { x.paidOff = t; } });
      var principal = debtPaid - interest;

      // 정책상품 납입과 만기 지급
      var productContrib = 0, productPayout = 0;
      prods.forEach(function (p) {
        if (t >= Math.max(1, p.start) && t < p.maturity) {
          var amt = (act && act.products && act.products[p.id] !== undefined) ? pos(act.products[p.id]) : p.monthly * ((opts.trend && t >= opts.trend.from) ? Math.min(1, opts.trend.factor) : 1);
          p.principal += amt; p.gov += amt * p.govRate; p.company += amt * p.companyRate;
          p.contribs.push({ t: t, amt: amt }); productContrib += amt;
        }
        if (t === p.maturity && !p.paid) {
          var intr = 0; p.contribs.forEach(function (c) { intr += c.amt * p.rate * (p.maturity - c.t) / 12; });
          if (!p.taxFree) intr *= 1 - 0.154;
          p.interest = intr;
          p.payoutAmount = p.principal + p.gov + p.company + intr;
          housing += p.payoutAmount; productPayout += p.payoutAmount; p.paid = true; p.payoutMonth = t; events.push('maturity:' + p.id);
        }
      });

      // 실제 지출(확정 기록) 반영 — 저축 기록이 없는 달만. 초과 지출은 저축을 줄이고,
      // 덜 쓴 돈(slack)은 확인 전까지 저축으로 보지 않음(별도 표시).
      var actualExpense = null, overspend = 0, slack = 0;
      if (act && (act.expense !== undefined || act.expenseEssential !== undefined || act.expenseOptional !== undefined)) {
        actualExpense = act.expenseEssential !== undefined || act.expenseOptional !== undefined ? pos(act.expenseEssential) + pos(act.expenseOptional) + pos(act.expense) : pos(act.expense);
        if (actualExpense > expense) overspend = actualExpense - expense; else slack = expense - actualExpense;
      }
      // 잉여자금
      var surplus = income - expense - debtPaid - productContrib;
      var emergencyIn = 0, investIn = 0, housingIn = 0, unfunded = 0, livingCash = null, cashShort = 0;
      var actualMonth = !!act;
      var savingsRecorded = act && (act.emergency !== undefined || act.housing !== undefined);
      if (!savingsRecorded && overspend > 0) surplus -= overspend;
      if (savingsRecorded) {
        // 실제 기록이 있는 달: 기록된 금액을 그대로 반영 (계획 배분 대신)
        emergencyIn = act.emergency !== undefined ? num(act.emergency) : 0;
        housingIn = act.housing !== undefined ? num(act.housing) : 0;
        emergency += emergencyIn; housing += housingIn;
        livingCash = surplus - emergencyIn - housingIn;
      } else if (surplus >= 0) {
        var f = (opts.trend && t >= opts.trend.from) ? opts.trend.factor : 1;
        var toE = Math.min(surplus * f, Math.max(0, emergencyTarget - emergency));
        emergency += toE; emergencyIn = toE;
        var rest = surplus * f - toE;
        investIn = rest * num(pl.investShare) / 100; invest += investIn;
        housingIn = rest - investIn; housing += housingIn;
        livingCash = surplus - surplus * f;
      } else {
        var need = -surplus;
        var a1 = Math.min(need, emergency); emergency -= a1; need -= a1; emergencyIn = -a1;
        var a2 = Math.min(need, housing); housing -= a2; need -= a2; housingIn = -a2;
        var a3 = Math.min(need, invest); invest -= a3; need -= a3; investIn = -a3;
        unfunded = need; if (need > EPS) unfundedTotal += need;
        deficitMonths.push(t);
        livingCash = -need;
      }
      if (savingsRecorded && actualExpense !== null && livingCash !== null) livingCash -= (actualExpense - expense);
      // 가정해보기(저장 안 됨): 이번 달 주거자금 추가 납입
      // 추가 납입은 이번 달 남는 생활자금 → 선택 지출 예산을 줄여서 충당. 그보다 크면 생활자금 부족.
      if (opts.sandbox && opts.sandbox.t === t) {
        var sb = pos(opts.sandbox.amount);
        housing += sb; housingIn += sb;
        livingCash = (livingCash === null ? 0 : livingCash) - sb + optional;
      }
      if (livingCash !== null && livingCash < -EPS) cashShort = -livingCash;

      // 초과소득(성과급·환급 등) 배분
      var bonus = 0;
      d.extraIncome.forEach(function (x) {
        if (!ymValid(x.month) || ymDiff(base, x.month) !== t) return;
        if (x.status !== 'confirmed' && !opts.includeExpected) return;
        var A = pos(x.amount); if (x.kind !== 'surplus') bonus += A; // 확인된 여유자금 배분은 소득이 아님
        var res = allocate(A, d.allocation, { emergencyRoom: Math.max(0, emergencyTarget - emergency), debts: debts });
        emergency += res.emergency; housing += res.housing; emergencyIn += res.emergency; housingIn += res.housing; debtPaid += res.debt; principal += res.debt;
        events.push('bonus');
      });
      income += bonus;

      if (debt0 > EPS && !debtFreeFlag && totalDebt(debts) <= EPS) { debtFreeFlag = true; events.push('debtFree'); }
      if (emergency + EPS >= emergencyTarget && !rows.some(function (r) { return r.events.indexOf('emergencyOk') >= 0; }) && emergencyTarget > 0) events.push('emergencyOk');
      if (t === T) events.push('move');

      rows.push(row(t, {
        income: income, salary: salary, taxRefund: taxRefund, bonus: bonus, essential: essential, optional: optional,
        interest: interest, principal: principal, debtPaid: debtPaid, debtBalance: totalDebt(debts), productContrib: productContrib,
        productPayout: productPayout, productBal: prodBal(), emergencyIn: emergencyIn, emergencyBal: emergency, housingIn: housingIn + depositIn,
        housingBal: housing, investIn: investIn, investBal: invest, depositIn: depositIn, depositPending: depositPending, pension: pension,
        surplus: surplus, unfunded: unfunded, livingCash: livingCash, cashShort: cashShort, actual: actualMonth, unemployed: unemployed, events: events,
        actualExpense: actualExpense, overspend: overspend, slack: slack
      }));
    }

    function prodBal() { var s = 0; prods.forEach(function (p) { if (!p.paid) s += p.principal + p.gov + p.company; }); return s; }
    function row(t, o) { o.month = t; o.ym = ymAdd(base, t); return o; }

    var includeInvest = d.plan.includeInvestment !== false;
    rows.forEach(function (r) {
      r.usableHousing = r.housingBal + (includeInvest ? r.investBal : 0);
      r.debtClear = r.debtBalance <= EPS;
      r.emergencyOk = r.emergencyBal + EPS >= emergencyTarget;
      r.housingOk = r.usableHousing + EPS >= targetTotal;
      r.status = r.debtClear && r.emergencyOk && r.housingOk ? 'achieved' : (r.housingOk ? 'partial' : 'short');
    });

    var at = rows[Math.min(T, rows.length - 1)];
    var debtFree = debt0 <= EPS ? 0 : null;
    for (var i = 0; i < rows.length && debtFree === null; i++) if (rows[i].debtClear) debtFree = rows[i].month;
    var firstAchieved = null;
    for (var j = T; j < rows.length; j++) if (rows[j].status === 'achieved') { firstAchieved = j; break; }
    var emOk = null; for (var e = 0; e < rows.length; e++) if (rows[e].emergencyOk) { emOk = e; break; }
    var negAmort = d.debts.filter(function (x) { return x.balance > 0 && x.payment < x.balance * x.rate / 1200; });
    negAmort.forEach(function (x) { warnings.push({ code: 'negAmort', text: x.name + '의 월 상환액이 이자보다 적어 잔액이 늘어납니다.' }); });
    var unfundedInT = 0; for (var u = 1; u <= T && u < rows.length; u++) unfundedInT += rows[u].unfunded;
    var defInT = deficitMonths.filter(function (m) { return m <= T; });
    if (defInT.length) warnings.push({ code: 'deficit', text: '목표일까지 ' + defInT.length + '개월은 지출·상환·납입이 소득보다 많아 비상금 → 주거자금 → 투자 순으로 꺼내 썼습니다.' + (unfundedInT > EPS ? ' 메우지 못한 금액 ' + Math.round(unfundedInT / 10000).toLocaleString('ko-KR') + '만원.' : '') });

    return {
      data: d, base: base, moveMonth: moveMonth, T: T, rows: rows, at: at, targetTotal: targetTotal, emergencyTarget: emergencyTarget,
      gap: at.usableHousing - targetTotal, status: at.status, debtFree: debtFree, emergencyOkMonth: emOk, firstAchieved: firstAchieved,
      delay: firstAchieved === null ? null : firstAchieved - T, initialLump: lump,
      products: prods.map(function (p) { return { id: p.id, name: p.name, policyId: p.policyId, start: p.start, maturity: p.maturity, maturityYm: ymAdd(base, p.maturity), payoutAmount: p.payoutAmount, paid: p.paid, principal: p.principal, gov: p.gov, company: p.company, interest: p.interest, govPending: p.govPending, beforeTarget: p.maturity <= T, monthly: p.monthly }; }),
      debts: debts.map(function (x) { return { id: x.id, name: x.name, paidOff: x.paidOff, balance: x.balance }; }),
      taxRelief: trStart === null ? null : { start: trStart, end: trEnd, endYm: ymAdd(base, trEnd), monthly: trMonthly, mode: tr.mode },
      unfunded: unfundedInT, deficitMonths: defInT, warnings: warnings, includeInvest: includeInvest
    };
  }

  // 초과소득 배분: 순서 방식 또는 비율 방식(남는 몫은 다음 항목으로)
  function allocate(A, rule, ctx) {
    var out = { emergency: 0, debt: 0, housing: 0 };
    var order = (rule.order && rule.order.length) ? rule.order : ['emergency', 'debt', 'housing'];
    var cap = { emergency: ctx.emergencyRoom, debt: totalDebt(ctx.debts), housing: Infinity };
    function give(item, amt) {
      var g = Math.min(amt, cap[item]);
      if (item === 'debt') g = payHighest(ctx.debts, g);
      cap[item] -= g; out[item] += g; return amt - g;
    }
    if (rule.mode === 'ratio') {
      var r = rule.ratios || {}, carry = 0;
      order.forEach(function (it) { carry = give(it, A * num(r[it]) / 100 + carry); });
      out.housing += carry; // 마지막까지 남은 몫은 주거자금
    } else {
      var left = A; order.forEach(function (it) { left = give(it, left); }); out.housing += left;
    }
    return out;
  }

  var Calc = { simulate: simulate, normalize: normalize, allocate: allocate, ymAdd: ymAdd, ymDiff: ymDiff, ymValid: ymValid, MAX: MAX, EPS: EPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else { root.FP = root.FP || {}; root.FP.Calc = Calc; }
})(this);
