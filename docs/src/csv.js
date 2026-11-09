/*
 * 거래내역 CSV 불러오기(명세 6-3 이번 달 기록).
 * 형식: 날짜,금액,적요,보낸계좌,받은계좌   (금액 단위: 원 → 만원으로 바꿔 저장)
 * - 계좌번호는 끝 4자리만 남긴다. 전체 번호는 어디에도 저장하지 않는다.
 * - 본인 계좌 간 이체는 소득·지출로 세지 않는다.
 * - 분류는 앱이 추정만 하고, 고객이 확인해야 기록에 반영된다.
 */
(function (root) {
  'use strict';

  var CATEGORIES = {
    income: '소득',
    essential: '필수 지출',
    optional: '선택 지출',
    debt: '부채 상환',
    emergency: '비상금',
    housing: '주거자금',
    product: '상품 납입',
    ownTransfer: '본인 계좌 이체',
    unknown: '분류 필요'
  };

  // 적요 키워드 → 분류 추정(고객이 바꿀 수 있음). 위에서부터 먼저 맞는 것.
  var RULES = [
    { re: /급여|월급|상여|성과급/, cat: 'income' },
    { re: /대출|이자|상환|학자금/, cat: 'debt' },
    { re: /청년미래|적금|저축공제/, cat: 'product' },
    { re: /비상금/, cat: 'emergency' },
    { re: /주거자금|이사자금/, cat: 'housing' },
    { re: /월세|관리비|전기|가스|수도|통신|보험|교통|마트|장보기/, cat: 'essential' },
    { re: /카드|식당|카페|쇼핑|배달|여행|구독/, cat: 'optional' }
  ];

  /** 따옴표·쉼표를 처리하는 CSV 한 줄 분리 */
  function splitLine(line) {
    var out = [];
    var cur = '';
    var q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  /** 계좌번호 → 끝 4자리(숫자만). 비어 있으면 '' */
  function last4(acc) {
    var d = String(acc || '').replace(/\D/g, '');
    return d ? d.slice(-4) : '';
  }

  function normDate(s) {
    var m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s || '');
    if (!m) return null;
    return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  }

  function guess(memo) {
    for (var i = 0; i < RULES.length; i++) if (RULES[i].re.test(memo || '')) return RULES[i].cat;
    return 'unknown';
  }

  /**
   * @param {string} text CSV 내용
   * @param {string[]} ownAccounts 본인 계좌 끝 4자리 목록
   * @returns {{rows:[{date,month,amount,memo,from4,to4,direction,category,confirmed}], errors:[string]}}
   */
  function parseTransactions(text, ownAccounts) {
    var own = (ownAccounts || []).map(last4).filter(Boolean);
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    var rows = [];
    var errors = [];
    if (!lines.length) return { rows: rows, errors: ['파일에 거래내역이 없습니다.'] };
    var start = /날짜|date/i.test(lines[0]) ? 1 : 0;
    for (var i = start; i < lines.length; i++) {
      var c = splitLine(lines[i]);
      var date = normDate(c[0]);
      var won = Number(String(c[1] || '').replace(/[,원\s]/g, ''));
      if (!date || !Number.isFinite(won)) {
        errors.push((i + 1) + '번째 줄을 읽지 못했습니다(날짜 또는 금액 형식).');
        continue;
      }
      var from4 = last4(c[3]);
      var to4 = last4(c[4]);
      var fromOwn = own.indexOf(from4) >= 0;
      var toOwn = own.indexOf(to4) >= 0;
      var direction = fromOwn && toOwn ? 'own' : toOwn ? 'in' : fromOwn ? 'out' : won >= 0 ? 'in' : 'out';
      var cat = direction === 'own' ? 'ownTransfer' : guess(c[2]);
      if (direction === 'in' && cat !== 'income') cat = guess(c[2]) === 'income' ? 'income' : 'unknown';
      // 본인 계좌 간 이체라도 적요가 비상금·주거자금·적금이면 '저축 이동'으로 본다(소득·지출 아님)
      if (direction === 'own') {
        var g = guess(c[2]);
        if (g === 'emergency' || g === 'housing' || g === 'product') cat = g;
      }
      rows.push({
        date: date,
        month: date.slice(0, 7),
        amount: Math.abs(won) / 10000,
        memo: c[2] || '',
        from4: from4,
        to4: to4,
        direction: direction,
        category: cat,
        confirmed: false
      });
    }
    return { rows: rows, errors: errors };
  }

  /**
   * 고객이 확인한 거래만 항목별 월 합계로. 소득·본인 이체·분류 필요는 기록 항목에 넣지 않는다.
   * @returns {{essential, optional, debt, emergency, housing, product}} (해당 거래가 없으면 키 없음)
   */
  function summarize(rows, month) {
    var out = {};
    rows.forEach(function (r) {
      if (!r.confirmed || r.month !== month) return;
      if (['essential', 'optional', 'debt', 'emergency', 'housing', 'product'].indexOf(r.category) < 0) return;
      out[r.category] = (out[r.category] || 0) + r.amount;
    });
    return out;
  }

  /** 시연용 거래내역(가상). 본인 계좌 끝 4자리: 1111(급여), 2222(생활비), 3333(저축) */
  var DEMO_OWN = ['1111', '2222', '3333'];
  // 2026-10 거래: 금액이 10월 기록(상환 65, 필수 132, 선택 61)과 같고, 기록이 비어 있던 비상금 이체 30만원이 들어 있다.
  var DEMO_CSV = [
    '날짜,금액,적요,보낸계좌,받은계좌',
    '2026-10-01,"2,900,000",급여,999-00-000001,110-111-111111',
    '2026-10-01,"1,930,000",생활비 통장으로,110-111-111111,220-222-222222',
    '2026-10-02,"500,000",월세,220-222-222222,555-55-5555',
    '2026-10-02,"150,000",관리비,220-222-222222,555-55-5556',
    '2026-10-05,"500,000",신용대출 상환,110-111-111111,777-77-7777',
    '2026-10-05,"150,000",학자금 대출 상환,110-111-111111,777-77-7778',
    '2026-10-06,"420,000",마트 장보기,220-222-222222,888-88-8801',
    '2026-10-08,"230,000",카드 결제(식당),220-222-222222,888-88-8888',
    '2026-10-10,"300,000",비상금 이체,110-111-111111,330-333-333333',
    '2026-10-12,"280,000",카드 결제(쇼핑),220-222-222222,888-88-8888',
    '2026-10-15,"38,000",통신요금,220-222-222222,888-88-8889',
    '2026-10-15,"62,000",교통카드 충전,220-222-222222,888-88-8890',
    '2026-10-20,"80,000",보험료,220-222-222222,888-88-8891',
    '2026-10-24,"70,000",전기·가스 요금,220-222-222222,888-88-8892',
    '2026-10-27,"100,000",카드 결제(여행 예약),220-222-222222,888-88-8888'
  ].join('\n');

  var api = {
    CATEGORIES: CATEGORIES,
    parseTransactions: parseTransactions,
    summarize: summarize,
    last4: last4,
    DEMO_OWN: DEMO_OWN,
    DEMO_CSV: DEMO_CSV
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.csv = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
