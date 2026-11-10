/*
 * 시연 데이터. getDemo(): 보고서 가상 고객(B안), getLegacyDemo(): 이전 시연 고객 김하늘(엔진 회귀 시험용).
 * 금액 단위: 만원. 이율: 연이율 소수.
 * getDemo()는 매번 새 사본을 돌려준다(원본이 화면에서 바뀌지 않도록).
 */
(function (root) {
  'use strict';

  // 이전 시연 고객(김하늘). 화면에서는 쓰지 않고, 엔진 회귀 시험(tests/cases.js A·B·C)의 고정 입력으로만 쓴다.
  var LEGACY = {
    schemaVersion: 1,
    demoVersion: 2, // 시연 데이터 내용이 바뀔 때마다 올린다(저장된 옛 시연 데이터 안내용)
    demoToday: '2026-11-05', // 시연 기준일(명세 검토 표 5번)
    activePlanId: 'after-v1',

    customer: {
      name: '김하늘(가상)',
      birth: '1997-03',
      firstJob: '2023-11',
      job: '사무직',
      companySize: '중소기업',
      region: '수도권',
      grossPrevYear: 4000,
      netMonthly: 290,
      taxExemption: { applied: true, start: '2023-11', end: '2028-10', monthlyEffect: 9 },
      cash: 900,
      emergency: 0,
      housing: 800,
      investment: 400,
      depositReturn: { amount: 1000, month: '2028-08' },
      pension: 300,
      debts: [
        { name: '학자금 대출', balance: 900, rate: 0.017, monthlyPayment: 15 },
        { name: '신용대출', balance: 1500, rate: 0.065, monthlyPayment: 35 }
      ],
      goal: { depositTarget: 5000, movingCost: 200, emergencyTarget: 800 },
      risk: {
        institution: {
          type: '위험중립형',
          date: '2024-05-10',
          source: 'OO은행 투자자정보확인서(가상)',
          purpose: '목돈 운용(펀드 가입)',
          netAtThatTime: 260
        },
        appSurvey: null
      }
    },

    plans: [
      {
        id: 'before-v1',
        kind: '설계 전',
        date: '2026-08-20',
        name: '설계 전 진단',
        memo: '현재 소비·상환 습관을 유지하는 경우',
        startMonth: '2026-09',
        targetMonth: '2029-08',
        essential: 135,
        optional: 60,
        extraRepayment: 0,
        products: [],
        parentId: null,
        author: '설계사'
      },
      {
        id: 'after-v1',
        kind: '설계 후',
        date: '2026-08-27',
        name: '설계 후 1차 수정안',
        memo: '선택지출 22·필수 5 절감, 월 15 추가 상환, 이사월 2029-12',
        startMonth: '2026-09',
        targetMonth: '2029-12',
        essential: 130,
        optional: 38,
        extraRepayment: 15,
        products: [{ policyId: 'youth-future', monthly: 30, start: '2026-12', months: 36, conditional: true }],
        parentId: 'before-v1',
        author: '설계사',
        selectedBy: '고객',
        selectedAt: '2026-08-28'
      }
    ],

    initial: { repayFromCash: 300, emergencyFromCash: 600 }, // 2026-08 말 초기 처리

    assumptions: {
      livingGrowth: 0.02,
      emergencyRate: 0.03,
      housingRate: 0.03,
      investmentRate: 0.04,
      highRateThreshold: 0.04,
      includeInvestmentInHousing: true
    },

    assumptionNotes: {
      livingGrowth: '생활비는 시작월부터 12개월마다 연 2%씩 오른다고 가정합니다. 물가 전망이 아니라 보수적 계획값입니다.',
      emergencyRate: '연 3%는 예금 금리 가정이며 보장값이 아닙니다. 월 이율은 연이율 ÷ 12로 계산합니다.',
      housingRate: '연 3%는 예금 금리 가정이며 보장값이 아닙니다. 월 이율은 연이율 ÷ 12로 계산합니다.',
      investmentRate: '연 4%는 투자자산의 계획용 기대수익 가정입니다. 실제로는 가격이 오르내리며 손실이 날 수 있습니다.',
      highRateThreshold: '연 4% 이상인 부채만 고금리로 보고 추가 상환합니다. 예금 금리 가정(3%)보다 높아 먼저 갚는 쪽이 유리하기 때문입니다.',
      includeInvestmentInHousing: '투자자산을 이사 자금에 포함합니다. 매각 시 가격 변동이 있으므로 화면에서 현금성과 따로 표시합니다.'
    },

    records: [
      { month: '2026-09', debt: 65, emergency: 50, essential: 130, optional: 42, status: '확정' },
      { month: '2026-10', debt: 65, essential: 132, optional: 61, status: '확정' },
      { month: '2026-11', debt: 65, optional: 18, status: '잠정' }
    ],

    scheduledPayments: [
      { name: '10월 카드대금', amount: 42, kind: '선택', spendMonth: '2026-10', note: '예측용 — 확인 전에는 기록에 더하지 않음' },
      { name: '월세·관리비', amount: 65, kind: '필수', spendMonth: '2026-11', note: '예측용 — 확인 전에는 기록에 더하지 않음' }
    ],

    // 결과(판정·부족액)는 저장하지 않고 화면에서 엔진으로 다시 계산한다. 적용 로직은 3단계에서 붙인다.
    // 숫자는 기본 모드 엔진으로 정했다: 제시일(2026-11-03)까지의 확정 기록(10월 초과 지출 포함)을 반영한
    // after-v1의 2029-12 주거 부족액 224.5를 메우는 세 가지 전략(tests/solver.test.js에서 확인).
    proposals: [
      {
        id: 'abc-2026-11',
        type: '설계안',
        status: '고객에게 제시됨',
        createdAt: '2026-11-03',
        presentedAt: '2026-11-03',
        basePlanId: 'after-v1',
        title: '주거 부족액 224.5만원 보완 — 세 가지 실행 전략',
        options: [
          {
            key: 'A',
            name: '생활비 조정형',
            summary: '2026-12부터 선택지출을 월 6만원 줄입니다(38 → 32, 생활비 인상률 함께 적용). 이사월은 그대로 2029-12.',
            planChanges: { budgetAdjustments: [{ start: '2026-12', months: 0, optional: -6, grow: true }] }
          },
          {
            key: 'B',
            name: '이사 시점 조정형',
            summary: '생활비는 그대로 두고 이사월을 3개월 늦춥니다(2029-12 → 2030-03).',
            planChanges: { targetMonth: '2030-03' }
          },
          {
            key: 'C',
            name: '목표 보증금 조정형',
            summary: '생활비와 이사월은 그대로 두고 목표 보증금을 230만원 낮춥니다(5,000 → 4,770).',
            goalChanges: { depositTarget: 4770 }
          }
        ],
        chosenKey: null
      },
      {
        id: 'rev-overspend-2026-10',
        type: '수정안',
        kind: '초과 지출 보완',
        status: '확인 대기',
        createdAt: '2026-11-02',
        basePlanId: 'after-v1',
        // src/alerts.js의 buildOverspendRevision이 2026-11-05 기준으로 만드는 것과 같은 내용(테스트로 확인)
        title: '10월 생활비 초과분 보완',
        reason: '2026-10 생활비가 193만원으로 계획 168만원보다 25만원(14.9%) 많습니다 (필수 +2.0, 선택 +23.0).',
        summary: '초과분 25만원을 2026-12~2027-02 석 달 동안 선택지출 예산에서 월 8.3만원씩 나눠 줄입니다.',
        planChanges: { budgetAdjustments: [{ start: '2026-12', months: 3, optional: -25 / 3, note: '초과 지출 보완' }] },
        alertId: 'overspend-2026-10',
        author: '앱(규칙 기반)'
      }
    ],

    changeLog: [
      { at: '2026-08-20', who: '설계사', what: '설계 전 진단 작성', version: 'before-v1' },
      { at: '2026-08-27', who: '설계사', what: '설계 후 1차 수정안 작성', version: 'after-v1' },
      { at: '2026-08-28', who: '고객', what: '설계 후 1차 수정안을 실행 기준으로 선택', version: 'after-v1' }
    ]
  };

  /*
   * 시연 고객: AFPK 영 플래너 챌린지 2026 재무설계 사례 보고서의 가상 고객(B안).
   * 기준일 2026-11-03, 금액 단위 만원. 보고서에 없는 값은 '계산용 가정'으로 표시한다.
   */
  var DEMO = {
    schemaVersion: 1,
    demoVersion: 4,
    demoToday: '2026-11-03',
    intake: { done: true, source: 'example', savedAt: '2026-11-03' },
    // 자가진단 응답(고객 본인 응답, 공식 투자성향 진단 아님) — 재무 수치(customer)와 따로 둔다
    selfCheck: {
      kind: '간단 자가진단', official: false, note: '고객 본인 응답이며 금융기관의 공식 투자성향 진단이 아닙니다.', at: '2026-11-03',
      answers: { keepSpending: '부모 지원, 건강·자기계발 지출 유지', spendFlex: '', incomeStability: '', lossTolerance: '원금손실은 피하고 싶다', newLoanPref: '결혼 전 신규 신용대출 추가 없음', memo: '' }
    },
    activePlanId: 'after-v1',
    caseSource: 'AFPK 영 플래너 챌린지 2026 재무설계 사례 보고서(가상 고객 B안, 기준일 2026-11-03)',

    // 초기 고객정보(사실만). 화면의 '설계 예시 불러오기'와 같은 값이다(src/intake.js EXAMPLE, 테스트로 일치 확인).
    // 생활비 200·대출 700 상환·연금 월 10·목적자금 110 같은 설계 내용은 아래 plans의 설계안에만 둔다.
    customer: {
      name: '가상 고객 B',
      age: 29,
      birth: '1997-05',         // 만 29세만 주어짐 — 정책 조건 계산용 가정(기준월 − 나이 − 6개월)
      birthAssumed: true,
      firstJob: '2024-01',      // 재직 3년 차 — 계산용 가정
      tenure: 3,
      job: '정규직 사무직',
      companySize: '중소기업',
      household: '미혼 1인 가구',
      marriagePlan: '',
      region: '',
      grossPrevYear: 4500,
      netMonthly: 320,
      taxExemption: null,       // 중소기업 취업자 소득세 감면: 실수령 320에 반영됐는지 확인 필요(보고서 9장)
      cash: 200,
      savings: 600,             // 만기 예·적금(해지손실 없음)
      emergency: 0,
      housing: 0,
      investment: 400,          // ETF 순현금화 금액
      pension: 100,             // 연금저축(노후 목적)
      depositReturn: { amount: 1000, month: '2029-10', note: '반환월 미확인 — 목표 시점에 반환된다고 가정' },
      debts: [
        { name: '신용대출', balance: 1000, rate: 0.072, remainingMonths: 36, method: 'equalPrincipal', monthlyPrincipal: 1000 / 36, monthlyPayment: 1000 / 36 + 1000 * 0.072 / 12, note: '잔여 36개월 원금균등 상환' }
      ],
      goal: { depositTarget: 4000, movingCost: 150, emergencyTarget: 990, emergencyBasis: '고객 입력 목표' },
      livingItems: [
        { key: 'rent', label: '월세·관리비', amount: 70, essential: true },
        { key: 'transport', label: '교통비', amount: 10, essential: true },
        { key: 'food', label: '식비·생필품', amount: 60, essential: true },
        { key: 'telecom', label: '통신·구독', amount: 8, essential: true },
        { key: 'insurance', label: '보험료', amount: 8, essential: true },
        { key: 'parents', label: '부모 지원', amount: 15, essential: true },
        { key: 'health', label: '건강·자기계발', amount: 12, essential: true },
        { key: 'leisure', label: '여가·쇼핑', amount: 42, essential: false },
        { key: 'irregular', label: '비정기 적립', amount: 10, essential: false },
        { key: 'otherEss', label: '기타 필수 지출', amount: 0, essential: true },
        { key: 'otherOpt', label: '기타 선택 지출', amount: 0, essential: false }
      ],
      existingSaving: { monthly: 50, note: '세부 구성 미확인' },
      risk: { institution: null, appSurvey: null, note: '' },
      unknown: [],
      isExample: true
    },

    plans: [
      {
        id: 'before-v1',
        kind: '설계 전',
        date: '2026-11-03',
        name: '설계 전 진단',
        memo: '생활비 235 유지, 신용대출 약정대로 원금균등 상환, 자산 재배치 없음',
        startMonth: '2026-11',
        targetMonth: '2029-10',
        essential: 183,
        optional: 52,
        extraRepayment: 0,
        pensionMonthly: 0,
        initial: {},
        products: [],
        parentId: null,
        author: '설계사'
      },
      {
        id: 'after-v1',
        kind: '설계 후',
        date: '2026-11-03',
        name: '설계 후 1차(보고서 설계안)',
        memo: '대출 700 부분 상환 · 생활비 235→200(식비 −15·구독 −3·여가 −17) · 남는 110을 대출→비상금→주거 순 배분 · 연금 월 10 · 2027-07부터 자유적금 월 80 + 주거 유동자금 월 30',
        startMonth: '2026-11',
        targetMonth: '2029-10',
        essential: 165,
        optional: 35,
        extraRepayment: 0,
        pensionMonthly: 10,
        debtOverrides: { '신용대출': { monthlyPrincipal: 100 } }, // 남은 300을 3개월에 상환(월 원금 100 + 이자)
        initial: { liquidate: ['savings', 'investment'], repayFromCash: 700, emergencyFromCash: 500 },
        products: [
          { type: 'bank', name: '카카오뱅크 자유적금(21개월)', monthly: 80, start: '2027-07', months: 21, rate: 0.0385, prefRate: 0.0405, sourceId: 'kakao-savings', contributionRate: 0, conditional: true }
        ],
        parentId: 'before-v1',
        author: '설계사',
        selectedBy: '고객(가상)',
        selectedAt: '2026-11-03',
        selectionNote: '보고서의 설계상 선택이며 실제 고객 동의·상품 가입·대출 상환은 이루어지지 않음',
        // 보고서 표 9의 조정 후 생활비(만원/월). 고객정보의 기존 생활비와 따로 둔다.
        livingAdjust: [['식비·생필품', 60, 45], ['통신·구독', 8, 5], ['여가·쇼핑', 42, 25]]
      }
    ],

    initial: {},

    assumptions: {
      livingGrowth: 0,
      emergencyRate: 0,
      housingRate: 0,
      investmentRate: 0,
      highRateThreshold: 0.04,
      includeInvestmentInHousing: true,
      rateBasis: 'effective',
      compareRate: 0.02
    },

    assumptionNotes: {
      livingGrowth: '기본안은 생활비 200을 유지합니다. 물가 상승은 충격 시나리오(생활비 상승)와 민감도 분석에서 따로 봅니다.',
      emergencyRate: '비상금 이자는 금리가 바뀔 수 있어 목표 재원에 넣지 않습니다(0%).',
      housingRate: '기본 계산은 원금 기준(0%)입니다. 적금 이자는 상품 만기에, 공통 비교모형은 세후 연 2%로 따로 보여 줍니다.',
      investmentRate: 'ETF는 설계안 실행 직전에 현금화합니다(수익 가정 없음).',
      highRateThreshold: '연 4% 이상인 부채를 고금리로 봅니다.',
      includeInvestmentInHousing: '현금화하지 않은 투자자산은 사용 가능 주거자금에 넣되 가격 변동을 따로 표시합니다.',
      rateBasis: '월 이율 = (1 + 연 유효수익률)^(1/12) − 1 (보고서 공통 비교모형과 같은 방식).',
      compareRate: '공통 비교모형(B)의 세후 연 유효수익률 2%. 특정 상품의 만기금이 아닙니다.'
    },

    settings: {
      alerts: {
        overspendTolerance: 0,      // 생활비 200 초과
        overspendConsecutive: 2,    // 2개월 연속이면 경보(보고서 표 20)
        emergencyMinMonths: 5,      // 825 = 필수생활비 165 × 5개월
        emergencyAfterReached: true, // 비상금 완성 이후에만 판단
        incomeDropRate: 0.1         // 실수령 10% 이상 감소
      }
    },

    records: [],
    scheduledPayments: [],
    proposals: [],

    changeLog: [
      { at: '2026-11-03', who: '설계사', what: '설계 전 진단 작성(보고서 기준)', version: 'before-v1' },
      { at: '2026-11-03', who: '설계사', what: '설계 후 1차(보고서 설계안) 작성', version: 'after-v1' }
    ]
  };

  function getDemo() {
    return JSON.parse(JSON.stringify(DEMO));
  }
  function getLegacyDemo() {
    return JSON.parse(JSON.stringify(LEGACY));
  }

  var api = { getDemo: getDemo, getLegacyDemo: getLegacyDemo };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.demo = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
