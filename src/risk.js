/*
 * 위험성향(명세 6-2 상담 시작, 6-3 더보기).
 * - 금융기관 결과와 앱 설문을 따로 저장한다.
 * - 나이나 소득만으로 성향을 추정하지 않는다(설문에 나이·소득 문항 없음).
 * - 확인된 성향이 없거나 재진단이 필요하면 보수적으로 적용한다.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;

  var TYPES = ['안정형', '안정추구형', '위험중립형', '적극투자형', '공격투자형'];

  // 10문항, 보기마다 1~5점. 합계 10~50점.
  var QUESTIONS = [
    { id: 'q1', text: '이 돈을 쓸 계획인 시점은 언제인가요?', options: ['1년 안', '1~2년', '2~3년', '3~5년', '5년 넘게'] },
    { id: 'q2', text: '투자한 돈이 1년 동안 10% 줄었다면 어떻게 하시겠어요?', options: ['바로 모두 찾는다', '일부를 찾는다', '그대로 둔다', '조금 더 넣는다', '많이 더 넣는다'] },
    { id: 'q3', text: '감수할 수 있는 1년 최대 손실은 어느 정도인가요?', options: ['손실은 싫다', '5% 이내', '10% 이내', '20% 이내', '20% 넘어도 괜찮다'] },
    { id: 'q4', text: '이 돈의 주된 목적은 무엇인가요?', options: ['원금 보존', '물가만큼 지키기', '예금보다 조금 높은 수익', '높은 수익', '최대한 높은 수익'] },
    { id: 'q5', text: '지금까지 해 본 금융상품은 무엇인가요?', options: ['예금·적금만', '채권형 펀드', '혼합형 펀드', '주식형 펀드·주식', '파생상품·레버리지'] },
    { id: 'q6', text: '투자 상품에 대해 얼마나 알고 계신가요?', options: ['거의 모른다', '예금과의 차이 정도', '주요 상품 구조를 안다', '위험과 수익 관계를 설명할 수 있다', '상품을 스스로 분석한다'] },
    { id: 'q7', text: '이 돈이 전체 금융자산에서 차지하는 비중은?', options: ['80% 넘게', '60~80%', '40~60%', '20~40%', '20% 미만'] },
    { id: 'q8', text: '급하게 돈이 필요할 때 이 돈 말고 쓸 수 있는 비상금이 있나요?', options: ['없다', '1개월분 미만', '1~3개월분', '3~6개월분', '6개월분 넘게'] },
    { id: 'q9', text: '수익이 크게 오르내리는 상품을 볼 때 마음은?', options: ['매우 불안하다', '불안한 편이다', '보통이다', '괜찮은 편이다', '전혀 개의치 않는다'] },
    { id: 'q10', text: '가장 마음에 드는 결과는?', options: ['원금 100% 보장, 수익 2%', '손실 −2% ~ 수익 5%', '손실 −5% ~ 수익 10%', '손실 −15% ~ 수익 20%', '손실 −30% ~ 수익 40%'] }
  ];

  // 합계 → 유형(경계 포함)
  var BANDS = [
    { max: 18, type: '안정형' },
    { max: 26, type: '안정추구형' },
    { max: 34, type: '위험중립형' },
    { max: 42, type: '적극투자형' },
    { max: 50, type: '공격투자형' }
  ];

  /**
   * @param {object} answers { q1: 0~4(보기 번호), ... }
   * @returns {{complete, score, type, answered}}
   */
  function scoreSurvey(answers) {
    answers = answers || {};
    var score = 0;
    var answered = 0;
    QUESTIONS.forEach(function (q) {
      var a = answers[q.id];
      if (a === undefined || a === null || a === '') return;
      var n = Number(a);
      if (!Number.isInteger(n) || n < 0 || n > 4) return;
      score += n + 1;
      answered++;
    });
    var complete = answered === QUESTIONS.length;
    var type = null;
    if (complete) {
      for (var i = 0; i < BANDS.length; i++) if (score <= BANDS[i].max) { type = BANDS[i].type; break; }
    }
    return { complete: complete, score: score, type: type, answered: answered };
  }

  /** 'YYYY-MM-DD' 두 날짜 사이 개월 수(일 단위 버림) */
  function monthsBetween(a, b) {
    var ma = /^(\d{4})-(\d{2})-(\d{2})/.exec(a || '');
    var mb = /^(\d{4})-(\d{2})-(\d{2})/.exec(b || '');
    if (!ma || !mb) return null;
    var m = dates.diffMonths(ma[1] + '-' + ma[2], mb[1] + '-' + mb[2]);
    if (Number(mb[3]) < Number(ma[3])) m -= 1;
    return m;
  }

  /**
   * 재진단 권고와 적용 성향.
   * 권고 사유: 진단일 24개월 경과, 진단 당시 대비 실수령 ±10% 이상 변화, 목적 변화.
   * @returns {{applied, source, recommend, reasons:[string]}}
   */
  function review(customer, today, opts) {
    opts = opts || {};
    var risk = (customer && customer.risk) || {};
    var inst = risk.institution;
    var app = risk.appSurvey;
    var reasons = [];
    var expired = false;
    var latest = null;
    var source = null;
    var latestDate = null;
    if (inst && inst.type) { latest = inst; source = '금융기관'; latestDate = inst.date; }
    if (app && app.type && (!latestDate || app.date >= latestDate)) { latest = app; source = '앱 설문'; latestDate = app.date; }

    if (!latest) {
      reasons.push('확인된 위험성향이 없습니다.');
    } else {
      var age = monthsBetween(latestDate, today);
      if (age !== null && age >= 24) expired = true;
      if (expired) reasons.push('마지막 진단(' + latestDate + ')부터 24개월이 지났습니다.');
      var netThen = Number(latest.netAtThatTime);
      var netNow = Number(customer.netMonthly);
      if (netThen > 0 && netNow > 0 && Math.abs(netNow - netThen) / netThen >= 0.1) {
        reasons.push('진단 당시 실수령 ' + netThen + '만원에서 지금 ' + netNow + '만원으로 10% 넘게 바뀌었습니다.');
      }
      var purposeNow = opts.currentPurpose || '주거자금 마련(이사 보증금)';
      if (latest.purpose && latest.purpose.indexOf('주거') < 0) {
        reasons.push('진단 목적(' + latest.purpose + ')이 지금 목적(' + purposeNow + ')과 다릅니다.');
      }
    }
    var recommend = reasons.length > 0;
    return {
      latest: latest,
      source: source,
      recommend: recommend,
      reasons: reasons,
      expired: expired,
      // 성향이 없거나 유효기간(24개월)이 지나 확인되지 않은 상태면 보수적으로 적용
      applied: !latest || expired ? '안정형(보수적 적용)' : latest.type,
      conservative: !latest || expired
    };
  }

  var api = { TYPES: TYPES, QUESTIONS: QUESTIONS, BANDS: BANDS, scoreSurvey: scoreSurvey, review: review };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.risk = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
