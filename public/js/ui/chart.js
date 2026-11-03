/*
 * 그래프 (SVG, 외부 라이브러리 없음)
 * Chart.line(box, {
 *   labels: ['2026-08', ...],                     // x축 연월
 *   series: [{ name, color, values:[원|null], dash:bool, points:bool, width }],
 *   target: { value, label } | null,
 *   events: [{ index, label, color }],             // 세로 표시(상환 완료·만기·보증금·이사 등)
 *   ariaLabel
 * })
 * null 값은 선을 끊습니다(기록 없는 달을 0으로 그리지 않음).
 */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function el(n, a, p) { var e = root.document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
  function step(range, n) { var raw = range / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), x = raw / mag; return (x <= 1 ? 1 : x <= 2 ? 2 : x <= 2.5 ? 2.5 : x <= 5 ? 5 : 10) * mag; }
  function fmt(won) { var m = won / 10000; return Math.abs(m) >= 10000 ? (Math.round(m / 1000) / 10).toLocaleString('ko-KR') + '억' : Math.round(m).toLocaleString('ko-KR'); }

  function line(box, o) {
    box.innerHTML = ''; box.classList.add('chart');
    var W = Math.max(300, box.clientWidth || 640), H = W < 520 ? 250 : 310;
    var n = o.labels.length, maxX = Math.max(1, n - 1);
    // 이벤트 이름이 겹치지 않도록 줄(lane) 배정
    var evs = (o.events || []).filter(function (ev) { return ev.index >= 0 && ev.index <= maxX; }).sort(function (a, b) { return a.index - b.index; });
    var plotW0 = W - 66, lanesEnd = [];
    evs.forEach(function (ev) {
      var px = 52 + ev.index / maxX * plotW0, lw = ev.label.length * 10.5 + 8, lane = 0;
      while (lanesEnd[lane] !== undefined && lanesEnd[lane] > px) lane++;
      ev._lane = lane; lanesEnd[lane] = px + lw;
    });
    var pad = { l: 52, r: 14, t: 22 + lanesEnd.length * 13, b: 34 };
    var vals = [0]; o.series.forEach(function (s) { s.values.forEach(function (v) { if (v !== null && v !== undefined) vals.push(v); }); });
    if (o.target) vals.push(o.target.value);
    var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals); if (hi === lo) hi = lo + 1e7;
    var st = step(hi - lo, 4); hi = Math.ceil(hi / st) * st; lo = Math.floor(lo / st) * st;
    var w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    var x = function (i) { return pad.l + i / maxX * w; }, y = function (v) { return pad.t + (1 - (v - lo) / (hi - lo)) * h; };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': o.ariaLabel || '그래프' }, box);
    for (var v = lo; v <= hi + 1; v += st) {
      el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: v === 0 ? 'grid zero' : 'grid' }, svg);
      el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, svg).textContent = fmt(v);
    }
    el('text', { x: 4, y: 12, class: 'axis' }, svg).textContent = '만원';
    var xs = maxX > 60 ? 24 : maxX > 24 ? 12 : 6;
    for (var i = 0; i <= maxX; i += xs) el('text', { x: x(i), y: H - 12, 'text-anchor': i === 0 ? 'start' : 'middle', class: 'axis' }, svg).textContent = o.labels[i];
    // 이벤트 표시
    evs.forEach(function (ev) {
      el('line', { x1: x(ev.index), x2: x(ev.index), y1: pad.t - 4, y2: pad.t + h, class: 'event-line', style: 'stroke:' + (ev.color || 'var(--muted)') }, svg);
      var ly = 14 + ev._lane * 13, right = x(ev.index) + ev.label.length * 10.5 > W - 4;
      el('text', { x: right ? x(ev.index) - 3 : x(ev.index) + 3, y: ly + 10, 'text-anchor': right ? 'end' : 'start', class: 'event-label', style: 'fill:' + (ev.color || 'var(--muted)') }, svg).textContent = ev.label;
    });
    if (o.target) {
      el('line', { x1: pad.l, x2: W - pad.r, y1: y(o.target.value), y2: y(o.target.value), class: 'target-line' }, svg);
      el('text', { x: pad.l + 6, y: y(o.target.value) - 6, class: 'target-label' }, svg).textContent = o.target.label + ' ' + fmt(o.target.value) + '만원';
    }
    o.series.forEach(function (s) {
      var d = '', pen = false;
      s.values.forEach(function (val, i) {
        if (val === null || val === undefined) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1) + ' '; pen = true;
      });
      if (d) el('path', { d: d, fill: 'none', style: 'stroke:' + s.color, 'stroke-width': s.width || 2.2, 'stroke-dasharray': s.dash ? '6 4' : 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      if (s.points) s.values.forEach(function (val, i) { if (val !== null && val !== undefined) el('circle', { cx: x(i), cy: y(val), r: 3.6, style: 'fill:' + s.color, class: 'endpoint' }, svg); });
    });
    // 툴팁
    var guide = el('line', { x1: 0, x2: 0, y1: pad.t, y2: pad.t + h, class: 'guide', visibility: 'hidden' }, svg);
    var tip = root.document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; box.appendChild(tip);
    var hit = el('rect', { x: pad.l, y: pad.t, width: w, height: h, fill: 'transparent', tabindex: 0 }, svg);
    var cur = 0;
    function show(i) {
      i = Math.max(0, Math.min(maxX, i)); cur = i;
      guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('visibility', 'visible');
      var html = '<strong>' + o.labels[i] + '</strong>';
      o.series.forEach(function (s) { var val = s.values[i]; html += '<span><i style="background:' + s.color + '"></i>' + s.name + ' ' + (val === null || val === undefined ? '기록 없음' : Math.round(val / 10000).toLocaleString('ko-KR') + '만원') + '</span>'; });
      evs.forEach(function (ev) { if (ev.index === i) html += '<span>◆ ' + ev.label + '</span>'; });
      tip.innerHTML = html; tip.hidden = false;
      var left = x(i) / W * box.clientWidth; tip.style.left = Math.min(Math.max(0, left - tip.offsetWidth / 2), box.clientWidth - tip.offsetWidth) + 'px';
    }
    function at(e) { var r = svg.getBoundingClientRect(); return Math.round(((e.clientX - r.left) / r.width * W - pad.l) / w * maxX); }
    hit.addEventListener('pointermove', function (e) { show(at(e)); });
    hit.addEventListener('pointerdown', function (e) { show(at(e)); });
    hit.addEventListener('pointerleave', function () { guide.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    hit.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { show(cur + 1); e.preventDefault(); } if (e.key === 'ArrowLeft') { show(cur - 1); e.preventDefault(); } });
    hit.addEventListener('focus', function () { show(cur); });
    hit.addEventListener('blur', function () { guide.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  root.FP = root.FP || {}; root.FP.Chart = { line: line };
})(this);
