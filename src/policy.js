/* 정책상품 가입 조건 판정과 계획 상품의 기여율 확정(순수 함수). */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var policiesData = isNode ? require('../data/policies.js') : root.Planner.policies;

  var OK = '충족';
  var CHECK = '확인 필요';
  var NO = '불충족';

  function num(x) {
    var n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  function overall(checks) {
    var hasNo = false;
    var hasCheck = false;
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].result === NO) hasNo = true;
      else if (checks[i].result === CHECK) hasCheck = true;
    }
    return hasNo ? NO : hasCheck ? CHECK : OK;
  }

  function ageCheck(policy, customer, ym) {
    var age = dates.ageAt(customer.birth, ym);
    if (age === null) return { label: '나이', result: CHECK, detail: '출생 연월이 없음' };
    var ok = age >= policy.ageMin && age <= policy.ageMax;
    return {
      label: '나이',
      result: ok ? OK : NO,
      detail: '만 ' + age + '세(' + ym + ' 기준), 조건 만 ' + policy.ageMin + '~' + policy.ageMax + '세'
    };
  }

  function smeCheck(customer) {
    if (!customer.companySize) return { label: '회사 규모', result: CHECK, detail: '회사 규모가 없음' };
    var ok = customer.companySize === '중소기업';
    return { label: '회사 규모', result: ok ? OK : NO, detail: customer.companySize };
  }

  /**
   * 정책 가입 조건 판정.
   * @returns {{status, tier, contributionRate, checks:[{label,result,detail}]}}
   */
  function checkEligibility(policy, customer, ym) {
    customer = customer || {};
    var checks = [];
    var tier = null;
    var rate = 0;

    if (!policy) {
      return { status: CHECK, tier: null, contributionRate: 0, checks: [{ label: '정책', result: CHECK, detail: '정책 정보를 찾을 수 없음' }] };
    }

    if (policy.id === 'youth-future') {
      checks.push(ageCheck(policy, customer, ym));
      var gross = num(customer.grossPrevYear);
      for (var i = 0; i < policy.tiers.length; i++) {
        var t = policy.tiers[i];
        if (gross <= t.grossMax && (!t.requireSME || customer.companySize === '중소기업')) {
          tier = t;
          break;
        }
      }
      checks.push({
        label: '소득 유형',
        result: tier ? OK : NO,
        detail: tier
          ? tier.name + '(총급여 ' + gross + '만원, 정부기여 ' + Math.round(tier.contributionRate * 100) + '%)'
          : '총급여 ' + gross + '만원으로 기준 초과'
      });
      checks.push({ label: '신청 회차', result: CHECK, detail: '1·2차 신청 종료, 3차는 2027년 예산 확정 후. 실제 가입 여부 확인 필요' });
      rate = tier ? tier.contributionRate : 0;
    } else if (policy.id === 'sme-saving') {
      checks.push(smeCheck(customer));
      checks.push({ label: '기업 참여', result: CHECK, detail: '재직 기업의 참여 여부 확인 필요' });
      rate = policy.employerMatchRate;
    } else if (policy.id === 'sme-tax') {
      checks.push(smeCheck(customer));
      var te = customer.taxExemption || {};
      checks.push({
        label: '감면 기간',
        result: te.start && te.end ? OK : CHECK,
        detail: te.start && te.end ? te.start + ' ~ ' + te.end : '감면 기간이 없음'
      });
    } else if (policy.id === 'beotimmok-youth') {
      checks.push(ageCheck(policy, customer, ym));
      var g2 = num(customer.grossPrevYear);
      checks.push({
        label: '연소득',
        result: g2 <= policy.incomeMax ? OK : NO,
        detail: g2 + '만원, 조건 ' + policy.incomeMax + '만원 이하'
      });
    } else {
      checks.push({ label: '조건', result: CHECK, detail: '판정 규칙이 없는 정책' });
    }

    return { status: overall(checks), tier: tier ? tier.key : null, contributionRate: rate, checks: checks };
  }

  /**
   * 계획의 상품 목록에 기여율·만기를 확정해 엔진 입력으로 만든다.
   * 상품에 contributionRate가 직접 있으면 그 값을 우선한다.
   * 판정이 '불충족'이면 기여율 0(납입액만 적립).
   */
  function resolveProducts(products, customer) {
    var out = [];
    (products || []).forEach(function (p, idx) {
      var policy = policiesData.getPolicy(p.policyId);
      var elig = checkEligibility(policy, customer, p.start);
      var rate = p.contributionRate !== undefined ? num(p.contributionRate) : elig.status === NO ? 0 : elig.contributionRate;
      out.push({
        key: p.policyId ? p.policyId + '#' + idx : 'product#' + idx,
        policyId: p.policyId || null,
        name: policy ? policy.name : p.name || '상품',
        monthly: num(p.monthly),
        start: p.start,
        months: Math.max(0, Math.floor(num(p.months || (policy && policy.termMonths)))),
        contributionRate: rate,
        conditional: !!p.conditional,
        eligibility: elig.status,
        // 은행 적금(type: 'bank'): 연 단리 rate, 이자소득세 taxRate(기본 15.4%), 비과세면 taxFree
        type: p.type === 'bank' ? 'bank' : 'policy',
        rate: num(p.rate),
        taxRate: p.taxRate === undefined ? 0.154 : num(p.taxRate),
        taxFree: !!p.taxFree,
        sourceId: p.sourceId || null
      });
    });
    return out;
  }

  var api = {
    STATUS: { OK: OK, CHECK: CHECK, NO: NO },
    checkEligibility: checkEligibility,
    resolveProducts: resolveProducts
  };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.policy = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
