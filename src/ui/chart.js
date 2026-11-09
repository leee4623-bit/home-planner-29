/*
 * 자금 경로 차트(명세 6-5). 직접 그린 SVG.
 * - 예상(미래)은 점선, 고객이 확인한 기록이 있는 달은 실선과 점.
 * - 값이 null인 달은 선을 끊는다(0으로 그리지 않음).
 * - 목표금액은 수평선, 사건(부채 상환 완료 등)은 세로선 + 번호.
 */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var dates = P.dates;
  var fmt = P.format;

  function niceStep(max) {
    var raw = max / 4;
    var pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    var n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  }

  var CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

  /**
   * @param {object} o
   *   series: [{ key, label, color(CSS 변수명), dashed, dots, points:[{month, value|null}] }]
   *   target: { value, label }
   *   events: [{ month, label }]
   *   width, height: viewBox 크기(기본 340×220)
   *   title: 스크린리더용 제목
   */
  function fundChart(o) {
    var W = o.width || 340;
    var H = o.height || 220;
    var padL = 44, padR = 10, padT = 22, padB = 26;
    var months = [];
    o.series.forEach(function (s) { s.points.forEach(function (p) { months.push(dates.parseYM(p.month)); }); });
    (o.events || []).forEach(function (e) { months.push(dates.parseYM(e.month)); });
    months = months.filter(Number.isFinite);
    if (!months.length) return ui.empty('그릴 자료가 없습니다.');
    var t0 = Math.min.apply(null, months);
    var t1 = Math.max.apply(null, months);
    var maxV = o.target ? o.target.value : 0;
    o.series.forEach(function (s) { s.points.forEach(function (p) { if (typeof p.value === 'number') maxV = Math.max(maxV, p.value); }); });
    var step = niceStep(maxV * 1.05 || 1);
    var top = Math.ceil((maxV * 1.05) / step) * step || step;
    var x = function (t) { return padL + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - padL - padR); };
    var y = function (v) { return padT + (1 - v / top) * (H - padT - padB); };

    var svg = [];
    svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="chart-t chart-d">');
    svg.push('<title id="chart-t">' + ui.esc(o.title || '자금 경로') + '</title>');
    svg.push('<desc id="chart-d">' + ui.esc(describe(o)) + '</desc>');

    // 격자·눈금
    for (var v = 0; v <= top + 1e-9; v += step) {
      svg.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--border)" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 4) + '" y="' + (y(v) + 3.5) + '" text-anchor="end" font-size="9.5" fill="var(--muted)">' + fmt.short(v) + '</text>');
    }
    svg.push('<text x="4" y="12" font-size="9" fill="var(--muted)">만원</text>');
    // 연도 눈금
    for (var t = t0; t <= t1; t++) {
      if (t === t0 || (t % 12 === 0 && t - t0 >= 6)) { // 시작 라벨과 겹치지 않게
        svg.push('<text x="' + x(t) + '" y="' + (H - 8) + '" text-anchor="' + (t === t0 ? 'start' : 'middle') + '" font-size="9.5" fill="var(--muted)">' +
          (t === t0 ? dates.formatYM(t).replace('-', '.') : String(Math.floor(t / 12))) + '</text>');
      }
    }

    // 사건 세로선
    // 사건 세로선(번호가 가까우면 옆으로 비켜 쓴다)
    var lastLabelX = -Infinity;
    (o.events || []).forEach(function (e, i) {
      var ex = x(dates.parseYM(e.month));
      svg.push('<line x1="' + ex + '" x2="' + ex + '" y1="' + padT + '" y2="' + (H - padB) + '" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 3"/>');
      var lx = Math.max(ex, lastLabelX + 11); // 사건 순서대로 정렬돼 있다고 가정
      lastLabelX = lx;
      svg.push('<text x="' + lx + '" y="' + (padT - 7) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + (CIRCLED[i] || i + 1) + '</text>');
    });

    // 목표 수평선
    if (o.target) {
      var ty = y(o.target.value);
      svg.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ty + '" y2="' + ty + '" stroke="var(--chart-target)" stroke-width="1.5" stroke-dasharray="6 3"/>');
      svg.push('<text x="' + (padL + 3) + '" y="' + (ty - 4) + '" font-size="9.5" fill="var(--chart-target)" font-weight="700">' + ui.esc(o.target.label) + '</text>');
    }

    // 선
    o.series.forEach(function (s) {
      var d = '';
      var pen = false;
      s.points.forEach(function (p) {
        var t = dates.parseYM(p.month);
        if (typeof p.value !== 'number' || !Number.isFinite(t)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(t).toFixed(1) + ' ' + y(p.value).toFixed(1) + ' ';
        pen = true;
      });
      if (d) {
        svg.push('<path d="' + d + '" fill="none" stroke="var(' + s.color + ')" stroke-width="' + (s.dots ? 2.5 : 2) + '"' +
          (s.dashed ? ' stroke-dasharray="5 4"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>');
      }
      if (s.dots) {
        s.points.forEach(function (p) {
          if (typeof p.value !== 'number') return;
          svg.push('<circle cx="' + x(dates.parseYM(p.month)).toFixed(1) + '" cy="' + y(p.value).toFixed(1) + '" r="3.2" fill="var(' + s.color + ')"><title>' +
            ui.esc(p.month + ' ' + s.label + ' ' + fmt.num1(p.value) + '만원') + '</title></circle>');
        });
      }
    });
    svg.push('</svg>');

    var legend = '<div class="legend">' + o.series.map(function (s) {
      return '<span style="color:var(' + s.color + ')"><i class="' + (s.dashed ? 'dash' : '') + '"></i><span style="color:var(--muted)">' + ui.esc(s.label) + '</span></span>';
    }).join('') + (o.target ? '<span style="color:var(--chart-target)"><i class="dash"></i><span style="color:var(--muted)">' + ui.esc(o.target.label) + '</span></span>' : '') + '</div>';
    var events = (o.events || []).length
      ? '<ul class="events">' + o.events.map(function (e, i) { return '<li>' + (CIRCLED[i] || i + 1) + ' ' + ui.esc(e.month) + ' ' + ui.esc(e.label) + '</li>'; }).join('') + '</ul>'
      : '';
    return '<div class="chart">' + svg.join('') + legend + events + '</div>';
  }

  /** 스크린리더용 한 줄 요약 */
  function describe(o) {
    var parts = o.series.map(function (s) {
      var last = null;
      s.points.forEach(function (p) { if (typeof p.value === 'number') last = p; });
      return last ? s.label + ' ' + last.month + ' ' + fmt.num1(last.value) + '만원' : null;
    }).filter(Boolean);
    if (o.target) parts.push(o.target.label + ' ' + fmt.num1(o.target.value) + '만원');
    return parts.join(', ');
  }

  ui.fundChart = fundChart;
})(typeof globalThis !== 'undefined' ? globalThis : this);
