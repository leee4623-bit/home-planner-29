/*
 * ‘실제 상품 비교’ 화면 (고객·설계사 공통)
 * ------------------------------------------------------------
 * - 금융감독원 공시(서버가 FSS_API_KEY로 조회)와 출처가 있는 정책상품만 보여 줍니다. 자료가 없으면 비어 있다고 표시합니다.
 * - 범주(정책형·적금·예금·대출·투자)별로만 비교하고, 최고금리 순위는 매기지 않습니다.
 * - ‘이 상품을 계획에 반영해보기’는 계획 사본으로 전후를 계산할 뿐, 가입 처리나 실행 기준 변경을 하지 않습니다.
 */
(function (root) {
  'use strict';
  var FP = root.FP, U = FP.UI, F = U.F, esc = U.esc, P = FP.Products, C = FP.Calc, doc = root.document;
  var ORDER = [['policy', '정책형 저축'], ['saving', '적금'], ['deposit', '정기예금'], ['loan', '대출상품'], ['investment', '투자상품']];

  function ui(S) {
    if (!S.ui.prod) {
      var sit = P.clientSituation(S.cd ? S.cd.data : {}, S.today);
      var m = sit.monthlyFree != null ? Math.max(100000, Math.min(500000, Math.floor(sit.monthlyFree / 2 / 10000) * 10000)) : 300000;
      S.ui.prod = { cat: 'policy', monthly: m, months: 36, lump: sit.housingFund ? Math.min(sit.housingFund, 10000000) : 5000000, start: C.ymAdd(S.todayYm, 1), sort: 'company', prefMet: {}, limit: 20 };
    }
    return S.ui.prod;
  }
  function load(S) {
    if (S.prodLoading) return;
    S.prodLoading = true;
    Promise.all([U.api('GET', '/api/products'), U.api('GET', '/api/clients/' + S.client.id + '/product-requests').catch(function () { return { requests: [] }; })]).then(function (r) { S.prodData = r[0]; S.prodReq = r[1].requests; S.prodLoading = false; FP.rerender(); }, function (e) { S.prodLoading = false; S.prodData = { error: e.message, products: [], meta: {} }; FP.rerender(); });
  }
  function metaLine(d) {
    var names = { 'fss:deposit': '정기예금', 'fss:saving': '적금', 'fss:loan': '전세자금대출' };
    if (!d.keyConfigured && !Object.keys(d.meta || {}).some(function (k) { return d.meta[k].fetchedAt; })) return '<p class="banner banner-warn"><strong>금융감독원 공시 자료 미연결</strong> — 서버에 공시 API 인증키(FSS_API_KEY)가 설정되지 않아 은행·저축은행 예적금과 대출 상품을 불러오지 않았습니다. 상품이나 금리를 임의로 채우지 않습니다. 아래에는 공식 발표로 확인한 정책상품만 표시합니다.</p>';
    return '<ul class="plain-list small">' + Object.keys(names).map(function (k) {
      var m = d.meta[k]; if (!m) return '<li>' + names[k] + ': 아직 조회하지 않음</li>';
      return '<li>' + names[k] + ': ' + (m.ok ? U.pill(m.stale ? 'check' : 'ok', (m.stale ? '오래된 자료 · ' : '') + '확인 ' + F.date(m.fetchedAt) + ' ' + FP.Sync.time(m.fetchedAt)) + ' ' + m.count + '개' : U.pill('bad', '조회 실패') + ' ' + esc(m.error || '') + (m.fetchedAt ? ' — 마지막 성공 ' + F.date(m.fetchedAt) + ' 자료를 표시(' + m.count + '개)' : ' — 표시할 자료 없음')) + '</li>';
    }).join('') + '</ul>';
  }
  function view(S) {
    var u = ui(S), d = S.prodData;
    if (!d) { load(S); return '<section class="card"><h2>실제 상품 비교</h2><p class="muted">상품 자료를 불러오는 중…</p></section>'; }
    var sit = P.clientSituation(S.cd ? S.cd.data : {}, S.today);
    var html = '<section class="card"><div class="card-head wrap"><h2>실제 상품 비교</h2>' + (S.user.role === 'planner' ? '<button type="button" class="btn btn-small btn-secondary" data-pv="refresh">상품 자료 갱신</button>' : '') + '</div>' +
      '<p class="small">공식 공시·공식 발표로 확인한 상품만 표시합니다. 성격이 다른 상품은 섞어 순위를 매기지 않고, 범주별로 <strong>같은 납입액·기간·세금 가정</strong>으로 계산합니다. 선택해도 가입되지 않으며, ‘계획에 반영해보기’로 전후를 비교한 뒤 확인해야 저장됩니다. 상품 자료 갱신은 고객 정보 동기화와 별개입니다.</p>' + metaLine(d) + '</section>';
    // 가정
    html += '<section class="card"><h2>비교 가정 <span class="muted small">(모든 상품에 같게 적용)</span></h2><div class="field-grid">' +
      '<div class="field"><label for="pvMonthly">월 납입액(적금·정책형)</label><div class="input-wrap"><input id="pvMonthly" type="text" inputmode="decimal" data-pvset="monthly" value="' + Math.round(u.monthly / 10000) + '"><span class="unit">만원</span></div></div>' +
      '<div class="field"><label for="pvLump">예치액(정기예금)</label><div class="input-wrap"><input id="pvLump" type="text" inputmode="decimal" data-pvset="lump" value="' + Math.round(u.lump / 10000) + '"><span class="unit">만원</span></div></div>' +
      '<div class="field"><label for="pvMonths">기간</label><select id="pvMonths" data-pvset="months">' + [6, 12, 24, 36].map(function (m) { return '<option value="' + m + '"' + (m === u.months ? ' selected' : '') + '>' + m + '개월</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="pvStart">가입(시작) 가정월</label><input id="pvStart" type="month" data-pvset="start" value="' + esc(u.start) + '"></div></div>' +
      '<p class="muted small">세금: 이자소득세 15.4% 일반과세(비과세가 공식 확인된 상품만 제외) · 이자: 공시된 단리/복리 방식 · 수수료: 공시 항목이 없으면 ‘확인 필요’ · 우대금리: 아래 ‘충족 확인’을 표시한 상품만 확정 결과에 반영 · 목표일 ' + esc(sit.moveMonth || '미입력') + ' · 월 여유자금 ' + (sit.monthlyFree == null ? '판단 불가(미입력: ' + esc(sit.missing.join(', ')) + ')' : F.money(sit.monthlyFree)) + '</p></section>';
    if (S.prodReq && S.prodReq.length) html += '<section class="card"><h2>' + (S.user.role === 'planner' ? '고객 검토 요청' : '내 검토 요청') + '</h2><ul class="plain-list">' + S.prodReq.map(function (r) { var s = r.simulation || {}; return '<li>' + F.date(r.createdAt) + ' · <strong>' + esc(r.product.company + ' ' + r.product.name) + '</strong> · 목표일 부족·여유 ' + (s.before ? F.signed(s.before.gap) + ' → ' + F.signed(s.after.gap) : '') + ' · ' + U.pill('info', '검토 대기(가입 아님)') + '</li>'; }).join('') + '</ul></section>';
    // 범주
    html += '<div class="segmented cat-tabs" role="group" aria-label="상품 범주">' + ORDER.map(function (c) { var n = c[0] === 'investment' ? 0 : d.products.filter(function (p) { return p.category === c[0]; }).length; return '<button type="button" data-pvcat="' + c[0] + '" aria-pressed="' + (u.cat === c[0]) + '">' + c[1] + ' <span class="muted small">' + n + '</span></button>'; }).join('') + '</div>';
    if (u.cat === 'investment') return html + '<section class="card"><h2>투자상품</h2><p class="banner banner-info">' + esc(d.investment ? d.investment.text : '공식 데이터 미연결') + '</p><p class="small">3년 안에 쓸 주거 핵심자금은 위험성향과 관계없이 원금 손실 가능성이 낮은 상품으로만 계획합니다.</p></section>';
    var list = d.products.filter(function (p) { return p.category === u.cat; });
    var a = { monthly: u.monthly, months: u.months, lump: u.lump, startMonth: u.start, prefMet: u.prefMet };
    var rows = list.map(function (p) { return { p: p, r: P.evaluate(p, a, sit) }; });
    if (u.cat === 'saving' || u.cat === 'deposit') rows = rows.filter(function (x) { return x.r.available; });
    if (u.sort === 'net' && u.cat !== 'loan') rows.sort(function (x, y) { return (y.r.confirmed ? y.r.confirmed.net : 0) - (x.r.confirmed ? x.r.confirmed.net : 0); });
    else rows.sort(function (x, y) { return (x.p.company + x.p.name).localeCompare(y.p.company + y.p.name, 'ko'); });
    html += '<div class="field-inline"><label for="pvSort">정렬</label><select id="pvSort" data-pvset="sort"><option value="company"' + (u.sort === 'company' ? ' selected' : '') + '>기관명순</option>' + (u.cat !== 'loan' ? '<option value="net"' + (u.sort === 'net' ? ' selected' : '') + '>같은 가정의 확정 예상 수령액순(우대 미확인 제외)</option>' : '') + '</select><span class="muted small">' + rows.length + '개' + (u.cat === 'saving' || u.cat === 'deposit' ? ' · ' + u.months + '개월 상품만' : '') + '</span></div>';
    if (!rows.length) html += '<section class="card"><p class="muted">' + (u.cat === 'policy' ? '표시할 정책상품이 없습니다.' : '이 범주의 공시 자료가 없습니다(인증키 미설정·조회 실패 또는 해당 기간 상품 없음). 임의 상품으로 채우지 않습니다.') + '</p></section>';
    html += rows.slice(0, u.limit).map(function (x) { return card(S, x.p, x.r, u); }).join('');
    if (rows.length > u.limit) html += '<div class="btn-row"><button type="button" class="btn btn-secondary" data-pv="more">더 보기 (' + (rows.length - u.limit) + '개 남음)</button></div>';
    return html;
  }
  function card(S, p, r, u) {
    var row = function (l, v) { return '<div class="abc-row"><dt>' + l + '</dt><dd>' + v + '</dd></div>'; };
    var opt = p.options[0] || {};
    var rate = p.category === 'loan' ? p.options.map(function (o) { return esc((o.rateType || '') + ' ' + (o.rpay || '') + ' ' + (o.min != null ? o.min + '%' : '') + (o.max != null && o.max !== o.min ? '~' + o.max + '%' : '') + (o.note ? ' (' + o.note + ')' : '')); }).join('<br>')
      : p.bankRateUnknown ? '은행 금리 미확인' + (opt.max ? ' (우대 최대 ' + opt.max + '%)' : '') : (function () { var o = p.options.filter(function (x) { return x.term === u.months; }); return o.map(function (x) { return esc(x.term + '개월 ' + x.rateType + (x.rsrv ? '·' + x.rsrv : '') + ' 기본 ' + x.base + '% / 최고 ' + (x.max == null ? '—' : x.max + '%')); }).join('<br>'); })();
    var g = r.goal || {};
    var hl = '';
    if (r.available) {
      hl = '<div class="goal-box"><h4>주거목표와 연결</h4><ul class="plain-list small">' +
        '<li>' + (g.matures === true ? U.pill('ok', '목표일 전 만기') : g.matures === false ? U.pill('bad', '목표일까지 만기 안 됨') : U.pill('info', '판단 불가')) + ' 가입 ' + esc(g.start || '—') + ' → 만기 ' + esc(g.maturity || '—') + '</li>' +
        '<li>목표일에 쓸 수 있는 금액: <strong>' + (g.usableAtGoal == null ? '—' : F.money(g.usableAtGoal)) + '</strong> <span class="muted">(' + esc(g.usableNote) + ')</span></li>' +
        '<li>납입 감당: ' + (g.afford ? (g.afford.ok === true ? U.pill('ok', '가능') : g.afford.ok === false ? U.pill('bad', '부족') : U.pill('info', '판단 불가')) + ' ' + esc(g.afford.text) : '—') + '</li>' +
        (g.impact || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') +
        '<li>위험성향·목적: ' + esc(g.riskFit || '') + '</li></ul></div>';
    }
    var res = r.available ? row('예상 수령액(확정 조건)', '<strong>' + F.money(r.confirmed.net) + '</strong> <span class="muted small">' + esc(r.confirmed.label) + ' · 원금 ' + F.money(r.confirmed.net - r.confirmed.interest + r.confirmed.tax - r.confirmed.support) + ' + 이자 ' + F.money(r.confirmed.interest) + ' − 세금 ' + F.money(r.confirmed.tax) + (r.confirmed.support ? ' + 지원금 ' + F.money(r.confirmed.support) : '') + '</span>') +
      (r.conditional ? row('조건부 결과', F.money(r.conditional.net) + ' <span class="muted small">' + esc(r.conditional.label) + ' — 조건 확인 전에는 계획에 넣지 않음</span>') : '') : row('예상 수령액', '<span class="muted">' + esc((r.notes || []).join(' ') || '계산 대상 아님') + '</span>');
    var prefBox = p.source === 'fss' && opt.max != null ? '<label class="check small"><input type="checkbox" data-pvpref="' + esc(p.id) + '"' + (u.prefMet[p.id] === true ? ' checked' : '') + '><span>우대조건을 충족하는 것을 확인했습니다(가입 기관 기준)</span></label>' :
      p.policyId === 'smeSaving' ? '<label class="check small"><input type="checkbox" data-pvpref="' + esc(p.id) + '"' + (u.prefMet[p.id] === true ? ' checked' : '') + '><span>소속 회사가 이 공제에 참여하는 것을 확인했습니다</span></label>' : '';
    return '<article class="card prod-card"><div class="abc-head"><h3>' + esc(p.company) + ' · ' + esc(p.name) + '</h3>' + U.badge(p.kind) + (p.grpLabel ? U.badge(p.grpLabel) : '') + '</div><dl class="abc-dl">' +
      row(p.category === 'loan' ? '금리(공시)' : '기본·최고금리', rate || '—') +
      row('우대조건', esc(p.conditions) + (prefBox ? '<div>' + prefBox + '</div>' : '') + '<div class="muted small">고객 충족 여부: ' + (u.prefMet[p.id] === true ? '고객 확인' : '확인 전(조건부)') + '</div>') +
      row('가입 자격', esc(p.eligibility) + (r.eligibility ? '<ul class="plain-list small">' + r.eligibility.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '')) +
      row('가입기간·만기', p.category === 'loan' ? esc(p.loanLimit || '') : esc((g.term || u.months) + '개월' + (g.maturity ? ' · 만기 ' + g.maturity : '')) + (p.joinWay ? '<div class="muted small">' + esc(p.joinWay) + '</div>' : '')) +
      row('월 납입한도', p.monthlyLimit ? F.money(p.monthlyLimit) : '<span class="muted">공시 없음</span>') +
      row('정부·기업 지원금', esc(p.support)) + row('세금·수수료', esc(p.tax) + '<div class="small">' + esc(p.fees) + '</div>') +
      row('중도해지', esc(p.earlyTermination)) + row('원금손실·예금자보호', esc(p.principalRisk) + '<div class="small">' + esc(p.protection) + '</div>') +
      res + row('출처·확인일', (p.sources || [{ title: p.sourceTitle, url: p.sourceUrl }]).filter(Boolean).map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>'; }).join('<br>') + '<div class="muted small">확인 ' + esc(String(p.checkedAt || '').slice(0, 10)) + '</div>') +
      '</dl>' + ((r.notes || []).length && r.available ? '<ul class="plain-list small muted">' + r.notes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') + hl +
      (r.available ? '<div class="btn-row"><button type="button" class="btn" data-pv="try" data-id="' + esc(p.id) + '">이 상품을 계획에 반영해보기</button></div>' : '') + '</article>';
  }

  function tryProduct(S, id) {
    var u = ui(S), p = S.prodData.products.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    var sit = P.clientSituation(S.cd ? S.cd.data : {}, S.today), a = { monthly: u.monthly, months: u.months, lump: u.lump, startMonth: u.start, prefMet: u.prefMet };
    var r = P.evaluate(p, a, sit), bp = FP.Client.myPlan(S);
    if (!bp) return U.toast('실행 기준 계획이 없어 비교할 수 없습니다.', true);
    var after = P.applyToPlan(bp.data, p, a, r), cmp = P.compare(bp.data, after, r.goal.start);
    var tr = function (l, x, y) { return '<tr><th scope="row">' + l + '</th><td>' + x + '</td><td>' + y + '</td></tr>'; };
    var gap = function (g) { return g >= 0 ? '<span class="is-ok">여유 ' + F.abs(g) + '</span>' : '<span class="is-bad">부족 ' + F.abs(g) + '</span>'; };
    var body = '<p class="small"><strong>' + esc(p.company + ' ' + p.name) + '</strong> — ' + esc(r.confirmed.label) + ' · ' + (p.category === 'deposit' ? '예치 ' + F.money(u.lump) + '(주거자금에서 이동)' : '월 ' + F.money(u.monthly)) + ' · ' + esc(r.goal.start + ' ~ ' + r.goal.maturity) + '</p>' +
      '<div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">실행 기준 ' + esc(FP.Planner.vLabel(bp)) + '</th><th scope="col">지금</th><th scope="col">반영 후</th></tr></thead><tbody>' +
      tr(esc(cmp.before.ym) + ' 월 여유자금', F.money(cmp.before.surplus), F.money(cmp.after.surplus)) + tr('목표일 부족·여유', gap(cmp.before.gap), gap(cmp.after.gap)) + tr('판정', U.statusText(cmp.before.status), U.statusText(cmp.after.status)) +
      tr('목표일 비상금', F.money(cmp.before.emergency), F.money(cmp.after.emergency)) + tr('부채 상환 완료', F.ym(bp.data.basis.baseMonth, cmp.before.debtFree), F.ym(bp.data.basis.baseMonth, cmp.after.debtFree)) + '</tbody></table></div>' +
      (cmp.warnings.length ? '<ul class="plain-list small is-bad">' + cmp.warnings.map(function (w) { return '<li>' + esc(w.text) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="muted small">확정 조건만 넣어 계산했습니다(조건부 우대·지원금 제외). 계획 계산은 매달 남는 돈을 비상금 → 주거자금 순으로 배분하므로 상품 납입액만큼 다른 저축이 줄어듭니다. 실제 가입·이체가 아니며 실행 기준 계획은 바뀌지 않습니다.</p>' +
      '<label class="check"><input type="checkbox" id="tryOk"><span>' + (S.user.role === 'planner' ? '비교 결과를 확인했고 새 계획 초안으로 엽니다(저장·제시는 따로)' : '비교 결과를 확인했고 설계사에게 검토를 요청합니다(가입 아님)') + '</span></label>';
    U.dialog({ title: '이 상품을 계획에 반영해보기', body: body, actions: [{ text: '닫기' }, { text: S.user.role === 'planner' ? '새 계획 초안으로 열기' : '검토 요청 저장', cls: 'btn-primary', keep: true, onClick: function () {
      if (!doc.getElementById('tryOk').checked) return U.toast('확인란을 선택해 주세요.', true);
      U.closeDialog();
      if (S.user.role === 'planner') { S.ui.draft = { data: after, kind: 'after', fromLabel: FP.Planner.vLabel(bp) + ' + ' + p.name + ' 반영', label: p.name + ' 반영안', note: p.company + ' ' + p.name + ' ' + (p.category === 'deposit' ? '예치 ' + F.money(u.lump) : '월 ' + F.money(u.monthly)) + ' 가정(상품 비교에서 반영)', dataVersion: S.cd ? S.cd.version : null }; S.ui.tab = 'edit'; FP.rerender(); var dr = doc.querySelector('.draft'); if (dr) dr.scrollIntoView(); return; }
      U.api('POST', '/api/clients/' + S.client.id + '/product-requests', { confirm: true, product: { id: p.id, name: p.name, company: p.company }, simulation: { assumptions: { monthly: u.monthly, months: u.months, lump: u.lump, start: u.start }, label: r.confirmed.label, before: cmp.before, after: cmp.after } }).then(function (x) { U.toast(x.already ? '이미 검토 요청한 상품입니다.' : '설계사에게 검토를 요청했습니다(가입 아님).'); S.prodData = null; FP.rerender(); }, function (e) { U.toast(e.message, true); });
    } }] });
  }

  doc.addEventListener('click', function (e) {
    var S = FP.App && FP.App.S; if (!S || !S.user) return;
    var c = e.target.closest('[data-pvcat]'); if (c) { ui(S).cat = c.dataset.pvcat; ui(S).limit = 20; return FP.rerender(); }
    var b = e.target.closest('[data-pv]'); if (!b) return;
    if (b.dataset.pv === 'more') { ui(S).limit += 20; return FP.rerender(); }
    if (b.dataset.pv === 'try') return tryProduct(S, b.dataset.id);
    if (b.dataset.pv === 'refresh') return U.api('POST', '/api/products/refresh').then(function (r) { S.prodData = r.list; var bad = Object.keys(r.result).filter(function (k) { return !r.result[k].ok; }); U.toast(bad.length ? '일부 조회 실패: ' + bad.join(', ') : '상품 자료를 갱신했습니다.', !!bad.length); FP.rerender(); }, function (x) { U.toast(x.message, true); });
  });
  doc.addEventListener('change', function (e) {
    var S = FP.App && FP.App.S; if (!S || !S.user) return; var t = e.target;
    if (t.dataset.pvset) {
      var u = ui(S), k = t.dataset.pvset;
      if (k === 'months') u.months = Number(t.value); else if (k === 'start') { if (C.ymValid(t.value)) u.start = t.value; } else if (k === 'sort') u.sort = t.value;
      else { var n = Number(String(t.value).replace(/,/g, '')); if (!isFinite(n) || n < 0) return U.toast('0 이상의 숫자(만원)를 입력해 주세요.', true); u[k] = Math.round(n * 10000); }
      return FP.rerender();
    }
    if (t.dataset.pvpref) { ui(S).prefMet[t.dataset.pvpref] = t.checked ? true : null; return FP.rerender(); }
  });

  FP.ProductsView = { view: view, reset: function (S) { S.prodData = null; } };
})(this);
