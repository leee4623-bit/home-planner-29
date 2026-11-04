/*
 * 고객 화면 — ‘이번 달 무엇을 해야 하는지’와 ‘실제로 얼마나 실행했는지’
 */
(function (root) {
  'use strict';
  var FP = root.FP, C = FP.Calc, A = FP.Analysis, U = FP.UI, F = U.F, esc = U.esc, PL = FP.Planner;
  // 입력은 ‘내 정보·실적 입력’ 한 페이지, 결과는 별도 화면
  var TABS = [['input', '내 정보·실적 입력'], ['diag', '진단·판정'], ['abc', 'A/B/C안·제안'], ['path', '자금 경로'], ['products', '상품 비교'], ['monthly', '월별 실행'], ['inbox', '알림'], ['tx', '거래내역']];

  // 실행 기준 계획(고객이 확인한 계획). 없으면 최신 설계 후 계획
  function myPlan(S) { var bid = S.x && S.x.baselineId; var b = bid && S.plans.filter(function (p) { return p.id === bid; })[0]; if (b) return b; var l = S.plans.filter(function (p) { return p.kind === 'after'; }); return l[l.length - 1] || S.plans[S.plans.length - 1]; }
  // 확정된 달의 지출만 실적으로 사용(월중 잠정 지출 제외)
  function finalRecs(S) { return FP.Monthly.finalRecords(S.records, S.x ? S.x.closures.map(function (c) { return c.month; }) : []); }
  function exec(S) { return A.execution(myPlan(S).data, finalRecs(S), { today: S.today, settings: S.settings }); }
  function stateLabel(s) { return { done: ['ok', '완료'], partial: ['check', '일부 · 예정일 전'], pending: ['info', '예정'], short: ['bad', '미달'], missingAfterDue: ['check', '기록 없음 · 확인 필요'], none: ['info', '이번 달 계획 없음'] }[s]; }
  function cats(d) { return [['debt', '부채 상환'], ['emergency', '비상금 적립'], ['housing', '주거자금 납입']].concat((d.products || []).map(function (p) { return ['product:' + p.id, p.name + ' 납입']; })).concat([['expense:essential', '이번 달 필수생활비 합계'], ['expense:optional', '이번 달 선택 지출 합계']]); }

  function month(S) {
    var pl = myPlan(S), ex = exec(S), d = pl.data;
    var html = '<section class="card"><div class="card-head wrap"><h2>' + F.ymKo(ex.ym) + ' 해야 할 일</h2><span class="muted small">납입 예정일 매월 ' + ex.settings.dueDay + '일 (유예 ' + ex.settings.graceDays + '일)</span></div>' +
      '<ul class="exec-list">' +
      ex.items.map(function (it) { var s = stateLabel(it.state); return '<li><div class="exec-top"><strong>' + esc(it.label) + '</strong>' + U.pill(s[0], s[1]) + '</div><dl><dt>계획</dt><dd>' + F.money(it.planned) + '</dd><dt>실제</dt><dd>' + (it.actual === null ? '<span class="muted">기록 없음</span>' : F.money(it.actual)) + '</dd><dt>차이</dt><dd>' + (it.diff === null ? '—' : F.signed(it.diff)) + '</dd></dl></li>'; }).join('') +
      '</ul><p class="muted small">기록이 없는 항목은 납입 실패가 아니라 ‘아직 확인되지 않음’입니다. 예정일이 지나기 전에는 미달로 보지 않습니다.</p></section>';
    html += '<div class="two-col"><section class="card"><h2>누적 실행</h2><p>기록이 있는 ' + ex.recordedMonths.length + '개월 기준 계획 <strong>' + F.money(ex.cumPlan) + '</strong> · 실제 <strong>' + F.money(ex.cumAct) + '</strong> · 차이 <strong class="' + (ex.cumDiff >= 0 ? 'is-ok' : 'is-bad') + '">' + F.signed(ex.cumDiff) + '</strong></p>' +
      (ex.noRecord.length ? '<p class="muted small">기록 없는 달(누적 비교에서 제외, 미확인): ' + ex.noRecord.join(', ') + '</p>' : '') + '</section>' +
      '<section class="card"><h2>목표일(' + d.basis.moveMonth + ') 예상</h2><ul class="plain-list"><li><strong>당초 계획대로 실행하면</strong> — ' + gapText(ex.forecastPlan) + '</li><li><strong>최근 실행 추세가 이어지면</strong>(실행률 ' + F.pct(ex.trendFactor * 100, 0) + ') — ' + gapText(ex.forecastTrend) + '</li></ul><p class="muted small">실제 기록이 있는 달은 기록값, 이후는 각 가정으로 계산합니다.</p></section></div>';
    html += '<div class="two-col"><section class="card"><h2>실적 입력</h2><p class="small">이번 달 실제 지출·상환·저축은 <button type="button" class="link-btn" data-tab="input">내 정보·실적 입력 → 6번 구역</button>에서 대상 월을 고르고 입력합니다.</p></section>' +
      '<section class="card sandbox"><div class="card-head"><h2>가정해보기</h2>' + U.badge('저장되지 않음', 'badge-warn') + '</div><p class="muted small">이번 달 주거자금에 추가로 넣으면 어떻게 되는지만 계산합니다. 실제 기록에는 저장되지 않습니다.</p>' +
      '<div class="field"><label for="sbAmt">이번 달 추가로 넣을 금액</label><div class="input-wrap"><input id="sbAmt" type="text" inputmode="decimal" data-ui="sandbox" value="' + (S.ui.sandbox || '') + '" placeholder="예: 20"><span class="unit">만원</span></div></div>' + sandboxResult(S, ex) + '</section></div>';
    return html;
  }
  function gapText(r) { return (r.gap >= 0 ? '<span class="is-ok">주거자금 여유 ' + F.abs(r.gap) + '</span>' : '<span class="is-bad">주거자금 부족 ' + F.abs(r.gap) + '</span>') + ' · ' + U.statusText(r.status); }
  function sandboxResult(S, ex) {
    var amt = Number(S.ui.sandbox) * 10000;
    if (!(amt > 0)) return '';
    var sb = A.sandbox(myPlan(S).data, finalRecs(S), amt, { today: S.today, settings: S.settings });
    return '<div class="sb-out"><p>목표일 주거자금: ' + F.money(ex.forecastPlan.at.usableHousing) + ' → <strong>' + F.money(sb.result.at.usableHousing) + '</strong> (' + F.signed(sb.result.at.usableHousing - ex.forecastPlan.at.usableHousing) + ')</p>' +
      (sb.cashShort > 0 ? '<p class="banner banner-bad"><strong>생활자금 부족</strong> — 이번 달 남는 돈과 선택 지출 예산을 모두 줄여도 ' + F.money(sb.cashShort) + '이 모자랍니다. 비상금을 쓰거나 금액을 줄여야 합니다.</p>' : '<p class="muted small">이번 달 선택 지출 예산 안에서 충당할 수 있는 금액입니다.</p>') + '</div>';
  }

  function alertsView(S) {
    var ex = exec(S), al = A.alerts(ex, { now: S.today, linked: !!S.sync, lastSync: S.sync && S.sync.lastSync }), s = ex.settings;
    var f = function (k, l, u, help) { return '<div class="field"><label for="set-' + k + '">' + l + '</label><div class="input-wrap"><input id="set-' + k + '" data-set="' + k + '" type="text" inputmode="numeric" value="' + s[k] + '"><span class="unit">' + u + '</span></div>' + (help ? '<p class="help">' + help + '</p>' : '') + '</div>'; };
    return '<section class="card"><h2>경보</h2>' + PL.alertList(al) + '</section>' +
      '<section class="card"><h2>경보 기준</h2><div class="field-grid">' + f('dueDay', '납입 예정일', '일') + f('graceDays', '유예기간', '일', '예정일 + 유예기간이 지나야 미달로 판단') + f('cumTolerancePct', '누적 미달 허용 범위', '%') + f('budgetTolerancePct', '생활비 예산 초과 허용', '%') + f('emergencyMinMonths', '비상금 최소 기준', '개월', '필수생활비 기준') + f('staleDays', '계좌 데이터 갱신 기준', '일') + '</div>' +
      '<p class="field-error" id="setErr" hidden></p><button type="button" class="btn" data-action="saveSettings">기준 저장</button></section>';
  }

  function txView(S) {
    var d = myPlan(S).data;
    var purposes = [['salary', '급여'], ['spending', '생활비'], ['emergency', '비상금'], ['housing', '주거자금']].concat((d.products || []).map(function (p) { return ['product:' + p.id, p.name]; })).concat([['debt', '대출 상환']]);
    var cls = [['', '선택'], ['housing', '주거자금 납입'], ['emergency', '비상금 적립'], ['debt', '부채 상환']].concat((d.products || []).map(function (p) { return ['product:' + p.id, p.name + ' 납입']; })).concat([['expense:essential', '생활비(필수)'], ['expense:optional', '생활비(선택)'], ['income', '소득'], ['ownTransfer', '본인 계좌 간 이체(목적 없음)'], ['exclude', '제외']]);
    var html = '<section class="card"><div class="card-head"><h2>계좌 연동</h2>' + U.badge(S.sync ? '마지막 갱신 ' + F.date(S.sync.lastSync) + ' (' + (S.sync.provider === 'demo' ? '시연용' : S.sync.provider === 'csv' ? 'CSV' : S.sync.provider) + ')' : '아직 불러오지 않음') + '</div>' +
      '<p class="muted small">은행 아이디·비밀번호·인증서는 받지 않습니다. 은행 앱에서 내려받은 거래내역 CSV를 가져오거나, 공모전 시연용 가짜 거래를 불러올 수 있습니다. 실제 마이데이터·오픈뱅킹 연동은 허가받은 사업자와 계약 후 같은 연결부에 붙입니다.</p>' +
      '<div class="two-col"><div><h3 class="sub-head">거래내역 CSV 가져오기</h3><p class="help">첫 줄: 날짜,금액,적요,보낸계좌,받은계좌 (출금은 −)</p><input type="file" id="csvFile" accept=".csv,text/csv"><textarea id="csvText" rows="4" placeholder="또는 CSV 내용을 붙여넣기"></textarea><button type="button" class="btn btn-secondary" data-action="importCsv">가져오기</button></div>' +
      '<div><h3 class="sub-head">시연용 거래 불러오기</h3><div class="field"><label for="demoMonth">월</label><input type="month" id="demoMonth" value="' + C.ymAdd(S.todayYm, 0) + '"></div><button type="button" class="btn btn-secondary" data-action="demoSync">시연용 거래 불러오기</button></div></div></section>';
    html += '<section class="card"><h2>내 계좌 (끝 4자리만 저장)</h2><ul class="plain-list">' + (S.accounts.length ? S.accounts.map(function (a) { return '<li>' + esc(a.label) + ' ' + esc(a.masked) + ' — ' + esc((purposes.filter(function (p) { return p[0] === a.purpose; })[0] || [0, a.purpose])[1]) + '</li>'; }).join('') : '<li class="muted">등록된 계좌 없음</li>') + '</ul>' +
      '<div class="field-grid"><div class="field"><label for="accLabel">이름</label><input id="accLabel" type="text" maxlength="30"></div><div class="field"><label for="accNo">계좌번호(끝 4자리 이상)</label><input id="accNo" type="text" inputmode="numeric" autocomplete="off"></div><div class="field"><label for="accPurpose">용도</label><select id="accPurpose">' + purposes.map(function (p) { return '<option value="' + p[0] + '">' + esc(p[1]) + '</option>'; }).join('') + '</select></div></div>' +
      '<button type="button" class="btn btn-secondary" data-action="addAccount">계좌 등록</button></section>';
    html += '<section class="card"><h2>거래 확인</h2><p class="muted small">이체가 발견되어도 자동으로 목표 저축으로 확정하지 않습니다. 받은 계좌와 목적을 확인한 뒤 분류해 주세요. 본인 계좌 간 이체는 소득이나 자산 증가로 세지 않습니다.</p><div class="table-scroll"><table class="compare-table tx-table"><thead><tr><th scope="col">날짜</th><th scope="col">금액</th><th scope="col">내용</th><th scope="col">보낸→받은</th><th scope="col">제안</th><th scope="col">확인</th></tr></thead><tbody>' +
      (S.txs.length ? S.txs.map(function (t) {
        var sug = t.suggested || {};
        return '<tr><td>' + t.date + '</td><td class="' + (t.amount < 0 ? 'neg' : '') + '">' + F.signed(t.amount) + '</td><td>' + esc(t.description) + (t.source === 'demo' ? ' ' + U.badge('시연용') : '') + '</td><td class="small">' + esc(t.fromMasked || '—') + ' → ' + esc(t.toMasked || '—') + '</td><td class="small">' + esc(sug.reason || '') + '</td><td>' +
          (t.confirmedAt ? U.pill('ok', (cls.filter(function (c) { return c[0] === t.classification; })[0] || [0, t.classification])[1]) : '<select data-txsel="' + t.id + '" aria-label="분류">' + cls.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] && c[0] === sug.category ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select> <button type="button" class="btn btn-small" data-txconfirm="' + t.id + '">확인</button>') + '</td></tr>';
      }).join('') : '<tr><td colspan="6">거래 없음</td></tr>') + '</tbody></table></div></section>';
    return html;
  }

  // 진단·판정: 실행 기준 계획(합의한 계획) + 고객 최신 입력 기준 예측(계획은 바꾸지 않음)
  function diagView(S) {
    var pl = myPlan(S); if (!pl) return '<section class="card"><p class="muted">아직 설계사가 계획을 만들지 않았습니다. ‘내 정보·실적 입력’에서 정보를 저장하면 설계사에게 전달됩니다.</p></section>';
    var res = C.simulate(pl.data), d = pl.data;
    var html = '<section class="card"><h2>목표 달성 판정 — 실행 기준 계획</h2><p class="muted small">' + esc(PL.vLabel(pl)) + ' · 설계사 작성, 고객 확인 · ' + esc(pl.note || '') + '</p><div class="verdict-grid">' + PL.verdictBlock(res, '실행 기준', 'after') + '</div></section>';
    if (S.cd && S.cd.version) {
      var df = FP.ClientData.diff(d, S.cd.data, { kind: pl.kind });
      if (df.length) {
        var lr = C.simulate(FP.ClientData.applyToPlan(d, S.cd.data, { kind: pl.kind }));
        html += '<section class="card"><h2>최신 입력 정보로 다시 본 예상</h2><p class="small">내가 저장한 최신 정보(v' + S.cd.version + ')가 계획과 다른 항목: ' + df.map(function (x) { return esc(x.label) + ' ' + esc(x.plan) + '→' + esc(x.client); }).join(', ') + '</p>' +
          '<p>목표일 주거자금 ' + gapText(res) + ' → <strong>' + gapText(lr) + '</strong></p><p class="muted small">예측만 다시 계산했습니다. 합의한 실행 기준 계획은 바뀌지 않으며, 설계사가 검토해 새 계획을 제시하면 선택할 수 있습니다.</p></section>';
      }
    }
    html += '<section class="card"><h2>매달 기준</h2><ul class="plain-list"><li>생활비 예산: 필수 ' + F.money(d.expenses.essential) + ' + 선택 ' + F.money(d.expenses.optional) + '</li><li>부채 상환: 월 ' + F.money(res.rows[1].debtPaid) + ' (' + F.ym(d.basis.baseMonth, res.debtFree) + ' 완료 예상)</li>' + (d.products || []).map(function (p) { return '<li>' + esc(p.name) + ': 월 ' + F.money(p.monthly) + ' (' + p.startMonth + '부터)</li>'; }).join('') + '<li>남는 돈은 비상금(' + F.money(d.goals.emergencyTarget) + '까지) → 주거자금 순서</li></ul></section>';
    var ind = A.indicators(res), pc = function (v) { return v === null ? '계산 불가' : F.pct(v, 1); };
    html += '<section class="card"><h2>재무진단 지표 <span class="muted small">(' + ind.baseYm + ' 기준)</span></h2><ul class="plain-list small">' +
      '<li>월 소득 ' + F.money(ind.income) + ' − 생활비 ' + F.money(ind.expense) + ' − 상환 ' + F.money(ind.debtPaid) + ' = 월 여유 <strong>' + F.money(ind.surplus) + '</strong></li>' +
      '<li>총자산 ' + F.money(ind.totalAssets) + ' · 총부채 ' + F.money(ind.totalDebt) + ' · 순자산 ' + F.money(ind.netWorth) + '</li>' +
      '<li>바로 쓸 수 있는 돈 ' + F.money(ind.liquid) + ' (필수생활비 ' + F.months(ind.liquidMonths) + ') · 사용 제한 자산 비중 ' + pc(ind.restrictedShare) + '</li>' +
      '<li>비상금 ' + F.money(ind.emergency) + ' (' + F.months(ind.emergencyMonths) + ') → 목표일 ' + F.money(ind.emergencyAtTarget) + '</li>' +
      '<li>부채/자산 ' + pc(ind.debtToAssets) + ' · 월 상환/소득 ' + pc(ind.repayTotalToIncome) + ' · 부채 상환 완료 ' + F.ym(d.basis.baseMonth, ind.debtFree) + '</li></ul></section>';
    return html;
  }
  function pathView(S) {
    if (!myPlan(S)) return '<section class="card"><p class="muted">계획이 아직 없습니다.</p></section>';
    return '<section class="card"><h2>주거자금 경로</h2><div class="legend"><span><i class="lg dash after"></i>계획 예상</span><span><i class="lg actual"></i>실제 기록</span><span><i class="lg target"></i>목표금액</span></div><div class="chart-box" id="clientChart"></div></section>';
  }
  function monthlyAll(S) { return (myPlan(S) ? month(S) : '') + FP.Client.monthlyCore(S); }
  function inboxAll(S) { return FP.Client.inboxCore(S) + (myPlan(S) ? alertsView(S) : ''); }
  function drawPlan(S) {
    var box = root.document.getElementById('clientChart'); if (!box) return;
    var pl = myPlan(S), res = C.simulate(pl.data), ex = exec(S), N = res.T + 3, base = pl.data.basis.baseMonth;
    var labels = []; for (var i = 0; i <= N; i++) labels.push(C.ymAdd(base, i));
    FP.Chart.line(box, { labels: labels, target: { value: res.targetTotal, label: '목표금액' }, events: [{ index: res.T, label: '이사 예정', color: 'var(--c-target)' }],
      series: [{ name: '계획 예상', color: 'var(--c-after)', values: res.rows.slice(0, N + 1).map(function (r) { return r.usableHousing; }), dash: true },
        { name: '실제 기록', color: 'var(--c-actual)', values: labels.map(function (_, t) { return t === 0 || (t <= ex.lastRecorded && ex.actuals[t]) ? ex.forecastPlan.rows[t].usableHousing : null; }), points: true, width: 3 }], ariaLabel: '내 주거자금 계획과 실제 기록' });
  }

  FP.Client = { TABS: TABS, myPlan: myPlan, month: month, alerts: alertsView, tx: txView, diag: diagView, path: pathView, drawPlan: drawPlan, monthlyAll: monthlyAll, inboxAll: inboxAll,
    input: function (S) { return FP.ClientInput.page(S); }, products: function (S) { return FP.ProductsView.view(S); }, abc: function (S) { return FP.Offers.client(S) + FP.Features.strategySection(S); } };
})(this);
