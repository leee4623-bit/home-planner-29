/*
 * 정책상품 조건·출처·확인일 (명세 8절).
 * 주의: 아래 수치는 CLAUDE.md 명세에 적힌 값을 옮긴 것이며, 공식 기관 원문과 대조하기 전이다.
 * 그래서 status는 모두 '확인 필요'로 두고, 원문 대조 후 '확정'/'잠정'으로 바꾼다.
 * 금액 단위: 만원. 비율: 소수(0.06 = 6%).
 */
(function (root) {
  'use strict';

  var POLICIES = [
    {
      id: 'youth-future',
      kind: 'saving',
      name: '청년미래적금',
      agency: '금융위원회',
      ageMin: 19,
      ageMax: 34,
      termMonths: 36,
      monthlyMax: 50,
      tiers: [
        { key: 'preferred', name: '우대형', grossMax: 3600, requireSME: true, contributionRate: 0.12 },
        { key: 'general', name: '일반형', grossMax: 6000, requireSME: false, contributionRate: 0.06 }
      ],
      taxFree: true,
      rounds: [
        { name: '1차', start: '2026-06-22', end: '2026-07-03', state: '종료' },
        { name: '2차', start: '2026-10-07', end: '2026-10-16', state: '종료' },
        { name: '3차', start: null, end: null, state: '미정(2027년 예산 확정 후)' }
      ],
      conditions: [
        '만 19~34세',
        '3년 만기, 월 최대 50만원',
        '일반형: 직전연도 총급여 6,000만원 이하, 정부기여 6%',
        '우대형: 총급여 3,600만원 이하 중소기업 재직, 정부기여 12%',
        '이자 비과세'
      ],
      source: '금융위원회 발표 자료(명세 기재 내용, 원문 대조 전)',
      checkedAt: '2026-11-05',
      status: '확인 필요',
      note: '시연 계획에서는 조건부 재원으로 표시하고 포함·제외 결과를 함께 보여준다. 2차 신청이 끝났으므로 실제 가입 여부를 확인해야 한다.'
    },
    {
      id: 'sme-saving',
      kind: 'saving',
      name: '중소기업 재직자 우대 저축공제',
      agency: '중소벤처기업부',
      termMonths: 60,
      monthlyMin: 10,
      monthlyMax: 50,
      requireSME: true,
      requireEmployerJoin: true,
      employerMatchRate: 0.2,
      bankRateMax: 0.045,
      conditions: [
        '근로자 월 10~50만원 납입',
        '기업이 납입액의 20%를 매칭(기업 참여 필요)',
        '5년 만기, 은행 우대금리 최대 연 4.5%',
        '만기가 이사 목표일보다 늦으면 목표일 재원에서 제외'
      ],
      source: '중소벤처기업부 발표 자료(명세 기재 내용, 원문 대조 전)',
      checkedAt: '2026-11-05',
      status: '확인 필요',
      note: ''
    },
    {
      id: 'sme-tax',
      kind: 'tax',
      name: '중소기업 취업 청년 소득세 감면',
      agency: '국세청',
      law: '조세특례제한법 제30조',
      termMonths: 60,
      rate: 0.9,
      annualCap: 200,
      requireSME: true,
      conditions: [
        '중소기업 취업 청년',
        '취업일부터 5년간 소득세 90% 감면, 연 200만원 한도',
        '이미 급여에 반영돼 있으면 실수령에 더하지 않고, 종료 후 실수령 감소를 반영'
      ],
      source: '조세특례제한법 제30조(명세 기재 내용, 원문 대조 전)',
      checkedAt: '2026-11-05',
      status: '확인 필요',
      note: ''
    },
    {
      id: 'beotimmok-youth',
      kind: 'loan',
      name: '청년전용 버팀목전세자금',
      agency: '주택도시기금',
      ageMin: 19,
      ageMax: 34,
      incomeMax: 5000,
      depositMax: 30000,
      loanRatio: 0.8,
      loanCap: 15000,
      smePreferentialRateCut: 0.003,
      conditions: [
        '만 19~34세, 연소득 5,000만원 이하',
        '임차보증금 3억원 이하',
        '보증금의 80%, 최대 1.5억원',
        '중소기업 재직 청년 0.3%p 우대'
      ],
      source: '주택도시기금 안내(명세 기재 내용, 원문 대조 전)',
      checkedAt: '2026-11-05',
      status: '확인 필요',
      note: '"대출 활용 비교안"으로만 보여주며 무대출 목표 충족으로 계산하지 않는다. 대출금은 소득·순자산 증가로 세지 않는다.'
    }
  ];

  function getPolicy(id) {
    for (var i = 0; i < POLICIES.length; i++) {
      if (POLICIES[i].id === id) return POLICIES[i];
    }
    return null;
  }

  var api = { POLICIES: POLICIES, getPolicy: getPolicy };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.policies = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
