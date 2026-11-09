/* 월(YYYY-MM) 계산과 나이 계산. 나이는 이 파일의 ageAt 한 곳에서만 계산한다(명세 5절 4). */
(function (root) {
  'use strict';

  var YM_RE = /^(\d{4})-(\d{2})$/;

  /** 'YYYY-MM' → 월 일련번호(연×12 + 월−1). 형식이 틀리면 NaN. */
  function parseYM(s) {
    if (typeof s !== 'string') return NaN;
    var m = YM_RE.exec(s);
    if (!m) return NaN;
    var mo = Number(m[2]);
    if (mo < 1 || mo > 12) return NaN;
    return Number(m[1]) * 12 + mo - 1;
  }

  /** 월 일련번호 → 'YYYY-MM' */
  function formatYM(n) {
    if (!Number.isFinite(n)) return '';
    var y = Math.floor(n / 12);
    var mo = n - y * 12 + 1;
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  }

  function isValidYM(s) {
    return Number.isFinite(parseYM(s));
  }

  function addMonths(s, k) {
    return formatYM(parseYM(s) + k);
  }

  /** b − a (개월). a가 2026-09, b가 2026-12면 3. */
  function diffMonths(a, b) {
    return parseYM(b) - parseYM(a);
  }

  /** 날짜 문자열('YYYY-MM-DD' 또는 'YYYY-MM') → 'YYYY-MM' */
  function ymOf(dateStr) {
    return typeof dateStr === 'string' ? dateStr.slice(0, 7) : '';
  }

  /**
   * 만 나이(월 단위). 출생 연월만 저장하므로 출생 달이 되면 한 살 많아진 것으로 본다.
   * 출생 연월이 없거나 형식이 틀리면 null.
   */
  function ageAt(birthYM, atYM) {
    var b = parseYM(birthYM);
    var t = parseYM(atYM);
    if (!Number.isFinite(b) || !Number.isFinite(t) || t < b) return null;
    return Math.floor((t - b) / 12);
  }

  var api = {
    parseYM: parseYM,
    formatYM: formatYM,
    isValidYM: isValidYM,
    addMonths: addMonths,
    diffMonths: diffMonths,
    ymOf: ymOf,
    ageAt: ageAt
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.dates = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
