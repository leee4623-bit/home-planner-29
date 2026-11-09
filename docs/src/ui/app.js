/*
 * 앱 셸: 상태 불러오기, 파생값 계산, 화면 그리기, 이벤트 위임.
 * 화면 모듈은 ui.screens[이름](ctx) → HTML, ui.actions[이름](ctx, el, ev)로 등록한다.
 */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var dates = P.dates;

  var VIEW_KEY = 'jaemu-planner-view';
  var app = (ui.app = {
    store: null,
    state: null,
    d: null,
    view: { role: 'customer', tab: 'home', more: null, recordMonth: null, confirm: null, tx: null, plannerPage: 'overview' }
  });

  /* ---------- 화면 위치 기억(개인 편의, 실패해도 무관) ---------- */
  function loadView() {
    try {
      var v = JSON.parse(root.localStorage.getItem(VIEW_KEY) || 'null');
      if (v && (v.role === 'customer' || v.role === 'planner')) app.view.role = v.role;
      if (v && typeof v.tab === 'string') app.view.tab = v.tab;
      if (v && typeof v.plannerPage === 'string') app.view.plannerPage = v.plannerPage;
    } catch (e) { /* 무시 */ }
  }
  function saveView() {
    try {
      root.localStorage.setItem(VIEW_KEY, JSON.stringify({ role: app.view.role, tab: app.view.tab, plannerPage: app.view.plannerPage }));
    } catch (e) { /* 무시 */ }
  }

  function findPlan(s, id) {
    return (s.plans || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  /* ---------- 파생값(상태가 바뀔 때마다 한 번 계산) ---------- */
  function derive(s) {
    var pid = s.activePlanId;
    var plan = findPlan(s, pid);
    var paths = P.tracking.paths(s);
    var current = paths.withRecords; // 기록 반영 후 계획대로
    var today = P.tracking.today(s);
    var month = today.slice(0, 7);
    var next = dates.addMonths(month, 1);
    var beforePlan = (s.plans || []).filter(function (p) { return p.kind === '설계 전'; }).slice(-1)[0] || null;
    var before = beforePlan ? P.engine.runPlan(s, beforePlan.id) : null;
    var recOpts = P.tracking.recordEngineOpts(s, pid, 'plan');
    var solve = null;
    try {
      solve = P.solver.solveLivingCut(s, pid, { fromMonth: next, engineOpts: recOpts });
    } catch (e) { solve = null; }
    var proposals = s.proposals || [];
    return {
      pid: pid,
      plan: plan,
      paths: paths,
      current: current,
      today: today,
      month: month,
      next: next,
      before: before,
      beforePlan: beforePlan,
      recOpts: recOpts,
      solve: solve,
      thisMonth: P.tracking.monthStatus(s, month),
      pending: proposals.filter(function (p) { return p.status === '확인 대기' || p.status === '고객에게 제시됨'; }),
      newAlerts: (s.alerts || []).filter(function (a) { return a.status === P.alerts.ALERT_STATUS.NEW; }).length,
      issues: P.validate.validateState(s)
    };
  }

  function ctx() {
    if (!app.d) app.d = derive(app.state);
    return { state: app.state, d: app.d, view: app.view, P: P, ui: ui, fmt: P.format, dates: dates };
  }

  /* ---------- 알림(방해금지 시간이면 토스트를 띄우지 않음) ---------- */
  function inQuietHours(s) {
    var q = s.settings && s.settings.notify && s.settings.notify.quiet;
    if (!q || !q.enabled || !q.start || !q.end) return false;
    var now = new Date();
    var cur = now.getHours() * 60 + now.getMinutes();
    var toMin = function (t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); };
    var a = toMin(q.start);
    var b = toMin(q.end);
    return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
  }

  function notifyAllowed(s, type) {
    var n = (s.settings && s.settings.notify && s.settings.notify.types) || {};
    return n[type] !== false;
  }

  var toastTimer = null;
  ui.toast = function (msg) {
    if (!msg) return;
    var box = document.getElementById('toast');
    if (!box) return;
    box.innerHTML = '<div class="toast" role="status">' + ui.esc(msg) + '</div>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.innerHTML = ''; }, 3200);
  };

  /**
   * 상태 변경 확정: 경보 동기화 → (동의 시) 자동 적용 → 저장 → 다시 그리기.
   */
  ui.commit = function (newState, msg) {
    var r = P.alerts.syncAlerts(newState);
    var s = r.state;
    var auto = P.alerts.autoApplyPending(s);
    s = auto.state;
    if (auto.applied.length) {
      s = P.alerts.syncAlerts(s).state;
      msg = (msg ? msg + ' ' : '') + '동의한 범위의 생활비 조정 ' + auto.applied.length + '건을 자동 적용했어요.';
    }
    app.state = s;
    var saved = app.store.save(s);
    app.d = null;
    app.view.confirm = null;
    render();
    var fresh = r.created.filter(function (id) {
      var a = s.alerts.filter(function (x) { return x.id === id; })[0];
      return a && notifyAllowed(s, a.type);
    });
    if (fresh.length && !inQuietHours(s)) msg = (msg ? msg + ' ' : '') + '새 알림 ' + fresh.length + '건이 있어요.';
    if (saved.mode === 'memory') msg = (msg ? msg + ' ' : '') + '(이 브라우저에는 저장되지 않아요. 더보기에서 내보내기로 보관하세요.)';
    ui.toast(msg);
  };

  ui.setView = function (patch, keepScroll) {
    Object.assign(app.view, patch);
    saveView();
    render();
    if (!keepScroll) root.scrollTo(0, 0);
  };

  /* ---------- 공통 화면 조각 ---------- */
  function header(c) {
    var s = c.state;
    var j = c.d.current.judgement;
    var role = c.view.role;
    return '<header class="topbar"><div class="topbar-inner">' +
      '<div class="brand">재무플래너</div>' +
      '<div class="seg" role="group" aria-label="화면 전환">' +
      '<button data-action="role" data-role="planner" aria-pressed="' + (role === 'planner') + '">설계사 화면</button>' +
      '<button data-action="role" data-role="customer" aria-pressed="' + (role === 'customer') + '">고객 화면</button></div>' +
      '<div class="context-line"><span>고객 <strong>' + ui.esc(s.customer.name || '이름 없음') + '</strong></span>' +
      '<span>실행 기준 <strong>' + ui.esc(c.d.plan ? c.d.plan.name : '없음') + '</strong></span>' +
      '<span>' + ui.judgementBadge(j) + '</span></div>' +
      '</div><div class="demo-note">시연 모드 · 가상 고객 데이터입니다. 실제 금융정보를 입력하지 마세요.</div></header>';
  }

  function footer(c) {
    var memory = app.store && app.store.mode === 'memory';
    return '<footer class="footer">' +
      (memory ? '<p class="notice warn" role="status"><span aria-hidden="true">!</span>이 브라우저에는 저장할 수 없어 창을 닫으면 입력이 사라집니다. 더보기 → 데이터 내보내기로 보관하세요.</p>' : '') +
      '<details><summary>모든 문장은 계산 결과로 만들며 외부 AI를 쓰지 않습니다 · 자세히</summary>' +
      '<p>모든 문장은 계산 결과로 만들며 외부 AI를 쓰지 않습니다. 금융상품 권유나 투자 조언이 아니며, 정책 조건은 확인일 기준이므로 가입·신청 전에 공식 기관에서 다시 확인하세요.</p></details>' +
      '<p>기준일 ' + ui.esc(c.d.today) + ' · 단위 만원</p></footer>';
  }

  var TABS = [
    { key: 'home', label: '홈', ico: '⌂' },
    { key: 'record', label: '이번 달 기록', ico: '✎' },
    { key: 'plan', label: '내 계획', ico: '◔' },
    { key: 'alerts', label: '알림', ico: '◉' },
    { key: 'more', label: '더보기', ico: '⋯' }
  ];

  function customerView(c) {
    var tab = ui.screens[c.view.tab] ? c.view.tab : 'home';
    var body = ui.screens[tab](c);
    var bar = '<nav class="tabbar" aria-label="고객 화면 메뉴"><div class="tabbar-inner">' + TABS.map(function (t) {
      var dot = t.key === 'alerts' && c.d.newAlerts ? '<span class="dot" aria-label="새 알림 ' + c.d.newAlerts + '건">' + c.d.newAlerts + '</span>' : '';
      return '<button data-action="tab" data-tab="' + t.key + '"' + (tab === t.key ? ' aria-current="page"' : '') + '>' +
        '<span class="ico" aria-hidden="true">' + t.ico + '</span>' + t.label + dot + '</button>';
    }).join('') + '</div></nav>';
    return '<main class="customer-main" id="main">' + body + '</main>' + bar;
  }

  function plannerView(c) {
    if (ui.screens.planner) return ui.screens.planner(c);
    return '<main class="planner-main"><div class="card"><h2>설계사 화면</h2><p class="muted">설계사 화면은 준비 중입니다. 고객 화면에서 시연을 확인해 주세요.</p></div></main>';
  }

  function staleNotice() {
    if (!app.staleDemo) return '';
    return '<div class="stale-note" role="status"><span>시연 데이터가 새 버전으로 바뀌었어요. 지금 보이는 값은 예전 시연 데이터를 바탕으로 한 저장본이에요.</span>' +
      '<button class="btn btn-sm" data-action="reset-demo-confirm">새 시연 데이터로 초기화</button></div>';
  }

  function render() {
    var el = document.getElementById('app');
    if (!el) return;
    var c;
    try {
      c = ctx();
      el.className = (c.view.role === 'customer' ? 'customer-view' : 'planner-view') + (c.view.tour !== null && c.view.tour !== undefined ? ' tour-on' : '');
      el.innerHTML = header(c) + staleNotice() + (c.view.role === 'customer' ? customerView(c) : plannerView(c)) + footer(c) + (ui.tourPanel ? ui.tourPanel(c) : '');
    } catch (e) {
      if (root.console) root.console.error(e);
      el.className = '';
      el.innerHTML = '<main class="customer-main">' + ui.errorBox('화면을 그리는 중 문제가 생겼어요. 다시 시도하거나 시연 데이터로 초기화해 주세요.') + '</main>';
    }
  }
  ui.render = render;

  /* ---------- 공통 동작 ---------- */
  Object.assign(ui.actions, {
    role: function (c, el) { ui.setView({ role: el.getAttribute('data-role') }); },
    tab: function (c, el) { ui.setView({ tab: el.getAttribute('data-tab'), more: null, confirm: null }); },
    retry: function () { app.d = null; render(); },
    'reset-demo-confirm': function () { ui.setView({ confirm: 'reset-demo', role: 'customer', tab: 'more', more: 'data' }); },
    'reset-demo': function () {
      var s = app.store.reset();
      app.staleDemo = false;
      app.view.tx = null;
      ui.commit(s, '시연 데이터로 되돌렸어요.');
    },
    'cancel-confirm': function () { ui.setView({ confirm: null }, true); }
  });

  function safe(fn) {
    try {
      fn();
    } catch (e) {
      if (root.console) root.console.error(e);
      // 상태 함수가 던지는 오류는 사람이 읽는 문장이다
      ui.toast(e && e.message && /[가-힣]/.test(e.message) ? e.message : '처리하지 못했어요. 다시 시도해 주세요.');
    }
  }

  function bindEvents() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (!el) return;
      var fn = ui.actions[el.getAttribute('data-action')];
      if (!fn) return;
      e.preventDefault();
      safe(function () { fn(ctx(), el, e); });
    });
    document.addEventListener('submit', function (e) {
      var f = e.target.closest('form[data-submit]');
      if (!f) return;
      e.preventDefault();
      var fn = ui.actions[f.getAttribute('data-submit')];
      if (fn) safe(function () { fn(ctx(), f, new FormData(f)); });
    });
    document.addEventListener('change', function (e) {
      var el = e.target.closest('[data-change]');
      if (!el) return;
      var fn = ui.actions[el.getAttribute('data-change')];
      if (fn) safe(function () { fn(ctx(), el, e); });
    });
  }

  function boot() {
    app.store = P.store.createStore();
    var loaded = app.store.load();
    var s = loaded.state;
    s = P.alerts.syncAlerts(s).state;
    app.state = s;
    app.store.save(s);
    app.firstVisit = loaded.firstVisit;
    app.staleDemo = !!loaded.staleDemo;
    loadView();
    bindEvents();
    render();
    if (app.store.mode === 'memory') ui.toast('이 브라우저에는 저장할 수 없어 이번 창에서만 유지돼요.');
    // 서비스 워커는 https에서만(파일로 열면 등록하지 않음)
    if (root.location && root.location.protocol === 'https:' && root.navigator && root.navigator.serviceWorker) {
      try { root.navigator.serviceWorker.register('sw.js'); } catch (e) { /* 무시 */ }
    }
  }

  ui.boot = boot;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
