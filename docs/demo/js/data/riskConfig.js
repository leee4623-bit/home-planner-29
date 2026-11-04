/*
 * 위험성향 설문 설정 — 앱 자체 참고용 기준 (버전 APP-RISK-2026.11-v1)
 * =====================================================================
 * - 금융기관의 공식 설문·배점·인증이 아닙니다. 공식 적합성·적정성 판단을 대신하지 않습니다.
 * - 참고: KB 「투자성향분석」의 평가 영역(자금 여건·경험과 이해도·목표와 태도·투자 기간)과 5개 유형 설명,
 *   증권사 투자자정보확인서의 문항 주제. 문항 문구·배점·구간은 이 앱이 새로 정했습니다.
 * - 이 파일만 고치면 문항·배점·가중치·구간·제한 규칙이 바뀝니다. 바꿀 때는 VERSION을 올리세요
 *   (같은 답변은 같은 버전에서 항상 같은 결과).
 *
 * 차원(dim)
 *  will    위험을 감수하려는 의향
 *  cap     실제 손실을 견딜 수 있는 재무 여력
 *  know    투자 경험과 이해도
 *  horizon 목표 자금의 사용 시점과 중요도(높을수록 길고 덜 필수적)
 * 선택지 score: 0~4. unknown(잘 모르겠음)은 score:null → 해당 차원의 판단 근거에서 제외(임의 보완 없음).
 * 단, know 차원의 ‘잘 모르겠음’은 이해 부족이라는 의미가 분명하므로 0점(knownZero) 처리.
 */
