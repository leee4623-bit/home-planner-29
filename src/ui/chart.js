/*
 * 그래프(직접 그린 SVG, 외부 라이브러리 없음).
 *
 * 화면은 HTML 문자열로 그리므로, 그래프는 먼저 자리(figure)만 넣고 화면을 그린 뒤 mountCharts()가
 * 실제 너비를 재서 그 크기 그대로 SVG를 그린다(viewBox 확대·축소를 쓰지 않아 작은 화면에서도 글자가 12px로 유지되고,
 * 벡터라 고해상도 화면에서 흐려지지 않음). 창 크기 변경·화면 회전·화면 전환 뒤에도 다시 그린다.
 *
 * - 범례·단위·핵심 수치는 SVG 밖 HTML(그래프 아래)에 둬서 겹치거나 잘리지 않는다.
 * - 색만으로 구분하지 않는다: 실선·점선·짧은 점선, 막대 빗금, 글자 라벨을 함께 쓴다.
 * - 마우스를 올리거나 손가락으로 누르면(또는 키보드 ←→) 그 달·항목의 값을 보여 준다.
 * - 값이 없거나 모두 0이어도 축이 깨지지 않고 NaN·Infinity를 표시하지 않는다.
 */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var dates = P.dates;
  var fmt = P.format;
  var engine = P.engine;

  var specs = [];
  ui.chartReset = function () { specs = []; };

  var DASH = { solid: '', dashed: '7 5', dotted: '2 4' };
  var FONT = 12;

  function isNum(x) { return typeof x === 'number' && Number.isFinite(x); }

  function niceStep(span) {
    if (!(span > 0)) return 1;
    var raw = span / 4;
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  }

  /** 세로축 범위: 0을 포함하고, 모두 0이거나 값이 없어도 [0, 1] 이상 */
  function yRange(values) {
    var nums = values.filter(isNum);
    var lo = Math.min(0, nums.length ? Math.min.apply(null, nums) : 0);
    var hi = Math.max(0, nums.length ? Math.max.apply(null, nums) : 0);
    if (hi - lo < 1e-9) hi = lo + 1;
    var step = niceStep((hi - lo) * 1.08);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil((hi * 1.04) / step) * step || step, step: step };
  }

  function label(v) {
    var a = Math.abs(v);
    return (v < 0 ? '-' : '') + (a >= 10000 ? fmt.short(a / 10000) + '억' : fmt.short(a));
  }

  function lineSample(style, color) {
    return '<svg width="26" height="10" aria-hidden="true" focusable="false"><line x1="1" x2="25" y1="5" y2="5" stroke="var(' + color + ')" stroke-width="2.5"' +
      (DASH[style] ? ' stroke-dasharray="' + (style === 'dotted' ? '2 3' : '6 3') + '"' : '') + ' stroke-linecap="round"/></svg>';
  }
  function barSample(hatch, color) {
    return '<svg width="14" height="12" aria-hidden="true" focusable="false"><rect x="1" y="1" width="12" height="10" fill="' + (hatch ? 'url(#hatch-legend)' : 'var(' + color + ')') + '" stroke="var(' + color + ')" stroke-width="1.5"/>' +
      (hatch ? '<defs><pattern id="hatch-legend" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="var(--surface)"/><line x1="0" y1="0" x2="0" y2="4" stroke="var(' + color + ')" stroke-width="2"/></pattern></defs>' : '') + '</svg>';
  }

  /**
   * 그래프 자리를 만든다.
   * spec.type 'line': { months:[YYYY-MM], series:[{label, values:[number|null], style:'solid'|'dashed'|'dotted', color:'--chart-plan'}], target:{value,label} }
   * spec.type 'bar' : { categories:[이름], groups:[{label, values:[number|null], color, hatch}], target? }
   * 공통: title, summary(HTML, 그래프 아래 핵심 수치), note
   */
  ui.chart = function (spec) {
    var id = specs.length;
    specs.push(spec);
    var legend = spec.type === 'bar'
      ? spec.groups.map(function (g) { return '<span>' + barSample(g.hatch, g.color) + ui.esc(g.label) + '</span>'; }).join('')
      : spec.series.map(function (s) { return '<span>' + lineSample(s.style, s.color) + ui.esc(s.label) + '</span>'; }).join('');
    if (spec.target && isNum(spec.target.value)) legend += '<span>' + lineSample('dotted', '--chart-target') + ui.esc(spec.target.label) + '</span>';
    var empty = spec.type === 'bar'
      ? !spec.groups.some(function (g) { return g.values.some(isNum); })
      : !spec.series.some(function (s) { return s.values.some(isNum); });
    return '<figure class="chart2" data-chart="' + id + '"' + (empty ? '' : ' tabindex="0"') + ' aria-label="' + ui.esc(spec.title + ' 그래프. 값은 그래프 아래 글로도 제공합니다.') + '">' +
      '<div class="chart-unit">단위: 만원' + (spec.type === 'line' && !empty ? ' · 누르거나 마우스를 올리면 그 달의 값' : spec.type === 'bar' && !empty ? ' · 막대를 누르면 값' : '') + '</div>' +
      (empty ? '<div class="chart-empty">표시할 자료가 아직 없어요.</div>' : '<div class="chart-plot" aria-hidden="true"></div><div class="chart-tip" role="status" aria-live="polite" hidden></div>') +
      '<figcaption><div class="chart-legend">' + legend + '</div>' +
      (spec.summary ? '<div class="chart-summary">' + spec.summary + '</div>' : '') +
      (spec.note ? '<div class="small muted">' + spec.note + '</div>' : '') + '</figcaption></figure>';
  };

  /* ---------- 그리기 ---------- */

  function size(fig) {
    var plot = fig.querySelector('.chart-plot');
    var w = Math.max(240, Math.floor(plot.getBoundingClientRect().width || plot.clientWidth || 320));
    var h = Math.round(Math.min(340, Math.max(230, w * 0.56)));
    return { plot: plot, W: w, H: h };
  }

  function yAxis(svg, r, y, padL, W, padR) {
    for (var v = r.lo; v <= r.hi + r.step * 1e-6; v += r.step) {
      var yy = Math.round(y(v)) + 0.5;
      svg.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--border)" stroke-width="1" shape-rendering="crispEdges"/>');
      svg.push('<text x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="' + FONT + '" fill="var(--muted)">' + label(v) + '</text>');
    }
  }

  function padLeft(r) {
    var longest = 0;
    for (var v = r.lo; v <= r.hi + r.step * 1e-6; v += r.step) longest = Math.max(longest, label(v).length);
    return 10 + longest * 7.2;
  }

  function drawLine(fig, spec) {
    var s = size(fig);
    var W = s.W, H = s.H;
    var n = spec.months.length;
    var all = [];
    spec.series.forEach(function (x) { all = all.concat(x.values); });
    if (spec.target && isNum(spec.target.value)) all.push(spec.target.value);
    var r = yRange(all);
    var padL = padLeft(r), padR = 14, padT = 14, padB = 28;
    var plotW = W - padL - padR;
    var x = function (i) { return padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW); };
    var y = function (v) { return padT + (1 - (v - r.lo) / (r.hi - r.lo)) * (H - padT - padB); };
    var svg = ['<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="inherit">'];
    yAxis(svg, r, y, padL, W, padR);

    // 가로축: 화면 너비에 맞춰 월 표시 수를 줄인다
    var t = spec.months.map(dates.parseYM);
    var maxLabels = Math.max(2, Math.floor(plotW / (W < 480 ? 58 : 76)));
    var steps = [1, 2, 3, 6, 12, 24, 36, 60];
    var stp = steps.filter(function (k) { return Math.ceil(n / k) <= maxLabels; })[0] || 60;
    var short = W < 480;
    var ticks = [];
    for (var i = 0; i < n; i++) {
      var mo = t[i] % 12;
      if (stp >= 12 ? mo === 0 : (t[i] % stp === 0)) ticks.push(i);
    }
    if (!ticks.length || ticks[0] > Math.max(1, stp / 2)) ticks.unshift(0);
    var lastX = -Infinity;
    ticks.forEach(function (i) {
      var xx = x(i);
      var txt = stp >= 12 && t[i] % 12 === 0 ? String(Math.floor(t[i] / 12)) : (short ? spec.months[i].slice(2).replace('-', '.') : spec.months[i].replace('-', '.'));
      var wTxt = txt.length * 7.2;
      if (xx - wTxt / 2 < lastX + 6) return; // 겹치면 건너뜀
      var anchor = 'middle';
      if (xx - wTxt / 2 < padL - 4) anchor = 'start';
      if (xx + wTxt / 2 > W - 2) anchor = 'end';
      svg.push('<line x1="' + (Math.round(xx) + 0.5) + '" x2="' + (Math.round(xx) + 0.5) + '" y1="' + (H - padB) + '" y2="' + (H - padB + 4) + '" stroke="var(--faint)" shape-rendering="crispEdges"/>');
      svg.push('<text x="' + xx.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="' + anchor + '" font-size="' + FONT + '" fill="var(--muted)">' + txt + '</text>');
      lastX = anchor === 'middle' ? xx + wTxt / 2 : anchor === 'start' ? xx + wTxt : xx;
    });

    // 목표선(짧은 점선 + 글자)
    if (spec.target && isNum(spec.target.value)) {
      var ty = y(spec.target.value);
      svg.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '" stroke="var(--chart-target)" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>');
      var ly = ty - 7 < padT + 10 ? ty + 16 : ty - 7;
      svg.push('<text x="' + (padL + 6) + '" y="' + ly.toFixed(1) + '" font-size="' + FONT + '" font-weight="700" fill="var(--chart-target)" stroke="var(--surface)" stroke-width="4" paint-order="stroke">' + ui.esc(spec.target.label) + '</text>');
    }
    // 선
    spec.series.forEach(function (sr) {
      var d = '';
      var pen = false;
      sr.values.forEach(function (v, i) {
        if (!isNum(v)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
        pen = true;
      });
      if (d) svg.push('<path d="' + d + '" fill="none" stroke="var(' + sr.color + ')" stroke-width="' + (sr.style === 'solid' ? 3 : 2.5) + '"' + (DASH[sr.style] ? ' stroke-dasharray="' + DASH[sr.style] + '"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>');
    });
    svg.push('<g class="hover" pointer-events="none"></g>');
    svg.push('<rect class="hit" x="' + padL + '" y="' + padT + '" width="' + plotW + '" height="' + (H - padT - padB) + '" fill="transparent"/>');
    svg.push('</svg>');
    s.plot.innerHTML = svg.join('');

    fig._pick = function (i) {
      i = Math.max(0, Math.min(n - 1, i));
      fig._idx = i;
      var g = s.plot.querySelector('.hover');
      var xx = x(i);
      var parts = ['<line x1="' + xx + '" x2="' + xx + '" y1="' + padT + '" y2="' + (H - padB) + '" stroke="var(--faint)" stroke-width="1"/>'];
      var rows = [];
      spec.series.forEach(function (sr) {
        var v = sr.values[i];
        if (isNum(v)) parts.push('<circle cx="' + xx.toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="5" fill="var(--surface)" stroke="var(' + sr.color + ')" stroke-width="2.5"/>');
        rows.push('<div>' + lineSample(sr.style, sr.color) + ui.esc(sr.label) + ' <strong>' + (isNum(v) ? fmt.num1(v) + '만원' : '자료 없음') + '</strong></div>');
      });
      if (spec.target && isNum(spec.target.value)) rows.push('<div class="muted">' + ui.esc(spec.target.label) + '</div>');
      g.innerHTML = parts.join('');
      showTip(fig, '<div class="tip-h">' + ui.esc(ui.ymText(spec.months[i])) + '</div>' + rows.join(''), xx, W);
    };
    fig._fromX = function (px) { return n <= 1 ? 0 : Math.round(((px - padL) / plotW) * (n - 1)); };
    fig._count = n;
  }

  function drawBar(fig, spec) {
    var s = size(fig);
    var W = s.W, H = s.H;
    var all = [];
    spec.groups.forEach(function (g) { all = all.concat(g.values); });
    if (spec.target && isNum(spec.target.value)) all.push(spec.target.value);
    var r = yRange(all);
    var padL = padLeft(r), padR = 12, padT = 22, padB = 30;
    var plotW = W - padL - padR;
    var nc = spec.categories.length;
    var ng = spec.groups.length;
    var slot = plotW / nc;
    var bw = Math.min(56, (slot * 0.72) / ng);
    var y = function (v) { return padT + (1 - (v - r.lo) / (r.hi - r.lo)) * (H - padT - padB); };
    var svg = ['<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="inherit">'];
    svg.push('<defs>' + spec.groups.map(function (g, gi) {
      return g.hatch ? '<pattern id="hatch-' + fig.getAttribute('data-chart') + '-' + gi + '" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(' + g.color + ')" stroke-width="3"/></pattern>' : '';
    }).join('') + '</defs>');
    yAxis(svg, r, y, padL, W, padR);
    var zero = y(0);
    spec.categories.forEach(function (cat, ci) {
      var cx = padL + slot * ci + slot / 2;
      var txt = cat;
      svg.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="' + FONT + '" fill="var(--text)">' + ui.esc(txt) + '</text>');
      spec.groups.forEach(function (g, gi) {
        var v = g.values[ci];
        var bx = cx - (ng * bw) / 2 + gi * bw + 2;
        var w = bw - 4;
        if (!isNum(v)) {
          svg.push('<text x="' + (bx + w / 2).toFixed(1) + '" y="' + (zero - 6).toFixed(1) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + (w >= 48 ? '기록 없음' : '없음') + '</text>');
          return;
        }
        var top = Math.min(y(v), zero);
        var h = Math.max(1, Math.abs(y(v) - zero));
        svg.push('<rect x="' + bx.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' +
          (g.hatch ? 'url(#hatch-' + fig.getAttribute('data-chart') + '-' + gi + ')' : 'var(' + g.color + ')') + '" stroke="var(' + g.color + ')" stroke-width="1.5"/>');
        if (w >= 26) svg.push('<text x="' + (bx + w / 2).toFixed(1) + '" y="' + (top - 5).toFixed(1) + '" text-anchor="middle" font-size="11" fill="var(--text)" stroke="var(--surface)" stroke-width="3" paint-order="stroke">' + fmt.short(v) + '</text>');
      });
    });
    if (spec.target && isNum(spec.target.value)) {
      var ty = y(spec.target.value);
      svg.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '" stroke="var(--chart-target)" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>');
      // 막대 그래프의 목표 글자는 막대 값과 겹칠 수 있어 범례에만 둔다
    }
    svg.push('<g class="hover" pointer-events="none"></g>');
    svg.push('<rect class="hit" x="' + padL + '" y="' + padT + '" width="' + plotW + '" height="' + (H - padT - padB) + '" fill="transparent"/>');
    svg.push('</svg>');
    s.plot.innerHTML = svg.join('');

    fig._pick = function (ci) {
      ci = Math.max(0, Math.min(nc - 1, ci));
      fig._idx = ci;
      var cx = padL + slot * ci + slot / 2;
      s.plot.querySelector('.hover').innerHTML = '<rect x="' + (padL + slot * ci + 2).toFixed(1) + '" y="' + padT + '" width="' + (slot - 4).toFixed(1) + '" height="' + (H - padT - padB) + '" fill="var(--faint)" opacity="0.18" rx="4"/>';
      var rows = spec.groups.map(function (g) {
        var v = g.values[ci];
        return '<div>' + barSample(g.hatch, g.color) + ' ' + ui.esc(g.label) + ' <strong>' + (isNum(v) ? fmt.num1(v) + '만원' : '기록 없음') + '</strong></div>';
      });
      showTip(fig, '<div class="tip-h">' + ui.esc(spec.categories[ci]) + '</div>' + rows.join('') + (spec.tipNote ? '<div class="muted">' + spec.tipNote[ci] + '</div>' : ''), cx, W);
    };
    fig._fromX = function (px) { return Math.floor((px - padL) / slot); };
    fig._count = nc;
  }

  function showTip(fig, html, xx, W) {
    var tip = fig.querySelector('.chart-tip');
    tip.innerHTML = html;
    tip.hidden = false;
    var tw = tip.offsetWidth || 180;
    var left = Math.max(0, Math.min(W - tw, xx - tw / 2));
    tip.style.left = left + 'px';
  }

  function hideTip(fig) {
    var tip = fig.querySelector('.chart-tip');
    if (tip) tip.hidden = true;
    var g = fig.querySelector('.hover');
    if (g) g.innerHTML = '';
    fig._idx = null;
  }

  function bind(fig) {
    if (fig._bound) return;
    fig._bound = true;
    var at = function (e) {
      var plot = fig.querySelector('.chart-plot');
      if (!plot || !fig._fromX) return;
      var rect = plot.getBoundingClientRect();
      fig._pick(fig._fromX(e.clientX - rect.left));
    };
    fig.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') at(e); });
    fig.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('.chart-plot')) at(e); });
    // 터치 탭은 click으로도 들어온다(포인터 이벤트가 없는 브라우저 대비)
    fig.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.chart-plot')) at(e); });
    fig.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hideTip(fig); });
    fig.addEventListener('keydown', function (e) {
      if (!fig._pick) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var i = fig._idx === null || fig._idx === undefined ? 0 : fig._idx + (e.key === 'ArrowRight' ? 1 : -1);
        fig._pick(i);
      } else if (e.key === 'Escape') hideTip(fig);
    });
    fig.addEventListener('blur', function () { hideTip(fig); });
  }

  /** 화면을 그린 뒤 호출: 자리마다 지금 너비로 SVG를 그린다. */
  ui.mountCharts = function () {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    var figs = document.querySelectorAll('figure.chart2[data-chart]');
    for (var i = 0; i < figs.length; i++) {
      var fig = figs[i];
      var spec = specs[Number(fig.getAttribute('data-chart'))];
      if (!spec || !fig.querySelector('.chart-plot')) continue;
      try {
        if (spec.type === 'bar') drawBar(fig, spec); else drawLine(fig, spec);
        bind(fig);
        if (fig._idx !== null && fig._idx !== undefined) fig._pick(fig._idx); else hideTip(fig);
      } catch (e) {
        if (root.console) root.console.error(e);
        fig.querySelector('.chart-plot').innerHTML = '<div class="chart-empty">그래프를 그리지 못했어요. 아래 수치를 확인해 주세요.</div>';
      }
    }
  };

  // 창 크기 변경·화면 회전 시 다시 그림(너비가 바뀐 경우만)
  if (typeof root.addEventListener === 'function') {
    var timer = null;
    var lastW = null;
    var redraw = function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var w = root.innerWidth;
        if (w === lastW) return;
        lastW = w;
        ui.mountCharts();
      }, 120);
    };
    root.addEventListener('resize', redraw);
    root.addEventListener('orientationchange', function () { lastW = null; redraw(); });
  }

  /* ---------- 앱에서 쓰는 세 가지 기본 그래프 ---------- */

  function rowsByMonth(res) {
    var m = {};
    (res ? res.rows : []).forEach(function (r) { m[r.month] = r; });
    return m;
  }

  function monthSpan(a, b) {
    var out = [];
    var t0 = dates.parseYM(a), t1 = dates.parseYM(b);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return out;
    for (var t = t0; t <= t1 && out.length < 600; t++) out.push(dates.formatYM(t));
    return out;
  }

  function moneyText(x) { return isNum(x) ? fmt.num1(x) + '만원' : '—'; }
  function gapText(v, need) {
    if (!isNum(v) || !isNum(need)) return '';
    var g = v - need;
    return Math.abs(g) < 0.05 ? '목표와 같음' : '목표보다 ' + fmt.num1(Math.abs(g)) + '만원 ' + (g > 0 ? '많음(여유)' : '적음(부족)');
  }

  /**
   * ① 주거자금 진행: 현재 계획의 예상 경로 + 목표선. 설계 전 비교는 버튼으로 켠다.
   * @param {object} c 화면 컨텍스트
   * @param {object} o { result: 엔진 결과(기본: 기록 반영 후 계획), compareKey: 비교 상태를 담는 view 키 }
   */
  ui.housingChart = function (c, o) {
    o = o || {};
    var cur = o.result || c.d.current;
    var key = o.compareKey || 'cmpBefore';
    var showBefore = !!c.view[key] && !!c.d.before && c.d.beforePlan && c.d.beforePlan.id !== c.state.activePlanId;
    var tm = cur.input.targetMonth;
    var goal = cur.input.goal;
    var need = goal.depositTarget + goal.movingCost;
    var start = cur.rows.length ? cur.rows[0].month : tm;
    var end = tm;
    var before = showBefore ? P.engine.runPlan(c.state, c.d.beforePlan.id, { endMonth: tm }) : null;
    if (before && before.rows.length && before.rows[0].month < start) start = before.rows[0].month;
    var months = monthSpan(start, end);
    var cm = rowsByMonth(cur);
    var series = [{ label: o.label || '현재 계획 예상', color: '--chart-plan', style: 'solid', values: months.map(function (m) { return cm[m] ? cm[m].usable : null; }) }];
    if (before) {
      var bm = rowsByMonth(before);
      series.push({ label: '설계 전 예상', color: '--chart-before', style: 'dashed', values: months.map(function (m) { return bm[m] ? bm[m].usable : null; }) });
    }
    var last = cm[tm];
    var summary = '<p><strong>' + ui.esc(ui.ymText(tm)) + ' 예상 ' + moneyText(last && last.usable) + '</strong> · 목표 ' + fmt.num1(need) + '만원 · ' + gapText(last && last.usable, need) + '</p>';
    if (before) {
      var b = rowsByMonth(before)[tm];
      summary += '<p>설계 전 같은 달 ' + moneyText(b && b.usable) + ' · ' + gapText(b && b.usable, need) + '</p>';
    }
    var events = (cur.events || []).filter(function (e) { return ['highDebtPaidOff', 'emergencyReached', 'depositReturn', 'productMaturity'].indexOf(e.type) >= 0; });
    var seen = {};
    events = events.filter(function (e) { var k = e.type + e.month; if (seen[k]) return false; seen[k] = true; return true; });
    var toggle = c.d.beforePlan && c.d.beforePlan.id !== c.state.activePlanId
      ? '<button class="btn btn-sm" data-action="chart-toggle" data-key="' + key + '" aria-pressed="' + showBefore + '">' + (showBefore ? '설계 전 비교 끄기' : '설계 전과 비교') + '</button>'
      : '';
    return '<div class="chart-head"><span class="small muted">사용 가능 주거자금 = 주거자금 + 투자자산(비상금·연금·반환 전 보증금 제외)</span>' + toggle + '</div>' +
      ui.chart({
        type: 'line',
        title: '주거자금 진행',
        months: months,
        series: series,
        target: { value: need, label: '목표 ' + fmt.short(need) },
        summary: summary,
        note: events.length ? '주요 시점: ' + events.map(function (e) { return ui.esc(e.month + ' ' + e.label); }).join(' · ') : ''
      });
  };

  /**
   * ② 월 예산 비교: 생활비·저축·부채 상환 3개 항목의 계획과 실제(같은 단위, 만원/월).
   * 세부 항목은 아래 표(접기)로 따로 보여 준다.
   */
  ui.budgetChart = function (c, month) {
    var res = c.d.paths.plan;
    var row = engine.rowAt(res, month);
    if (!row) return '<p class="small muted">' + ui.esc(ui.ymText(month)) + '은 계획 기간 밖이에요.</p>';
    var pl = P.tracking.plannedFor(row);
    var rec = P.store.getRecord(c.state, month) || {};
    var has = function (k) { return rec[k] !== undefined && rec[k] !== null; };
    var sum = function (keys) {
      var any = keys.some(has);
      return any ? keys.reduce(function (s, k) { return s + (has(k) ? Number(rec[k]) : 0); }, 0) : null;
    };
    // 계획이 있는 항목 중 일부만 기록했을 때만 '일부 기록'으로 표시(계획 0인 항목은 기록이 없어도 됨)
    var partial = function (keys) {
      var n = keys.filter(has).length;
      return n > 0 && keys.some(function (k) { return !has(k) && (pl[k] || 0) > 0.05; });
    };
    var SAV = ['emergency', 'housing', 'product', 'pension'];
    var cats = [
      { name: '생활비', keys: ['essential', 'optional'], plan: pl.essential + pl.optional, lowerGood: true },
      { name: '저축', keys: SAV, plan: SAV.reduce(function (s, k) { return s + (pl[k] || 0); }, 0) },
      { name: '부채 상환', keys: ['debt'], plan: pl.debt }
    ];
    var actual = cats.map(function (k) { return sum(k.keys); });
    var lines = cats.map(function (k, i) {
      var a = actual[i];
      return '<li><span>' + k.name + '</span><span class="num">계획 ' + fmt.num1(k.plan) + ' · 실제 ' + (a === null ? '<span class="muted">기록 없음</span>' : fmt.num1(a) + (partial(k.keys) ? '<span class="small muted">(일부 항목만 기록)</span>' : '') + ' (' + ui.delta(a - k.plan, !k.lowerGood) + ')') + '</span></li>';
    }).join('');
    var LABEL = { essential: '필수 지출', optional: '선택 지출', emergency: '비상금', housing: '주거자금', product: '상품 납입', pension: '연금 납입', debt: '부채 상환(원금+이자)', income: '실수령 소득' };
    var detail = ui.fold('항목별 자세히 보기', ui.table(['구분', '항목', '계획', '실제'], [].concat(
      [['소득', LABEL.income, ui.n1(pl.income), has('income') ? ui.n1(Number(rec.income)) : '기록 없음']],
      cats.reduce(function (out, k) {
        return out.concat(k.keys.map(function (key) { return [k.name, LABEL[key], ui.n1(pl[key] || 0), has(key) ? ui.n1(Number(rec[key])) : '기록 없음']; }));
      }, [])
    ), { caption: ui.ymText(month) + ' 항목별 계획과 실제' }));
    return ui.chart({
      type: 'bar',
      title: ui.ymText(month) + ' 월 예산 비교',
      categories: cats.map(function (k) { return k.name; }),
      groups: [
        { label: '계획', color: '--chart-plan', values: cats.map(function (k) { return k.plan; }) },
        { label: '실제(기록)', color: '--chart-actual', hatch: true, values: actual }
      ],
      summary: '<ul class="chart-list">' + lines + '</ul>' + (rec.status ? '<p class="small muted">기록 상태: ' + ui.esc(rec.status) + '</p>' : '')
    }) + detail;
  };

  /**
   * ③ 설계 전후 목표 비교: 같은 목표 시점의 설계 전·후 주거재원 막대 + 숫자 카드(부족·여유, 부채 잔액, 비상금).
   * 계획값 기준(실행 기록 반영 전)으로 두 안을 같은 조건에서 비교한다.
   */
  ui.beforeAfterChart = function (c) {
    var bp = c.d.beforePlan;
    var ap = c.d.plan;
    if (!bp || !ap || bp.id === ap.id) {
      return '<p class="small muted">설계안이 아직 없어 설계 전·후를 비교할 수 없어요. 설계사 화면 → 계획 버전에서 설계안을 만들면 여기에 나타나요.</p>';
    }
    var tm = ap.targetMonth;
    var end = bp.targetMonth > tm ? bp.targetMonth : tm;
    var A = engine.runPlan(c.state, ap.id, { endMonth: end });
    var B = engine.runPlan(c.state, bp.id, { endMonth: end });
    var a = engine.rowAt(A, tm);
    var b = engine.rowAt(B, tm);
    var goal = A.input.goal;
    var need = goal.depositTarget + goal.movingCost;
    var gap = function (r) { return r ? r.usable - need : null; };
    var card = function (lbl, r) {
      var g = gap(r);
      return ui.kpi(lbl + ' 목표 대비', isNum(g) ? '<span class="num ' + (g >= 0 ? 'up' : 'down') + '">' + (g >= 0 ? '여유 ' : '부족 ') + fmt.num1(Math.abs(g)) + '<small>만원</small></span>' : '—');
    };
    return ui.chart({
      type: 'bar',
      title: ui.ymText(tm) + ' 설계 전·후 주거재원',
      categories: ['설계 전', '설계 후'],
      groups: [{ label: '사용 가능 주거자금(' + tm + ' 말)', color: '--chart-plan', values: [b ? b.usable : null, a ? a.usable : null] }],
      target: { value: need, label: '목표 ' + fmt.short(need) },
      summary: '<p>' + ui.esc(ui.ymText(tm)) + ' 말 기준 · 설계 전 ' + moneyText(b && b.usable) + ' → 설계 후 ' + moneyText(a && a.usable) + ' (목표 ' + fmt.num1(need) + '만원)</p>',
      note: '계획값 기준(실행 기록 반영 전). 설계 전 「' + ui.esc(bp.name) + '」, 설계 후 「' + ui.esc(ap.name) + '」.'
    }) +
      '<div class="kpis k4 ba-cards">' + card('설계 전', b) + card('설계 후', a) +
      ui.kpi('부채 잔액(전 → 후)', '<span class="num">' + (b ? fmt.num1(b.debtTotal) : '—') + ' → ' + (a ? fmt.num1(a.debtTotal) : '—') + '<small>만원</small></span>') +
      ui.kpi('비상금(전 → 후)', '<span class="num">' + (b ? fmt.num1(b.emergency) : '—') + ' → ' + (a ? fmt.num1(a.emergency) : '—') + '<small>만원</small></span>', '목표 ' + fmt.short(goal.emergencyTarget) + '만원') +
      '</div>';
  };

  /** 충격 시나리오: 기본안과 선택한 시나리오 하나 */
  ui.scenarioChart = function (r, scnLabel) {
    var tm = r.base.input.targetMonth;
    var goal = r.shocked.input.goal;
    var need = goal.depositTarget + goal.movingCost;
    var start = r.base.rows.length ? r.base.rows[0].month : tm;
    var months = monthSpan(start, tm);
    var bm = rowsByMonth(r.base), sm = rowsByMonth(r.shocked);
    var b = bm[tm], s = sm[tm];
    return ui.chart({
      type: 'line',
      title: '기본안과 ' + scnLabel + ' 비교',
      months: months,
      series: [
        { label: '기본안', color: '--chart-plan', style: 'solid', values: months.map(function (m) { return bm[m] ? bm[m].usable : null; }) },
        { label: scnLabel, color: '--chart-trend', style: 'dashed', values: months.map(function (m) { return sm[m] ? sm[m].usable : null; }) }
      ],
      target: { value: need, label: '목표 ' + fmt.short(need) },
      summary: '<p>' + ui.esc(ui.ymText(tm)) + ' 말 · 기본안 ' + moneyText(b && b.usable) + ' → ' + ui.esc(scnLabel) + ' ' + moneyText(s && s.usable) +
        (b && s ? ' (' + fmt.signed(s.usable - b.usable) + '만원)' : '') + ' · 목표 ' + fmt.num1(need) + '만원</p>'
    });
  };

  ui.actions['chart-toggle'] = function (c, el) {
    var k = el.getAttribute('data-key');
    var patch = {};
    patch[k] = !c.view[k];
    ui.setView(patch, true);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
