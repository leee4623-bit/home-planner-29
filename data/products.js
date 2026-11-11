/*
 * 은행 적금 후보(보고서 최종본 표 16·17). 같은 목적·같은 납입 조건(월 80·21개월)끼리 비교한다. 금리는 세전 연이율.
 * 정기예금·납입한도 30 적금처럼 조건이 다른 상품은 같은 줄에서 비교하지 않는다(보고서 부록 5).
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
      checkedAt: '2026-11-10'
    },
    {
      id: 'kbank-main', bank: '케이뱅크', name: '주거래우대 자유적금', use: '주거자금 정기 적립 비교 후보', kind: 'installment',
      rates: [{ min: 21, max: 21, base: 0.037, pref: 0.043 }],
      conditions: '최대 우대는 급여 입금·통신비 자동이체·체크카드 실적 등 우대조건을 충족할 때',
      caution: '보고서는 월 80·21개월 조건의 금리만 조회함. 우대조건을 위해 추가 소비를 만들지 않음',
      source: { title: '케이뱅크 주거래우대 자유적금 상품안내', url: 'https://www.kbanknow.com' },
      checkedAt: '2026-11-10'
    },
    {
      id: 'kb-mymind', bank: 'KB국민은행', name: '내맘대로적금(자유적립식)', use: '주거자금 정기 적립 비교 후보', kind: 'installment',
      rates: [{ min: 21, max: 21, base: 0.025, pref: 0.031 }],
      conditions: '선택한 우대조건을 실제로 충족할 때 최대 우대',
      caution: '금리는 상품설명자료의 2026-11-03 기준. 보고서는 월 80·21개월 조건만 조회함',
      source: { title: 'KB내맘대로적금 상품설명자료', url: 'https://www.kbstar.com' },
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
