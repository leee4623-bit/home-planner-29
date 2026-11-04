/*
 * 설계사 계획 제시 → 고객 확인·선택 → 실행 기준
 * ------------------------------------------------------------
 * - 설계사 초안(저장만 한 버전)은 고객에게 보이지 않습니다.
 * - ‘고객에게 제시’한 계획만 고객 화면에 알림과 함께 나타나고, 고객이 확인·선택해야 실행 기준이 됩니다.
 * - 선택 전까지 실행 기준 계획은 그대로입니다.
 */
(function (root) {
  'use strict';
  var FP = root.FP, U = FP.UI, F = U.F, esc = U.esc, C = FP.Calc, doc = root.document;
  function gap(g) { return g >= 0 ? '<span class="is-ok">여유 ' + F.abs(g) + '</span>' : '<span class="is-bad">부족 ' + F.abs(g) + '</span>'; }
  function planById(S, id) { return S.plans.filter(function (p) { return p.id === id; })[0]; }

  function compareTable(cur, next) {
    var a = C.simulate(cur.data), b = C.simulate(next.data), base = cur.data.basis.baseMonth;
    var tr = function (l, x, y) { return '<tr><th scope="row">' + l + '</th><td>' + x + '</td><td>' + y + '</td></tr>'; };
    var prod = function (d) { return F.money((d.products || []).reduce(function (s, p) { return s + (p.monthly || 0); }, 0)); };
    return '<div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">항목</th><th scope="col">지금 실행 기준<br><span class="muted small">' + esc(FP.Planner.vLabel(cur)) + '</span></th><th scope="col">제시된 계획<br><span class="muted small">' + esc(FP.Planner.vLabel(next)) + '</span></th></tr></thead><tbody>' +
      tr('판정', U.statusText(a.status), U.statusText(b.status)) + tr('목표일', cur.data.basis.moveMonth, next.data.basis.moveMonth) + tr('목표일 주거자금', gap(a.gap), gap(b.gap)) +
      tr('월 생활비 예산', F.money(cur.data.expenses.essential + cur.data.expenses.optional), F.money(next.data.expenses.essential + next.data.expenses.optional)) + tr('월 정책·저축상품 납입', prod(cur.data), prod(next.data)) +
      tr('부채 상환 완료', F.ym(base, a.debtFree), F.ym(next.data.basis.baseMonth, b.debtFree)) + tr('목표일 비상금', F.money(a.at.emergencyBal), F.money(b.at.emergencyBal)) + '</tbody></table></div>';
  }

  // 고객: 제시된 계획
  function clientView(S) {
    var offers = (S.x.offers || []), pending = offers.filter(function (o) { return o.status === 'presented'; }), cur = FP.Client.myPlan(S);
    var html = '<section class="card"><div class="card-head wrap"><h2>설계사가 제시한 계획</h2><span class="muted small">선택하기 전까지 실행 기준 계획은 바뀌지 않습니다</span></div>';
    if (!pending.length) html += '<p class="muted">지금 확인할 새 제안이 없습니다.</p>';
    pending.forEach(function (o) {
      var pl = planById(S, o.planId); if (!pl) return;
      html += '<article class="offer"><p><strong>' + esc(o.author) + '</strong> · ' + F.date(o.createdAt) + ' 제시 ' + U.pill('info', '확인 대기') + (o.note ? '<br><span class="small">' + esc(o.note) + '</span>' : '') + '</p>' + (cur ? compareTable(cur, pl) : '') +
        '<div class="btn-row"><button type="button" class="btn" data-of="accept" data-id="' + o.id + '">이 계획을 실행 기준으로 선택</button><button type="button" class="btn btn-secondary" data-of="decline" data-id="' + o.id + '">보류</button></div><p class="muted small">선택하면 이 계획이 매달 실행 기준이 됩니다. 앱 안의 계획만 바뀌며 실제 계좌이체·가입은 하지 않습니다.</p></article>';
    });
    var past = offers.filter(function (o) { return o.status !== 'presented'; });
    if (past.length) html += '<details class="small"><summary>지난 제안 ' + past.length + '건</summary><ul class="plain-list">' + past.map(function (o) { var pl = planById(S, o.planId); return '<li>' + F.date(o.createdAt) + ' · ' + (pl ? esc(FP.Planner.vLabel(pl)) : '계획 #' + o.planId) + ' · ' + ({ accepted: '선택함', declined: '보류함', withdrawn: '설계사가 철회' }[o.status] || o.status) + '</li>'; }).join('') + '</ul></details>';
    return html + '</section>';
  }

  // 설계사: 계획 버전 표의 상태와 버튼
  function plannerStatus(S, p) {
    if (p.kind !== 'after') return '';
    var offers = (S.x.offers || []).filter(function (o) { return o.planId === p.id; }), last = offers[0];
    var tags = [];
    if (S.x.baselineId === p.id) tags.push(U.pill('ok', '실행 기준(고객 선택)'));
    else if (last && last.status === 'presented') tags.push(U.pill('info', '고객에게 제시됨'));
    else if (last && last.status === 'declined') tags.push(U.pill('check', '고객 보류'));
    else if (!offers.length && !(S.x.baselines || []).some(function (b) { return b.planId === p.id; })) tags.push(U.badge('설계사 초안'));
    var btn = S.x.baselineId === p.id ? '' : last && last.status === 'presented' ? '<button type="button" class="btn btn-small btn-secondary" data-of="withdraw" data-id="' + last.id + '">제시 철회</button>' : '<button type="button" class="btn btn-small" data-of="present" data-plan="' + p.id + '">고객에게 제시</button>';
    return tags.join(' ') + ' ' + btn;
  }

  doc.addEventListener('click', function (e) {
    var b = e.target.closest('[data-of]'); if (!b) return;
    var S = FP.App.S, base = '/api/clients/' + S.client.id;
    var k = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : String(Date.now());
    if (b.dataset.of === 'present') {
      var pl = planById(S, Number(b.dataset.plan));
      return U.dialog({ title: '이 계획을 고객에게 제시할까요?', body: '<p>' + esc(FP.Planner.vLabel(pl)) + ' · ' + esc(pl.label || '') + '</p><p class="small">고객 화면에 새 제안 알림이 나타나고, 고객이 선택해야 실행 기준이 됩니다. 이미 제시한 다른 계획은 철회됩니다.</p><div class="field"><label for="offerNote">고객에게 남길 설명</label><input id="offerNote" type="text" maxlength="300"></div>', actions: [{ text: '취소' }, { text: '제시', cls: 'btn-primary', onClick: function () {
        U.api('POST', base + '/offers', { planId: pl.id, note: doc.getElementById('offerNote').value }, { 'Idempotency-Key': k }).then(function () { U.toast('고객에게 제시했습니다.'); return FP.reload(true); }, function (x) { U.toast(x.message, true); });
      } }] });
    }
    if (b.dataset.of === 'withdraw') return U.api('POST', base + '/offers/' + b.dataset.id + '/withdraw', {}).then(function () { U.toast('제시를 철회했습니다.'); return FP.reload(true); }, function (x) { U.toast(x.message, true); });
    if (b.dataset.of === 'decline') return U.api('POST', base + '/offers/' + b.dataset.id + '/decline', {}).then(function () { U.toast('보류했습니다. 실행 기준은 그대로입니다.'); return FP.reload(true); }, function (x) { U.toast(x.message, true); });
    if (b.dataset.of === 'accept') {
      return U.dialog({ title: '이 계획을 실행 기준으로 선택할까요?', body: '<p class="small">선택하면 매달 이 계획을 기준으로 실행 여부를 확인합니다. 이전 계획은 이력으로 남습니다.</p><label class="check"><input type="checkbox" id="offerOk"><span>비교 내용을 확인했고 이 계획으로 실행하겠습니다</span></label>', actions: [{ text: '취소' }, { text: '선택', cls: 'btn-primary', keep: true, onClick: function () {
        if (!doc.getElementById('offerOk').checked) return U.toast('확인란을 선택해 주세요.', true);
        U.closeDialog();
        U.api('POST', base + '/offers/' + b.dataset.id + '/accept', { confirm: true }, { 'Idempotency-Key': k }).then(function () { U.toast('실행 기준 계획을 바꿨습니다.'); return FP.reload(true); }, function (x) { U.toast(x.message, true); });
      } }] });
    }
  });

  FP.Offers = { client: clientView, plannerStatus: plannerStatus };
})(this);
