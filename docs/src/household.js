/*
 * 가구 전세 조달과 지급일 잔액(보고서 표 2·9·19·21). 본인 주거재원은 엔진 결과를 그대로 쓰고,
 * 배우자 자금·전세대출(승인 전 조건부)·보증금·계약금은 state.household의 가정값이다.
 * 누적 조달액(엔진의 주거자금)과 계약금을 낸 뒤의 실제 계좌잔액을 섞지 않는다.
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var engine = isNode ? require('./engine.js') : root.Planner.engine;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;

  function num(x) { var n = Number(x); return Number.isFinite(n) ? n : 0; }
  function c(x) { return Math.round(num(x) * 10) / 10 >= 1000 ? (Math.round(num(x) * 10) / 10).toLocaleString('en-US') : String(Math.round(num(x) * 10) / 10); }

  /**
   * @param {object} state
   * @param {object} result 실행 기준 계획의 엔진 결과(목표월까지)
   * @returns {null | {...}} household 정보가 없으면 null
   */
  function compute(state, result) {
    var h = state.household;
    if (!h || !result) return null;
    var tm = result.input.targetMonth;
    var goal = result.input.goal;
    var row = engine.rowAt(result, tm);
    if (!row) return null;
    var sp = h.spouse || {};
    var spouseTotal = num(sp.initial) + num(sp.monthly) * num(sp.months);
    var spouseLast = num(sp.monthly);
    var own = row.usable;
    var ownLast = Math.max(0, row.housingIn);
    var loan = num(h.loan && h.loan.amount);
    var deposit = num(h.deposit);
    var moving = num(goal.movingCost);
    var bufferMin = num(h.bufferMin);
    var funding = own + spouseTotal + loan;
    var budget = deposit + moving;
    var after = funding - budget;
    var early = after - ownLast - spouseLast;

    // 본인 계좌의 지급일 흐름(표 19): 계약월 말 잔액 → 계약금 지급 → 매월 적립 → 보증금 반환 → 잔금 분담 → 부대비용
    var down = num(h.downPayment);
    var ownShare = num(goal.depositTarget);
    var flow = [];
    var cm = h.contractMonth;
    var depRet = result.input.depositReturn;
    var depAmt = depRet ? num(depRet.amount) : 0;
    var depMonth = depRet ? depRet.month : null;
    var cRow = cm ? engine.rowAt(result, cm) : null;
    if (cRow) {
      var bal = cRow.housing - (depMonth && depMonth <= cm ? depAmt : 0);
      flow.push({ label: cm + ' 적립 완료, 계약금 지급 전', balance: bal, note: '기존 보증금 ' + c(depAmt) + '은 아직 미반환' });
      bal -= down;
      flow.push({ label: '계약금 ' + c(down) + ' 지급 후', balance: bal, note: '계약금은 이미 지급한 주거자금' });
      for (var t = dates.parseYM(cm) + 1; t <= dates.parseYM(tm); t++) {
        var r = engine.rowAt(result, dates.formatYM(t));
        if (!r) continue;
        bal += r.housingIn + num(r.productMaturity);
        flow.push({ label: dates.formatYM(t) + ' 적립 후', balance: bal, note: '월 ' + Math.round(r.housingIn * 10) / 10 + ' 적립' });
      }
      if (depAmt > 0) { bal += depAmt; flow.push({ label: '기존 보증금 ' + c(depAmt) + ' 반환 후', balance: bal, note: '실제 입금 확인' }); }
      bal -= ownShare - down;
      flow.push({ label: '본인 잔금 분담 ' + c(ownShare - down) + ' 지급 후', balance: bal, note: '배우자 ' + c(spouseTotal) + '·대출 ' + c(loan) + ' 별도 투입' });
      bal -= moving;
      flow.push({ label: '부대비용 ' + c(moving) + ' 지급 후', balance: bal, note: '비상금과 별도' });
    }
    return {
      targetMonth: tm,
      own: own, ownLast: ownLast,
      spouseTotal: spouseTotal, spouseLast: spouseLast,
      loan: loan, deposit: deposit, moving: moving,
      funding: funding, budget: budget,
      after: after, bufferMin: bufferMin, margin: after - bufferMin,
      early: early, earlyNeed: Math.max(0, bufferMin - early),
      movingLimit: after + moving - bufferMin,
      loanRatio: deposit > 0 ? loan / deposit : null,
      ownShare: ownShare, balancePayment: deposit - down, down: down,
      flow: flow,
      spouseCut500: after - 500,
      depositUp10: { deposit: deposit * 1.1, loanNeeded: deposit * 1.1 - (ownShare + spouseTotal) },
      ok: after >= bufferMin - 1e-9
    };
  }

  var api = { compute: compute };
  if (isNode) module.exports = api;
  else { root.Planner = root.Planner || {}; root.Planner.household = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
