/* 숫자 표시(표시할 때만 반올림). 단위는 만원. */
(function (root) {
  'use strict';

  function isNum(x) {
    return typeof x === 'number' && Number.isFinite(x);
  }

  function withCommas(intStr) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 소수 1자리 + 천 단위 쉼표. 1234.56 → '1,234.6'. 숫자가 아니면 '—'. */
  function num1(x) {
    if (!isNum(x)) return '—';
    var r = Math.round(x * 10) / 10;
    if (Object.is(r, -0) || Math.abs(r) < 0.05) r = 0;
    var neg = r < 0;
    var parts = Math.abs(r).toFixed(1).split('.');
    return (neg ? '-' : '') + withCommas(parts[0]) + '.' + parts[1];
  }

  /** 문장용: 소수점 아래가 0이면 뗀다. 60 → '60', 32.9 → '32.9' */
  function short(x) {
    var s = num1(x);
    return s.slice(-2) === '.0' ? s.slice(0, -2) : s;
  }

  /** 금액: '1,234.5만원' */
  function won(x) {
    return isNum(x) ? num1(x) + '만원' : '—';
  }

  /** 증감: '+12.3' / '-4.0' / '0.0' */
  function signed(x) {
    if (!isNum(x)) return '—';
    var s = num1(x);
    return s !== '0.0' && s.charAt(0) !== '-' ? '+' + s : s;
  }

  /** 비율(0.172 → '17.2%') */
  function pct(x) {
    return isNum(x) ? num1(x * 100) + '%' : '—';
  }

  var api = { num1: num1, short: short, won: won, signed: signed, pct: pct };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.format = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
