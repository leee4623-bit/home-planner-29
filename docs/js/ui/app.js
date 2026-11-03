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
  $('logoutBtn').addEventListener('click', function () { U.api('POST', '/api/logout').then(function () { location.hash = ''; location.reload(); }, err); });

  function start() {
    return U.api('GET', '/api/me').then(function (m) {
      S.user = m.user; show('appView');
      $('who').textContent = m.user.name + ' · ' + (m.user.role === 'planner' ? '설계사' : '고객');
      return U.api('GET', '/api/clients');
    }).then(function (r) {
      S.clients = r.clients;
      var sel = $('clientSel');
      sel.hidden = S.user.role !== 'planner';
      sel.innerHTML = S.clients.map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.profile.name) + '</option>'; }).join('');
      if (!S.clients.length) { $('main').innerHTML = '<section class="card"><p>배정된 고객이 없습니다. 고객이 설계사에게 조회 권한을 부여해야 합니다.</p></section>'; return; }
      return loadClient(S.clients[0].id);
    });
  }

  function loadClient(id) {
    S.client = S.clients.filter(function (c) { return c.id === Number(id); })[0];
    var base = '/api/clients/' + S.client.id;
    return Promise.all([U.api('GET', base + '/plans'), U.api('GET', base + '/records'), U.api('GET', base + '/settings'), U.api('GET', base + '/transactions'), U.api('GET', base + '/accounts'), U.api('GET', base + '/extra')]).then(function (r) {
      S.x = r[5];
      S.plans = r[0].plans; S.records = r[1].records.filter(function (x) { return !x.voidedAt; }).map(function (x) { x.status = 'confirmed'; return x; }); S.allRecords = r[1].records;
      S.settings = r[2].settings; S.txs = r[3].transactions; S.sync = r[3].sync; S.accounts = r[4].accounts;
      S.ui.draft = null; S.ui.cutApplied = null;
      if (FP.Features) FP.Features.onLoad(S);
      var tabs = tabsFor(); var h = location.hash.slice(1);
      S.ui.tab = tabs.some(function (t) { return t[0] === h; }) ? h : (S.ui.tab && tabs.some(function (t) { return t[0] === S.ui.tab; }) ? S.ui.tab : tabs[0][0]);
      renderTabs(); render();
    }).catch(err);
  }
  FP.reload = function () { return reload(true); };
  FP.rerender = function () { renderTabs(); render(); };
  function reload(keepUi) { var ui = S.ui; return loadClient(S.client.id).then(function () { if (keepUi) { S.ui.draft = ui.draft; S.ui.cutApplied = ui.cutApplied; render(); } }); }

  function tabsFor() { return S.user.role === 'planner' ? FP.Planner.TABS : FP.Client.TABS; }
  function renderTabs() {
    var unread = S.x ? S.x.notifications.filter(function (n) { return !n.readAt; }).length : 0;
    $('tabs').innerHTML = tabsFor().map(function (t) { return '<button role="tab" type="button" class="tab" id="tab-' + t[0] + '" data-tab="' + t[0] + '" aria-selected="' + (S.ui.tab === t[0]) + '" tabindex="' + (S.ui.tab === t[0] ? 0 : -1) + '">' + t[1] + (t[0] === 'inbox' && unread ? ' <span class="tab-count" aria-label="읽지 않은 알림 ' + unread + '개">' + unread + '</span>' : '') + '</button>'; }).join('');
  }
  function render() {
    var f = doc.activeElement, fid = f && f.id, sel = null; try { sel = f && f.selectionStart; } catch (e) { sel = null; }
    var V = S.user.role === 'planner' ? FP.Planner : FP.Client;
    try { $('main').innerHTML = V[S.ui.tab](S); }
    catch (e) { console.error(e); $('main').innerHTML = '<section class="card"><p class="is-bad">화면을 그리는 중 오류가 발생했습니다: ' + U.esc(e.message) + '</p></section>'; }
    if (S.ui.tab === 'path') FP.Planner.drawPath(S);
    if (S.ui.tab === 'plan' && S.user.role === 'client') FP.Client.drawPlan(S);
    if (FP.Features && FP.Features.afterRender) FP.Features.afterRender(S);
    if (fid) { var g = $(fid); if (g && g !== f) { g.focus(); try { if (sel !== null) g.setSelectionRange(sel, sel); } catch (e) { /* 무시 */ } } }
  }
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
    if (ds.edit) { var p = S.plans.filter(function (x) { return x.id === Number(ds.edit); })[0]; S.ui.draft = { data: JSON.parse(JSON.stringify(p.data)), kind: p.kind === 'before' ? 'before' : 'after', fromLabel: FP.Planner.vLabel(p), label: '', note: '' }; render(); var dr = doc.querySelector('.draft'); if (dr) dr.scrollIntoView(); return; }
    if (ds.addlist) { var d = S.ui.draft.data; d[ds.addlist] = d[ds.addlist] || []; d[ds.addlist].push(PF.LISTS[ds.addlist].blank()); return render(); }
    if (ds.dellist) { S.ui.draft.data[ds.dellist].splice(Number(ds.idx), 1); return render(); }
    if (ds.txconfirm) return confirmTx(ds.txconfirm, false);
    switch (ds.action) {
      case 'saveDraft': return saveDraft();
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
    U.api('POST', '/api/clients/' + S.client.id + '/plans', { kind: d.kind, label: d.label || '수정안', note: d.note, data: d.data })
      .then(function (r) { U.toast((d.kind === 'before' ? '설계 전' : '설계 후') + ' v' + r.version + '로 저장했습니다. 이전 버전은 그대로 남아 있습니다.'); S.ui.draft = null; return reload(); })
      .catch(function (x) { out.textContent = x.message; out.hidden = false; });
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
