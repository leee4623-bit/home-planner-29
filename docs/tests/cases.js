/*
 * 정답 테스트 입력·기대값(명세 7절). Node 테스트와 화면의 '계산 검증' 탭이 함께 쓴다.
 * 기대값은 사용자 허락 없이 바꾸지 않는다(명세 0절 5).
 * 허용 오차 ±0.05만원. 2026-09가 m=1.
 */
(function (root) {
  'use strict';

  var TOLERANCE = 0.05;

  // 필드 이름 → 화면 표시 이름
  var FIELD_LABELS = {
    income: '소득',
    interest: '이자',
    principal: '원금 상환',
    debtTotal: '부채 잔액',
    debtHigh: '고금리 부채 잔액',
    debtLow: '저금리 부채 잔액(조건 제외)',
    productPay: '상품 납입',
    productBalance: '상품 잔액',
    productMaturity: '상품 만기 지급',
    depositReturn: '보증금 반환',
    emergency: '비상금',
    housing: '주거자금',
    investment: '투자자산',
    usable: '사용 가능 주거자금',
    verdict: '판정',
    payoffHigh: '고금리 부채 상환 완료월',
    judgeStatus: '목표 판정',
    judgeLabel: '목표 판정(미충족 항목)',
    shortDebt: '부채 조건 부족액',
    shortEmergency: '비상금 조건 부족액',
    shortHousing: '주거 조건 부족액',
    emergencyIn: '비상금 적립',
    debtTotalNow: '부채 잔액',
    paydayUsable: '마지막 월 납입 제외 재원',
    reachMonth: '목표 도달월',
    pension: '연금 잔액',
    housingIn: '주거 적립',
    income: '실수령',
    essential: '필수 생활비',
    optional: '선택 생활비',
    pensionPay: '연금 납입',
    hhFunding: '가구 조달 합계',
    housingTotalIn: '주거적립 총액(적금 포함)',
    hhAfter: '지급 후 잔액',
    hhEarly: '마지막 적립 전 지급 시 잔액',
    hhMovingLimit: '부대비용 한계',
    flow0: '계약금 지급 전 잔액',
    flow1: '계약금 지급 후 잔액',
    flow4: '10월 적립 후 잔액',
    flow5: '보증금 반환 후 잔액',
    flow6: '본인 잔금 지급 후 잔액'
  };

  // R 그룹(보고서 가상 고객 B안, 최종 수정 2026-11-10): 기본 계산이 곧 최종 기준(원금, 적금 이자 제외)이다.
  var FINAL = '보고서 최종본';

  var CASES = [
    // A. 호환 모드(legacy) — 원본 앱 재현
    { id: 'A1', group: 'A', title: '설계 후, 2026-09', plan: 'after-v1', debtRule: 'legacy', month: '2026-09',
      expect: { interest: 7.8, principal: 57.2, debtTotal: 2042.8, emergency: 658.5, housing: 802.0, investment: 401.3 } },
    { id: 'A2', group: 'A', title: '설계 후, 2026-12', plan: 'after-v1', debtRule: 'legacy', month: '2026-12',
      expect: { productPay: 30, productBalance: 31.8, emergency: 800.0, housing: 812.9 } },
    { id: 'A3', group: 'A', title: '설계 후, 2028-08 보증금 반환', plan: 'after-v1', debtRule: 'legacy', month: '2028-08',
      expect: { depositReturn: 1000, housing: 2366.7 } },
    { id: 'A4', group: 'A', title: '설계 후, 2028-10 신용대출 완제', plan: 'after-v1', debtRule: 'legacy', month: '2028-10',
      expect: { principal: 64.0, debtTotal: 525.8 } },
    { id: 'A5', group: 'A', title: '설계 후, 2028-11 감면 종료', plan: 'after-v1', debtRule: 'legacy', month: '2028-11',
      expect: { income: 281, interest: 0.7, principal: 29.3, debtTotal: 496.5 } },
    { id: 'A6', group: 'A', title: '설계 후, 2029-12 목표월', plan: 'after-v1', debtRule: 'legacy', month: '2029-12',
      expect: { productMaturity: 1144.8, debtTotal: 112.4, emergency: 875.2, housing: 4323.4, investment: 457.0, usable: 4780.4, verdict: '미달' } },
    { id: 'A7', group: 'A', title: '설계 후, 정책상품 제외', plan: 'after-v1', debtRule: 'legacy', excludeProducts: true, month: '2029-12',
      expect: { usable: 4767.0 } },
    { id: 'A8', group: 'A', title: '설계 전, 2029-08', plan: 'before-v1', debtRule: 'legacy', month: '2029-08',
      expect: { debtTotal: 463.9, emergency: 864.4, usable: 3605.8 } },

    // B. 기본 모드(고금리 부채 규칙, 기준 연 4%)
    { id: 'B1', group: 'B', title: '설계 후, 2026-09 (A1과 같음)', plan: 'after-v1', debtRule: 'default', month: '2026-09',
      expect: { interest: 7.8, principal: 57.2, debtTotal: 2042.8, emergency: 658.5, housing: 802.0, investment: 401.3 } },
    { id: 'B2', group: 'B', title: '설계 후, 2029-12 목표월', plan: 'after-v1', debtRule: 'default', month: '2029-12',
      expect: { debtHigh: 0, payoffHigh: '2028-10', debtLow: 335.6, emergency: 875.2, housing: 4548.3, usable: 5005.2,
        judgeStatus: '미달', judgeLabel: '미달(주거)', shortDebt: 0, shortEmergency: 0, shortHousing: 194.8 } },
    { id: 'B3', group: 'B', title: '설계 후, 정책상품 제외', plan: 'after-v1', debtRule: 'default', excludeProducts: true, month: '2029-12',
      expect: { usable: 4991.8 } },

    // R. 재무설계 사례 보고서 최종본(가상 고객 B안) — 기대값은 보고서 본문·부록 수치(표 2·14·15·16·19·24, 부록 7·8)
    { id: 'R1', group: 'R', demo: 'report', title: FINAL + ' 표 14: 2026-11 대출 원금 100·이자 1.8·비상금 8.2·주거 완충 5', plan: 'after-v1', month: '2026-11',
      expect: { principal: 100, interest: 1.8, emergencyIn: 8.2, housingIn: 5, emergency: 508.2 } },
    { id: 'R2', group: 'R', demo: 'report', title: FINAL + ' 표 14·15: 2027-01 대출 완제, 비상금 526.4·주거 15', plan: 'after-v1', month: '2027-01',
      expect: { principal: 100, interest: 0.6, emergencyIn: 9.4, debtTotal: 0, emergency: 526.4, housing: 15 } },
    { id: 'R3', group: 'R', demo: 'report', title: FINAL + ' 표 14·15: 2027-06 비상금 990 완성(23.6), 주거 91.4 → 누계 126.4', plan: 'after-v1', month: '2027-06',
      expect: { emergencyIn: 23.6, housingIn: 91.4, emergency: 990, housing: 126.4 } },
    { id: 'R4', group: 'R', demo: 'report', title: FINAL + ' 표 15: 2028-10 주거 적립누계 1,966.4(적금 80 + 유동 30 + 완충 5)', plan: 'after-v1', month: '2028-10',
      expect: { housingTotalIn: 115, productPay: 80, usable: 1966.4 } },
    { id: 'R5', group: 'R', demo: 'report', title: FINAL + ' 표 14: 2029-06 감면 종료로 실수령 313·주거적립 108', plan: 'after-v1', month: '2029-06',
      expect: { income: 313, housingIn: 108, housing: 2879.4 } },
    { id: 'R6', group: 'R', demo: 'report', title: FINAL + ' 표 2·15: 2029-10 본인 주거재원 원금 4,311.4(마지막 달 적립 전 4,203.4)', plan: 'after-v1', month: '2029-10',
      expect: { usable: 4311.4, paydayUsable: 4203.4, judgeStatus: '전체 목표 달성' } },
    { id: 'R7', group: 'R', demo: 'report', title: FINAL + ' 표 16: 자유적금 월 80·21개월(3.85%) 세후 이자 50.2 → 만기 1,730.2(참고, 재원 제외)', plan: 'after-v1', month: '2029-04', opts: { includeBankInterest: true },
      expect: { productMaturity: 1730.16 } },
    { id: 'R8', group: 'R', demo: 'report', title: FINAL + ' 7장: 기본 계산은 적금 이자를 재원에 넣지 않음(만기 원금 1,680)', plan: 'after-v1', month: '2029-04',
      expect: { productMaturity: 1680 } },
    { id: 'R9', group: 'R', demo: 'report', title: FINAL + ' 표 24: 보완저축 미실행 → 4,131.4(목표 대비 18.6 부족)', plan: 'after-v1', month: '2029-10',
      scenarios: [{ type: 'bufferSkip', value: 5 }], expect: { usable: 4131.4, shortHousing: 18.6 } },
    { id: 'R10', group: 'R', demo: 'report', title: FINAL + ' 표 24: 감면 종료 충격 확대(월 7 → 10) → 4,296.4', plan: 'after-v1', month: '2029-10',
      scenarios: [{ type: 'taxEndShock', value: 10 }], expect: { usable: 4296.4 } },
    { id: 'R11', group: 'R', demo: 'report', title: FINAL + ' 표 24: 2027-11부터 6개월 소득 20% 감소(생활비 185) → 3,987.4', plan: 'after-v1', month: '2029-10',
      scenarios: [{ type: 'incomeDrop', start: '2027-11', months: 6, value: 0.2, living: 185 }], expect: { usable: 3987.4, shortHousing: 162.6, reachMonth: '2029-12' } },
    { id: 'R12', group: 'R', demo: 'report', title: FINAL + ' 표 24: 3개월 실직(생활비 165, 연금·주거 중단) → 3,471.4, 43개월 차(2030-05) 도달', plan: 'after-v1', month: '2029-10',
      scenarios: [{ type: 'jobLoss', start: '2027-11', months: 3, value: 0, living: 165, pausePension: true }], expect: { usable: 3471.4, shortHousing: 678.6, reachMonth: '2030-05' } },
    { id: 'R13', group: 'R', demo: 'report', title: FINAL + ' 10장: 실직 시 2028-01 비상금 495', plan: 'after-v1', month: '2028-01',
      scenarios: [{ type: 'jobLoss', start: '2027-11', months: 3, value: 0, living: 165, pausePension: true }], expect: { emergency: 495 } },
    { id: 'R14', group: 'R', demo: 'report', title: FINAL + ' 10장: 실직 후 2~5월 복구 → 2028-05 비상금 955, 6월 990', plan: 'after-v1', month: '2028-05',
      scenarios: [{ type: 'jobLoss', start: '2027-11', months: 3, value: 0, living: 165, pausePension: true }], expect: { emergency: 955 } },
    { id: 'R15', group: 'R', demo: 'report', title: FINAL + ' 표 24: 비주거 생활비(월세 70 고정) 13·25개월 차 2.3% 인상 → 약 4,207.1', plan: 'after-v1', month: '2029-10',
      scenarios: [{ type: 'livingRise', start: '2027-11', months: 0, value: 0.023, steps: true, keepRent: true }], expect: { usable: 4207.1 } },
    { id: 'R16', group: 'R', demo: 'report', title: FINAL + ' 표 24: 생활비 전체 13·25개월 차 2.3% 인상 → 약 4,148.7(목표 대비 1.3 부족)', plan: 'after-v1', month: '2029-10',
      scenarios: [{ type: 'livingRise', start: '2027-11', months: 0, value: 0.023, steps: true }], expect: { usable: 4148.7, shortHousing: 1.3 } },
    { id: 'R17', group: 'R', demo: 'report', title: FINAL + ' 표 2·19·21: 가구 조달 22,511.4, 지급 후 161.4, 마지막 적립 전 3.4, 부대비용 한계 211.4', plan: 'after-v1', month: '2029-10',
      expect: { hhFunding: 22511.4, hhAfter: 161.4, hhEarly: 3.4, hhMovingLimit: 211.4 } },
    { id: 'R18', group: 'R', demo: 'report', title: FINAL + ' 표 19: 계약금 지급 전 2,987.4 → 지급 후 767.4 → 10월 적립 후 1,091.4 → 반환 후 2,091.4 → 잔금 후 311.4', plan: 'after-v1', month: '2029-10',
      expect: { flow0: 2987.4, flow1: 767.4, flow4: 1091.4, flow5: 2091.4, flow6: 311.4 } },
    { id: 'R19', group: 'R', demo: 'report', title: FINAL + ' 표 13·14: 설계 전(생활비 235) 대비 설계 후 생활비 195(필수 165·선택 30)', plan: 'after-v1', month: '2027-02',
      expect: { essential: 165, optional: 30, pensionPay: 10, emergencyIn: 110, housingIn: 5 } }
  ];

  function getActual(field, row, result) {
    var j = result.judgement;
    var cond = function (key) {
      for (var i = 0; i < j.conditions.length; i++) if (j.conditions[i].key === key) return j.conditions[i].shortfall;
      return undefined;
    };
    switch (field) {
      case 'payoffHigh': return result.payoff.high;
      case 'judgeStatus': return j.status;
      case 'judgeLabel': return j.label;
      case 'shortDebt': return cond('debt');
      case 'shortEmergency': return cond('emergency');
      case 'shortHousing': return cond('housing');
      case 'paydayUsable': return row ? row.usable - Math.max(0, row.housingIn) : undefined;
      case 'reachMonth': return result.reachMonth;
      case 'housingTotalIn': return row ? row.housingIn + row.productPay : undefined;
      case 'hhFunding': return result.household && result.household.funding;
      case 'hhAfter': return result.household && result.household.after;
      case 'hhEarly': return result.household && result.household.early;
      case 'hhMovingLimit': return result.household && result.household.movingLimit;
      default:
        if (/^flow\d$/.test(field)) { var f = result.household && result.household.flow[Number(field.slice(4))]; return f ? f.balance : undefined; }
        return row ? row[field] : undefined;
    }
  }

  /**
   * 사례 하나 실행.
   * @param {object} c 사례
   * @param {object} P { engine, demo } (Node: require 결과, 브라우저: window.Planner)
   * @returns {{id, title, pass, checks:[{field,label,expected,actual,pass}]}}
   */
  function runCase(c, P) {
    var state = c.demo === 'report' ? P.demo.getDemo() : P.demo.getLegacyDemo();
    var opts = Object.assign({ debtRule: c.debtRule, excludeProducts: !!c.excludeProducts }, c.opts || {});
    if (c.scenarios) opts = P.scenarios.withScenarios(state, c.scenarios, opts);
    var result = P.engine.runPlan(state, c.plan, opts);
    if (c.expect.reachMonth !== undefined) {
      // 목표월 이후로 계산을 늘려 처음으로 목표 금액(보증금+부대비용)에 닿는 달
      var ext = P.engine.runPlan(state, c.plan, Object.assign({}, opts, { endMonth: P.dates.addMonths(result.input.targetMonth, 24) }));
      var goal = ext.input.goal, need = Number(goal.depositTarget) + Number(goal.movingCost);
      var hit = ext.rows.filter(function (r) { return r.month >= result.input.targetMonth && r.usable >= need - 1e-9; })[0];
      result.reachMonth = hit ? hit.month : '도달 안 함';
    }
    if (P.household) result.household = P.household.compute(state, result);
    var row = P.engine.rowAt(result, c.month);
    var checks = Object.keys(c.expect).map(function (field) {
      var expected = c.expect[field];
      var actual = getActual(field, row, result);
      var pass = typeof expected === 'number'
        ? typeof actual === 'number' && Math.abs(actual - expected) <= TOLERANCE
        : actual === expected;
      return { field: field, label: FIELD_LABELS[field] || field, expected: expected, actual: actual, pass: pass };
    });
    return {
      id: c.id,
      group: c.group,
      title: c.title,
      pass: checks.every(function (x) { return x.pass; }),
      checks: checks
    };
  }

  function runAll(P) {
    return CASES.map(function (c) { return runCase(c, P); });
  }

  var api = { TOLERANCE: TOLERANCE, FIELD_LABELS: FIELD_LABELS, CASES: CASES, runCase: runCase, runAll: runAll };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.cases = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
