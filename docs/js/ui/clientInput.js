/*
 * 고객 ‘내 정보·실적 입력’ (한 페이지) + 설계사 ‘고객 정보’(조회·변경 이력)
 * ------------------------------------------------------------
 * - 저장된 값을 불러오고, 바꾼 항목만 저장합니다(PATCH, 불러온 버전 baseVersion 포함).
 * - 빈칸 = 미입력(null), 0 = 실제 0원. 화면과 서버 모두 둘을 구분합니다.
 * - 입력 중인 값(저장 전)은 이 화면에만 있고, 확정 실적·다른 기기로 보내지지 않습니다.
 * - 다른 기기에서 같은 항목을 먼저 저장했다면 서버가 409로 알려 주고, 고객이 고르기 전에는 덮어쓰지 않습니다.
 */
(function (root) {
  'use strict';
  var FP = root.FP, U = FP.UI, F = U.F, esc = U.esc, CD = FP.ClientData, C = FP.Calc, doc = root.document;
  var SECS = [['basic', '기본정보·주거목표'], ['income', '소득·월 생활비'], ['asset', '자산·부채·비상금'], ['product', '정책상품 가입 현황'], ['risk', '위험성향 설문'], ['month', '이번 달 실제 지출·상환·저축 기록']];
  var HELP = {
    'goal.housingTarget': '새 집 보증금 중 대출 없이 마련할 금액', 'income.netMonthly': '세금·4대보험을 뗀 통장 입금액', 'expenses.essential': '월세·관리비·통신·식비 등 꼭 나가는 돈',
    'expenses.optional': '외식·쇼핑·경조사 등(월 평균)', 'assets.cash': '용도를 정하지 않은 현금·예금', 'assets.deposit': '지금 집에서 돌려받을 보증금', 'profile.annualGross': '정책상품 소득 요건 확인용(원천징수영수증 기준)'
  };

  function ist(S) {
    if (!S.ui.inp) S.ui.inp = { dirty: {}, lists: {}, sec: {}, open: {}, rec: {}, recMonth: null, conflicts: {} };
    return S.ui.inp;
  }
  function serverVal(S, path) { var d = (S.cd && S.cd.data) || {}; var v = CD.LISTS[path] ? d[path] : CD.get(d, path); return v === undefined ? null : v; }
  function curVal(S, path) { var I = ist(S); if (CD.LISTS[path]) return I.lists[path] !== undefined ? I.lists[path] : (serverVal(S, path) || []); return Object.prototype.hasOwnProperty.call(I.dirty, path) ? I.dirty[path] : serverVal(S, path); }
  function dirtyIn(S, sec) {
    var I = ist(S), n = 0;
    CD.FIELDS.forEach(function (f) { if (f.sec === sec && Object.prototype.hasOwnProperty.call(I.dirty, f.path)) n++; });
    Object.keys(CD.LISTS).forEach(function (k) { if (CD.LISTS[k].sec === sec && I.lists[k] !== undefined && JSON.stringify(I.lists[k]) !== JSON.stringify(serverVal(S, k) || [])) n++; });
    if (sec === 'month') n += Object.keys(I.rec).length;
    return n;
  }
  function showMoney(v) { return v === null || v === undefined ? '' : String(Math.round(v / 100) / 100); }

  function fieldInput(S, f) {
    var v = curVal(S, f.path), id = 'cd-' + f.path.replace(/\./g, '_'), I = ist(S);
    var dirty = Object.prototype.hasOwnProperty.call(I.dirty, f.path), conflict = I.conflicts[f.path];
    var state = conflict ? '<span class="chip chip-bad">다른 기기에서 먼저 저장됨: ' + esc(conflict.current) + '</span>' : dirty ? '<span class="chip chip-warn">변경됨 · 저장 전</span>' : (v === null ? '<span class="chip">미입력</span>' : (f.type === 'money' && v === 0 ? '<span class="chip chip-ok">0원(입력함)</span>' : ''));
    var input;
    if (f.type === 'select') input = '<select id="' + id + '" data-cd="' + f.path + '"><option value=""' + (v === null ? ' selected' : '') + '>미입력</option>' + f.options.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    else if (f.type === 'ym') input = '<input id="' + id + '" type="month" data-cd="' + f.path + '" value="' + esc(v || '') + '">';
    else if (f.type === 'text') input = '<input id="' + id + '" type="text" maxlength="60" data-cd="' + f.path + '" value="' + esc(v || '') + '" placeholder="미입력">';
    else input = '<div class="input-wrap"><input id="' + id + '" type="text" inputmode="decimal" data-cd="' + f.path + '" data-type="money" value="' + esc(showMoney(v)) + '" placeholder="미입력"><span class="unit">만원</span></div>';
    return '<div class="field' + (dirty ? ' is-dirty' : '') + '"><label for="' + id + '">' + esc(f.label) + '</label>' + input + (HELP[f.path] ? '<p class="help">' + esc(HELP[f.path]) + '</p>' : '') + '<p class="field-state" data-state-for="' + f.path + '">' + state + '</p><p class="field-error" hidden></p></div>';
  }
  function listInput(S, key) {
    var L = CD.LISTS[key], arr = curVal(S, key) || [];
    var html = '<fieldset class="group"><legend>' + esc(L.label) + ' <span class="muted small">(' + arr.length + '건)</span></legend>';
    html += arr.map(function (row, i) {
      return '<div class="list-row"><div class="field-grid">' + L.fields.map(function (fd) {
        var k = fd[0], label = fd[1], type = fd[2], opts = fd[3], v = row[k], id = 'cdl-' + key + '-' + i + '-' + k;
        var inp = type === 'select' ? '<select id="' + id + '" data-cdl="' + key + '.' + i + '.' + k + '"><option value="">미입력</option>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'
          : type === 'ym' ? '<input id="' + id + '" type="month" data-cdl="' + key + '.' + i + '.' + k + '" value="' + esc(v || '') + '">'
            : type === 'text' ? '<input id="' + id + '" type="text" maxlength="60" data-cdl="' + key + '.' + i + '.' + k + '" value="' + esc(v || '') + '" placeholder="미입력">'
              : '<div class="input-wrap"><input id="' + id + '" type="text" inputmode="decimal" data-cdl="' + key + '.' + i + '.' + k + '" data-type="' + type + '" value="' + esc(type === 'money' ? showMoney(v) : v === null || v === undefined ? '' : v) + '" placeholder="미입력"><span class="unit">' + (type === 'money' ? '만원' : type === 'pct' ? '%' : '개월') + '</span></div>';
        return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' + inp + '<p class="field-error" hidden></p></div>';
      }).join('') + '</div><button type="button" class="btn btn-small btn-danger-ghost" data-cdfx="delRow" data-key="' + key + '" data-i="' + i + '">삭제</button></div>';
    }).join('') + '<button type="button" class="btn btn-small btn-secondary" data-cdfx="addRow" data-key="' + key + '">+ ' + esc(L.label) + ' 추가</button>';
    if (key === 'products') html += '<p class="help">실제로 가입해 납입 중인 상품만 적어 주세요. 가입 예정·검토 중인 상품은 ‘상품 비교’에서 계획에 반영해볼 수 있습니다.</p>';
    return html + '</fieldset>';
  }

  function secStatus(S, sec) {
    var I = ist(S), s = I.sec[sec] || {}, n = dirtyIn(S, sec);
    var t = s.state === 'saving' ? U.pill('info', '저장 중…') : s.state === 'error' ? U.pill('bad', '저장 실패') : n ? U.pill('check', '저장 안 된 변경 ' + n + '개') : s.state === 'saved' ? U.pill('ok', '저장됨 ' + FP.Sync.time(s.at)) : U.pill('info', '변경 없음');
    return '<span class="sec-status" id="secst-' + sec + '">' + t + '</span>';
  }
  function secErr(S, sec) {
    var s = ist(S).sec[sec] || {};
    if (s.state !== 'error') return '';
    return '<div class="banner banner-bad sec-error"><p>' + esc(s.msg) + '</p>' + (s.conflicts && s.conflicts.length ? '<ul class="plain-list small">' + s.conflicts.map(function (c) { return '<li><strong>' + esc(c.label) + '</strong>: 다른 기기 저장값 ' + esc(c.current) + ' / 내가 입력한 값 ' + esc(c.mine) + '</li>'; }).join('') + '</ul><div class="btn-row"><button type="button" class="btn btn-small btn-secondary" data-cdfx="takeServer" data-sec="' + sec + '">최신 값으로 바꾸기</button><button type="button" class="btn btn-small" data-cdfx="keepMine" data-sec="' + sec + '">확인했고 내 값으로 저장</button></div>' : '') + '</div>';
  }
  function section(S, sec, title, body, opts) {
    var I = ist(S), open = I.open[sec] !== false;
    return '<section class="card in-sec" id="sec-' + sec + '"><details' + (open ? ' open' : '') + ' data-sec="' + sec + '"><summary class="sec-sum"><h2>' + esc(title) + '</h2>' + (opts && opts.noStatus ? '' : secStatus(S, sec)) + '</summary>' + secErr(S, sec) + body +
      (opts && opts.noSave ? '' : '<div class="btn-row sec-actions"><button type="button" class="btn" data-cdfx="saveSec" data-sec="' + sec + '">이 구역 저장</button></div>') + '</details></section>';
  }

  // ---------- 이번 달 실적 ----------
  function monthOptions(S, d) {
    var out = [], base = d.basis.baseMonth;
    for (var t = 1; t <= 60; t++) { var ym = C.ymAdd(base, t); if (C.ymDiff(ym, S.todayYm) < 0) break; out.push(ym); }
    return out.reverse();
  }
  function cats(d) { return [['debt', '부채 상환(원리금 합계)'], ['emergency', '비상금 적립'], ['housing', '주거자금 저축']].concat((d.products || []).map(function (p) { return ['product:' + p.id, p.name + ' 납입']; })).concat([['expense:essential', '필수생활비 지출 합계'], ['expense:optional', '선택 지출 합계']]); }
  function monthSection(S) {
    var pl = FP.Client.myPlan(S); if (!pl) return '<p class="muted">실행 기준 계획이 아직 없어 실적 항목을 만들 수 없습니다.</p>';
    var d = pl.data, I = ist(S), months = monthOptions(S, d);
    var ym = I.recMonth && months.indexOf(I.recMonth) >= 0 ? I.recMonth : (months[0] || S.todayYm);
    var closed = (S.x.closures || []).some(function (c) { return c.month === ym; });
    var res = C.simulate(d), t = C.ymDiff(d.basis.baseMonth, ym), row = res.rows[t] || {};
    var planOf = function (cat) {
      if (cat === 'debt') return row.debtPaid; if (cat === 'emergency') return Math.max(0, row.emergencyIn || 0); if (cat === 'housing') return Math.max(0, (row.housingIn || 0) - (row.depositIn || 0) - (row.productPayout || 0));
      if (cat === 'expense:essential') return row.essential; if (cat === 'expense:optional') return row.optional;
      var p = (d.products || []).filter(function (x) { return 'product:' + x.id === cat; })[0]; return p && t >= C.ymDiff(d.basis.baseMonth, p.startMonth) ? p.monthly : 0;
    };
    var recOf = function (cat) { return S.records.filter(function (r) { return r.month === ym && r.category === cat; }).slice(-1)[0] || null; };
    var html = '<div class="rec-month"><div class="field-inline"><label for="recMonthSel">대상 월</label><select id="recMonthSel" data-cdrec="month">' + months.map(function (m) { return '<option value="' + m + '"' + (m === ym ? ' selected' : '') + '>' + F.ymKo(m) + (m === S.todayYm ? ' (이번 달)' : '') + '</option>'; }).join('') + '</select></div>' +
      '<p class="rec-target"><strong>' + F.ymKo(ym) + '</strong> 실적 ' + (closed ? U.pill('ok', '확정된 달 — 수정 불가') : ym === S.todayYm ? U.pill('check', '진행 중인 달 — 월말 확정 전까지 잠정') : U.pill('info', '확정 전')) + '</p>' +
      '<p class="help">금액은 그 달의 합계입니다. 같은 달·같은 항목을 다시 저장하면 이전 값을 대체합니다(두 번 더해지지 않음). 비워 두면 ‘기록 없음’으로 남고, 0을 넣으면 ‘0원 실행’으로 기록됩니다.</p></div>';
    html += '<div class="table-scroll"><table class="compare-table rec-table"><thead><tr><th scope="col">항목</th><th scope="col">계획</th><th scope="col">저장된 실적</th><th scope="col">입력(만원)</th></tr></thead><tbody>' + cats(d).map(function (c) {
      var r = recOf(c[0]), dv = I.rec[c[0]];
      var val = dv !== undefined ? dv : (r ? r.amount : null);
      return '<tr' + (dv !== undefined ? ' class="is-dirty"' : '') + '><th scope="row">' + esc(c[1]) + '</th><td>' + F.money(planOf(c[0]) || 0) + '</td><td>' + (r ? F.money(r.amount) + '<div class="muted small">' + ({ manual: '직접 입력', transaction: '거래 확인', 'import': '가져옴' }[r.source] || r.source) + '</div>' : '<span class="chip">기록 없음</span>') + '</td>' +
        '<td><div class="input-wrap"><input id="rec-' + c[0].replace(':', '_') + '" type="text" inputmode="decimal" data-cdrec="' + c[0] + '" value="' + esc(showMoney(val)) + '" placeholder="기록 없음"' + (closed ? ' disabled' : '') + ' aria-label="' + esc(c[1]) + ' ' + F.ymKo(ym) + ' 실적"><span class="unit">만원</span></div>' + (dv !== undefined ? '<span class="chip chip-warn">저장 전</span>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    html += '<p class="muted small">월중 기록은 ‘잠정’으로 표시되고, 달이 확정(월별 실행 화면에서 확정하거나 월말 자동 정산)된 뒤에만 목표 예측에 반영됩니다.</p>';
    return html;
  }

  // ---------- 페이지 ----------
  function inputPage(S) {
    var I = ist(S), cd = S.cd || { version: 0 };
    var nav = '<div class="sec-nav-wrap"><nav class="sec-nav" aria-label="구역 이동">' + SECS.map(function (s, i) { return '<a href="#sec-' + s[0] + '" data-cdnav="' + s[0] + '">' + (i + 1) + '. ' + s[1] + '</a>'; }).join('') + '</nav></div>';
    var total = SECS.reduce(function (n, s) { return n + dirtyIn(S, s[0]); }, 0);
    var head = '<section class="card in-head"><div class="card-head wrap"><h2>내 정보·실적 입력</h2><span class="muted small">저장된 정보 v' + cd.version + (cd.updatedAt ? ' · ' + F.date(cd.updatedAt) + ' ' + FP.Sync.time(cd.updatedAt) + (cd.updatedBy ? ' · ' + esc(cd.updatedBy) : '') : ' · 아직 저장한 정보 없음') + '</span></div>' +
      '<p class="small">한 페이지에서 모두 입력합니다. 이미 저장한 값은 불러와 있으니 <strong>바뀐 항목만 고치고 저장</strong>하세요. 빈칸은 ‘미입력’, 0은 ‘0원’으로 따로 저장됩니다. 저장이 끝난 값만 담당 설계사 화면에 전달됩니다.</p></section>' + nav;
    var html = head;
    var fieldsOf = function (sec) { return '<div class="field-grid">' + CD.FIELDS.filter(function (f) { return f.sec === sec; }).map(function (f) { return fieldInput(S, f); }).join('') + '</div>'; };
    html += section(S, 'basic', '1. 기본정보·주거목표', fieldsOf('basic'));
    html += section(S, 'income', '2. 소득·월 생활비', fieldsOf('income'));
    html += section(S, 'asset', '3. 자산·부채·비상금', fieldsOf('asset') + listInput(S, 'debts'));
    html += section(S, 'product', '4. 정책상품 가입 현황', listInput(S, 'products'));
    var app = (S.x.risk || []).filter(function (r) { return r.kind === 'app'; }).slice(-1)[0];
    html += section(S, 'risk', '5. 위험성향 설문', '<p class="small">저장된 결과: ' + (app ? '<strong>' + esc(app.type) + '</strong>(참고용) · ' + esc(app.diagnosedAt) : '없음') + ' — 설문은 10문항을 모두 답하고 ‘결과 확인·저장’을 눌러야 저장됩니다. 답하는 중인 내용은 저장되지 않습니다.</p>' + FP.Client.chat(S, { embedded: true }), { noSave: true, noStatus: true });
    html += section(S, 'month', '6. 이번 달 실제 지출·상환·저축 기록', monthSection(S));
    if (!root.FP_STATIC) html += importBox(S);
    html += '<div class="save-all-bar"><span id="saveAllCount">' + (total ? '저장 안 된 변경 ' + total + '개' : '모든 변경 저장됨') + '</span><button type="button" class="btn" data-cdfx="saveAll"' + (total ? '' : ' disabled') + '>전체 저장</button></div>';
    return html;
  }
  function importBox(S) {
    var p = ist(S).importPreview;
    var html = '<section class="card"><details><summary><h2 class="inline-h">기존 브라우저(시연판) 데이터 가져오기</h2></summary><p class="small">GitHub Pages 시연판에서 ‘내 데이터 내보내기’로 받은 파일을 고르면, <strong>무엇을 가져올지 먼저 보여 드립니다.</strong> 확인을 눌러야 서버에 저장됩니다. 시연판의 가상 데이터를 실제 정보로 쓰지 않도록 내용을 꼭 확인해 주세요.</p><input type="file" id="importFile" accept=".json,application/json">';
    if (p) {
      html += '<div class="import-preview"><p><strong>가져올 내용</strong> (내보낸 시각 ' + esc(p.exportedAt || '—') + (p.demo ? ', ' + U.badge('시연용 가상 데이터 포함', 'badge-warn') : '') + ')</p>' +
        (p.fields.length ? '<div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">항목</th><th scope="col">지금 서버 값</th><th scope="col">가져올 값</th></tr></thead><tbody>' + p.fields.map(function (f) { return '<tr><th scope="row">' + esc(f.label) + '</th><td>' + esc(f.current) + '</td><td>' + esc(f.incoming) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted small">바뀌는 정보 항목 없음</p>') +
        (p.records.length ? '<p class="small">실적 ' + p.records.length + '건: ' + p.records.slice(0, 8).map(function (r) { return esc(r.month + ' ' + r.label + ' ' + r.amount); }).join(', ') + (p.records.length > 8 ? ' 외' : '') + '</p>' : '') +
        '<label class="check"><input type="checkbox" id="importOk"><span>위 내용을 확인했고 내 정보로 가져옵니다</span></label><div class="btn-row"><button type="button" class="btn" data-cdfx="importCommit">가져오기</button><button type="button" class="btn btn-secondary" data-cdfx="importCancel">취소</button></div></div>';
    }
    return html + '</details></section>';
  }

  // ---------- 입력 처리 ----------
  function parse(type, raw) {
    var s = String(raw).replace(/[,\s]/g, '');
    if (s === '') return { v: null };
    if (type === 'money') { var n = Number(s); if (!isFinite(n) || n < 0) return { err: '0 이상의 숫자(만원)를 입력해 주세요.' }; return { v: Math.round(n * 10000) }; }
    if (type === 'pct') { var p = Number(s); if (!isFinite(p) || p < 0 || p > 30) return { err: '0~30 사이로 입력해 주세요.' }; return { v: p }; }
    if (type === 'int') { var k = Number(s); if (!Number.isInteger(k) || k < 1) return { err: '1 이상의 정수' }; return { v: k }; }
    return { v: raw };
  }
  function fieldErr(t, msg) { var e = t.closest('.field') && t.closest('.field').querySelector('.field-error'); if (e) { e.hidden = !msg; e.textContent = msg || ''; } }
  function refreshCounts(S) {
    SECS.forEach(function (s) { var el = doc.getElementById('secst-' + s[0]); if (el) el.outerHTML = secStatus(S, s[0]); });
    var total = SECS.reduce(function (n, s) { return n + dirtyIn(S, s[0]); }, 0), c = doc.getElementById('saveAllCount'), b = doc.querySelector('[data-cdfx="saveAll"]');
    if (c) c.textContent = total ? '저장 안 된 변경 ' + total + '개' : '모든 변경 저장됨'; if (b) b.disabled = !total;
  }
  function onInput(e) {
    var S = FP.App.S, t = e.target; if (!S.user || S.user.role !== 'client') return;
    var I = ist(S);
    if (t.dataset.cd) {
      var f = CD.FIELDS.filter(function (x) { return x.path === t.dataset.cd; })[0]; if (!f) return;
      var r = f.type === 'money' ? parse('money', t.value) : f.type === 'ym' ? (t.value && !C.ymValid(t.value) ? { err: 'YYYY-MM' } : { v: t.value || null }) : f.type === 'text' ? { v: t.value.trim() || null } : { v: t.value || null };
      if (r.err) return fieldErr(t, r.err);
      fieldErr(t, null);
      if (JSON.stringify(r.v) === JSON.stringify(serverVal(S, f.path))) delete I.dirty[f.path]; else I.dirty[f.path] = r.v;
      delete I.conflicts[f.path];
      var stEl = doc.querySelector('[data-state-for="' + f.path + '"]'); if (stEl) stEl.innerHTML = Object.prototype.hasOwnProperty.call(I.dirty, f.path) ? '<span class="chip chip-warn">변경됨 · 저장 전</span>' : '';
      t.closest('.field').classList.toggle('is-dirty', Object.prototype.hasOwnProperty.call(I.dirty, f.path));
      return refreshCounts(S);
    }
    if (t.dataset.cdl) {
      var parts = t.dataset.cdl.split('.'), key = parts[0], i = Number(parts[1]), k = parts[2];
      var fd = CD.LISTS[key].fields.filter(function (x) { return x[0] === k; })[0];
      var rr = fd[2] === 'money' || fd[2] === 'pct' || fd[2] === 'int' ? parse(fd[2], t.value) : fd[2] === 'ym' ? (t.value && !C.ymValid(t.value) ? { err: 'YYYY-MM' } : { v: t.value || null }) : { v: t.value === '' ? null : t.value };
      if (rr.err) return fieldErr(t, rr.err);
      fieldErr(t, null);
      if (I.lists[key] === undefined) I.lists[key] = JSON.parse(JSON.stringify(serverVal(S, key) || []));
      I.lists[key][i][k] = rr.v;
      return refreshCounts(S);
    }
    if (t.dataset.cdrec && t.dataset.cdrec !== 'month') {
      var cat = t.dataset.cdrec, pr = parse('money', t.value);
      if (pr.err) { t.setCustomValidity(pr.err); t.reportValidity && t.reportValidity(); return; }
      t.setCustomValidity('');
      var ym = curMonth(S), rec = S.records.filter(function (x) { return x.month === ym && x.category === cat; }).slice(-1)[0];
      if (pr.v === null || (rec && rec.amount === pr.v)) delete I.rec[cat]; else I.rec[cat] = pr.v;
      return refreshCounts(S);
    }
  }
  function curMonth(S) { var el = doc.getElementById('recMonthSel'); return el ? el.value : (ist(S).recMonth || S.todayYm); }
  function onChange(e) {
    var S = FP.App.S, t = e.target; if (!S.user) return;
    if (t.dataset.cdrec === 'month') { var I = ist(S); if (Object.keys(I.rec).length && !root.confirm('저장하지 않은 ' + F.ymKo(I.recMonth || S.todayYm) + ' 실적 입력이 있습니다. 대상 월을 바꾸면 입력이 사라집니다. 바꿀까요?')) { t.value = I.recMonth || S.todayYm; return; } I.rec = {}; I.recMonth = t.value; return FP.rerender(); }
    if (t.dataset.cd && (t.tagName === 'SELECT' || t.type === 'month')) return onInput(e);
    if (t.dataset.cdl && (t.tagName === 'SELECT' || t.type === 'month')) return onInput(e);
    if (t.id === 'importFile' && t.files[0]) {
      var rd = new FileReader();
      rd.onload = function () {
        var file; try { file = JSON.parse(String(rd.result)); } catch (x) { return U.toast('JSON 파일이 아닙니다.', true); }
        U.api('POST', '/api/clients/' + S.client.id + '/import/preview', { file: file }).then(function (p) { ist(S).importPreview = p; ist(S).importFile = file; FP.rerender(); }, function (x) { U.toast(x.message, true); });
      };
      rd.readAsText(t.files[0], 'utf-8');
    }
  }
  doc.addEventListener('input', onInput);
  doc.addEventListener('change', onChange);
  doc.addEventListener('toggle', function (e) { var d = e.target; if (d.dataset && d.dataset.sec && FP.App.S.ui.inp) FP.App.S.ui.inp.open[d.dataset.sec] = d.open; }, true);

  // ---------- 저장 ----------
  function key() { return (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function setFor(S, secs) {
    var I = ist(S), set = {};
    CD.FIELDS.forEach(function (f) { if (secs.indexOf(f.sec) >= 0 && Object.prototype.hasOwnProperty.call(I.dirty, f.path)) set[f.path] = I.dirty[f.path]; });
    Object.keys(CD.LISTS).forEach(function (k) { if (secs.indexOf(CD.LISTS[k].sec) >= 0 && I.lists[k] !== undefined && JSON.stringify(I.lists[k]) !== JSON.stringify(serverVal(S, k) || [])) set[k] = I.lists[k]; });
    return set;
  }
  function refetchData(S) { return U.api('GET', '/api/clients/' + S.client.id + '/data').then(function (d) { S.cd = d; return d; }); }
  function saveFields(S, secs, force) {
    var I = ist(S), set = setFor(S, secs);
    if (!Object.keys(set).length) return Promise.resolve(null);
    secs.forEach(function (s) { I.sec[s] = { state: 'saving' }; }); refreshCounts(S); FP.Sync.saving(true);
    var send = function (base) { return U.api('PATCH', '/api/clients/' + S.client.id + '/data', { baseVersion: base, set: set }, { 'Idempotency-Key': key() }); };
    var p = force ? refetchData(S).then(function (d) { return send(d.version); }) : send(S.cd ? S.cd.version : 0);
    return p.then(function (r) {
      Object.keys(set).forEach(function (k) { delete I.dirty[k]; delete I.lists[k]; delete I.conflicts[k]; });
      secs.forEach(function (s) { I.sec[s] = { state: 'saved', at: new Date() }; });
      FP.Sync.saving(false); FP.Sync.saved();
      return refetchData(S).then(function () { S.ui.ownVersion = r.version; return r; });
    }, function (x) {
      FP.Sync.saving(false); FP.Sync.failed(x.status === 0 ? '서버에 연결할 수 없어 저장하지 못했습니다. 입력한 값은 이 화면에 남아 있습니다.' : x.message);
      var conf = x.body && x.body.conflicts || [];
      conf.forEach(function (c) { I.conflicts[c.path] = c; });
      secs.forEach(function (s) { I.sec[s] = { state: 'error', msg: x.status === 0 ? '서버에 연결할 수 없어 저장하지 못했습니다. 입력한 값은 그대로 있으니 연결 후 다시 저장해 주세요.' : x.message, conflicts: conf.filter(function (c) { var f = CD.FIELDS.filter(function (y) { return y.path === c.path; })[0]; var sec = f ? f.sec : (CD.LISTS[c.path] || {}).sec; return sec === s; }) }; });
      throw x;
    });
  }
  function saveRecords(S) {
    var I = ist(S), ym = curMonth(S), cats0 = Object.keys(I.rec);
    if (!cats0.length) return Promise.resolve(null);
    I.sec.month = { state: 'saving' }; refreshCounts(S); FP.Sync.saving(true);
    var chain = Promise.resolve(), done = 0;
    cats0.forEach(function (cat) {
      var k = key();
      chain = chain.then(function () {
        var body = { month: ym, category: cat, amount: I.rec[cat] };
        var tryOnce = function (n) { return U.api('POST', '/api/clients/' + S.client.id + '/records', body, { 'Idempotency-Key': k }).catch(function (x) { if (x.status === 0 && n < 2) return new Promise(function (r) { setTimeout(r, 1000); }).then(function () { return tryOnce(n + 1); }); throw x; }); };
        return tryOnce(0).then(function () { delete I.rec[cat]; done++; });
      });
    });
    return chain.then(function () { FP.Sync.saving(false); FP.Sync.saved(); I.sec.month = { state: 'saved', at: new Date() }; I.recMonth = ym; },
      function (x) { FP.Sync.saving(false); FP.Sync.failed(x.message); I.sec.month = { state: 'error', msg: (done ? done + '개 항목은 저장됨. ' : '') + x.message }; throw x; });
  }
  function after(S) { return FP.reload(true); }
  function onClick(e) {
    var b = e.target.closest('[data-cdfx]'); if (!b) return;
    var S = FP.App.S, I = ist(S), fx = b.dataset.cdfx;
    if (fx === 'addRow') { var k = b.dataset.key; if (I.lists[k] === undefined) I.lists[k] = JSON.parse(JSON.stringify(serverVal(S, k) || [])); var row = { id: k[0] + Date.now().toString(36).slice(-4) }; CD.LISTS[k].fields.forEach(function (f) { row[f[0]] = null; }); I.lists[k].push(row); return FP.rerender(); }
    if (fx === 'delRow') { var k2 = b.dataset.key; if (I.lists[k2] === undefined) I.lists[k2] = JSON.parse(JSON.stringify(serverVal(S, k2) || [])); I.lists[k2].splice(Number(b.dataset.i), 1); return FP.rerender(); }
    if (fx === 'saveSec') {
      var sec = b.dataset.sec;
      var p = sec === 'month' ? saveRecords(S) : saveFields(S, [sec]);
      return p.then(function (r) { if (r === null && sec !== 'month') U.toast('바뀐 항목이 없습니다.'); else U.toast('저장했습니다. 담당 설계사 화면에도 전달됩니다.'); return after(S); }, function () { FP.rerender(); });
    }
    if (fx === 'saveAll') {
      var secs = ['basic', 'income', 'asset', 'product'];
      return saveFields(S, secs).then(function () { return saveRecords(S); }).then(function () { U.toast('모든 변경을 저장했습니다.'); return after(S); }, function () { FP.rerender(); });
    }
    if (fx === 'takeServer') { var s1 = b.dataset.sec; (I.sec[s1].conflicts || []).forEach(function (c) { delete I.dirty[c.path]; delete I.lists[c.path]; delete I.conflicts[c.path]; }); I.sec[s1] = {}; return refetchData(S).then(function () { FP.rerender(); }); }
    if (fx === 'keepMine') { var s2 = b.dataset.sec; return saveFields(S, [s2], true).then(function () { U.toast('확인한 값으로 저장했습니다.'); return after(S); }, function () { FP.rerender(); }); }
    if (fx === 'importCommit') {
      if (!doc.getElementById('importOk').checked) return U.toast('가져올 내용을 확인했다고 표시해 주세요.', true);
      return U.api('POST', '/api/clients/' + S.client.id + '/import/commit', { file: I.importFile, confirm: true }, { 'Idempotency-Key': key() }).then(function (r) { I.importPreview = null; I.importFile = null; U.toast('정보 ' + r.fields + '개 항목, 실적 ' + r.records + '건을 가져왔습니다.'); return refetchData(S).then(function () { return after(S); }); }, function (x) { U.toast(x.message, true); });
    }
    if (fx === 'importCancel') { I.importPreview = null; I.importFile = null; return FP.rerender(); }
  }
  doc.addEventListener('click', onClick);
  doc.addEventListener('click', function (e) { var a = e.target.closest('[data-cdnav]'); if (!a) return; e.preventDefault(); var S = FP.App.S, I = ist(S); I.open[a.dataset.cdnav] = true; var el = doc.getElementById('sec-' + a.dataset.cdnav); if (el) { var d = el.querySelector('details'); if (d) d.open = true; el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } });
  root.addEventListener('beforeunload', function (e) { var S = FP.App && FP.App.S; if (!S || !S.ui || !S.ui.inp) return; var n = SECS.reduce(function (m, s) { return m + dirtyIn(S, s[0]); }, 0); if (n) { e.preventDefault(); e.returnValue = ''; } });

  // ======================================================================
  // 설계사: 고객 정보(조회) · 변경 이력 · 실행 기준 계획과의 차이
  // ======================================================================
  function clientInfo(S) {
    var cd = S.cd || { data: {}, version: 0 }, bp = FP.Client.myPlan(S);
    var html = '<section class="card"><div class="card-head wrap"><h2>고객 입력 정보</h2><span class="muted small">v' + cd.version + (cd.updatedAt ? ' · ' + F.date(cd.updatedAt) + ' ' + FP.Sync.time(cd.updatedAt) + ' · ' + esc(cd.updatedBy || '') : '') + '</span></div><p class="muted small">고객이 직접 입력·저장한 값입니다. 설계사는 조회만 할 수 있고, 계획에 넣으려면 ‘최신 정보로 새 안 작성’을 눌러 초안을 만든 뒤 검토·저장합니다(자동으로 계획을 바꾸지 않음).</p>';
    var recent = {}; (S.ui.updates || []).forEach(function (u) { (u.items || []).forEach(function (it) { recent[it.path] = true; }); });
    SECS.slice(0, 4).forEach(function (s) {
      var fs = CD.FIELDS.filter(function (f) { return f.sec === s[0]; }), ls = Object.keys(CD.LISTS).filter(function (k) { return CD.LISTS[k].sec === s[0]; });
      html += '<h3 class="sub-head">' + esc(s[1]) + '</h3><dl class="info-dl">' + fs.map(function (f) { var v = CD.get(cd.data, f.path); return '<div' + (recent[f.path] ? ' class="flash-row"' : '') + '><dt>' + esc(f.label) + '</dt><dd>' + (v === null || v === undefined ? '<span class="chip">미입력</span>' : esc(CD.fmt(f.path, v))) + (cd.fieldVersions && cd.fieldVersions[f.path] ? ' <span class="muted small">v' + cd.fieldVersions[f.path] + '</span>' : '') + '</dd></div>'; }).join('') +
        ls.map(function (k) { var arr = cd.data[k] || []; return '<div' + (recent[k] ? ' class="flash-row"' : '') + '><dt>' + esc(CD.LISTS[k].label) + '</dt><dd>' + (arr.length ? arr.map(function (r) { return esc(CD.LISTS[k].fields.map(function (f) { var v = r[f[0]]; return v === null || v === undefined ? '' : f[2] === 'money' ? F.money(v) : f[2] === 'pct' ? v + '%' : String(v); }).filter(Boolean).join(' · ')); }).join('<br>') : '<span class="chip">없음</span>') + '</dd></div>'; }).join('') + '</dl>';
    });
    html += '</section>';
    if (bp) {
      var df = CD.diff(bp.data, cd.data, { kind: bp.kind });
      html += '<section class="card"><div class="card-head wrap"><h2>실행 기준 계획과 다른 항목</h2><span class="muted small">' + esc(FP.Planner.vLabel(bp)) + '</span></div>' +
        (df.length ? '<div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">항목</th><th scope="col">계획 값</th><th scope="col">고객 최신 값</th></tr></thead><tbody>' + df.map(function (x) { return '<tr><th scope="row">' + esc(x.label) + '</th><td>' + esc(x.plan) + '</td><td><strong>' + esc(x.client) + '</strong></td></tr>'; }).join('') + '</tbody></table></div>' +
          '<p class="small">설계 후 계획의 생활비는 합의한 ‘예산’이라 고객의 현재 생활비로 바꾸지 않습니다. 미입력 항목은 계획 값을 유지합니다.</p><button type="button" class="btn" data-action="draftFromClient">최신 정보로 새 안 작성</button>' : '<p class="is-ok">계획에 쓰인 값과 고객 최신 정보가 같습니다.</p>') + '</section>';
    }
    var h = S.ui.history;
    html += '<section class="card"><div class="card-head wrap"><h2>변경 이력</h2><button type="button" class="btn btn-small btn-secondary" data-action="loadHistory">' + (h ? '새로 고침' : '불러오기') + '</button></div>' +
      (h ? (h.length ? '<ul class="history">' + h.slice(0, 60).map(function (e) { return '<li><span class="muted small">' + F.date(e.at) + ' ' + FP.Sync.time(e.at) + '</span> <strong>' + esc(e.actorName || '') + '</strong>(' + ({ client: '고객', planner: '설계사', system: '자동 점검' }[e.actorRole] || e.actorRole) + ') · ' + esc(e.text || e.entity) + (e.version ? ' <span class="muted small">데이터 v' + e.version + '</span>' : '') + (e.items && e.items.length ? '<ul class="plain-list small">' + e.items.map(function (it) { return '<li>' + esc(it.label) + ': ' + esc(it.from || '') + (it.from ? ' → ' : '') + esc(it.to) + '</li>'; }).join('') + '</ul>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="muted">이력 없음</p>') : '<p class="muted small">변경자·시각·항목·데이터 버전이 기록됩니다.</p>') + '</section>';
    return html;
  }

  FP.ClientInput = { page: inputPage, clientInfo: clientInfo, state: ist, dirtyCount: function (S) { return SECS.reduce(function (n, s) { return n + dirtyIn(S, s[0]); }, 0); } };
})(this);
