/* 화면 공통 조각. 모든 함수는 HTML 문자열을 돌려준다. 사용자 입력은 반드시 esc()를 거친다. */
(function (root) {
  'use strict';

  var P = root.Planner;
  var fmt = P.format;
  var ui = (P.ui = P.ui || {});
  ui.screens = ui.screens || {};
  ui.actions = ui.actions || {};

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 상태 글자 → 색·아이콘(색 + 아이콘 + 글자를 함께 표시)
  var META = {
    '전체 목표 달성': ['ok', '✓'], '완료': ['ok', '✓'], '예산 안': ['ok', '✓'], '충족': ['ok', '✓'], '적용됨': ['ok', '✓'], 'ok': ['ok', '✓'], '양호': ['ok', '✓'], '해소': ['ok', '✓'],
    '부분 충족': ['warn', '!'], '초과': ['warn', '!'], '주의': ['warn', '!'], 'warn': ['warn', '!'], '확인 필요': ['warn', '!'], '진행 중': ['info', '…'], '확인 대기': ['warn', '!'],
    '미달': ['bad', '✕'], '경보': ['bad', '✕'], 'bad': ['bad', '✕'], '불충족': ['bad', '✕'],
    '안내': ['info', 'i'], 'info': ['info', 'i'], '새 알림': ['info', '●'], '고객에게 제시됨': ['info', '●'], '잠정': ['info', '…'],
    '확정': ['ok', '✓'], '아직 확인 안 됨': ['muted', '○'], '해당 없음': ['muted', '–'], '참고': ['muted', '·'], 'na': ['muted', '–'],
    '읽음': ['muted', '○'], '통과': ['ok', '✓'], '실패': ['bad', '✕'], '작성 중': ['muted', '✎'], '대체됨': ['muted', '↻'], '제시함': ['info', '●'], '보류': ['muted', '‖'], '판정 불가': ['muted', '?']
  };

  function metaOf(text) {
    if (META[text]) return META[text];
    var base = String(text).split('(')[0];
    return META[base] || ['muted', '·'];
  }

  function badge(text, key) {
    var m = metaOf(key || text);
    return '<span class="badge b-' + m[0] + '"><span aria-hidden="true">' + m[1] + '</span>' + esc(text) + '</span>';
  }

  /** 금액: 숫자 + 작은 '만원' */
  function money(x, cls) {
    return '<span class="num ' + (cls || '') + '">' + fmt.num1(x) + '<small>만원</small></span>';
  }

  /** 증감: 좋은 방향(초록) / 나쁜 방향(빨강). higherIsGood=false면 반대(지출 등) */
  function delta(x, higherIsGood) {
    if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) < 0.05) return '<span class="num muted">0.0</span>';
    var good = higherIsGood === false ? x < 0 : x > 0;
    return '<span class="num ' + (good ? 'up' : 'down') + '">' + fmt.signed(x) + '</span>';
  }

  var GLOSSARY = {
    '사용 가능 주거자금': '이사할 때 쓸 수 있는 돈입니다. 주거자금 잔액에 투자자산을 더합니다(매각 시 가격 변동). 만기 전 정책상품, 반환 전 보증금, 비상금, 연금은 넣지 않습니다.',
    '비상금': '소득이 끊기거나 갑자기 돈이 필요할 때 쓰는 돈입니다. 목표까지 먼저 채우고 남는 돈을 주거자금으로 보냅니다.',
    '고금리 부채': '연 금리가 기준(4%) 이상인 부채입니다. 추가 상환은 고금리 부채에만 합니다. 저금리 부채는 목표 판정에서 빼고 잔액만 따로 보여줍니다.',
    '잠정': '아직 달이 끝나지 않았거나 확인 전인 기록입니다. 화면에 보여주지만 실제 경로 계산에는 넣지 않습니다.',
    '확정': '고객이 확인한 기록입니다. 실제 경로 계산과 경보 판단에 씁니다.',
    '유예기간': '납입 예정일 뒤 기다려 주는 기간입니다. 이 기간이 지나기 전에는 기록이 없어도 미달로 보지 않습니다.',
    '조건부 재원': '가입·지급 조건이 확정되지 않은 돈입니다. 이 재원을 넣은 결과와 뺀 결과를 함께 확인하세요.',
    '판정': '이사 예정월 말 기준으로 ① 고금리 부채 상환 완료 ② 비상금 목표 ③ 사용 가능 주거자금 ≥ 목표 보증금 + 이사비 세 가지를 봅니다.',
    '최근 추세': '최근 확정 기록(최대 3개월)에서 계획과 달랐던 금액이 앞으로도 매달 이어진다고 가정한 예상입니다.',
    '자동 적용': '동의한 범위 안의 생활비 예산 조정만 앱이 바로 새 계획 버전으로 적용합니다. 목표일 변경·신규 대출·위험 확대·상품 해지는 자동 적용하지 않습니다.'
  };

  function help(term) {
    var t = GLOSSARY[term];
    if (!t) return '';
    return '<details class="help"><summary aria-label="용어 도움말: ' + esc(term) + '">?</summary><div role="note"><strong>' + esc(term) + '</strong><br>' + esc(t) + '</div></details>';
  }

  function fold(title, body, open) {
    return '<details class="fold"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary>' + body + '</details>';
  }

  function empty(msg, btnLabel, action, extra) {
    return '<div class="empty"><p>' + esc(msg) + '</p>' +
      (btnLabel ? '<button class="btn btn-primary" data-action="' + esc(action) + '"' + (extra || '') + '>' + esc(btnLabel) + '</button>' : '') + '</div>';
  }

  function errorBox(msg) {
    return '<div class="card" role="alert"><h2>' + badge('문제가 생겼어요', 'bad') + '</h2><p>' + esc(msg) +
      '</p><div class="btn-row"><button class="btn btn-primary" data-action="retry">다시 시도</button>' +
      '<button class="btn" data-action="reset-demo-confirm">설계 예시로 되돌리기</button></div></div>';
  }

  function kpi(label, valueHtml, sub) {
    return '<div class="kpi"><div class="label">' + label + '</div><div class="value">' + valueHtml + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  /** 'YYYY-MM' → '2029년 12월' */
  function ymText(ym) {
    if (!ym) return '—';
    return ym.slice(0, 4) + '년 ' + Number(ym.slice(5, 7)) + '월';
  }

  function judgementBadge(j) {
    return badge(j.label, j.status);
  }

  /**
   * 넓은 표(머리행 고정). cells는 이미 HTML이면 {html: '...'}로, 아니면 글자로 넣는다.
   * opts: { caption, rowClass(i) }
   */
  function table(headers, rows, opts) {
    opts = opts || {};
    var cell = function (c, tag) {
      if (c && typeof c === 'object' && 'html' in c) return '<' + tag + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + c.html + '</' + tag + '>';
      return '<' + tag + '>' + esc(c) + '</' + tag + '>';
    };
    return '<div class="table-wrap"' + (opts.maxHeight ? ' style="max-height:' + opts.maxHeight + '"' : '') + ' tabindex="0" role="region" aria-label="' + esc(opts.caption || '표') + '"><table class="data">' +
      (opts.caption ? '<caption class="sr-only">' + esc(opts.caption) + '</caption>' : '') +
      '<thead><tr>' + headers.map(function (h) { return cell(h, 'th'); }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr' + (opts.rowClass ? ' class="' + (opts.rowClass(i) || '') + '"' : '') + '>' + r.map(function (c) { return cell(c, 'td'); }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function n1(x) { return { html: '<span class="num">' + fmt.num1(x) + '</span>' }; }

  Object.assign(ui, {
    table: table, n1: n1,
    esc: esc, badge: badge, metaOf: metaOf, money: money, delta: delta, help: help, fold: fold,
    empty: empty, errorBox: errorBox, kpi: kpi, ymText: ymText, judgementBadge: judgementBadge, GLOSSARY: GLOSSARY
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
