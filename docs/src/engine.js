/*
 * 월별 계산 엔진(명세 3절). 화면과 분리된 순수 함수.
 * - 계산 중에는 반올림하지 않는다. 단위는 만원.
 * - 입력 객체를 바꾸지 않는다(필요한 값은 복사해서 쓴다).
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var policy = isNode ? require('./policy.js') : root.Planner.policy;
  var judgeMod = isNode ? require('./judge.js') : root.Planner.judge;

  var EPS = 1e-9;

  var DEFAULT_ASSUMPTIONS = {
    livingGrowth: 0.02,
    emergencyRate: 0.03,
    housingRate: 0.03,
    investmentRate: 0.04,
    highRateThreshold: 0.04,
    includeInvestmentInHousing: true,
    // 월 이율 환산: 'nominal' = 연이율 ÷ 12(기본), 'effective' = (1 + 연 유효수익률)^(1/12) − 1
    rateBasis: 'nominal'
  };

  /** 연이율 → 한 달 증가 배수 */
  function monthlyFactor(rate, basis) {
    rate = num(rate);
    return basis === 'effective' ? Math.pow(1 + rate, 1 / 12) : 1 + rate / 12;
  }

  function num(x) {
    var n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) target[k] = src[k];
      }
    }
    return target;
  }

  /**
   * 부채 복사. method: 'annuity'(기본, 매달 같은 원리금 monthlyPayment)
   *              | 'equalPrincipal'(원금균등, 매달 원금 monthlyPrincipal + 그 달 이자)
   */
  function copyDebts(debts) {
    return (debts || []).map(function (d, i) {
      return {
        name: d.name || '부채 ' + (i + 1),
        balance: Math.max(0, num(d.balance)),
        rate: Math.max(0, num(d.rate)),
        monthlyPayment: Math.max(0, num(d.monthlyPayment)),
        method: d.method === 'equalPrincipal' ? 'equalPrincipal' : 'annuity',
        monthlyPrincipal: Math.max(0, num(d.monthlyPrincipal))
      };
    });
  }
  /** 이 달 약정 상환액(이자 포함)과 약정 원금 */
  function scheduled(d) {
    var i = d.balance * d.rate / 12;
    if (d.method === 'equalPrincipal') {
      var p = Math.min(d.monthlyPrincipal, d.balance);
      return { interest: i, principal: p, payment: i + p };
    }
    return { interest: i, principal: Math.min(Math.max(0, d.monthlyPayment - i), d.balance), payment: d.monthlyPayment };
  }

  /** 금리 높은 순(같으면 원래 순서) */
  function byRateDesc(list) {
    return list
      .map(function (d, i) { return { d: d, i: i }; })
      .sort(function (a, b) { return b.d.rate - a.d.rate || a.i - b.i; })
      .map(function (x) { return x.d; });
  }

  /**
   * 초기 처리(시작 전 달 말): 목적 미지정 현금에서
   * repayFromCash를 금리가 가장 높은 부채부터 상환하고(다 갚으면 다음 부채로),
   * emergencyFromCash를 비상금으로 옮긴다. 현금이 부족하면 상환을 먼저 한다.
   */
  function applyInitial(customer, initial) {
    customer = customer || {};
    initial = initial || {};
    var debts = copyDebts(customer.debts);
    var cash = Math.max(0, num(customer.cash));
    // 현금화(예: 만기 예·적금, ETF 순매도대금)를 먼저 현금에 더한다. 현금화하지 않은 예·적금은 목적 미지정 자금으로 남는다.
    var liquidate = initial.liquidate || [];
    var savings = Math.max(0, num(customer.savings));
    var investment = Math.max(0, num(customer.investment));
    var liquidated = 0;
    if (liquidate.indexOf('savings') >= 0) { cash += savings; liquidated += savings; savings = 0; }
    if (liquidate.indexOf('investment') >= 0) { cash += investment; liquidated += investment; investment = 0; }

    var repayWanted = Math.max(0, num(initial.repayFromCash));
    var repayLeft = Math.min(repayWanted, cash);
    var repaid = 0;
    var targets = byRateDesc(debts.filter(function (d) { return d.balance > EPS; }));
    for (var i = 0; i < targets.length && repayLeft > EPS; i++) {
      var x = Math.min(repayLeft, targets[i].balance);
      targets[i].balance -= x;
      repayLeft -= x;
      repaid += x;
    }
    cash -= repaid;

    var toEmergency = Math.min(Math.max(0, num(initial.emergencyFromCash)), cash);
    cash -= toEmergency;

    return {
      debts: debts,
      emergency: Math.max(0, num(customer.emergency)) + toEmergency,
      housing: Math.max(0, num(customer.housing)),
      investment: investment,
      pension: Math.max(0, num(customer.pension)),
      repaid: repaid,
      toEmergency: toEmergency,
      liquidated: liquidated,
      cashLeft: cash + savings, // 배정되지 않은 현금·예적금(사용 가능 주거자금에 넣지 않음)
      repayShort: repayWanted - repaid,
      emergencyShort: Math.max(0, num(initial.emergencyFromCash)) - toEmergency
    };
  }

  /**
   * 저장된 상태와 계획 id로 엔진 입력을 만든다.
   * opts:
   *   debtRule: 'default' | 'legacy'
   *   excludeProducts: true면 정책상품을 뺀 결과
   *   endMonth: 계산 종료월(기본 targetMonth)
   *   planOverrides / customerOverrides / goalOverrides / assumptionOverrides
   *   incomeCut: 실수령 감소율(0.1 = 10%)
   *   hooks: { income(base, ctx), living({essential, optional}, ctx) } — 시나리오용(2단계)
   */
  function buildInput(state, planId, opts) {
    opts = opts || {};
    var plans = (state && state.plans) || [];
    var basePlan = null;
    for (var i = 0; i < plans.length; i++) if (plans[i].id === planId) basePlan = plans[i];
    if (!basePlan) throw new Error('계획을 찾을 수 없습니다: ' + planId);

    var plan = assign({}, basePlan, opts.planOverrides);
    var customer = assign({}, state.customer, opts.customerOverrides);
    // 목표: 고객 목표 → 계획 버전의 목표 변경(plan.goal) → 화면의 임시 변경 순으로 덮어쓴다
    var goal = assign({}, customer.goal, plan.goal, opts.goalOverrides);
    var assumptions = assign({}, DEFAULT_ASSUMPTIONS, state.assumptions, opts.assumptionOverrides);
    var products = opts.excludeProducts ? [] : policy.resolveProducts(plan.products, customer);
    if (opts.excludeBankProducts) products = products.filter(function (p) { return p.type !== 'bank'; });
    // 계획별 부채 조정(예: 원금균등 대출의 월 원금을 계획에서 바꿈) — 이름으로 찾는다
    var debtOverrides = plan.debtOverrides || {};
    customer.debts = (customer.debts || []).map(function (d) { return assign({}, d, debtOverrides[d.name]); });

    return {
      planId: plan.id,
      startMonth: plan.startMonth,
      targetMonth: plan.targetMonth,
      endMonth: opts.endMonth || plan.targetMonth,
      netMonthly: num(customer.netMonthly) * (1 - num(opts.incomeCut)),
      taxExemption: customer.taxExemption || null,
      essential: num(plan.essential),
      optional: num(plan.optional),
      extraRepayment: Math.max(0, num(plan.extraRepayment)),
      budgetAdjustments: plan.budgetAdjustments || [],
      // 확정된 초과소득만 계산에 넣는다. '예상'은 확정 재원에서 뺀다(명세 6-2 소득 가정).
      windfalls: (opts.windfalls || plan.windfalls || []).filter(function (w) { return w && w.status === '확정'; }),
      products: products,
      initial: applyInitial(customer, plan.initial || state.initial),
      pensionMonthly: Math.max(0, num(plan.pensionMonthly)),
      depositReturn: customer.depositReturn || null,
      assumptions: assumptions,
      goal: goal,
      debtRule: opts.debtRule === 'legacy' ? 'legacy' : 'default',
      hooks: opts.hooks || null
    };
  }

  function inWindow(t, startYM, months) {
    var s = dates.parseYM(startYM);
    return Number.isFinite(s) && t >= s && t < s + months;
  }

  /**
   * 월별 계산.
   * @returns {{rows, initial, events, payoff:{all, high}}}
   */
  function simulate(input) {
    var a = input.assumptions;
    var thr = num(a.highRateThreshold);
    var legacy = input.debtRule === 'legacy';
    var start = dates.parseYM(input.startMonth);
    var end = dates.parseYM(input.endMonth);
    var taxEnd = input.taxExemption && input.taxExemption.applied ? dates.parseYM(input.taxExemption.end) : NaN;
    var depMonth = input.depositReturn ? dates.parseYM(input.depositReturn.month) : NaN;
    var depAmount = input.depositReturn ? Math.max(0, num(input.depositReturn.amount)) : 0;
    var emTarget = Math.max(0, num(input.goal.emergencyTarget));
    var hooks = input.hooks || {};

    var init = input.initial;
    var debts = copyDebts(init.debts);
    var em = init.emergency;
    var ho = init.housing;
    var inv = init.investment;
    var pen = init.pension;
    var basis = a.rateBasis;
    var prodBal = {};
    var prodContrib = {}; // 은행 적금: 납입 회차별 기록(만기 이자 계산용)
    input.products.forEach(function (p) { prodBal[p.key] = 0; prodContrib[p.key] = []; });

    var rows = [];
    var events = [];
    var payoffAll = null;
    var payoffHigh = null;
    var emergencyReached = null;

    var highOf = function () {
      return debts.reduce(function (s, d) { return s + (d.rate >= thr ? d.balance : 0); }, 0);
    };
    var totalOf = function () {
      return debts.reduce(function (s, d) { return s + d.balance; }, 0);
    };
    // 처음부터 부채가 없으면 상환 완료월은 null로 둔다(이벤트 없음)
    var hadDebt = totalOf() > EPS;
    var hadHigh = highOf() > EPS;

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return { rows: rows, initial: init, events: events, payoff: { all: null, high: null } };
    }

    for (var t = start, m = 1; t <= end; t++, m++) {
      var ym = dates.formatYM(t);
      var ctx = { month: ym, m: m };

      // 1. 소득
      var income = input.netMonthly;
      if (Number.isFinite(taxEnd) && t > taxEnd) income -= num(input.taxExemption.monthlyEffect);
      if (typeof hooks.income === 'function') income = num(hooks.income(income, ctx));

      // 2. 생활비
      var g = Math.pow(1 + num(a.livingGrowth), Math.floor((m - 1) / 12));
      var essential = input.essential * g;
      var optional = input.optional * g;
      input.budgetAdjustments.forEach(function (adj) {
        // months가 없거나 0이면 계산 끝까지 적용. grow가 true면 조정액에도 생활비 증가율을 곱한다.
        var span = num(adj.months) > 0 ? num(adj.months) : Infinity;
        if (inWindow(t, adj.start, span)) {
          var f = adj.grow ? g : 1;
          essential += num(adj.essential) * f;
          optional += num(adj.optional) * f;
        }
      });
      essential = Math.max(0, essential);
      optional = Math.max(0, optional);
      if (typeof hooks.living === 'function') {
        var lv = hooks.living({ essential: essential, optional: optional }, ctx);
        essential = num(lv.essential);
        optional = num(lv.optional);
      }

      // 3. 부채(이 달 초에 잔액이 있는 부채만)
      var active = debts.filter(function (d) { return d.balance > EPS; });
      var budget = active.length
        ? active.reduce(function (s, d) { return s + scheduled(d).payment; }, 0) + input.extraRepayment
        : 0;
      // 실행 기록 반영용: 실제로 낸 상환액(이자+원금)으로 예산을 바꾼다. 약정분보다 적으면 그만큼만 낸다.
      if (active.length && typeof hooks.debtBudget === 'function') budget = Math.max(0, num(hooks.debtBudget(budget, ctx)));
      var interest = 0;
      var principal = 0;
      var left = budget;
      active.forEach(function (d) {
        var sc = scheduled(d);
        var i = sc.interest;
        var pr = sc.principal;
        // 보통은 예산이 약정분 이상이라 그대로 낸다. 실제 기록이 약정분보다 적으면 이자 → 원금 순으로 내고,
        // 못 낸 이자는 잔액에 더한다.
        var payI = Math.min(i, left);
        left -= payI;
        var payP = Math.min(pr, left);
        left -= payP;
        interest += payI;
        principal += payP;
        d.balance += i - payI - payP;
      });
      var remaining = Math.max(0, left);
      var extraTargets = byRateDesc(active.filter(function (d) {
        return d.balance > EPS && (legacy || d.rate >= thr);
      }));
      for (var k = 0; k < extraTargets.length && remaining > EPS; k++) {
        var x = Math.min(remaining, extraTargets[k].balance);
        extraTargets[k].balance -= x;
        principal += x;
        remaining -= x;
      }
      // 남은 예산(대상 없음)은 상환하지 않고 잉여로 넘어간다 — 아래 잉여 식에 자동 반영

      // 6-1. 이번 달 상품 납입액
      var productPay = 0;
      input.products.forEach(function (p) {
        if (inWindow(t, p.start, p.months)) productPay += p.monthly;
      });

      // 6-2. 연금저축 납입(주거·비상금 재원이 아님). 시나리오로 멈출 수 있다.
      var pensionPay = input.pensionMonthly;
      if (typeof hooks.pension === 'function') pensionPay = Math.max(0, num(hooks.pension(pensionPay, ctx)));

      // 4. 잉여
      var surplus = income - essential - optional - interest - principal - productPay - pensionPay;

      // 5. 잔액 증가(이번 달 납입 전 잔액에만)
      em *= monthlyFactor(a.emergencyRate, basis);
      ho *= monthlyFactor(a.housingRate, basis);
      inv *= monthlyFactor(a.investmentRate, basis);
      pen += pensionPay; // 연금 수익은 계산하지 않음(은퇴 충분성은 범위 밖)
      // 시나리오: 투자 손실 등(이번 달 증가 후 잔액에 적용)
      if (typeof hooks.investment === 'function') inv = Math.max(0, num(hooks.investment(inv, ctx)));

      // 6. 상품 적립·만기(만기월 = 시작월 + 기간, 그 달에는 납입 없음)
      var maturity = 0;
      input.products.forEach(function (p) {
        if (inWindow(t, p.start, p.months)) {
          prodBal[p.key] += p.monthly * (1 + p.contributionRate);
          prodContrib[p.key].push({ t: t, amount: p.monthly });
        }
        if (p.months > 0 && t === dates.parseYM(p.start) + p.months) {
          var payout = prodBal[p.key];
          if (p.type === 'bank') {
            // 은행 적금(단리): 회차별 납입액 × 연이율 × 운용개월/12. 첫 회 n개월 … 마지막 회 1개월. 세금은 이자에만.
            var pre = prodContrib[p.key].reduce(function (s2, c) { return s2 + c.amount * num(p.rate) * (t - c.t) / 12; }, 0);
            var tax = p.taxFree ? 0 : pre * num(p.taxRate);
            payout += pre - tax;
            events.push({ type: 'productMaturity', month: ym, label: p.name + ' 만기', amount: payout, interest: pre - tax });
          } else {
            events.push({ type: 'productMaturity', month: ym, label: p.name + ' 만기', amount: payout });
          }
          maturity += payout;
          prodBal[p.key] = 0;
          prodContrib[p.key] = [];
        }
      });
      ho += maturity;

      // 7. 보증금 반환
      var depositIn = 0;
      if (t === depMonth) {
        depositIn = depAmount;
        ho += depositIn;
      }

      // 8. 배분
      var emIn = 0;
      var hoIn = 0;
      var deficit = 0;
      if (surplus >= 0) {
        emIn = Math.min(Math.max(0, emTarget - em), surplus);
        hoIn = surplus - emIn;
      } else {
        var need = -surplus;
        var fromEm = Math.min(need, em);
        need -= fromEm;
        var fromHo = Math.min(need, ho);
        need -= fromHo;
        emIn = -fromEm;
        hoIn = -fromHo;
        deficit = need;
      }
      em += emIn;
      ho += hoIn;

      // 9. 확정 초과소득(성과급 등): 비상금(목표까지) → 고금리 부채 → 주거자금. '예상' 상태는 입력 단계에서 뺀다.
      var windfall = 0;
      var wfEm = 0;
      var wfDebt = 0;
      var wfHo = 0;
      input.windfalls.forEach(function (w) {
        if (dates.parseYM(w.month) === t) windfall += Math.max(0, num(w.amount));
      });
      if (windfall > 0) {
        var wl = windfall;
        // 미충당 적자가 있으면 먼저 메운다
        var cover = Math.min(wl, deficit);
        deficit -= cover;
        wl -= cover;
        wfEm = Math.min(wl, Math.max(0, emTarget - em));
        em += wfEm;
        wl -= wfEm;
        var wTargets = byRateDesc(debts.filter(function (d) { return d.balance > EPS && (legacy || d.rate >= thr); }));
        for (var w2 = 0; w2 < wTargets.length && wl > EPS; w2++) {
          var y = Math.min(wl, wTargets[w2].balance);
          wTargets[w2].balance -= y;
          wfDebt += y;
          wl -= y;
        }
        wfHo = wl;
        ho += wfHo;
      }

      var debtTotal = totalOf();
      var debtHigh = highOf();
      var productBalance = 0;
      for (var key in prodBal) productBalance += prodBal[key];
      var usable = ho + (a.includeInvestmentInHousing ? inv : 0);

      if (payoffAll === null && hadDebt && debtTotal <= EPS) {
        payoffAll = ym;
        events.push({ type: 'debtPaidOff', month: ym, label: '부채 상환 완료' });
      }
      if (payoffHigh === null && hadHigh && debtHigh <= EPS) {
        payoffHigh = ym;
        events.push({ type: 'highDebtPaidOff', month: ym, label: '고금리 부채 상환 완료' });
      }
      if (emergencyReached === null && emTarget > 0 && em >= emTarget - EPS) {
        emergencyReached = ym;
        events.push({ type: 'emergencyReached', month: ym, label: '비상금 확보' });
      }
      if (depositIn > 0) events.push({ type: 'depositReturn', month: ym, label: '보증금 반환', amount: depositIn });
      if (Number.isFinite(taxEnd) && t === taxEnd + 1) events.push({ type: 'taxExemptionEnd', month: ym, label: '소득세 감면 종료' });

      var row = {
        month: ym,
        m: m,
        income: income,
        essential: essential,
        optional: optional,
        interest: interest,
        principal: principal,
        debtTotal: debtTotal,
        debtHigh: debtHigh,
        debtLow: debtTotal - debtHigh,
        debtBalances: debts.map(function (d) { return d.balance; }),
        productPay: productPay,
        productBalance: productBalance,
        pensionPay: pensionPay,
        pension: pen,
        surplus: surplus,
        emergencyIn: emIn,
        emergency: em,
        housingIn: hoIn,
        depositReturn: depositIn,
        productMaturity: maturity,
        housing: ho,
        investment: inv,
        usableCash: ho,
        usable: usable,
        deficit: deficit,
        windfall: windfall,
        windfallToEmergency: wfEm,
        windfallToDebt: wfDebt,
        windfallToHousing: wfHo
      };
      row.verdict = judgeMod.evaluate(row, input.goal, input.debtRule).status;
      rows.push(row);
    }

    if (dates.isValidYM(input.targetMonth)) {
      events.push({ type: 'move', month: input.targetMonth, label: '이사 예정' });
    }

    return { rows: rows, initial: init, events: events, payoff: { all: payoffAll, high: payoffHigh } };
  }

  /** 계획 하나를 계산하고 목표월 판정까지 붙인다. */
  function runPlan(state, planId, opts) {
    var input = buildInput(state, planId, opts);
    var result = simulate(input);
    result.input = input;
    result.judgement = judgeMod.judge(result.rows, input.targetMonth, input.goal, input.debtRule);
    return result;
  }

  function rowAt(result, month) {
    for (var i = 0; i < result.rows.length; i++) if (result.rows[i].month === month) return result.rows[i];
    return null;
  }

  var api = {
    DEFAULT_ASSUMPTIONS: DEFAULT_ASSUMPTIONS,
    monthlyFactor: monthlyFactor,
    applyInitial: applyInitial,
    buildInput: buildInput,
    simulate: simulate,
    runPlan: runPlan,
    rowAt: rowAt
  };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.engine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
