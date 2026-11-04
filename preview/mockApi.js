/*
 * 시연판(GitHub Pages·미리보기) 전용 '브라우저 안 시연 서버'
 * ------------------------------------------------------------
 * 서버가 없는 정적 호스팅에서도 앱 흐름을 보여 주기 위해 server/api.js·api2.js·jobs.js의 규칙
 * (역할별 권한, 계획 버전 추가만, 같은 달 기록 대체, 거래 확인 후 실적, 위험성향 재채점, A/B/C 제시·선택,
 *  월 확정, 수정안·자동 적용 동의, 알림 중복 방지)을 이 브라우저 안에서 흉내 냅니다.
 * - 데이터는 이 기기 브라우저(localStorage)에만 저장됩니다. 실제 보안은 서버판이 담당합니다.
 * - 서버가 없으므로 Web Push와 앱을 닫은 상태의 정기 점검은 없습니다. 알림은 앱을 열 때 점검해 알림함에 표시합니다.
 */
(function (root) {
  'use strict';
  var FP = root.FP, C = FP.Calc, A = FP.Analysis, L = FP.Linking, Rk = FP.Risk, St = FP.Strategies, M = FP.Monthly;
  var KEY = 'fp3-demo-db', PW = '1234', CD = FP.ClientData;
  var CATS = /^(debt|emergency|housing|expense|expense:essential|expense:optional|income|product:[A-Za-z0-9_-]{1,20})$/;
  var TYPES = ['안정형', '안정추구형', '위험중립형', '적극투자형', '공격투자형'];
  var DEF_NOTIF = { types: { overspend: true, savingShort: true, emergencyLow: true, goalFlip: true, goalShort: true, surplus: true, revision: true }, quietStart: '22:00', quietEnd: '08:00', push: false, lockDetails: false };
  var DEF_CONSENT = { enabled: false, monthlyLimit: 100000, floor: 0, agreedAt: null };
  function now() { return new Date().toISOString(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fail(status, msg, code) { var e = new Error(msg); e.status = status; e.code = code; throw e; }
  function need(c, s, m) { if (!c) fail(s, m); }

  function seed() {
    var S = FP.Sample, t = now();
    var rec = function (id, month, category, amount, note) { return { id: id, clientId: 1, month: month, category: category, amount: amount, source: 'manual', note: note || '', voidedAt: null, createdAt: t, createdBy: 3 }; };
    return { seq: 100, session: null,
      users: [
        { id: 1, email: 'planner@demo.kr', name: '박설계(시연)', role: 'planner' },
        { id: 3, email: 'client@demo.kr', name: '김하늘(가상)', role: 'client', clientId: 1 },
        { id: 4, email: 'other@demo.kr', name: '이다른(가상)', role: 'client', clientId: 2 }],
      clients: [{ id: 1, profile: clone(S.PROFILE) }, { id: 2, profile: Object.assign(clone(S.PROFILE), { name: '이다른(가상)', annualGross: 33000000 }) }],
      assignments: [[1, 1]],
      plans: [
        { id: 1, clientId: 1, kind: 'before', version: 1, label: '설계 전 진단', note: '현재 소비·상환 습관을 유지하는 경우', data: clone(S.BEFORE), createdBy: 1, createdAt: '2026-08-20T10:00:00.000Z' },
        { id: 2, clientId: 1, kind: 'after', version: 1, label: '설계 후 1차 수정안', note: '선택지출 22만원·필수 5만원 절감, 월 15만원 추가 상환, 청년미래적금(일반형) 월 30만원, 이사월 2029-12', data: clone(S.AFTER), createdBy: 1, createdAt: '2026-08-27T10:00:00.000Z' },
        { id: 3, clientId: 2, kind: 'before', version: 1, label: '설계 전 진단', note: '다른 고객(권한 분리 확인용)', data: clone(S.BEFORE), createdBy: 2, createdAt: t }],
      records: [rec(1, '2026-09', 'debt', 650000), rec(2, '2026-09', 'emergency', 500000, '계획보다 7만원 적게 적립'), rec(3, '2026-09', 'expense:essential', 1300000), rec(4, '2026-09', 'expense:optional', 420000),
        rec(5, '2026-10', 'debt', 650000), rec(6, '2026-10', 'expense:essential', 1320000, '관리비·병원비'), rec(7, '2026-10', 'expense:optional', 610000, '경조사 2건'), rec(8, '2026-11', 'debt', 650000, '자동이체'), rec(9, '2026-11', 'expense:optional', 180000, '월중 기록')],
      accounts: [{ id: 1, clientId: 1, label: '급여 통장', masked: '****1001', purpose: 'salary' }, { id: 2, clientId: 1, label: '주거자금 통장', masked: '****2002', purpose: 'housing' }, { id: 3, clientId: 1, label: '비상금 통장', masked: '****3003', purpose: 'emergency' }],
      txs: [], sync: {},
      settings: { 1: { dueDay: 25, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 3, staleDays: 7 } },
      closures: [{ clientId: 1, month: '2026-09', closedAt: '2026-10-02T09:00:00.000Z', closedBy: 'client' }, { clientId: 1, month: '2026-10', closedAt: '2026-11-02T09:00:00.000Z', closedBy: 'client' }],
      scheduled: [{ id: 1, clientId: 1, month: '2026-11', label: '10월 카드대금(미결제)', amount: 420000, category: 'optional', kind: 'card', paid: false }, { id: 2, clientId: 1, month: '2026-11', label: '월세·관리비', amount: 650000, category: 'essential', kind: 'fixed', paid: false }],
      baselines: [{ clientId: 1, planId: 2, setBy: 3, setAt: '2026-08-28T10:00:00.000Z', reason: '고객 확인' }],
      risk: [{ id: 1, clientId: 1, kind: 'official', type: '위험중립형', typeId: 3, diagnosedAt: '2024-05-10', source: 'OO은행 투자자정보확인서(가상)', purpose: '목돈 운용(펀드 가입)', snapshot: { netMonthly: 2600000, totalDebt: 28000000, purpose: '목돈 운용(펀드 가입)' }, createdAt: t }],
      strategies: [], revisions: [], notifications: [], notif: {}, consent: {}, evalState: {}, inquiries: [],
      offers: [{ id: 1, clientId: 1, planId: 2, status: 'accepted', note: '1차 상담 결과', createdBy: 1, createdAt: '2026-08-27T11:00:00.000Z', decidedAt: '2026-08-28T10:00:00.000Z' }],
      cdata: { 1: (function () { var d = CD.fromPlan(S.BEFORE, S.PROFILE); d.goal.moveMonth = S.AFTER.basis.moveMonth; var fv = {}; CD.FIELDS.forEach(function (f) { fv[f.path] = 1; }); Object.keys(CD.LISTS).forEach(function (k) { fv[k] = 1; }); return { data: d, version: 1, fieldVersions: fv, updatedAt: '2026-08-19T10:00:00.000Z', updatedBy: '김하늘(가상)' }; })() },
      changes: [], productRequests: []
    };
  }
  var mem = null;
  function load() { if (mem) return mem; try { var r = root.localStorage.getItem(KEY); if (r) mem = JSON.parse(r); } catch (e) { mem = null; } if (!mem || !mem.closures) mem = seed(); return mem; }
  function save() { try { root.localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* 저장 불가 시 메모리만 */ } }
  function nid() { mem.seq++; return mem.seq; }

  function user() { var db = load(); var u = db.users.filter(function (x) { return x.id === db.session; })[0]; if (!u) fail(401, '로그인이 필요합니다.'); return u; }
  function canAccess(u, cid) { cid = Number(cid); if (u.role === 'client') return u.clientId === cid; return load().assignments.some(function (a) { return a[0] === u.id && a[1] === cid; }); }
  function clientOf(u, cid) { if (!canAccess(u, cid)) fail(403, '이 고객의 정보를 볼 권한이 없습니다.'); return load().clients.filter(function (c) { return c.id === Number(cid); })[0]; }
  function pub(u) { return { id: u.id, email: u.email, name: u.name, role: u.role, clientId: u.clientId || null }; }
  function clientUser(cid) { return load().users.filter(function (u) { return u.clientId === cid; })[0].id; }

  // ---------- 서버 jobs.js와 같은 점검 ----------
  function baseline(cid) {
    var db = load(), b = db.baselines.filter(function (x) { return x.clientId === cid; }).slice(-1)[0];
    var p = b ? db.plans.filter(function (x) { return x.id === b.planId; })[0] : db.plans.filter(function (x) { return x.clientId === cid && x.kind === 'after'; }).sort(function (a, b2) { return a.version - b2.version; }).slice(-1)[0];
    return p ? { id: p.id, version: p.version, data: p.data } : null;
  }
  function context(cid, today) {
    var db = load(), plan = baseline(cid); if (!plan) return null;
    var notif = Object.assign({}, DEF_NOTIF, db.notif[cid] || {}); notif.types = Object.assign({}, DEF_NOTIF.types, notif.types || {});
    return { plan: plan, data: plan.data, records: db.records.filter(function (r) { return r.clientId === cid && !r.voidedAt; }), txs: db.txs.filter(function (t) { return t.clientId === cid; }),
      scheduled: db.scheduled.filter(function (s) { return s.clientId === cid; }), closed: db.closures.filter(function (c) { return c.clientId === cid; }).map(function (c) { return c.month; }),
      alertSettings: Object.assign({ dueDay: 25, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 3, staleDays: 7 }, db.settings[cid] || {}),
      notif: notif, consent: Object.assign({}, DEF_CONSENT, db.consent[cid] || {}), today: today || new Date() };
  }
  function nextAfterVersion(cid) { return load().plans.filter(function (p) { return p.clientId === cid && p.kind === 'after'; }).reduce(function (a, p) { return Math.max(a, p.version); }, 0) + 1; }
  function applyRevision(cid, rev, by, how) {
    var db = load(), v = nextAfterVersion(cid), label = how === 'auto' ? '자동 적용(동의 범위)' : '수정안 적용';
    var p = { id: nid(), clientId: cid, kind: 'after', version: v, label: label, note: (rev.summary.changes || []).join(' / ').slice(0, 500), data: clone(rev.data), createdBy: by, createdAt: now() };
    db.plans.push(p); db.baselines.push({ clientId: cid, planId: p.id, setBy: by, setAt: now(), reason: label + ' #' + rev.id });
    rev.status = how === 'auto' ? 'auto' : 'applied'; rev.decidedAt = now(); rev.appliedPlanId = p.id;
    return { planId: p.id, version: v };
  }
  function addNotice(cid, n, revId) {
    var db = load(); if (db.notifications.some(function (x) { return x.clientId === cid && x.key === n.key; })) return null;
    var o = { id: nid(), clientId: cid, type: n.type, key: n.key, fact: n.fact, impact: n.impact || '', action: n.action || '', revisionId: revId || null, amounts: n.amounts || {}, createdAt: now(), readAt: null, pushState: 'none' };
    db.notifications.push(o); return o.id;
  }
  function evaluate(cid) {
    var db = load(), ctx = context(cid); if (!ctx) return { closed: [], revisions: [], notifications: [] };
    var closedNow = [], base = ctx.data.basis.baseMonth, cur = M.ymOf(ctx.today);
    for (var t = 1; ; t++) {
      var ym = C.ymAdd(base, t); if (C.ymDiff(ym, cur) <= 0) break; if (ctx.closed.indexOf(ym) >= 0) continue;
      var p = ym.split('-').map(Number), end = new Date(p[0], p[1], 0, 23, 59, 59);
      if ((ctx.today - end) / 864e5 < ctx.alertSettings.graceDays) continue;
      if (ctx.txs.some(function (x) { return !x.confirmedAt && x.date.slice(0, 7) === ym; })) continue;
      db.closures.push({ clientId: cid, month: ym, closedAt: now(), closedBy: 'system' }); ctx.closed.push(ym); closedNow.push(ym);
    }
    var rc = M.recalc(ctx), ex = A.execution(ctx.data, M.finalRecords(ctx.records, ctx.closed), { today: ctx.today, settings: ctx.alertSettings });
    var prevStatus = db.evalState[cid] || rc.plan.status, created = [], revs = [], kinds = [];
    if (rc.lastFinal && rc.lastFinal.overspend > rc.lastFinal.planned * ctx.alertSettings.budgetTolerancePct / 100) kinds.push('overspend');
    else if (prevStatus === 'achieved' && rc.forecast.status !== 'achieved') kinds.push('goalFlip');
    if (rc.lastFinal && rc.lastFinal.slack >= 10000) kinds.push('surplus');
    kinds.forEach(function (kind) {
      var month = rc.closedYm || rc.startYm;
      if (db.revisions.some(function (r) { return r.clientId === cid && r.kind === kind && r.month === month && r.basePlanId === ctx.plan.id; })) return;
      var pr = M.proposal(ctx, rc, kind); if (!pr.applicable && !pr.infeasible) return;
      var rev = { id: nid(), clientId: cid, basePlanId: ctx.plan.id, kind: kind, month: month, status: pr.infeasible ? 'info' : 'pending', data: pr.data,
        summary: { changes: pr.changes, compare: pr.compare || null, amount: pr.amount || null, autoEligible: pr.autoEligible, needsBalanceCheck: !!pr.needsBalanceCheck, infeasible: !!pr.infeasible, alternatives: pr.alternatives, startYm: pr.startYm, remaining: rc.remaining },
        createdAt: now(), decidedAt: null, appliedPlanId: null };
      db.revisions.push(rev);
      if (ctx.consent.enabled && pr.autoEligible && (kind === 'overspend' || kind === 'goalFlip')) applyRevision(cid, rev, clientUser(cid), 'auto');
      revs.push(rev.id);
      if (ctx.notif.types.revision) { var id = addNotice(cid, M.revisionNotice({ id: rev.id, kind: kind, month: month, status: rev.status, compare: pr.compare }), rev.id); if (id) created.push(id); }
    });
    M.notices(ctx, rc, ex, prevStatus).forEach(function (n) {
      if (!ctx.notif.types[n.type]) return;
      var rv = (n.type === 'overspend' || n.type === 'surplus' || n.type === 'goalFlip') ? db.revisions.filter(function (r) { return r.clientId === cid && r.month === (n.month || rc.startYm) && r.kind === n.type; }).slice(-1)[0] : null;
      var id = addNotice(cid, n, rv && rv.id); if (id) created.push(id);
    });
    db.evalState[cid] = rc.forecast.status;
    return { closed: closedNow, revisions: revs, notifications: created };
  }

  function storeTx(cid, rows, source) {
    var db = load(), accs = db.accounts.filter(function (a) { return a.clientId === cid; }), added = 0, dup = 0;
    rows.forEach(function (t) {
      var key = [t.date, t.amount, t.from, t.to, t.description].join('|');
      if (db.txs.some(function (x) { return x.clientId === cid && x.importKey === key; })) { dup++; return; }
      db.txs.push({ id: nid(), clientId: cid, date: t.date, amount: t.amount, description: t.description, fromMasked: t.from, toMasked: t.to, source: source, suggested: L.suggest({ amount: t.amount, description: t.description, from: t.from, to: t.to }, accs), classification: null, confirmedAt: null, recordId: null, importKey: key });
      added++;
    });
    db.sync[cid] = { provider: source, lastSync: now(), lastError: null };
    return { added: added, duplicates: dup };
  }
  function riskFor(cid) {
    var rows = load().risk.filter(function (r) { return r.clientId === cid; });
    var app = rows.filter(function (r) { return r.kind === 'app'; }).slice(-1)[0];
    if (app) return { id: app.id, typeId: app.typeId, type: app.type, status: app.result.status, flags: app.result.flags, housingCoreMax: app.result.housingCoreMax, source: '앱 설문 ' + app.diagnosedAt };
    var off = rows.filter(function (r) { return r.kind === 'official'; }).slice(-1)[0];
    if (off) return { id: off.id, typeId: off.typeId, type: off.type, status: 'needsReview', flags: [{ id: 'officialOnly', reason: '금융기관 결과만 있고 앱 설문(재무 여력 확인)이 없습니다.' }], source: off.source + ' ' + off.diagnosedAt };
    return null;
  }
  function snapshotOf(cid) { var b = baseline(cid); if (!b) return {}; var d = C.normalize(b.data); return { netMonthly: d.income.netMonthly, totalDebt: d.debts.reduce(function (s, x) { return s + x.balance; }, 0), purpose: '주거자금 마련(' + d.basis.moveMonth + ' 이사)', planId: b.id }; }

  function logc(cid, me, entity, text, items, extra) { var db = load(); db.changes.push(Object.assign({ id: nid(), clientId: cid, entity: entity, actorRole: me ? me.role : 'system', actorName: me ? me.name : '자동 점검', text: text, items: items || [], at: now() }, extra || {})); }
  function handle(method, path, body) {
    var db = load(), m;
    if (path === '/api/config') return { demo: true, realtime: 'none', static: true, version: '3.0.0' };
    if (path === '/api/login' && method === 'POST') {
      var u = db.users.filter(function (x) { return x.email === String(body.email || '').trim().toLowerCase(); })[0];
      if (!u || body.password !== PW) fail(401, '이메일 또는 비밀번호가 맞지 않습니다.');
      db.session = u.id; return { ok: true };
    }
    if (path === '/api/logout') { db.session = null; return { ok: true }; }
    var me = user();
    if (path === '/api/me') return { user: Object.assign(pub(me), { demo: true }), demoMode: true };
    if (path.indexOf('/api/sync') === 0) return { changes: [], latest: 0, serverTime: now() };
    if (path === '/api/products') return { products: FP.Products.policyProducts(), meta: {}, keyConfigured: false, investment: { connected: false, text: '투자상품은 연결된 공식 공시 자료가 없어 표시하지 않습니다.' }, staticNote: true };
    if (path === '/api/clients') return { clients: db.clients.filter(function (c) { return canAccess(me, c.id); }).map(clone) };
    if (path.indexOf('/api/push/') === 0) fail(501, '시연판(GitHub Pages)은 서버가 없어 푸시 알림을 보낼 수 없습니다. 알림은 앱을 열 때 알림함에 표시됩니다.');
    if (!(m = path.match(/^\/api\/clients\/(\d+)\/([\w-]+)(?:\/([\w-]+))?(?:\/([\w-]+))?$/))) fail(404, '없는 요청입니다.');
    var cid = Number(m[1]), res = m[2], sub = m[3], act = m[4];
    clientOf(me, cid);
    var mine = function (arr) { return arr.filter(function (x) { return x.clientId === cid; }); };

    if (res === 'data' && method === 'GET') { var cdx = db.cdata[cid] || { data: {}, version: 0, fieldVersions: {} }; return clone(Object.assign({}, cdx, { latestChange: 0 })); }
    if (res === 'data' && method === 'PATCH') {
      need(me.role === 'client', 403, '고객 정보는 고객 본인이 수정합니다.');
      var cur = db.cdata[cid] || (db.cdata[cid] = { data: {}, version: 0, fieldVersions: {} }), set = body.set || {}, base = Number(body.baseVersion), items = [], conf = [], chg = [];
      var gv = function (o, k) { var v = CD.LISTS[k] ? o[k] : CD.get(o, k); return v === undefined ? null : v; };
      Object.keys(set).forEach(function (k) {
        need(CD.LISTS[k] || CD.FIELDS.some(function (f) { return f.path === k; }), 400, '알 수 없는 항목입니다: ' + k);
        var cv = gv(cur.data, k); if (JSON.stringify(cv) === JSON.stringify(set[k])) return;
        if ((cur.fieldVersions[k] || 0) > base) conf.push({ path: k, label: CD.label(k), current: CD.fmt(k, cv), mine: CD.fmt(k, set[k]) }); else chg.push(k);
      });
      if (conf.length) { var ce = new Error('다른 기기에서 같은 항목이 먼저 저장되었습니다. 최신 값을 확인한 뒤 다시 저장해 주세요.'); ce.status = 409; ce.code = 'conflict'; ce.body = { conflicts: conf }; throw ce; }
      if (!chg.length) return { version: cur.version, unchanged: true };
      var nv = cur.version + 1;
      chg.forEach(function (k) { items.push({ path: k, label: CD.label(k), from: CD.fmt(k, gv(cur.data, k)), to: CD.fmt(k, set[k]) }); if (CD.LISTS[k]) cur.data[k] = clone(set[k]); else CD.set(cur.data, k, set[k]); cur.fieldVersions[k] = nv; });
      cur.version = nv; cur.updatedAt = now(); cur.updatedBy = me.name; logc(cid, me, 'client_data', items.length + '개 항목 변경', items, { version: nv });
      return { version: nv, updatedAt: cur.updatedAt, changed: items };
    }
    if (res === 'history') return { history: mine(db.changes).slice().reverse().map(clone) };
    if (res === 'product-requests' && method === 'GET') return { requests: mine(db.productRequests).slice().reverse().map(clone) };
    if (res === 'product-requests' && method === 'POST') { need(me.role === 'client', 403, '검토 요청은 고객이 합니다.'); need(body.confirm === true, 400, '비교 결과를 확인해 주세요.'); db.productRequests.push({ id: nid(), clientId: cid, product: clone(body.product), simulation: clone(body.simulation || {}), status: 'requested', createdAt: now() }); return { id: mem.seq }; }
    if (res === 'offers' && method === 'GET') return { offers: mine(db.offers).slice().reverse().map(clone) };
    if (res === 'offers' && method === 'POST' && !sub) {
      need(me.role === 'planner', 403, '계획 제시는 설계사가 합니다.');
      var op = db.plans.filter(function (p) { return p.id === Number(body.planId) && p.clientId === cid && p.kind === 'after'; })[0]; need(op, 404, '제시할 설계 후 계획을 찾을 수 없습니다.');
      mine(db.offers).forEach(function (o) { if (o.status === 'presented') { o.status = 'withdrawn'; o.decidedAt = now(); } });
      var oid = nid(); db.offers.push({ id: oid, clientId: cid, planId: op.id, status: 'presented', note: String(body.note || '').slice(0, 300), createdBy: me.id, createdAt: now() });
      db.notifications.push({ id: nid(), clientId: cid, type: 'revision', key: 'offer:' + oid, fact: '설계사가 새 계획(설계 후 v' + op.version + ')을 제시했습니다.', impact: '선택하기 전까지 현재 실행 기준 계획은 바뀌지 않습니다.', action: '‘A/B/C안·제안’에서 비교하고 선택하거나 보류해 주세요.', amounts: {}, createdAt: now(), readAt: null, pushState: 'none' });
      return { id: oid };
    }
    if (res === 'offers' && sub) {
      var of0 = mine(db.offers).filter(function (o) { return o.id === Number(sub); })[0]; need(of0, 404, '제시된 계획을 찾을 수 없습니다.');
      need(act === 'withdraw' ? me.role === 'planner' : me.role === 'client', 403, '권한이 없습니다.');
      if (act === 'accept') { need(body.confirm === true, 400, '선택 내용을 확인해 주세요.'); if (of0.status === 'accepted') return { ok: true, already: true }; }
      need(of0.status === 'presented', 409, '이미 처리된 제시입니다.');
      of0.status = act === 'accept' ? 'accepted' : act === 'decline' ? 'declined' : 'withdrawn'; of0.decidedAt = now();
      if (act === 'accept') { db.baselines.push({ clientId: cid, planId: of0.planId, setBy: me.id, setAt: now(), reason: '고객 선택(제시 #' + of0.id + ')' }); evaluate(cid); }
      return { ok: true };
    }
    if (res === 'plans' && method === 'GET' && me.role === 'client') {
      var okIds = mine(db.baselines).map(function (b) { return b.planId; }).concat(mine(db.offers).map(function (o) { return o.planId; })).concat(mine(db.strategies).map(function (x) { return x.selectedPlanId; }));
      return { plans: mine(db.plans).filter(function (p) { return p.kind === 'before' || okIds.indexOf(p.id) >= 0; }).sort(function (a, b) { return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.version - b.version; }).map(function (p) { var o = clone(p); o.author = db.users.filter(function (x) { return x.id === p.createdBy; })[0].name; return o; }) };
    }
    if (res === 'plans' && method === 'GET') return { plans: mine(db.plans).sort(function (a, b) { return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.version - b.version; }).map(function (p) { var o = clone(p); o.author = db.users.filter(function (x) { return x.id === p.createdBy; })[0].name; return o; }) };
    if (res === 'plans' && method === 'POST') {
      need(me.role === 'planner', 403, '계획은 설계사만 저장할 수 있습니다.');
      var d = body.data; need(d && d.basis && C.ymValid(d.basis.baseMonth) && C.ymValid(d.basis.moveMonth), 400, '기준월과 이사 예정월(YYYY-MM)을 입력해 주세요.');
      var df = C.ymDiff(d.basis.baseMonth, d.basis.moveMonth); need(df >= 1 && df <= 120, 400, '이사 예정월은 기준월 이후 120개월 이내여야 합니다.');
      if (d.allocation && d.allocation.mode === 'ratio') { var r0 = d.allocation.ratios || {}, s0 = Number(r0.emergency || 0) + Number(r0.debt || 0) + Number(r0.housing || 0); need(Math.abs(s0 - 100) < 0.001, 400, '초과소득 배분 비율의 합계가 100%가 되어야 합니다. (현재 ' + s0 + '%)'); }
      var v = mine(db.plans).filter(function (p) { return p.kind === body.kind; }).reduce(function (a, p) { return Math.max(a, p.version); }, 0) + 1;
      var np = { id: nid(), clientId: cid, kind: body.kind, version: v, label: String(body.label || '').slice(0, 60), note: String(body.note || '').slice(0, 500), data: clone(d), createdBy: me.id, createdAt: now() };
      db.plans.push(np); return { id: np.id, version: v };
    }
    if (res === 'records' && method === 'GET') return { records: mine(db.records).map(clone) };
    if (res === 'records' && method === 'POST') {
      need(me.role === 'client', 403, '실행 기록은 고객 본인이 입력합니다.'); need(C.ymValid(body.month), 400, '월(YYYY-MM)을 확인해 주세요.'); need(CATS.test(body.category), 400, '항목을 확인해 주세요.');
      var amt = Number(body.amount); need(isFinite(amt) && amt >= 0, 400, '0 이상으로 입력해 주세요.');
      need(!mine(db.closures).some(function (c) { return c.month === body.month; }), 409, body.month + '은(는) 이미 확정된 달입니다.');
      var ex0 = mine(db.records).filter(function (x) { return x.month === body.month && x.category === body.category && !x.voidedAt; })[0];
      if (ex0 && ex0.amount === amt) return { id: ex0.id, unchanged: true };
      var t0 = now(); mine(db.records).forEach(function (x) { if (x.month === body.month && x.category === body.category && !x.voidedAt) x.voidedAt = t0; });
      var rec = { id: nid(), clientId: cid, month: body.month, category: body.category, amount: amt, source: 'manual', note: '', voidedAt: null, createdAt: t0, createdBy: me.id };
      db.records.push(rec); evaluate(cid); return { id: rec.id };
    }
    if (res === 'accounts' && method === 'GET') return { accounts: mine(db.accounts).map(clone) };
    if (res === 'accounts' && method === 'POST') { need(me.role === 'client', 403, '계좌는 고객 본인이 등록합니다.'); var mk = L.maskAccount(body.number); need(mk, 400, '계좌번호 끝 4자리 이상을 입력해 주세요.'); db.accounts.push({ id: nid(), clientId: cid, label: String(body.label || '계좌').slice(0, 30), masked: mk, purpose: body.purpose }); return { ok: true }; }
    if (res === 'transactions' && method === 'GET') return { sync: db.sync[cid] || null, transactions: mine(db.txs).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; }).map(clone) };
    if (res === 'transactions' && method === 'POST') {
      need(me.role === 'client', 403, '고객 본인만 할 수 있습니다.');
      if (sub === 'import') { var pr = L.parseCsv(body.csv); need(pr.rows.length || !pr.errors.length, 400, pr.errors.join(' ')); var o = storeTx(cid, pr.rows, 'csv'); o.errors = pr.errors; return o; }
      if (sub === 'sync') { need(C.ymValid(body.month), 400, '월을 확인해 주세요.'); var o2 = storeTx(cid, L.DemoProvider.fetchTransactions(mine(db.accounts), body.month), 'demo'); o2.provider = L.DemoProvider.label; return o2; }
      if (act === 'confirm') {
        var tx = mine(db.txs).filter(function (x) { return x.id === Number(sub); })[0];
        need(tx, 404, '거래를 찾을 수 없습니다.'); need(!tx.confirmedAt, 409, '이미 확인한 거래입니다.');
        var cls = body.classification === 'expense' ? 'expense:optional' : body.classification, month = tx.date.slice(0, 7), recordId = null;
        if (/^(debt|emergency|housing|product:|expense:)/.test(cls)) {
          var twin = mine(db.txs).filter(function (x) { return x.id !== tx.id && x.date === tx.date && Math.abs(x.amount) === Math.abs(tx.amount) && x.fromMasked === tx.fromMasked && x.toMasked === tx.toMasked && x.recordId; })[0];
          if (twin) recordId = twin.recordId;
          else {
            var man = mine(db.records).filter(function (x) { return x.month === month && x.category === cls && x.source === 'manual' && !x.voidedAt; })[0];
            if (man && !body.replaceManual) fail(409, '이 달 ‘' + cls + '’에 직접 입력한 기록(' + Math.round(man.amount / 10000) + '만원)이 있습니다. 거래로 대체할지 선택해 주세요.', 'manualExists');
            if (man) man.voidedAt = now();
            var nr = { id: nid(), clientId: cid, month: month, category: cls, amount: Math.abs(tx.amount), source: 'transaction', txId: tx.id, note: tx.description, voidedAt: null, createdAt: now(), createdBy: me.id };
            db.records.push(nr); recordId = nr.id;
          }
        }
        tx.classification = cls; tx.confirmedAt = now(); tx.recordId = recordId;
        if (cls.indexOf('expense:') === 0) { var sc = mine(db.scheduled).filter(function (s) { return s.month === month && !s.paid && s.amount === Math.abs(tx.amount); })[0]; if (sc) sc.paid = true; }
        evaluate(cid); return { ok: true, recordId: recordId };
      }
    }
    if (res === 'settings' && method === 'GET') return { settings: clone(db.settings[cid] || {}) };
    if (res === 'settings' && method === 'PUT') {
      var st = body.settings || {}, clean = {};
      [['dueDay', 1, 31], ['graceDays', 0, 15], ['cumTolerancePct', 0, 100], ['budgetTolerancePct', 0, 100], ['emergencyMinMonths', 0, 24], ['staleDays', 1, 90]].forEach(function (k) { var x = Number(st[k[0]]); need(isFinite(x) && x >= k[1] && x <= k[2], 400, k[0] + ' 값은 ' + k[1] + '~' + k[2] + ' 사이여야 합니다.'); clean[k[0]] = x; });
      db.settings[cid] = clean; evaluate(cid); return { settings: clean };
    }

    // ----- v2.1 -----
    if (res === 'extra' && method === 'GET') {
      evaluate(cid); // 앱 실행 시 점검(서버판의 정기 점검을 대신함)
      var ctx = context(cid);
      return {
        risk: mine(db.risk).map(clone), snapshot: snapshotOf(cid), riskVersion: Rk.CFG.VERSION,
        strategies: mine(db.strategies).filter(function (s) { return me.role === 'planner' || s.status !== 'draft'; }).map(clone),
        baselineId: ctx ? ctx.plan.id : null, baselines: mine(db.baselines).map(clone), scheduled: ctx ? clone(ctx.scheduled) : [],
        closures: mine(db.closures).map(clone).sort(function (a, b) { return a.month < b.month ? -1 : 1; }),
        revisions: mine(db.revisions).slice().reverse().map(function (r) { var o = clone(r); delete o.data; return o; }),
        notifications: mine(db.notifications).slice().reverse().map(clone), notifSettings: ctx ? ctx.notif : DEF_NOTIF, consent: ctx ? ctx.consent : DEF_CONSENT,
        inquiries: mine(db.inquiries).slice().reverse().map(clone), pushSubscribed: false, offers: mine(db.offers).slice().reverse().map(clone)
      };
    }
    if (res === 'risk' && sub === 'official') {
      need(me.role === 'planner', 403, '금융기관 결과는 설계사가 확인 후 입력합니다.'); need(TYPES.indexOf(body.type) >= 0, 400, '유형을 선택해 주세요.');
      need(/^\d{4}-\d{2}-\d{2}$/.test(body.diagnosedAt || ''), 400, '진단일(YYYY-MM-DD)을 입력해 주세요.'); need(String(body.source || '').trim(), 400, '출처(금융기관·서류명)를 입력해 주세요.');
      db.risk.push({ id: nid(), clientId: cid, kind: 'official', type: body.type, typeId: TYPES.indexOf(body.type) + 1, diagnosedAt: body.diagnosedAt, source: String(body.source).slice(0, 80), purpose: String(body.purpose || '').slice(0, 80), snapshot: {}, createdAt: now() });
      return { ok: true };
    }
    if (res === 'risk' && sub === 'app') {
      need(me.role === 'client', 403, '앱 설문은 고객 본인이 답합니다.');
      var rr = Rk.score(body.answers || {}); need(rr.complete, 400, '판단에 필요한 답변이 빠졌습니다: ' + rr.missing.concat(rr.insufficient).join(', '));
      var snap = snapshotOf(cid);
      db.risk.push({ id: nid(), clientId: cid, kind: 'app', type: rr.type, typeId: rr.typeId, diagnosedAt: now().slice(0, 10), source: Rk.CFG.LABEL + ' 설문', purpose: snap.purpose || '', answers: clone(body.answers), result: rr, version: Rk.CFG.VERSION, snapshot: snap, createdAt: now() });
      return { ok: true, result: rr };
    }
    if (res === 'strategies') {
      var buildSet = function (planId, ov) {
        var pl = mine(db.plans).filter(function (p) { return p.id === Number(planId); })[0]; need(pl, 404, '기준 계획을 찾을 수 없습니다.');
        var rk = riskFor(cid); return { pl: pl, rk: rk, r: St.build(clone(pl.data), rk, clone(clientOf(me, cid).profile), ov || {}) };
      };
      if (!sub && method === 'POST') {
        need(me.role === 'planner', 403, '설계안은 설계사가 만듭니다.');
        var bs = buildSet(body.basePlanId, body.overrides), sid = nid();
        db.strategies.push({ id: sid, clientId: cid, basePlanId: bs.pl.id, riskId: bs.rk ? bs.rk.id : null, status: 'draft', overrides: body.overrides || {}, result: bs.r, note: '', createdAt: now(), presentedAt: null, selectedKey: null, selectedAt: null, selectedPlanId: null });
        return { id: sid };
      }
      var set = mine(db.strategies).filter(function (s) { return s.id === Number(sub); })[0]; need(set, 404, '설계안을 찾을 수 없습니다.');
      if (!act && method === 'PUT') { need(me.role === 'planner', 403, '설계사만 수정할 수 있습니다.'); need(set.status === 'draft', 409, '제시한 설계안은 수정할 수 없습니다. 새로 만들어 주세요.'); set.result = buildSet(set.basePlanId, body.overrides).r; set.overrides = body.overrides || {}; return { ok: true }; }
      if (act === 'present') {
        need(me.role === 'planner', 403, '설계사만 제시할 수 있습니다.'); need(set.status === 'draft', 409, '작성 중인 설계안만 제시할 수 있습니다.');
        mine(db.strategies).forEach(function (s) { if (s.status === 'presented') s.status = 'withdrawn'; });
        set.status = 'presented'; set.presentedAt = now();
        addNotice(cid, { type: 'revision', key: 'strategy:' + set.id, fact: '설계사가 A/B/C 재무설계안을 보냈습니다.', impact: '세 안의 목표일 예상 가용자금과 불리한 상황 결과를 비교할 수 있습니다.', action: '‘성향·설계안’에서 비교하고 한 가지를 선택해 주세요.' });
        return { ok: true };
      }
      if (act === 'select') {
        need(me.role === 'client', 403, '실행할 안은 고객이 선택합니다.'); need(set.status === 'presented', 409, '제시된 설계안이 아닙니다.');
        var opt = set.result.options.filter(function (o) { return o.key === body.key; })[0]; need(opt, 400, '안을 선택해 주세요.'); need(body.confirm === true, 400, '선택 내용을 확인해 주세요.');
        var v2 = nextAfterVersion(cid), pp = { id: nid(), clientId: cid, kind: 'after', version: v2, label: '고객 선택 ' + opt.key + '안', note: opt.title + ' — ' + opt.actions.join(', ').slice(0, 400), data: clone(opt.data), createdBy: me.id, createdAt: now() };
        db.plans.push(pp); db.baselines.push({ clientId: cid, planId: pp.id, setBy: me.id, setAt: now(), reason: '고객 선택 ' + opt.key + '안 (설계안 #' + set.id + ')' });
        set.status = 'selected'; set.selectedKey = opt.key; set.selectedAt = now(); set.selectedPlanId = pp.id; evaluate(cid);
        return { ok: true, planId: pp.id, version: v2 };
      }
    }
    if (res === 'baseline' && method === 'POST') {
      need(me.role === 'client', 403, '실행 기준 계획은 고객이 확인해 정합니다.');
      var bp = mine(db.plans).filter(function (p) { return p.id === Number(body.planId) && p.kind === 'after'; })[0]; need(bp, 404, '설계 후 계획을 찾을 수 없습니다.');
      db.baselines.push({ clientId: cid, planId: bp.id, setBy: me.id, setAt: now(), reason: '고객 확인' }); evaluate(cid); return { ok: true };
    }
    if (res === 'scheduled') {
      need(me.role === 'client', 403, '고객 본인만 할 수 있습니다.');
      if (!sub && method === 'POST') {
        need(C.ymValid(body.month), 400, '월을 확인해 주세요.'); var a2 = Number(body.amount); need(isFinite(a2) && a2 > 0, 400, '금액을 입력해 주세요.');
        need(['essential', 'optional'].indexOf(body.category) >= 0, 400, '항목을 선택해 주세요.'); need(['card', 'fixed'].indexOf(body.kind) >= 0, 400, '종류를 선택해 주세요.');
        need(!mine(db.closures).some(function (c) { return c.month === body.month; }), 409, '확정된 달에는 예정 결제를 추가할 수 없습니다.');
        db.scheduled.push({ id: nid(), clientId: cid, month: body.month, label: String(body.label || (body.kind === 'card' ? '카드대금' : '고정비')).slice(0, 30), amount: a2, category: body.category, kind: body.kind, paid: false }); return { ok: true };
      }
      var it = mine(db.scheduled).filter(function (s) { return s.id === Number(sub); })[0]; need(it, 404, '항목이 없습니다.');
      if (act === 'paid') { it.paid = true; return { ok: true }; }
      if (method === 'DELETE' && !it.paid) { db.scheduled.splice(db.scheduled.indexOf(it), 1); return { ok: true }; }
    }
    if (res === 'months' && act === 'close') {
      need(me.role === 'client', 403, '월 확정은 고객이 합니다.'); need(C.ymValid(sub), 400, '월을 확인해 주세요.'); need(body.confirm === true, 400, '확정 전에 내용을 확인해 주세요.');
      var pt = mine(db.txs).filter(function (x) { return x.date.slice(0, 7) === sub && !x.confirmedAt; }).length, ps = mine(db.scheduled).filter(function (s) { return s.month === sub && !s.paid; }).length;
      need(!pt && !ps, 409, '아직 확인하지 않은 거래 ' + pt + '건, 결제 전 예정 항목 ' + ps + '건이 있습니다. 먼저 정리해 주세요.');
      if (!mine(db.closures).some(function (c) { return c.month === sub; })) db.closures.push({ clientId: cid, month: sub, closedAt: now(), closedBy: 'client' });
      evaluate(cid); return { ok: true };
    }
    if (res === 'revisions') {
      need(me.role === 'client', 403, '수정안은 고객이 확인 후 적용합니다.');
      var rv = mine(db.revisions).filter(function (r) { return r.id === Number(sub); })[0]; need(rv, 404, '수정안이 없습니다.');
      if (act === 'apply') {
        need((rv.status === 'pending' || rv.status === 'held') && rv.data, 409, '적용할 수 없는 수정안입니다.');
        var curB = baseline(cid); need(curB && curB.id === rv.basePlanId, 409, '기준 계획이 그 사이 바뀌어 이 수정안은 더 이상 맞지 않습니다. 다시 점검해 주세요.');
        if (rv.summary.needsBalanceCheck) need(body.balanceConfirmed === true, 400, '통장에 그 금액이 실제로 남아 있는지 확인해 주세요.');
        var out = applyRevision(cid, rv, me.id, 'manual'); evaluate(cid); return out;
      }
      if (act === 'hold') { need(rv.status === 'pending', 409, '보류할 수 없는 수정안입니다.'); rv.status = 'held'; rv.decidedAt = now(); return { ok: true }; }
    }
    if (res === 'notifications') {
      var n = mine(db.notifications).filter(function (x) { return x.id === Number(sub); })[0]; need(n, 404, '알림이 없습니다.');
      if (act === 'read') { n.readAt = n.readAt || now(); return { ok: true }; }
      if (act === 'ask') { need(me.role === 'client', 403, '고객만 문의할 수 있습니다.'); var msg = String(body.message || '').trim(); need(msg, 400, '문의 내용을 입력해 주세요.'); db.inquiries.push({ id: nid(), clientId: cid, notificationId: n.id, message: msg.slice(0, 500), createdAt: now() }); return { ok: true }; }
    }
    if (res === 'notif-settings' && method === 'PUT') {
      need(me.role === 'client', 403, '알림 설정은 고객이 정합니다.');
      var b2 = body.settings || {}, tm = /^([01]\d|2[0-3]):[0-5]\d$/;
      need(!b2.quietStart || tm.test(b2.quietStart), 400, '방해금지 시작 시각(HH:MM)을 확인해 주세요.'); need(!b2.quietEnd || tm.test(b2.quietEnd), 400, '방해금지 끝 시각(HH:MM)을 확인해 주세요.');
      var cl = { types: {}, quietStart: b2.quietStart || '', quietEnd: b2.quietEnd || '', push: false, lockDetails: !!b2.lockDetails };
      Object.keys(DEF_NOTIF.types).forEach(function (k) { cl.types[k] = !(b2.types && b2.types[k] === false); });
      db.notif[cid] = cl; return { settings: cl };
    }
    if (res === 'consent' && method === 'PUT') {
      need(me.role === 'client', 403, '자동 적용 동의는 고객 본인만 할 수 있습니다.');
      var c2 = body.consent || {}, lim = Number(c2.monthlyLimit), fl = Number(c2.floor);
      need(isFinite(lim) && lim >= 0 && lim <= 1000000, 400, '월 조정 한도는 0~100만원입니다.'); need(isFinite(fl) && fl >= 0, 400, '필수생활비 하한을 확인해 주세요.');
      db.consent[cid] = { enabled: !!c2.enabled, monthlyLimit: lim, floor: fl, agreedAt: c2.enabled ? now() : null }; return { consent: db.consent[cid] };
    }
    if (res === 'evaluate' && method === 'POST') { var ev = evaluate(cid); return { closed: ev.closed, revisions: ev.revisions.length, notifications: ev.notifications.length }; }
    fail(404, '없는 요청입니다.');
  }

  // 서버판으로 옮길 때 쓰는 내보내기 파일(서버에서 미리보기 → 고객 확인 후 저장)
  function exportData() {
    var db = load(), u = db.users.filter(function (x) { return x.id === db.session; })[0];
    if (!u || u.role !== 'client') return null;
    var cid = u.clientId;
    return { format: 'fp-export-1', exportedAt: now(), demo: true, note: '재무플래너 시연판에서 내보낸 데이터(가상 시연 데이터가 포함될 수 있음)', clientData: clone((db.cdata[cid] || {}).data || {}),
      records: db.records.filter(function (r) { return r.clientId === cid && !r.voidedAt; }).map(function (r) { return { month: r.month, category: r.category, amount: r.amount, note: r.note || '' }; }) };
  }
  FP.UI.api = function (method, path, body) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { var out = handle(method, path, body || {}); save(); resolve(JSON.parse(JSON.stringify(out))); }
        catch (e) { save(); if (!e.status) { console.error(e); e.status = 500; } reject(e); }
      }, 40);
    });
  };
  FP.MockServer = { reset: function () { mem = seed(); save(); }, evaluate: evaluate, exportData: exportData };
})(this);
