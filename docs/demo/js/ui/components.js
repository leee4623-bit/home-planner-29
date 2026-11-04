/*
 * 화면 공통 도우미: 서버 요청, 형식, 카드, 대화상자, 알림, 파일
 */
(function (root) {
  'use strict';
  var doc = root.document;
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // 서버 요청 (쿠키 세션 + CSRF 헤더)
  // headers: 추가 헤더(예: Idempotency-Key — 재시도해도 한 번만 처리)
  function api(method, path, body, headers) {
    var h = { 'Content-Type': 'application/json', 'X-FP-Request': '1' }; if (headers) Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
    return fetch(path, { method: method, credentials: 'same-origin', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || ('요청 실패 (' + r.status + ')')); e.status = r.status; e.code = j.code; e.body = j; throw e; }
          return j;
        });
      }, function () { var e = new Error('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.'); e.status = 0; throw e; });
  }

  var F = {
    man: function (w, d) { var v = (Number(w) || 0) / 10000, k = Math.pow(10, d || 0); var r = Math.round(v * k) / k; if (Object.is(r, -0)) r = 0; return r.toLocaleString('ko-KR', { maximumFractionDigits: d || 0 }); },
    money: function (w) { return F.man(w) + '만원'; },
    abs: function (w) { return F.man(Math.abs(w)) + '만원'; },
    signed: function (w) { var r = Math.round(w / 10000); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toLocaleString('ko-KR') + '만원'; },
    pct: function (v, d) { return v === null || v === undefined ? '—' : (Math.round(v * Math.pow(10, d === undefined ? 1 : d)) / Math.pow(10, d === undefined ? 1 : d)).toLocaleString('ko-KR') + '%'; },
    months: function (v) { return v === null || v === undefined ? '—' : (Math.round(v * 10) / 10).toLocaleString('ko-KR') + '개월'; },
    ym: function (base, t) { return t === null || t === undefined ? '10년 내 어려움' : root.FP.Calc.ymAdd(base, t); },
    ymKo: function (s) { if (!s) return '—'; var p = s.split('-'); return p[0] + '년 ' + Number(p[1]) + '월'; },
    date: function (iso) { if (!iso) return '—'; var d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  };

  function pill(state, text) { var cls = { achieved: 'pill-ok', ok: 'pill-ok', pass: 'pill-ok', partial: 'pill-warn', check: 'pill-warn', short: 'pill-bad', fail: 'pill-bad', bad: 'pill-bad', info: 'pill-info' }[state] || 'pill-info'; var ic = { 'pill-ok': '●', 'pill-warn': '◆', 'pill-bad': '▲', 'pill-info': '○' }[cls]; return '<span class="pill ' + cls + '"><span aria-hidden="true">' + ic + '</span> ' + esc(text) + '</span>'; }
  function statusText(s) { return { achieved: '전체 목표 달성', partial: '부분 충족', short: '미달' }[s] || s; }
  function badge(t, cls) { return '<span class="badge ' + (cls || '') + '">' + esc(t) + '</span>'; }

  var lastFocus = null;
  function dialog(o) {
    var wrap = doc.getElementById('dialog');
    doc.getElementById('dialogTitle').textContent = o.title;
    doc.getElementById('dialogBody').innerHTML = o.body;
    var act = doc.getElementById('dialogActions'); act.innerHTML = '';
    (o.actions || [{ text: '닫기' }]).forEach(function (a) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'btn ' + (a.cls || 'btn-secondary'); b.textContent = a.text;
      b.addEventListener('click', function () { if (!a.keep) close(); if (a.onClick) a.onClick(doc.getElementById('dialogBody')); });
      act.appendChild(b);
    });
    lastFocus = doc.activeElement; wrap.hidden = false;
    var f = act.querySelector('button'); if (f) f.focus();
  }
  function close() { doc.getElementById('dialog').hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !doc.getElementById('dialog').hidden) close(); });

  var tt = null;
  function toast(msg, bad) { var t = doc.getElementById('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' toast-bad' : ''); t.hidden = false; clearTimeout(tt); tt = setTimeout(function () { t.hidden = true; }, 3200); }

  function download(name, text, mime) {
    if (root.FP_PREVIEW) return false; // 미리보기 화면은 파일 내려받기가 막혀 있음
    try { var b = new Blob([text], { type: mime }); var u = URL.createObjectURL(b); var a = doc.createElement('a'); a.href = u; a.download = name; doc.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1500); return true; } catch (e) { return false; }
  }

  // 지표 카드: 설계 전/후 나란히 + 기준일·단위·정의
  function metricCard(o) {
    return '<article class="card metric">' +
      '<div class="metric-head"><h3>' + esc(o.label) + '</h3>' + (o.std ? '<span class="std">' + esc(o.std) + '</span>' : '') + '</div>' +
      '<div class="metric-pair">' +
      '<div class="metric-col"><span class="plan-tag before">설계 전</span><span class="metric-value ' + (o.bCls || '') + '">' + o.b + '</span>' + (o.bSub ? '<span class="metric-sub">' + o.bSub + '</span>' : '') + '</div>' +
      '<div class="metric-col"><span class="plan-tag after">설계 후</span><span class="metric-value ' + (o.aCls || '') + '">' + o.a + '</span>' + (o.aSub ? '<span class="metric-sub">' + o.aSub + '</span>' : '') + '</div>' +
      '</div>' +
      (o.why ? '<p class="metric-why">' + o.why + '</p>' : '') +
      '<details class="metric-def"><summary>기준일·단위·정의</summary><p>' + o.def + '</p></details>' +
      '</article>';
  }

  root.FP = root.FP || {};
  root.FP.UI = { esc: esc, api: api, F: F, pill: pill, statusText: statusText, badge: badge, dialog: dialog, closeDialog: close, toast: toast, download: download, metricCard: metricCard };
})(this);