(function (root) {
  'use strict';
  var VERSION = 'APP-RISK-2026.11-v1';
  var LABEL = '앱 자체 참고용 기준';
  var UNKNOWN = { id: 'u', text: '잘 모르겠음', score: null, unknown: true };

  var QUESTIONS = [
    { id: 'q1', dim: 'horizon', topic: '자금의 주된 사용 목적', text: '지금 모으는 돈은 주로 어디에 쓸 예정인가요?',
      help: '여러 목적이 있으면 가장 큰 목적을 골라 주세요.',
      options: [
        { id: 'a', text: '이사·전세 보증금처럼 꼭 필요한 주거자금', score: 0, tag: 'housingCore' },
        { id: 'b', text: '비상시 생활비', score: 0 },
        { id: 'c', text: '결혼·차량 등 몇 년 안의 큰 지출', score: 1 },
        { id: 'd', text: '노후 등 먼 미래를 위한 자산 늘리기', score: 4 },
        UNKNOWN] },
    { id: 'q2', dim: 'horizon', topic: '사용 시점과 연기 가능성', text: '그 돈은 언제 써야 하고, 필요하면 미룰 수 있나요?',
      options: [
        { id: 'a', text: '3년 안에 써야 하고 미루기 어렵다', score: 0, tag: 'shortFixed' },
        { id: 'b', text: '3년 안에 쓰지만 1년 정도는 미룰 수 있다', score: 1 },
        { id: 'c', text: '3~5년 뒤에 쓴다', score: 2 },
        { id: 'd', text: '5년 이상 뒤에 쓰거나 시점이 정해져 있지 않다', score: 4 },
        UNKNOWN] },
    { id: 'q3', dim: 'will', topic: '원금 손실을 받아들일 의향', text: '모은 돈의 원금이 줄어들 수 있다면 어느 정도까지 받아들일 수 있나요?',
      options: [
        { id: 'a', text: '원금이 조금이라도 줄면 안 된다', score: 0, tag: 'noLoss' },
        { id: 'b', text: '5% 정도까지', score: 1 },
        { id: 'c', text: '10~20% 정도까지', score: 2 },
        { id: 'd', text: '20% 넘게 줄어도 기다릴 수 있다', score: 4 },
        UNKNOWN] },
    { id: 'q4', dim: 'cap', topic: '손실 시 생활·주거목표 영향', text: '만약 모은 돈이 20% 줄어든다면 생활이나 이사 계획은 어떻게 되나요?',
      options: [
        { id: 'a', text: '이사나 생활이 바로 어려워진다', score: 0, tag: 'goalBreaks' },
        { id: 'b', text: '이사를 미루거나 집 조건을 낮춰야 한다', score: 1 },
        { id: 'c', text: '불편하지만 계획은 유지할 수 있다', score: 3 },
        { id: 'd', text: '생활과 이사 계획에 거의 영향이 없다', score: 4 },
        UNKNOWN] },
    { id: 'q5', dim: 'cap', topic: '소득의 안정성과 향후 변화', text: '앞으로 1~2년 동안 소득은 어떨 것 같나요?',
      options: [
        { id: 'a', text: '줄거나 끊길 가능성이 있다', score: 0 },
        { id: 'b', text: '변동이 큰 편이다', score: 1 },
        { id: 'c', text: '지금과 비슷하게 안정적이다', score: 3 },
        { id: 'd', text: '안정적이고 늘어날 가능성이 높다', score: 4 },
        UNKNOWN] },
    { id: 'q6', dim: 'cap', topic: '비상금 확보 수준', text: '갑자기 소득이 없어져도 생활비를 버틸 수 있는 따로 모아 둔 돈은 몇 달 치인가요?',
      options: [
        { id: 'a', text: '거의 없다(1개월 미만)', score: 0, months: 0 },
        { id: 'b', text: '1~3개월 치', score: 1, months: 1 },
        { id: 'c', text: '3~6개월 치', score: 3, months: 3 },
        { id: 'd', text: '6개월 치 이상', score: 4, months: 6 },
        UNKNOWN] },
    { id: 'q7', dim: 'cap', topic: '부채 상환 후 남는 여유', text: '매달 대출 상환과 생활비를 내고 나면 돈이 얼마나 남나요?',
      options: [
        { id: 'a', text: '거의 남지 않거나 모자란다', score: 0 },
        { id: 'b', text: '소득의 10% 미만', score: 1 },
        { id: 'c', text: '소득의 10~20%', score: 2 },
        { id: 'd', text: '소득의 20% 이상', score: 4 },
        UNKNOWN] },
    { id: 'q8', dim: 'know', topic: '투자 경험', text: '예금·적금 말고 투자해 본 경험이 있나요?',
      options: [
        { id: 'a', text: '예금·적금만 해 봤다', score: 0 },
        { id: 'b', text: '채권·채권형 펀드 등 비교적 안정적인 상품', score: 1 },
        { id: 'c', text: '주식·주식형 펀드·ETF', score: 3 },
        { id: 'd', text: '파생상품·레버리지 상품까지', score: 4 },
        Object.assign({}, UNKNOWN, { score: 0, knownZero: true })] },
    { id: 'q9', dim: 'know', topic: '금융상품과 손실 위험 이해도', text: '투자상품의 구조와 손실이 생기는 이유를 어느 정도 알고 있나요?',
      options: [
        { id: 'a', text: '거의 모른다', score: 0 },
        { id: 'b', text: '예금과 투자상품의 차이 정도는 안다', score: 1 },
        { id: 'c', text: '주식·펀드의 손실 위험을 설명할 수 있다', score: 3 },
        { id: 'd', text: '대부분의 상품 구조를 이해하고 있다', score: 4 },
        Object.assign({}, UNKNOWN, { score: 0, knownZero: true })] },
    { id: 'q10', dim: 'will', topic: '투자금 하락 시 예상 행동', text: '투자한 돈이 한 달 만에 15% 떨어졌다면 어떻게 하실 것 같나요?',
      options: [
        { id: 'a', text: '더 떨어지기 전에 모두 판다', score: 0 },
        { id: 'b', text: '일부를 판다', score: 1 },
        { id: 'c', text: '그대로 두고 지켜본다', score: 3 },
        { id: 'd', text: '오히려 더 산다', score: 4, tag: 'buyMore' },
        UNKNOWN] }
  ];

  // 차원 가중치(합 100) — 앱 자체 기준
  var WEIGHTS = { will: 35, cap: 35, know: 15, horizon: 15 };
  // 차원별 최소 판단 근거(‘잘 모르겠음’ 제외 응답 수). 못 채우면 결과를 확정하지 않음
  var MIN_KNOWN = { will: 1, cap: 3, know: 2, horizon: 2 };

  // 종합 점수(0~100) 구간
  var TYPES = [
    { id: 1, name: '안정형', max: 20, desc: '예금·적금 수준의 수익을 원하고 원금 손실을 피하고 싶어 합니다.' },
    { id: 2, name: '안정추구형', max: 40, desc: '원금 손실을 최소화하면서 이자 수준의 안정적인 수익을 원하고, 일부만 변동성을 받아들입니다.' },
    { id: 3, name: '위험중립형', max: 60, desc: '수익에는 위험이 따른다는 점을 알고, 예금보다 높은 수익을 위해 일정 손실을 받아들입니다.' },
    { id: 4, name: '적극투자형', max: 80, desc: '원금 보전보다 높은 수익을 추구하며 자금의 상당 부분을 위험자산에 둘 의향이 있습니다.' },
    { id: 5, name: '공격투자형', max: 100, desc: '높은 수익을 위해 큰 손실 위험도 적극적으로 받아들입니다.' }
  ];

  /*
   * 분류 제한 규칙 — 합산 점수가 높아도 아래 조건이면 상한을 둡니다(위 유형 id 기준).
   * scope: 'overall'(종합 유형 상한) | 'housingCore'(주거 핵심자금 운용 상한)
   */
  var RULES = [
    { id: 'capLow', when: function (s) { return s.dims.cap !== null && s.dims.cap < 40; }, maxType: 2, scope: 'overall', reason: '실제 손실을 견딜 재무 여력 점수가 40점 미만입니다.' },
    { id: 'goalBreaks', when: function (s) { return s.tags.goalBreaks; }, maxType: 2, scope: 'overall', reason: '20% 손실이 생기면 생활·이사가 바로 어려워진다고 답했습니다.' },
    { id: 'knowLow', when: function (s) { return s.dims.know !== null && s.dims.know < 25; }, maxType: 3, scope: 'overall', reason: '투자 경험·이해도 점수가 25점 미만입니다.' },
    { id: 'shortFixed', when: function (s) { return s.tags.shortFixed || s.tags.housingCore; }, maxType: 3, scope: 'overall', reason: '목표 자금을 3년 안에 꼭 써야 하거나 주거 핵심자금입니다.' },
    { id: 'coreSafe', when: function () { return true; }, maxType: 1, scope: 'housingCore', reason: '3년 안에 반드시 필요한 주거 핵심자금은 성향과 관계없이 원금 보전형으로만 운용합니다.' }
  ];

  // 의향과 여력의 충돌 기준: will − cap 이 이 값 이상이면 ‘추가 확인 필요’
  var CONFLICT_GAP = 30;
  // 모순 응답 규칙(임의로 보완하지 않고 표시만)
  var CONTRADICTIONS = [
    { id: 'lossVsBuy', when: function (a) { return a.q3 === 'a' && a.q10 === 'd'; }, reason: '원금이 조금도 줄면 안 된다고 했지만, 15% 하락 시 더 사겠다고 답했습니다.' },
    { id: 'lossVsHold', when: function (a) { return a.q3 === 'a' && a.q10 === 'c'; }, reason: '원금 손실을 받아들이지 않는다고 했지만, 15% 하락에도 그대로 두겠다고 답했습니다.' },
    { id: 'purposeVsTime', when: function (a) { return a.q1 === 'a' && a.q2 === 'd'; }, reason: '꼭 필요한 주거자금이라고 했지만, 사용 시점은 5년 이상 뒤라고 답했습니다.' }
  ];
  // 재진단 권유 기준(기존 결과 대비 변화)
  var RESURVEY = { incomeChangePct: 10, debtChangePct: 20, maxAgeMonths: 24 };
  // A/B/C안의 ‘불리한 상황’ 정의
  var ADVERSE = [{ type: 'incomeDrop', start: 13, duration: 12, size: 10 }, { type: 'expenseRise', start: 1, duration: 0, size: 5 }, { type: 'investLoss', start: 12, duration: 0, size: 20 }];
  var ADVERSE_LABEL = '13개월째부터 1년간 소득 10% 감소 + 생활비 5% 상승 + 12개월째 투자자산 20% 하락';

  var Config = { VERSION: VERSION, LABEL: LABEL, QUESTIONS: QUESTIONS, WEIGHTS: WEIGHTS, MIN_KNOWN: MIN_KNOWN, TYPES: TYPES, RULES: RULES, CONFLICT_GAP: CONFLICT_GAP, CONTRADICTIONS: CONTRADICTIONS, RESURVEY: RESURVEY, ADVERSE: ADVERSE, ADVERSE_LABEL: ADVERSE_LABEL,
    SOURCES: [
      { title: 'KB Think 「투자성향분석 왜 하는 걸까? 투자자 유형별 위험등급과 상품 선택 기준」', url: 'https://kbthink.com/fund/investment-profile.html' },
      { title: '유진투자선물 투자자정보확인서(문항 주제 참고)', url: 'https://eugenefutures.com/downloads/agreement_d_08.pdf' }
    ] };
  if (typeof module !== 'undefined' && module.exports) module.exports = Config;
  else { root.FP = root.FP || {}; root.FP.RiskConfig = Config; }
})(this);
