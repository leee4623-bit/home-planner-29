/*
 * 실시간 동기화(화면 쪽)
 * ------------------------------------------------------------
 * - 서버판: GET /api/events (SSE). 서버가 DB 저장을 마친 변경만 보내므로, 받은 변경 = 저장 성공이 확인된 값입니다.
 * - 연결이 끊기면 브라우저가 3초 뒤 자동으로 다시 연결하고(Last-Event-ID), 놓친 변경을 서버가 다시 보냅니다.
 *   세 번 연속 실패하면 15초마다 /api/sync?since=로 조회(주기 조회)하고, 30초마다 실시간 연결을 다시 시도합니다.
 * - 시연판(GitHub Pages): 서버가 없어 기기 간 동기화가 없습니다. 상태 표시도 그렇게 보여 줍니다.
 */
(function (root) {
  'use strict';
  var FP = root.FP, U = FP.UI, doc = root.document;
  var st = { mode: 'idle', lastId: 0, lastSyncAt: null, lastSaveAt: null, saving: 0, failed: null, es: null, errors: 0, pollTimer: null, retryTimer: null, reloadTimer: null };
  var handlers = [];

  function hhmmss(d) { if (!d) return '—'; d = new Date(d); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0'); }
  var LABEL = {
    idle: ['info', '연결 전'], connecting: ['info', '실시간 연결 중…'], live: ['ok', '실시간 연결됨'], reconnecting: ['check', '연결 끊김 · 다시 연결 중'],
    polling: ['check', '실시간 연결 실패 · 15초마다 확인 중'], offline: ['bad', '오프라인 · 저장할 수 없음'], static: ['info', '시연판 · 이 기기에만 저장(기기 간 동기화 없음)']
  };
  function paint() {
    var el = doc.getElementById('syncBar'); if (!el) return;
    var l = LABEL[st.mode] || LABEL.idle;
    var save = st.saving ? U.pill('info', '저장 중…') : st.failed ? U.pill('bad', '저장 실패') : st.lastSaveAt ? U.pill('ok', '저장 완료') : '';
    el.innerHTML = '<span class="sync-state" data-mode="' + st.mode + '">' + U.pill(l[0], l[1]) + '</span>' + (save ? ' ' + save : '') +
      '<span class="sync-times">마지막 저장 ' + hhmmss(st.lastSaveAt) + ' · 마지막 동기화 ' + hhmmss(st.lastSyncAt) + '</span>' +
      (st.failed ? '<span class="sync-err">' + U.esc(st.failed) + '</span>' : '');
    el.hidden = false;
  }
  function set(mode) { st.mode = mode; paint(); }

  function start(lastId) {
    stop();
    if (root.FP_STATIC || root.FP_PREVIEW) { set('static'); return; }
    if (lastId) st.lastId = Math.max(st.lastId, lastId);
    if (!navigator.onLine) { set('offline'); return; }
    if (!('EventSource' in root)) return poll();
    set(st.errors ? 'reconnecting' : 'connecting');
    var es = new EventSource('/api/events?since=' + st.lastId, { withCredentials: true });
    st.es = es;
    es.addEventListener('ready', function (e) {
      var d = JSON.parse(e.data); st.errors = 0; st.lastSyncAt = new Date(); set('live');
      if (st.pollTimer) { clearInterval(st.pollTimer); st.pollTimer = null; }
      if (d.replayed) scheduleReload();
      st.lastId = Math.max(st.lastId, d.latest || 0);
    });
    es.addEventListener('change', function (e) { var ev = JSON.parse(e.data); st.lastSyncAt = new Date(); paint(); handle(ev); });
    es.addEventListener('revoked', function (e) { var d = JSON.parse(e.data); emit({ type: 'revoked', data: d }); });
    es.addEventListener('assigned', function (e) { emit({ type: 'assigned', data: JSON.parse(e.data) }); });
    es.onerror = function () {
      st.errors++;
      if (!navigator.onLine) { es.close(); set('offline'); return; }
      if (st.errors >= 3) { es.close(); st.es = null; poll(); return; }
      set('reconnecting');
    };
  }
  function stop() { if (st.es) { st.es.close(); st.es = null; } if (st.pollTimer) { clearInterval(st.pollTimer); st.pollTimer = null; } if (st.retryTimer) { clearTimeout(st.retryTimer); st.retryTimer = null; } }

  // 주기 조회(실시간 연결 실패 시) — 같은 변경 이력을 번호로 조회
  function poll() {
    set('polling');
    var tick = function () {
      U.api('GET', '/api/sync?since=' + st.lastId).then(function (r) {
        st.lastSyncAt = new Date(); paint();
        r.changes.forEach(handle); st.lastId = Math.max(st.lastId, r.latest || 0);
      }, function (e) { if (e.status === 401) { stop(); emit({ type: 'revoked', data: { all: true } }); } else set(navigator.onLine ? 'polling' : 'offline'); });
    };
    tick();
    st.pollTimer = setInterval(tick, 15000);
    st.retryTimer = setTimeout(function () { st.errors = 1; start(); }, 30000); // 실시간 연결 다시 시도
  }

  function handle(ev) {
    if (ev.id && ev.id <= st.lastId && st.mode === 'live') { /* 재전송 */ }
    st.lastId = Math.max(st.lastId, ev.id || 0);
    emit({ type: 'change', data: ev });
  }
  function emit(m) { handlers.forEach(function (h) { try { h(m); } catch (e) { console.error(e); } }); }
  function scheduleReload() { clearTimeout(st.reloadTimer); st.reloadTimer = setTimeout(function () { if (FP.reload) FP.reload(); }, 250); }

  root.addEventListener('online', function () { if (st.mode !== 'static' && st.mode !== 'idle') { st.errors = 1; start(); scheduleReload(); } });
  root.addEventListener('offline', function () { if (st.mode !== 'static' && st.mode !== 'idle') { stop(); set('offline'); } });
  doc.addEventListener('visibilitychange', function () {
    // 휴대폰에서 앱을 다시 열면 연결이 잠들어 있을 수 있음 → 다시 연결하고 놓친 변경 조회
    if (doc.visibilityState === 'visible' && st.mode !== 'static' && st.mode !== 'idle' && (!st.es || st.es.readyState === 2)) { st.errors = 1; start(); }
  });

  // 저장 상태(서버 응답을 받은 뒤에만 '저장 완료')
  function saving(on) { st.saving += on ? 1 : -1; if (st.saving < 0) st.saving = 0; if (on) st.failed = null; paint(); }
  function saved() { st.lastSaveAt = new Date(); st.failed = null; paint(); }
  function failed(msg) { st.failed = msg; paint(); }

  FP.Sync = { start: start, stop: stop, on: function (h) { handlers.push(h); }, saving: saving, saved: saved, failed: failed, state: st, time: hhmmss, reloadSoon: scheduleReload, paint: paint };
})(this);
