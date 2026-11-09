/*
 * 은행 예·적금 후보(보고서 표 12). 공시·조회 기준 2026-11-03, 금리는 세전 연이율.
 * 특정 상품 추천이 아니라 사례 보고서가 조사한 후보를 같은 가정으로 비교하기 위한 자료다.
 * 가입 시점의 금리·판매가 같다는 보장이 없으므로 화면에 확인일과 함께 '조건부'로 표시한다.
 */
(function (root) {
  'use strict';
  var PRODUCTS = [
    {
      id: 'kakao-safebox', bank: '카카오뱅크', name: '세이프박스', use: '비상금 보관 후보', kind: 'demand',
      rates: [{ min: 0, max: 0, base: 0.018, pref: null }],
      conditions: '수시 입출금 성격, 일별 잔액과 게시금리로 이자 계산, 최대 보관한도 1억 원',
      caution: '금리가 바뀔 수 있어 36개월 고정수익으로 계산하지 않음. 연결 입출금계좌 출금 방식 확인',
      source: { title: '카카오뱅크 세이프박스 상품안내', url: 'https://www.kakaobank.com/products/safeboxes' },
      checkedAt: '2026-11-03'
    },
    {
      id: 'kakao-savings', bank: '카카오뱅크', name: '자유적금', use: '주거자금 정기 적립 후보', kind: 'installment',
      monthlyMin: 0.1, monthlyMax: 300, termMin: 6, termMax: 36,
      rates: [{ min: 12, max: 23, base: 0.0385, pref: 0.0405 }, { min: 24, max: 36, base: 0.032, pref: 0.034 }],
      conditions: '기간 6~36개월, 월 1천 원~300만 원. 계약월수의 절반 이상 자동이체 납입 후 만기 해지 시 0.20%p 우대',
      caution: '중도해지 시 약정 만기금리보다 낮은 금리가 적용될 수 있음',
      source: { title: '카카오뱅크 자유적금 상품안내 및 금리정보', url: 'https://www.kakaobank.com/products/savings' },
      checkedAt: '2026-11-03'
    },
    {
      id: 'kakao-deposit', bank: '카카오뱅크', name: '정기예금', use: '적금 만기 후 사용일까지 남는 목돈의 조건부 운용 후보', kind: 'deposit',
      lumpMin: 100, termMin: 1, termMax: 36,
      rates: [{ min: 6, max: 11, base: 0.036, pref: null }, { min: 12, max: 23, base: 0.038, pref: null }],
      conditions: '최소 가입금액 100만 원, 기간 1~36개월',
      caution: '계약금·잔금 지급일이 먼저이면 가입하지 않음',
      source: { title: '카카오뱅크 정기예금 상품안내 및 금리정보', url: 'https://www.kakaobank.com/products/deposit' },
      checkedAt: '2026-11-03'
    }
  ];
  var TAX = { rate: 0.154, note: '일반과세: 이자소득세 14% + 지방소득세(소득세의 10%) = 15.4%. 개인 과세 상황에 따라 달라질 수 있음' };
  function getProduct(id) { for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i]; return null; }
  function rateFor(p, months) { var r = (p.rates || []).filter(function (x) { return months >= x.min && months <= x.max; })[0]; return r || null; }
  var api = { PRODUCTS: PRODUCTS, TAX: TAX, getProduct: getProduct, rateFor: rateFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.Planner = root.Planner || {}; root.Planner.bankProducts = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
