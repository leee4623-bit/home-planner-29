/*
 * 앱 진행: 로그인 → 역할별 화면 → 서버 데이터 불러오기·저장
 */
(function (root) {
  'use strict';
  var FP = root.FP, U = FP.UI, F = U.F, C = FP.Calc, A = FP.Analysis, PF = FP.PlanForm, doc = root.document;
  var S = { user: null, clients: [], client: null, plans: [], records: [], accounts: [], txs: [], sync: null, settings: {}, today: new Date(), ui: { tab: null, shocks: [], shockPlan: 'after', verifyPlan: 'after', loanPref: false } };
  S.todayYm = S.today.getFullYear() + '-' + String(S.today.getMonth() + 1).padStart(2, '0');
  var $ = function (id) { return doc.getElementById(id); };

  function show(id) { ['loginView', 'appView'].forEach(function (v) { $(v).hidden = v !== id; }); }
  function err(e) { U.toast(e.message || String(e), true); if (e.status === 401) { S.user = null; show('loginView'); } }

  // ---------- 로그인 ----------
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var em = $('loginEmail').value.trim(), pw = $('loginPw').value, out = $('loginErr');
    out.hidden = true;
    if (!em || !pw) { out.textContent = '이메일과 비밀번호를 입력해 주세요.'; out.hidden = false; return; }
    U.api('POST', '/api/login', { email: em, password: pw }).then(function () { $('loginPw').value = ''; return start(); }).catch(function (x) { out.textContent = x.message; out.hidden = false; });
  });
  doc.querySelectorAll('[data-demo]').forEach(function (b) { b.addEventListener('click', function () { $('loginEmail').value = b.dataset.demo; $('loginPw').focus(); }); });
  $('logoutBtn').addEventListener('click', function () {
    var n = FP.ClientInput && S.user && S.user.role === 'client' ? FP.ClientInput.dirtyCount(S) : 0;
    if (n && !root.confirm('저장하지 않은 변경 ' + n + '개가 있습니다. 로그아웃하면 사라집니다. 계속할까요?')) return;
    FP.Sync.stop(); U.api('POST', '/api/logout').then(function () { location.hash = ''; location.reload(); }, err);
  });

  // 로그인 화면: 시연 모드일 때만 시연 계정 버튼(고객·설계사) 표시. 역할은 서버 계정에 저장된 값으로만 정해짐
  U.api('GET', '/api/config').then(function (c) { S.config = c; var d = $('demoAccounts'); if (d) d.hidden = !c.demo; }, function () { /* 서버 연결 실패는 로그인 시 안내 */ });

  function start() {
    return U.api('GET', '/api/me').then(function (m) {
      S.user = m.user; S.demoMode = m.demoMode; show('appView');
      $('who').textContent = m.user.name + ' · ' + (m.user.role === 'planner' ? '설계사' : '고객');
      $('demoBanner').hidden = !(m.user.demo || m.demoMode);
      return U.api('GET', '/api/sync?latestOnly=1').catch(function () { return { latest: 0 }; });
    }).then(function (sy) { FP.Sync.start(sy.latest || 0); return refreshClients(); });
  }
  function refreshClients() {
    return U.api('GET', '/api/clients').then(function (r) {
      S.clients = r.clients;
      var sel = $('clientSel');
      sel.hidden = S.user.role !== 'planner' || !S.clients.length;
      sel.innerHTML = S.clients.map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.profile.name) + '</option>'; }).join('');
      if (!S.clients.length) { S.client = null; $('tabs').innerHTML = ''; $('main').innerHTML = '<section class="card empty-state"><h2>현재 배정된 고객이 없습니다</h2><p class="muted">고객 배정은 서버 관리자만 할 수 있습니다. 배정되면 이 화면에 바로 나타납니다.</p></section>'; return; }
      var keep = S.client && S.clients.some(function (c) { return c.id === S.client.id; }) ? S.client.id : S.clients[0].id;
      sel.value = keep;
      return loadClient(keep);
    });
  }

  function loadClient(id, keep) {
    var prev = S.client && S.client.id;
    S.client = S.clients.filter(function (c) { return c.id === Number(id); })[0];
    if (prev !== S.client.id) { S.ui.inp = null; S.ui.updates = null; S.ui.history = null; S.ui.basisChanged = null; S.prodData = null; S.ui.prod = null; S.chat = null; }
    var base = '/api/clients/' + S.client.id;
    return Promise.all([U.api('GET', base + '/plans'), U.api('GET', base + '/records'), U.api('GET', base + '/settings'), U.api('GET', base + '/transactions'), U.api('GET', base + '/accounts'), U.api('GET', base + '/extra'), U.api('GET', base + '/data')]).then(function (r) {
      S.x = r[5]; S.cd = r[6];
      if (S.ui.historyOpen) U.api('GET', base + '/history').then(function (h) { S.ui.history = h.history; if (S.ui.tab === 'clientInfo') render(); }, function () {});
      S.plans = r[0].plans; S.records = r[1].records.filter(function (x) { return !x.voidedAt; }).map(function (x) { x.status = 'confirmed'; return x; }); S.allRecords = r[1].records;
      S.settings = r[2].settings; S.txs = r[3].transactions; S.sync = r[3].sync; S.accounts = r[4].accounts;
      if (!keep) { S.ui.draft = null; S.ui.cutApplied = null; } // keep: 불러오는 사이 만든 초안도 그대로 둠
      if (FP.Features) FP.Features.onLoad(S);
      var tabs = tabsFor(); var h = location.hash.slice(1);
      S.ui.tab = tabs.some(function (t) { return t[0] === h; }) ? h : (S.ui.tab && tabs.some(function (t) { return t[0] === S.ui.tab; }) ? S.ui.tab : tabs[0][0]);
      renderTabs(); render();
    }).catch(err);
  }
  FP.reload = function () { return reload(true); };
  FP.rerender = function () { renderTabs(); render(); };
  // 다시 불러와도 작성 중인 초안은 유지(조용히 덮어쓰지 않음)
  function reload(keepUi) { if (!S.client) return Promise.resolve(); return loadClient(S.client.id, !!keepUi); }

  function tabsFor() { return S.user.role === 'planner' ? FP.Planner.TABS : FP.Client.TABS; }
  function renderTabs() {
    var unread = S.x ? S.x.notifications.filter(function (n) { return !n.readAt; }).length : 0;
    $('tabs').innerHTML = tabsFor().map(function (t) { return '<button role="tab" type="button" class="tab" id="tab-' + t[0] + '" data-tab="' + t[0] + '" aria-selected="' + (S.ui.tab === t[0]) + '" tabindex="' + (S.ui.tab === t[0] ? 0 : -1) + '">' + t[1] + (t[0] === 'inbox' && unread ? ' <span class="tab-count" aria-label="읽지 않은 알림 ' + unread + '개">' + unread + '</span>' : '') + '</button>'; }).join('');
  }
  function render() {
    var f = doc.activeElement, fid = f && f.id, sel = null; try { sel = f && f.selectionStart; } catch (e) { sel = null; }
    var V = S.user.role === 'planner' ? FP.Planner : FP.Client;
    try { $('main').innerHTML = updatesNote() + V[S.ui.tab](S); }
    catch (e) { console.error(e); $('main').innerHTML = '<section class="card"><p class="is-bad">화면을 그리는 중 오류가 발생했습니다: ' + U.esc(e.message) + '</p></section>'; }
    if (S.ui.tab === 'path') FP.Planner.drawPath(S);
    if (S.ui.tab === 'path' && S.user.role === 'client') FP.Client.drawPlan(S);
    var tw = doc.querySelector('.tabs-wrap'); if (tw) doc.documentElement.style.setProperty('--tabs-h', tw.offsetHeight + 'px');
    if (FP.Features && FP.Features.afterRender) FP.Features.afterRender(S);
    if (fid) { var g = $(fid); if (g && g !== f) { g.focus(); try { if (sel !== null) g.setSelectionRange(sel, sel); } catch (e) { /* 무시 */ } } }
  }
  // 설계사: 고객이 저장한 변경(서버 저장 확인 후 실시간 전달) 요약
  function updatesNote() {
    var u = S.user.role === 'planner' && S.ui.updates;
    if (!u || !u.length) return '';
    return '<section class="card update-note" role="status"><div class="card-head wrap"><h2>고객 정보가 업데이트되었습니다</h2><button type="button" class="btn btn-small btn-secondary" data-action="dismissUpdates">확인</button></div><ul class="plain-list small">' + u.map(function (x) {
      return '<li><span class="muted">' + FP.Sync.time(x.at) + '</span> ' + U.esc(x.text || '') + (x.items && x.items.length ? ' — ' + x.items.map(function (it) { return '<strong>' + U.esc(it.label) + '</strong> ' + U.esc(it.from ? it.from + ' → ' : '') + U.esc(it.to); }).join(', ') : '') + '</li>';
    }).join('') + '</ul><p class="muted small">분석 결과는 최신 정보로 다시 계산되어 표시됩니다. 실행 기준 계획은 설계사가 새 안을 제시하고 고객이 선택해야 바뀝니다.</p></section>';
  }

  // 실시간 변경 받기
  FP.Sync.on(function (m) {
    if (!S.user) return;
    if (m.type === 'revoked') { if (m.data.all) { U.toast('로그인이 만료되었습니다. 다시 로그인해 주세요.', true); FP.Sync.stop(); S.user = null; show('loginView'); return; } U.toast('이 고객에 대한 접근 권한이 해제되었습니다.', true); return refreshClients(); }
    if (m.type === 'assigned') { U.toast('새 고객이 배정되었습니다.'); return refreshClients(); }
    var ev = m.data; if (!S.client) return;
    if (ev.clientId !== S.client.id) { if (S.user.role === 'planner') { var c = S.clients.filter(function (x) { return x.id === ev.clientId; })[0]; if (c && ev.actorRole === 'client') U.toast(c.profile.name + ' 고객 정보가 업데이트되었습니다.'); } return; }
    var own = ev.entity === 'client_data' && S.ui.ownVersion === ev.version;
    var sum = (ev.items || []).slice(0, 3).map(function (it) { return it.label + ' ' + it.to; }).join(', ');
    if (S.user.role === 'planner' && ev.actorRole === 'client') {
      S.ui.updates = [{ at: ev.at, text: ev.text, items: ev.items, entity: ev.entity }].concat(S.ui.updates || []).slice(0, 6);
      if (S.ui.draft && ev.entity === 'client_data') S.ui.basisChanged = (S.ui.basisChanged || []).concat(ev.items || []);
      U.toast('고객 정보가 업데이트되었습니다' + (sum ? ': ' + sum : ''));
      render(); // 변경 요약은 바로 표시, 분석 결과는 이어서 다시 불러와 갱신
    } else if (S.user.role === 'client' && ev.actorRole !== 'client') {
      if (ev.entity === 'offer' || ev.entity === 'strategy') U.toast('설계사가 새 제안을 보냈습니다. ‘A/B/C안·제안’에서 확인해 주세요.');
      else if (ev.entity === 'baseline') U.toast('실행 기준 계획이 바뀌었습니다: ' + (ev.text || ''));
      else if (ev.entity === 'evaluation') U.toast('새 알림이 있습니다: ' + (ev.text || ''));
    } else if (S.user.role === 'client' && ev.entity === 'client_data' && !own && S.ui.inp) {
      // 다른 기기에서 같은 항목을 저장함 → 이 화면의 저장 전 입력과 겹치면 표시(덮어쓰지 않음)
      (ev.items || []).forEach(function (it) { if (Object.prototype.hasOwnProperty.call(S.ui.inp.dirty, it.path) || S.ui.inp.lists[it.path] !== undefined) S.ui.inp.conflicts[it.path] = { path: it.path, label: it.label, current: it.to }; });
      U.toast('다른 기기에서 내 정보가 저장되었습니다' + (sum ? ': ' + sum : ''));
    }
    if (!own) FP.Sync.reloadSoon();
  });

  function setTab(t) { S.ui.tab = t; try { history.replaceState(null, '', '#' + t); } catch (e) { /* 무시 */ } renderTabs(); render(); root.scrollTo(0, 0); }

  // ---------- 이벤트 ----------
  $('clientSel').addEventListener('change', function (e) { loadClient(e.target.value); });
  $('tabs').addEventListener('keydown', function (e) {
    var ts = tabsFor().map(function (t) { return t[0]; }), i = ts.indexOf(S.ui.tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { setTab(ts[(i + (e.key === 'ArrowRight' ? 1 : ts.length - 1)) % ts.length]); $('tab-' + S.ui.tab).focus(); }
  });

  doc.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t || !S.user) return;
    var ds = t.dataset;
    if (ds.tab) return setTab(ds.tab);
    if (ds.shockplan) { S.ui.shockPlan = ds.shockplan; return render(); }
    if (ds.verify) { S.ui.verifyPlan = ds.verify; return render(); }
    if (ds.addshock) { var ty = A.SHOCK_TYPES.filter(function (x) { return x.type === ds.addshock; })[0]; S.ui.shocks.push(Object.assign({ type: ty.type }, ty.def)); return render(); }
    if (ds.delshock !== undefined) { S.ui.shocks.splice(Number(ds.delshock), 1); return render(); }
    if (ds.edit) { var p = S.plans.filter(function (x) { return x.id === Number(ds.edit); })[0]; S.ui.basisChanged = null; S.ui.draft = { data: JSON.parse(JSON.stringify(p.data)), kind: p.kind === 'before' ? 'before' : 'after', fromLabel: FP.Planner.vLabel(p), label: '', note: '', dataVersion: S.cd ? S.cd.version : null }; render(); var dr = doc.querySelector('.draft'); if (dr) dr.scrollIntoView(); return; }
    if (ds.addlist) { var d = S.ui.draft.data; d[ds.addlist] = d[ds.addlist] || []; d[ds.addlist].push(PF.LISTS[ds.addlist].blank()); return render(); }
    if (ds.dellist) { S.ui.draft.data[ds.dellist].splice(Number(ds.idx), 1); return render(); }
    if (ds.txconfirm) return confirmTx(ds.txconfirm, false);
    switch (ds.action) {
      case 'saveDraft': return saveDraft();
      case 'dismissUpdates': S.ui.updates = null; return render();
      case 'loadHistory': S.ui.historyOpen = true; return U.api('GET', '/api/clients/' + S.client.id + '/history').then(function (h) { S.ui.history = h.history; render(); }, err);
      case 'draftFromClient': { var bp = FP.Client.myPlan(S); S.ui.basisChanged = null; S.ui.draft = { data: FP.ClientData.applyToPlan(bp.data, S.cd.data, { kind: bp.kind }), kind: 'after', fromLabel: FP.Planner.vLabel(bp) + ' + 고객 정보 v' + S.cd.version, label: '고객 최신 정보 반영', note: '고객 정보 v' + S.cd.version + ' 반영', dataVersion: S.cd.version }; return setTab('edit'); }
      case 'rebaseDraft': return U.api('GET', '/api/clients/' + S.client.id + '/data').then(function (cd) { S.cd = cd; var dd = S.ui.draft; dd.data = FP.ClientData.applyToPlan(dd.data, cd.data, { kind: dd.kind }); dd.dataVersion = cd.version; S.ui.basisChanged = null; U.toast('고객 최신 정보(v' + cd.version + ')로 다시 계산했습니다. 직접 바꾼 다른 값은 그대로입니다.'); render(); }, err);
      case 'keepDraft': S.ui.basisChanged = null; return render();
      case 'cancelDraft': S.ui.draft = null; return render();
      case 'applyCut': return applyCut();
      case 'csv': { var ok = U.download('계산표-' + S.client.profile.name + '-' + (S.ui.verifyPlan === 'before' ? '설계전' : '설계후') + '.csv', FP.Planner.csv(S), 'text/csv;charset=utf-8'); if (ok) return U.toast('CSV를 내려받았습니다.');
        var csvText = FP.Planner.csv(S).replace(/^\uFEFF/, '');
        return U.dialog({ title: 'CSV 내용', body: '<p class="small">이 화면에서는 파일 내려받기가 막혀 있습니다. 아래 내용을 복사해 엑셀·시트에 붙여넣으세요.</p><textarea class="csv-box" id="csvBox" readonly rows="10">' + U.esc(csvText) + '</textarea>', actions: [{ text: '닫기' }, { text: '복사', cls: 'btn-primary', keep: true, onClick: function () { var t = $('csvBox'); t.select(); (navigator.clipboard ? navigator.clipboard.writeText(csvText) : Promise.reject()).then(function () { U.toast('복사했습니다.'); }, function () { U.toast('선택된 내용을 직접 복사해 주세요.'); }); } }] }); }
      case 'saveRecord': return saveRecord();
      case 'saveSettings': return saveSettings();
      case 'importCsv': return importCsv();
      case 'demoSync': return U.api('POST', '/api/clients/' + S.client.id + '/transactions/sync', { month: $('demoMonth').value }).then(function (r) { U.toast('시연용 거래 ' + r.added + '건을 불러왔습니다(중복 ' + r.duplicates + '건 제외).'); return reload(); }, err);
      case 'addAccount': return U.api('POST', '/api/clients/' + S.client.id + '/accounts', { label: $('accLabel').value, number: $('accNo').value, purpose: $('accPurpose').value }).then(function () { U.toast('계좌를 등록했습니다(끝 4자리만 저장).'); return reload(); }, err);
    }
  });

  doc.addEventListener('input', function (e) {
    var t = e.target; if (!S.user) return;
    if (t.dataset.shock !== undefined) {
      var s = S.ui.shocks[Number(t.dataset.shock)], k = t.dataset.key, base = FP.Planner.plans(S).after.data.basis.baseMonth;
      var ty = A.SHOCK_TYPES.filter(function (x) { return x.type === s.type; })[0];
      if (k === 'start') { if (C.ymValid(t.value)) s.start = Math.max(0, C.ymDiff(base, t.value)); }
      else { var v = Number(t.value); if (!isFinite(v)) return; s[k] = k === 'size' && ty.unit.indexOf('원') === 0 ? v * 10000 : v; }
      return render();
    }
    if (t.dataset.ui) {
      var key = t.dataset.ui;
      if (key === 'cutMinEss') { var n = Number(t.value.replace(/,/g, '')); if (!isFinite(n)) return; S.ui.cutMinEss = n * 10000; }
      else if (key === 'customRaise') { S.ui.customRaise = t.value === '' ? undefined : Number(t.value); if (t.value !== '' && !isFinite(S.ui.customRaise)) return; }
      else if (key === 'sandbox') { S.ui.sandbox = t.value.replace(/,/g, ''); }
      else S.ui[key] = t.value;
      S.ui.cutApplied = key.indexOf('cut') === 0 ? null : S.ui.cutApplied;
      return render();
    }
    if (t.dataset.pf) return draftInput(t);
  });
  doc.addEventListener('change', function (e) {
    var t = e.target; if (!S.user) return;
    if (t.dataset.select) { S.ui[t.dataset.select] = Number(t.value); return render(); }
    if (t.dataset.toggle) { S.ui[t.dataset.toggle] = t.checked; return render(); }
    if (t.dataset.pf && (t.type === 'checkbox' || t.tagName === 'SELECT')) return draftInput(t);
    if (t.id === 'draftKind') S.ui.draft.kind = t.value;
    if (t.id === 'draftLabel') S.ui.draft.label = t.value;
    if (t.id === 'draftNote') S.ui.draft.note = t.value;
    if (t.id === 'csvFile' && t.files[0]) { var rd = new FileReader(); rd.onload = function () { $('csvText').value = String(rd.result); }; rd.readAsText(t.files[0], 'utf-8'); }
  });

  // 계획 초안 입력 — 원본 버전은 바뀌지 않음
  function draftInput(t) {
    var path = t.dataset.pf, type = t.dataset.type, errEl = t.closest('.field') && t.closest('.field').querySelector('.field-error');
    var v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.tagName === 'SELECT') v = t.value;
    else if (type === 'ym') { if (t.value && !C.ymValid(t.value)) return showErr(errEl, 'YYYY-MM 형식'); v = t.value || null; }
    else if (type === 'text') v = t.value;
    else {
      var s = t.value.replace(/[,\s]/g, '');
      if (s === '') v = 0;
      else { var n = Number(s); if (!isFinite(n)) return showErr(errEl, '숫자만 입력해 주세요.'); if (t.dataset.min !== undefined && n < Number(t.dataset.min)) return showErr(errEl, t.dataset.min + ' 이상'); if (t.dataset.max !== undefined && n > Number(t.dataset.max)) return showErr(errEl, t.dataset.max + ' 이하'); if (n < 0 && type === 'money') return showErr(errEl, '0 이상으로 입력해 주세요.'); v = type === 'money' ? Math.round(n * 10000) : n; }
    }
    showErr(errEl, null);
    if (path.indexOf('income.promotion.') === 0 && !S.ui.draft.data.income.promotion) S.ui.draft.data.income.promotion = { month: null, pct: 0, stack: false };
    PF.set(S.ui.draft.data, path, v);
    // 미리보기만 갱신(입력 중 양식을 다시 그리지 않음)
    try { var res = C.simulate(S.ui.draft.data), vd = A.verdict(res); $('draftPreview').innerHTML = U.pill(vd.status, vd.label) + ' 목표일 ' + res.at.ym + ' · 주거자금 ' + (res.gap >= 0 ? '여유 ' : '부족 ') + F.abs(res.gap) + ' · 부채 완료 ' + F.ym(S.ui.draft.data.basis.baseMonth, res.debtFree); }
    catch (x) { $('draftPreview').textContent = '입력을 확인해 주세요: ' + x.message; }
  }
  function showErr(el, msg) { if (!el) return; el.hidden = !msg; el.textContent = msg || ''; }

  function saveDraft() {
    var d = S.ui.draft, out = $('draftError');
    d.label = $('draftLabel').value; d.note = $('draftNote').value; d.kind = $('draftKind').value;
    var send = function (ack) {
      return U.api('POST', '/api/clients/' + S.client.id + '/plans', { kind: d.kind, label: d.label || '수정안', note: d.note, data: d.data, dataVersion: d.dataVersion, acknowledgeStale: ack })
        .then(function (r) { U.toast((d.kind === 'before' ? '설계 전' : '설계 후') + ' v' + r.version + '(설계사 초안)로 저장했습니다. 고객에게 보이려면 ‘고객에게 제시’를 누르세요.'); S.ui.draft = null; S.ui.basisChanged = null; return reload(); })
        .catch(function (x) {
          if (x.code === 'staleBasis') return U.dialog({ title: '분석 기준 정보가 변경되었습니다', body: '<p>이 초안을 만든 뒤 고객이 정보를 저장했습니다. 조용히 덮어쓰지 않도록 확인을 받습니다.</p><ul class="plain-list small">' + (x.body.items || []).map(function (it) { return '<li>' + U.esc(it.label) + ': ' + U.esc(it.from || '') + ' → ' + U.esc(it.to) + '</li>'; }).join('') + '</ul>', actions: [{ text: '최신 정보로 다시 계산', cls: 'btn-primary', onClick: function () { d.data = FP.ClientData.applyToPlan(d.data, S.cd.data, { kind: d.kind }); d.dataVersion = S.cd.version; S.ui.basisChanged = null; render(); U.toast('다시 계산했습니다. 확인 후 저장해 주세요.'); } }, { text: '확인했고 그대로 저장', onClick: function () { send(true); } }, { text: '취소' }] });
          out.textContent = x.message; out.hidden = false;
        });
    };
    send(false);
  }

  function applyCut() {
    var p = FP.Planner.plans(S), d = p.after.data, base = d.basis.baseMonth;
    var startYm = S.ui.cutStart || C.ymAdd(base, Math.max(1, C.ymDiff(base, S.todayYm)));
    var minEss = S.ui.cutMinEss !== undefined ? S.ui.cutMinEss : (d.expenses.minEssential || d.expenses.essential);
    var rc = A.reverseCut(d, { start: C.ymDiff(base, startYm), minEssential: minEss });
    if (!rc.feasible || !rc.required) return U.toast('적용할 역산 결과가 없습니다.', true);
    var nd = A.applyCut(d, rc), before = C.simulate(d), after = C.simulate(nd);
    if (after.status !== 'achieved') return U.toast('적용 후 확인에서 목표를 충족하지 못해 저장하지 않았습니다.', true);
    U.api('POST', '/api/clients/' + S.client.id + '/plans', { kind: 'after', label: '역산 적용안', note: rc.startYm + '부터 월 ' + F.money(rc.required) + ' 생활비 절감(원본 ' + FP.Planner.vLabel(p.after) + ')', data: nd })
      .then(function (r) {
        var row = function (l, a, b) { return '<tr><th scope="row">' + l + '</th><td>' + a + '</td><td>' + b + '</td></tr>'; };
        S.ui.cutApplied = '<p>새 수정안 <span class="plan-tag after">설계 후 v' + r.version + '</span>을 저장했습니다. 원본 v' + p.after.version + '은 그대로 있습니다.</p><div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">항목</th><th scope="col">적용 전 v' + p.after.version + '</th><th scope="col">적용 후 v' + r.version + '</th></tr></thead><tbody>' +
          row('판정', U.statusText(before.status), U.statusText(after.status)) + row('주거자금 부족·여유', (before.gap >= 0 ? '여유 ' : '부족 ') + F.abs(before.gap), (after.gap >= 0 ? '여유 ' : '부족 ') + F.abs(after.gap)) +
          row('부채 상환 완료', F.ym(base, before.debtFree), F.ym(base, after.debtFree)) + row('목표일 비상금', F.money(before.at.emergencyBal), F.money(after.at.emergencyBal)) + '</tbody></table></div>';
        var keep = S.ui.cutApplied;
        return reload().then(function () { S.ui.cutApplied = keep; S.ui.afterId = r.id; render(); U.toast('역산 결과를 새 수정안으로 저장했습니다.'); });
      }, err);
  }

  function saveRecord() {
    var m = $('recMonth').value, c = $('recCat').value, raw = $('recAmt').value.replace(/[,\s]/g, ''), e = $('recErr');
    var n = Number(raw);
    if (!C.ymValid(m)) { e.textContent = '월을 선택해 주세요.'; e.hidden = false; return; }
    if (raw === '' || !isFinite(n) || n < 0) { e.textContent = '0 이상의 금액(만원)을 입력해 주세요.'; e.hidden = false; return; }
    e.hidden = true;
    U.api('POST', '/api/clients/' + S.client.id + '/records', { month: m, category: c, amount: Math.round(n * 10000) }).then(function () { U.toast('실제 납입 기록을 저장했습니다. 같은 달·항목의 이전 기록은 대체되었습니다.'); return reload(); }, err);
  }
  function saveSettings() {
    var s = {}; doc.querySelectorAll('[data-set]').forEach(function (i) { s[i.dataset.set] = Number(i.value); });
    U.api('PUT', '/api/clients/' + S.client.id + '/settings', { settings: s }).then(function () { U.toast('경보 기준을 저장했습니다.'); return reload(); }, function (x) { $('setErr').textContent = x.message; $('setErr').hidden = false; });
  }
  function importCsv() {
    var text = $('csvText').value; if (!text.trim()) return U.toast('CSV 파일을 고르거나 내용을 붙여넣어 주세요.', true);
    U.api('POST', '/api/clients/' + S.client.id + '/transactions/import', { csv: text }).then(function (r) { U.toast(r.added + '건 가져옴, 중복 ' + r.duplicates + '건 제외' + (r.errors.length ? ', 읽지 못한 줄 ' + r.errors.length + '개' : '')); return reload(); }, err);
  }
  function confirmTx(id, replace) {
    var sel = doc.querySelector('[data-txsel="' + id + '"]'); var cls = sel && sel.value;
    if (!cls) return U.toast('분류를 선택해 주세요.', true);
    U.api('POST', '/api/clients/' + S.client.id + '/transactions/' + id + '/confirm', { classification: cls, replaceManual: replace }).then(function () { U.toast('거래를 확인했습니다.'); return reload(); }, function (x) {
      if (x.code === 'manualExists') return U.dialog({ title: '직접 입력한 기록이 있습니다', body: '<p>' + U.esc(x.message) + '</p><p class="muted small">대체하면 직접 입력 기록은 취소 표시되고 이 거래 금액이 실적이 됩니다(중복 반영 방지).</p>', actions: [{ text: '취소' }, { text: '거래로 대체', cls: 'btn-primary', onClick: function () { var s2 = doc.querySelector('[data-txsel="' + id + '"]'); if (s2) s2.value = cls; confirmTx(id, true); } }] });
      err(x);
    });
  }

  // ---------- 시작 ----------
  FP.Install.onChange(function (s) { $('updateBanner').hidden = !s.updateReady; });
  $('updateBtn').addEventListener('click', function () { FP.Install.applyUpdate(); });
  $('installBtn').addEventListener('click', function () {
    var s = FP.Install.state(), G = FP.Install.GUIDE, names = { ios: '아이폰·아이패드', android: '안드로이드', desktop: '데스크톱' };
    var order = [s.platform].concat(['ios', 'android', 'desktop'].filter(function (p) { return p !== s.platform; }));
    U.dialog({ title: '앱 설치 안내', body: (s.standalone ? '<p class="banner banner-ok">설치된 앱으로 실행 중입니다.</p>' : '') + (!s.swSupported ? '<p class="banner banner-warn">https 주소(또는 localhost)에서만 설치할 수 있습니다.</p>' : '') + order.map(function (p, i) { return '<details' + (i ? '' : ' open') + '><summary>' + names[p] + '</summary><ol class="rule-list">' + G[p].map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ol></details>'; }).join('') + '<p class="muted small">설치해도 데이터는 서버에 있고 로그인해야 볼 수 있습니다. 오프라인일 때는 화면만 열리고 데이터는 불러오지 않습니다.</p>', actions: [{ text: '닫기' }].concat(s.canPrompt ? [{ text: '지금 설치', cls: 'btn-primary', onClick: function () { FP.Install.prompt(); } }] : []) });
  });
  root.addEventListener('resize', function () { clearTimeout(root.__rt); root.__rt = setTimeout(function () { if (S.user && (S.ui.tab === 'path' || S.ui.tab === 'plan')) render(); }, 200); });

  FP.Install.init();
  start().catch(function (e) { if (e.status === 401) show('loginView'); else { show('loginView'); $('loginErr').textContent = e.message; $('loginErr').hidden = false; } });
  FP.App = { S: S };
})(this);
