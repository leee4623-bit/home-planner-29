/*
 * 입력 모순 검증(명세 5절). 저장은 막지 않고, 경고 배지와 사유만 돌려준다.
 * level: 'error'(계산이 성립하지 않음) | 'warn'(모순·확인 필요) | 'info'(참고)
 * 메시지는 사람이 읽는 문장만 쓴다(변수 이름 노출 금지).
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var policiesData = isNode ? require('../data/policies.js') : root.Planner.policies;
  var fmt = isNode ? require('./format.js') : root.Planner.format;

  function num(x) {
    var n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  function isBlank(x) {
    return x === undefined || x === null || x === '';
  }

  function todayYM(state, opts) {
    if (opts && opts.today) return dates.ymOf(opts.today);
    if (state && state.demoToday) return dates.ymOf(state.demoToday);
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /**
   * @param {object} state 저장 상태
   * @param {object} opts { planId(검사할 계획, 기본 activePlanId), today('YYYY-MM-DD') }
   * @returns {Array<{code, level, field, message}>}
   */
  function validateState(state, opts) {
    opts = opts || {};
    var issues = [];
    var add = function (code, level, field, message) {
      issues.push({ code: code, level: level, field: field, message: message });
    };
    var c = (state && state.customer) || {};
    var te = c.taxExemption || {};
    var now = todayYM(state, opts);

    // 날짜 형식
    [['birth', '출생 연월'], ['firstJob', '최초 취업월']].forEach(function (f) {
      if (!isBlank(c[f[0]]) && !dates.isValidYM(c[f[0]])) {
        add('YM_FORMAT', 'error', f[0], f[1] + '은(는) 2026-09처럼 연-월 형식으로 입력해 주세요.');
      }
    });

    // 4. 나이(계산은 dates.ageAt 한 곳에서만)
    var age = dates.ageAt(c.birth, now);
    if (!isBlank(c.birth) && dates.isValidYM(c.birth)) {
      if (age === null) add('BIRTH_FUTURE', 'error', 'birth', '출생 연월이 오늘보다 늦습니다.');
      else if (age < 15 || age > 100) add('AGE_RANGE', 'warn', 'birth', '나이가 만 ' + age + '세로 계산됩니다. 출생 연월을 확인해 주세요.');
    }

    // 1. 중소기업이 아닌데 중소기업 취업자 소득세 감면 적용
    if (te.applied && c.companySize && c.companySize !== '중소기업') {
      add('TAX_NOT_SME', 'warn', 'taxExemption',
        '회사 규모가 ' + c.companySize + '인데 중소기업 취업 청년 소득세 감면을 적용 중으로 입력했습니다.');
    }

    // 2. 최초 취업월과 감면 대상 최초 취업월이 다름
    if (te.applied && dates.isValidYM(c.firstJob) && dates.isValidYM(te.start) && te.start !== c.firstJob) {
      add('TAX_START_MISMATCH', 'warn', 'taxExemption',
        '최초 취업월(' + c.firstJob + ')과 감면 시작월(' + te.start + ')이 다릅니다. 이직했다면 감면 기간이 달라질 수 있습니다.');
    }
    if (te.applied && dates.isValidYM(te.start) && dates.isValidYM(te.end)) {
      var span = dates.diffMonths(te.start, te.end) + 1;
      if (span <= 0) add('TAX_RANGE', 'error', 'taxExemption', '감면 종료월이 시작월보다 빠릅니다.');
      else if (span > 60) add('TAX_TOO_LONG', 'warn', 'taxExemption', '감면 기간이 ' + span + '개월입니다. 법정 감면 기간은 5년(60개월)입니다.');
    }
    if (te.applied && !dates.isValidYM(te.end)) {
      add('TAX_END_MISSING', 'warn', 'taxExemption', '감면을 적용 중인데 종료월이 없어 종료 후 실수령 감소를 계산할 수 없습니다.');
    }

    // 3. 최초 취업월이 미래인데 직전연도 총급여가 있음
    if (dates.isValidYM(c.firstJob) && num(c.grossPrevYear) > 0) {
      if (dates.parseYM(c.firstJob) > dates.parseYM(now)) {
        add('FIRSTJOB_FUTURE_GROSS', 'warn', 'grossPrevYear', '최초 취업월이 미래인데 직전연도 총급여가 입력되어 있습니다.');
      } else if (Number(c.firstJob.slice(0, 4)) >= Number(now.slice(0, 4))) {
        add('FIRSTJOB_THIS_YEAR_GROSS', 'info', 'grossPrevYear', '올해 처음 취업했다면 직전연도 총급여는 0이어야 합니다. 이전 직장 소득인지 확인해 주세요.');
      }
    }

    // 6. 숫자 범위
    var negFields = [
      ['netMonthly', '월 실수령'], ['grossPrevYear', '직전연도 총급여'], ['cash', '현금·예금'],
      ['emergency', '비상금'], ['housing', '주거자금'], ['investment', '투자자산'], ['pension', '연금']
    ];
    negFields.forEach(function (f) {
      if (num(c[f[0]]) < 0) add('NEGATIVE', 'error', f[0], f[1] + '은(는) 0 이상이어야 합니다.');
    });

    var initial = (state && state.initial) || {};
    var useCash = num(initial.repayFromCash) + num(initial.emergencyFromCash);
    if (useCash > num(c.cash) + 1e-9) {
      add('INITIAL_OVER_CASH', 'warn', 'initial',
        '초기 처리에 쓰려는 금액(' + fmt.short(useCash) + '만원)이 현금·예금(' + fmt.short(num(c.cash)) + '만원)보다 많습니다. 상환을 먼저 하고 나머지만 비상금으로 옮깁니다.');
    }

    (c.debts || []).forEach(function (d, i) {
      var name = d.name || i + 1 + '번째 부채';
      var bal = num(d.balance);
      var rate = num(d.rate);
      var pay = num(d.monthlyPayment);
      if (bal < 0 || rate < 0 || pay < 0) add('DEBT_NEGATIVE', 'error', 'debts', name + ': 잔액·금리·월 상환액은 0 이상이어야 합니다.');
      if (rate > 0.2) add('DEBT_RATE_HIGH', 'warn', 'debts', name + ': 연 금리 ' + fmt.short(rate * 100) + '%가 맞는지 확인해 주세요(소수로 입력했는지 확인).');
      var interest = bal * rate / 12;
      if (bal > 0 && pay <= interest + 1e-9) {
        add('DEBT_UNPAYABLE', 'error', 'debts',
          name + ': 월 상환액(' + fmt.short(pay) + '만원)이 월 이자(' + fmt.num1(interest) + '만원)보다 작거나 같아 원금이 줄지 않습니다.');
      }
    });

    var goal = c.goal || {};
    if (num(goal.depositTarget) < 0 || num(goal.movingCost) < 0 || num(goal.emergencyTarget) < 0) {
      add('GOAL_NEGATIVE', 'error', 'goal', '목표 금액은 0 이상이어야 합니다.');
    }

    // 계획별 검사
    var plans = (state && state.plans) || [];
    var planId = opts.planId || (state && state.activePlanId);
    var plan = plans.filter(function (p) { return p.id === planId; })[0];
    if (plan) {
      var label = plan.name ? '「' + plan.name + '」 ' : '';
      if (!dates.isValidYM(plan.startMonth) || !dates.isValidYM(plan.targetMonth)) {
        add('PLAN_YM', 'error', 'plan', label + '시작월과 이사 예정월을 연-월 형식으로 입력해 주세요.');
      } else if (dates.parseYM(plan.targetMonth) < dates.parseYM(plan.startMonth)) {
        add('PLAN_ORDER', 'error', 'plan', label + '이사 예정월이 시작월보다 빠릅니다.');
      }
      var ess = num(plan.essential);
      var opt = num(plan.optional);
      var net = num(c.netMonthly);
      if (ess < 0 || opt < 0 || num(plan.extraRepayment) < 0) add('PLAN_NEGATIVE', 'error', 'plan', label + '생활비와 추가 상환은 0 이상이어야 합니다.');
      if (ess > net) add('ESSENTIAL_OVER_INCOME', 'warn', 'plan', label + '필수생활비(' + fmt.short(ess) + '만원)가 월 실수령(' + fmt.short(net) + '만원)보다 큽니다.');
      else if (ess + opt > net) add('LIVING_OVER_INCOME', 'warn', 'plan', label + '생활비 합계(' + fmt.short(ess + opt) + '만원)가 월 실수령보다 큽니다.');

      // 5. 보증금 반환월이 이사 예정월보다 늦음
      var dr = c.depositReturn || {};
      if (num(dr.amount) > 0 && dates.isValidYM(dr.month) && dates.isValidYM(plan.targetMonth)) {
        var gap = dates.diffMonths(dr.month, plan.targetMonth);
        if (gap < 0) {
          add('DEPOSIT_AFTER_MOVE', 'warn', 'depositReturn',
            '보증금 반환월(' + dr.month + ')이 이사 예정월(' + plan.targetMonth + ')보다 늦어 이사 자금으로 쓸 수 없습니다.');
        } else if (gap > 0) {
          add('DEPOSIT_BEFORE_MOVE', 'info', 'depositReturn',
            '보증금이 이사 ' + gap + '개월 전에 돌아옵니다. 그 사이 주거비(재계약·임시 거처)는 계획에 반영되어 있지 않습니다.');
        }
      }

      // 정책상품
      (plan.products || []).forEach(function (p) {
        var pol = policiesData.getPolicy(p.policyId);
        var pname = pol ? pol.name : '정책상품';
        if (pol && pol.monthlyMax && num(p.monthly) > pol.monthlyMax) {
          add('PRODUCT_OVER_MAX', 'warn', 'products', pname + ': 월 납입 ' + fmt.short(num(p.monthly)) + '만원이 한도(' + pol.monthlyMax + '만원)를 넘습니다.');
        }
        if (pol && pol.monthlyMin && num(p.monthly) > 0 && num(p.monthly) < pol.monthlyMin) {
          add('PRODUCT_UNDER_MIN', 'warn', 'products', pname + ': 월 납입이 최소 금액(' + pol.monthlyMin + '만원)보다 적습니다.');
        }
        if (pol && pol.termMonths && num(p.months) && num(p.months) !== pol.termMonths) {
          add('PRODUCT_TERM', 'info', 'products', pname + ': 기간 ' + num(p.months) + '개월이 정책 만기(' + pol.termMonths + '개월)와 다릅니다.');
        }
        if (dates.isValidYM(p.start) && dates.isValidYM(plan.targetMonth)) {
          var maturity = dates.addMonths(p.start, num(p.months || (pol && pol.termMonths)));
          if (dates.parseYM(maturity) > dates.parseYM(plan.targetMonth)) {
            add('PRODUCT_AFTER_MOVE', 'warn', 'products', pname + ': 만기(' + maturity + ')가 이사 예정월보다 늦어 목표일 재원이 아닙니다.');
          }
        }
      });
    }

    var order = { error: 0, warn: 1, info: 2 };
    issues.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return issues;
  }

  /** 배지용 요약 */
  function summarize(issues) {
    var s = { error: 0, warn: 0, info: 0 };
    issues.forEach(function (i) { s[i.level]++; });
    return s;
  }

  var api = { validateState: validateState, summarize: summarize };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.validate = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
