/*
 * 설계사 화면
 */
(function (root) {
  'use strict';
  var FP = root.FP, C = FP.Calc, A = FP.Analysis, U = FP.UI, F = U.F, esc = U.esc, PF = FP.PlanForm;

  var TABS = [['diag', '진단·판정'], ['path', '자금 경로'], ['shock', '충격 시나리오'], ['reverse', '생활비 역산'], ['policy', '정책·상품'], ['income', '소득 가정'], ['edit', '계획 버전'], ['records', '실행 기록'], ['verify', '계산 검증']];

  function plans(S) {
    var b = S.plans.filter(function (p) { return p.id === S.ui.beforeId; })[0] || latest(S, 'before');
    var a = S.plans.filter(function (p) { return p.id === S.ui.afterId; })[0] || latest(S, 'after') || b;
    return { before: b, after: a };
  }
  function latest(S, kind) { var l = S.plans.filter(function (p) { return p.kind === kind; }); return l[l.length - 1] || null; }
  function vLabel(p) { return p ? (p.kind === 'before' ? '설계 전' : '설계 후') + ' v' + p.version + ' · ' + F.date(p.createdAt) : '없음'; }

  function header(S) {
    var p = plans(S);
    var opts = function (kind, sel) { return S.plans.filter(function (x) { return x.kind === kind; }).map(function (x) { return '<option value="' + x.id + '"' + (x.id === sel ? ' selected' : '') + '>v' + x.version + ' · ' + esc(x.label || '') + ' (' + F.date(x.createdAt) + ')</option>'; }).join(''); };
    return '<div class="compare-bar card">' +
      '<div class="field"><label for="selBefore"><span class="plan-tag before">설계 전</span> 비교 버전</label><select id="selBefore" data-select="beforeId">' + opts('before', p.before && p.before.id) + '</select></div>' +
      '<div class="field"><label for="selAfter"><span class="plan-tag after">설계 후</span> 비교 버전</label><select id="selAfter" data-select="afterId">' + opts('after', p.after && p.after.id) + '</select></div>' +
      '<p class="muted small">계획은 덮어쓰지 않고 버전으로 쌓입니다. 고객: ' + esc(S.client.profile.name) + ' · 공모전용 가상 고객</p></div>';
  }

  // 설계 전후 차이로 개선·악화 이유 만들기
  function diffs(b, a) {
    var out = [], g = PF.get;
    function chg(path, label, unit) { var x = Number(g(b, path)) || 0, y = Number(g(a, path)) || 0; if (Math.abs(x - y) > 0.5) out.push({ path: path, text: label + ' ' + (unit === 'pct' ? x + '% → ' + y + '%' : F.money(x) + ' → ' + F.money(y)), d: y - x }); }
    chg('expenses.optional', '선택 지출'); chg('expenses.essential', '필수생활비'); chg('plan.extraRepayment', '월 추가 상환'); chg('plan.lumpSum', '초기 일시 상환'); chg('income.netMonthly', '실수령'); chg('goals.housingTarget', '목표 보증금'); chg('plan.investShare', '투자 비율', 'pct');
    var pb = (b.products || []).length, pa = (a.products || []).length; if (pb !== pa) out.push({ path: 'products', text: '정책상품 ' + pb + '개 → ' + pa + '개 (월 ' + F.money((a.products || []).reduce(function (s, p) { return s + p.monthly; }, 0)) + ' 납입)' });
    if (b.basis.moveMonth !== a.basis.moveMonth) out.push({ path: 'basis.moveMonth', text: '이사 예정월 ' + b.basis.moveMonth + ' → ' + a.basis.moveMonth });
    if (a.plan && a.plan.cut) out.push({ path: 'plan.cut', text: '생활비 절감 계획 월 ' + F.money(a.plan.cut.amount) + ' (' + a.plan.cut.startMonth + '부터)' });
    return out;
  }
  function why(list, paths, bv, av, betterHigher) {
    var rel = list.filter(function (x) { return paths.indexOf(x.path) >= 0 || paths.indexOf('*') >= 0; });
    if (bv === null || av === null || bv === undefined || av === undefined) return rel.length ? '변화 요인: ' + rel.map(function (r) { return r.text; }).join(', ') : '';
    var d = av - bv; if (Math.abs(d) < 1) return '변화 없음' + (rel.length ? ' — ' + rel.map(function (r) { return r.text; }).join(', ') : '');
    var better = betterHigher ? d > 0 : d < 0;
    return '<strong class="' + (better ? 'is-ok' : 'is-bad') + '">' + (better ? '개선' : '악화') + '</strong> — ' + (rel.length ? rel.map(function (r) { return esc(r.text); }).join(', ') : '입력 변화의 누적 효과');
  }

  function verdictBlock(res, title, tag) {
    var v = A.verdict(res);
    return '<div class="verdict-col"><div class="verdict-head"><span class="plan-tag ' + tag + '">' + title + '</span>' + U.pill(v.status, v.label) + '<span class="muted small">목표일 ' + v.ym + ' 말</span></div><ul class="cond-list">' +
      v.conds.map(function (c) { return '<li class="' + (c.ok ? 'is-ok' : 'is-bad') + '"><span aria-hidden="true">' + (c.ok ? '✓' : '✗') + '</span> ' + esc(c.label) + ' — ' + (c.ok ? '충족' : '미충족') + ' <span class="muted">(' + (c.id === 'debt' ? '잔액 ' + F.money(c.value) : F.money(c.value) + ' / 기준 ' + F.money(c.target)) + ')</span></li>'; }).join('') + '</ul></div>';
  }

  // ---------- 진단·판정 ----------
  function diag(S) {
    var p = plans(S); if (!p.before) return '<p>계획이 없습니다.</p>';
    var rb = C.simulate(p.before.data), ra = C.simulate(p.after.data);
    var ib = A.indicators(rb), ia = A.indicators(ra), dl = diffs(p.before.data, p.after.data), STD = A.PLANNER_STANDARDS;
    var base = p.after.data.basis.baseMonth;
    var flowDef = function (what) { return '기준일: ' + ib.flowYm + '(설계 첫 달), 단위: 만원/월, 정의: ' + what; };
    var stockDef = function (what) { return '기준일: ' + ib.baseYm + ' 말(초기 일시 상환·현금 배분 반영 후), 단위: 만원, 정의: ' + what; };
    var html = header(S);
    html += '<section class="card"><div class="card-head"><h2>목표 판정</h2><span class="badge">세 조건 각각 확인</span></div><div class="verdict-grid">' + verdictBlock(rb, '설계 전', 'before') + verdictBlock(ra, '설계 후', 'after') + '</div>' +
      '<p class="muted small">세 조건을 모두 충족해야 ‘전체 목표 달성’. 주거자금만 충족하면 ‘부분 충족’. 주거자금은 비상금·연금·반환 전 보증금·만기 전 상품을 빼고, 목표일 말까지 실제로 들어오는 돈만 셉니다.</p></section>';

    var cards = [
      { label: '월 소득', b: F.money(ib.income), a: F.money(ia.income), why: why(dl, ['income.netMonthly'], ib.income, ia.income, true), def: flowDef('실수령 급여 + 환급 유입(해당 시). 소득세 감면이 급여에 반영된 경우 따로 더하지 않음') },
      { label: '월 지출(생활비)', b: F.money(ib.expense), a: F.money(ia.expense), why: why(dl, ['expenses.optional', 'expenses.essential', 'plan.cut'], ib.expense, ia.expense, false), def: flowDef('필수생활비 + 선택·비정기 지출') },
      { label: '월 잉여자금', b: F.money(ib.surplus), a: F.money(ia.surplus), bCls: ib.surplus < 0 ? 'is-bad' : '', aCls: ia.surplus < 0 ? 'is-bad' : '', why: why(dl, ['expenses.optional', 'expenses.essential', 'plan.extraRepayment', 'income.netMonthly', 'plan.cut'], ib.surplus, ia.surplus, true), def: flowDef('소득 − 생활비 − 부채 상환액(추가 상환 포함). 정책상품 납입·비상금·주거자금 적립에 쓸 수 있는 돈') },
      { label: '총자산', b: F.money(ib.totalAssets), a: F.money(ia.totalAssets), why: why(dl, ['plan.lumpSum'], ib.totalAssets, ia.totalAssets, true), def: stockDef('현금·예금 + 비상금 + 주거자금 + 투자 + 반환 전 보증금 + 정책상품 잔액 + 연금') },
      { label: '총부채', b: F.money(ib.totalDebt), a: F.money(ia.totalDebt), why: why(dl, ['plan.lumpSum'], ib.totalDebt, ia.totalDebt, false), def: stockDef('기존 대출 잔액 합계(신규 대출 없음)') },
      { label: '순자산', b: F.money(ib.netWorth), a: F.money(ia.netWorth), bCls: ib.netWorth <= 0 ? 'is-bad' : '', aCls: ia.netWorth <= 0 ? 'is-bad' : '', def: stockDef('총자산 − 총부채') },
      { label: '즉시 사용 가능한 유동자산', b: F.money(ib.liquid), a: F.money(ia.liquid), bSub: '필수생활비 ' + F.months(ib.liquidMonths), aSub: '필수생활비 ' + F.months(ia.liquidMonths), why: why(dl, ['plan.lumpSum'], ib.liquid, ia.liquid, true), def: stockDef('비상금 + 주거자금(예금). 투자자산은 매각·결제 기간과 가격 변동이 있어 제외(준유동). 보유 개월 수 = 유동자산 ÷ 월 필수생활비') },
      { label: '비상자금', std: '설계사 기준 ' + STD.emergencyMonths.value + '개월', b: F.money(ib.emergency), a: F.money(ia.emergency), bSub: F.months(ib.emergencyMonths) + ' 충당', aSub: F.months(ia.emergencyMonths) + ' 충당', bCls: ib.emergencyMonths < STD.emergencyMonths.value ? 'is-bad' : 'is-ok', aCls: ia.emergencyMonths < STD.emergencyMonths.value ? 'is-bad' : 'is-ok', why: why(dl, ['plan.lumpSum'], ib.emergency, ia.emergency, true), def: stockDef('별도 비상금 잔액, 확보 개월 수 = 비상금 ÷ 월 필수생활비. 기준 3개월은 설계사가 정한 기준(공식 출처 기준 아님)') },
      { label: '총자산 대비 부채비중', std: '설계사 기준 ' + STD.debtToAssets.value + '% 이하', b: A.ratioState(ib.debtToAssets, 'debtToAssets', ib) || F.pct(ib.debtToAssets), a: A.ratioState(ia.debtToAssets, 'debtToAssets', ia) || F.pct(ia.debtToAssets), bCls: ib.debtToAssets > STD.debtToAssets.value ? 'is-bad' : '', aCls: ia.debtToAssets > STD.debtToAssets.value ? 'is-bad' : '', bSub: '부채/순자산 ' + (A.ratioState(ib.debtToNet, 'debtToNet', ib) ? '해석 불가' : F.pct(ib.debtToNet)), aSub: '부채/순자산 ' + (A.ratioState(ia.debtToNet, 'debtToNet', ia) ? '해석 불가' : F.pct(ia.debtToNet)), def: stockDef('총부채 ÷ 총자산 × 100. 보조로 표시한 부채/순자산은 분모가 순자산(순자산이 0 이하면 해석 불가로 표시)') },
      { label: '월 소득 대비 원리금 상환비중', std: '설계사 기준 ' + STD.repayToIncome.value + '% 이하', b: A.ratioState(ib.repayTotalToIncome, 'repay', ib) || F.pct(ib.repayTotalToIncome), a: A.ratioState(ia.repayTotalToIncome, 'repay', ia) || F.pct(ia.repayTotalToIncome), bSub: '약정분만 ' + F.pct(ib.repayToIncome), aSub: '약정분만 ' + F.pct(ia.repayToIncome), why: why(dl, ['plan.extraRepayment'], ib.repayTotalToIncome, ia.repayTotalToIncome, false), def: flowDef('월 원리금 상환액(추가 상환 포함) ÷ 월 실수령 소득 × 100. 앱 내부 현금흐름 지표이며 금융기관 규제상 DSR이 아님') },
      { label: '예상 부채 상환 완료', b: F.ym(base, rb.debtFree), a: F.ym(base, ra.debtFree), bCls: rb.debtFree !== null && rb.debtFree <= rb.T ? 'is-ok' : 'is-bad', aCls: ra.debtFree !== null && ra.debtFree <= ra.T ? 'is-ok' : 'is-bad', why: why(dl, ['plan.extraRepayment', 'plan.lumpSum', 'plan.cut'], rb.debtFree === null ? 999 : rb.debtFree, ra.debtFree === null ? 999 : ra.debtFree, false), def: '기준: 월별 계산에서 모든 대출 잔액이 0이 되는 달, 단위: 연-월, 정의: 약정 원리금 + 추가 상환(이자율 높은 대출부터)' },
      { label: '목표일 사용 가능한 주거자금', b: F.money(rb.at.usableHousing), a: F.money(ra.at.usableHousing), bSub: rb.at.ym + ' 말', aSub: ra.at.ym + ' 말', why: why(dl, ['*'], rb.at.usableHousing, ra.at.usableHousing, true), def: '기준일: 각 계획의 이사 예정월 말, 단위: 만원, 정의: 주거자금 예금 + 만기 지급된 상품 + 반환된 보증금' + (ra.includeInvest ? ' + 투자자산(매각 전제)' : '') + '. 비상금·연금·만기 전 상품·목표일 이후 유입 제외' },
      { label: '목표 대비 부족·여유', b: (rb.gap >= 0 ? '여유 ' : '부족 ') + F.abs(rb.gap), a: (ra.gap >= 0 ? '여유 ' : '부족 ') + F.abs(ra.gap), bCls: rb.gap >= 0 ? 'is-ok' : 'is-bad', aCls: ra.gap >= 0 ? 'is-ok' : 'is-bad', bSub: '필요 ' + F.money(rb.targetTotal), aSub: '필요 ' + F.money(ra.targetTotal), why: why(dl, ['*'], rb.gap, ra.gap, true), def: '사용 가능한 주거자금 − (목표 보증금 + 이사 부대비용). 단위: 만원' },
      { label: '사용이 제한된 자산', b: F.money(ib.restricted), a: F.money(ia.restricted), bSub: '총자산의 ' + F.pct(ib.restrictedShare), aSub: '총자산의 ' + F.pct(ia.restrictedShare), def: stockDef('반환 전 보증금(' + F.money(ia.restrictedParts.deposit) + ') + 만기 전 정책상품 + 연금(' + F.money(ia.restrictedParts.pension) + ')') }
    ];
    html += '<div class="metrics-grid">' + cards.map(U.metricCard).join('') + '</div>';
    html += '<section class="card insight"><h2>유동성 진단</h2><p>설계 후 기준 총자산은 <strong>' + F.money(ia.totalAssets) + '</strong>이지만, 지금 바로 쓸 수 있는 돈은 <strong>' + F.money(ia.liquid) + '</strong>(필수생활비 ' + F.months(ia.liquidMonths) + ')입니다. 총자산의 ' + F.pct(ia.restrictedShare) + '는 반환 전 보증금·만기 전 상품·연금처럼 당장 쓸 수 없고, 투자자산 ' + F.money(ia.semiLiquid) + '은 매각해야 하며 그때의 가격에 따라 금액이 달라집니다. 같은 시점 총자산 대비 부채비중은 ' + (A.ratioState(ia.debtToAssets, 'debtToAssets', ia) || F.pct(ia.debtToAssets)) + ', 월 소득 대비 원리금 상환비중은 ' + F.pct(ia.repayTotalToIncome) + '입니다.</p><p class="muted small">계산 기반 설명 — 숫자는 위 카드와 같은 계산 결과입니다.</p></section>';
    html += warnBlock(ra.warnings.concat(rb.warnings));
    return html;
  }

  function warnBlock(ws) {
    var seen = {}, list = ws.filter(function (w) { if (seen[w.text]) return false; seen[w.text] = 1; return true; });
    if (!list.length) return '';
    return '<section class="card warn-card"><h2>계산 경고</h2><ul>' + list.map(function (w) { return '<li><span class="warn-icon" aria-hidden="true">!</span>' + esc(w.text) + '</li>'; }).join('') + '</ul></section>';
  }

  // ---------- 자금 경로 ----------
  function pathView(S) {
    var p = plans(S);
    return header(S) + '<section class="card"><div class="card-head"><h2>주거자금 경로</h2></div>' +
      '<div class="legend"><span><i class="lg dash before"></i>설계 전 예상</span><span><i class="lg dash after"></i>설계 후 예상</span><span><i class="lg actual"></i>실제 실행(기록 반영)</span><span><i class="lg dot trend"></i>최근 추세 지속 예상</span><span><i class="lg target"></i>목표금액</span></div>' +
      '<div class="chart-box" id="pathChart"></div>' +
      '<p class="muted small">점선은 미래 예상, 실선과 점은 고객이 확인한 실제 기록이 있는 달입니다. 기록이 없는 달은 선을 끊고 0원으로 그리지 않습니다. 세로선: 부채 상환 완료·비상금 확보·상품 만기·보증금 반환·이사 예정.</p></section>' +
      '<section class="card"><h2>표시된 일정</h2><ul class="plain-list" id="pathEvents"></ul></section>';
  }
  function drawPath(S) {
    var box = root.document.getElementById('pathChart'); if (!box) return;
    var p = plans(S), rb = C.simulate(p.before.data), ra = C.simulate(p.after.data);
    var ex = A.execution(p.after.data, FP.Monthly.finalRecords(S.records, S.x ? S.x.closures.map(function (c) { return c.month; }) : []), { today: S.today, settings: S.settings });
    var N = Math.min(C.MAX, Math.max(rb.T, ra.T) + 6), base = p.after.data.basis.baseMonth;
    var labels = []; for (var i = 0; i <= N; i++) labels.push(C.ymAdd(base, i));
    var actual = labels.map(function (_, t) { return t === 0 || (t <= ex.lastRecorded && ex.actuals[t]) ? ex.forecastPlan.rows[t].usableHousing : null; });
    var trend = labels.map(function (_, t) { return t >= ex.lastRecorded ? ex.forecastTrend.rows[t].usableHousing : null; });
    var evs = [], evList = [];
    function ev(t, label, color) { if (t !== null && t !== undefined && t >= 0 && t <= N) { evs.push({ index: t, label: label, color: color }); evList.push(C.ymAdd(base, t) + ' — ' + label); } }
    ev(ra.debtFree, '부채 상환 완료', 'var(--c-after)'); ev(ra.emergencyOkMonth, '비상금 확보', 'var(--ok)');
    ra.products.forEach(function (pr) { ev(pr.maturity, pr.name + ' 만기', pr.beforeTarget ? 'var(--c-after)' : 'var(--bad)'); });
    var dep = ra.rows.findIndex(function (r) { return r.depositIn > 0; }); ev(dep, '보증금 반환', 'var(--muted)');
    ev(ra.T, '이사 예정(설계 후)', 'var(--c-target)'); if (rb.T !== ra.T) ev(rb.T, '이사 예정(설계 전)', 'var(--c-before)');
    if (ra.taxRelief) ev(ra.taxRelief.end + 1, '소득세 감면 종료', 'var(--muted)');
    FP.Chart.line(box, {
      labels: labels, target: { value: ra.targetTotal, label: '목표금액' }, events: evs,
      series: [
        { name: '설계 전 예상', color: 'var(--c-before)', values: rb.rows.slice(0, N + 1).map(function (r) { return r.usableHousing; }), dash: true },
        { name: '설계 후 예상', color: 'var(--c-after)', values: ra.rows.slice(0, N + 1).map(function (r) { return r.usableHousing; }), dash: true },
        { name: '최근 추세 지속', color: 'var(--c-trend)', values: trend, dash: true, width: 1.6 },
        { name: '실제 실행', color: 'var(--c-actual)', values: actual, points: true, width: 3 }
      ], ariaLabel: '설계 전·설계 후 주거자금 예상 경로와 실제 실행 경로'
    });
    var ul = root.document.getElementById('pathEvents'); evList.sort(); if (ul) ul.innerHTML = evList.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
  }

  // ---------- 충격 시나리오 ----------
  function shockView(S) {
    var p = plans(S), target = S.ui.shockPlan === 'before' ? p.before : p.after, base = target.data.basis.baseMonth;
    var shocks = S.ui.shocks;
    var html = header(S) + '<section class="card"><div class="card-head wrap"><h2>충격 조합</h2><div class="segmented" role="group" aria-label="적용 계획"><button type="button" data-shockplan="after" aria-pressed="' + (S.ui.shockPlan !== 'before') + '">설계 후</button><button type="button" data-shockplan="before" aria-pressed="' + (S.ui.shockPlan === 'before') + '">설계 전</button></div></div>' +
      '<div class="btn-row">' + A.SHOCK_TYPES.map(function (t) { return '<button type="button" class="btn btn-secondary btn-small" data-addshock="' + t.type + '">+ ' + t.label + '</button>'; }).join('') + '</div>';
    if (!shocks.length) html += '<p class="muted">충격을 추가하세요. 여러 개를 함께 적용할 수 있습니다.</p>';
    html += '<div class="shock-list">' + shocks.map(function (s, i) {
      var t = A.SHOCK_TYPES.filter(function (x) { return x.type === s.type; })[0];
      var startYm = C.ymAdd(base, s.start);
      return '<div class="shock-row"><strong>' + t.label + '</strong>' +
        '<div class="field"><label for="sh-' + i + '-start">시작월</label><input id="sh-' + i + '-start" type="month" data-shock="' + i + '" data-key="start" value="' + startYm + '"></div>' +
        (s.type === 'targetRise' || s.type === 'depositDelay' || s.type === 'investLoss' ? '' : '<div class="field"><label for="sh-' + i + '-dur">지속(개월, 0=계속)</label><input id="sh-' + i + '-dur" type="number" min="0" max="120" data-shock="' + i + '" data-key="duration" value="' + s.duration + '"></div>') +
        '<div class="field"><label for="sh-' + i + '-size">' + t.sizeLabel + ' (' + (t.unit.indexOf('원') === 0 ? '만원' : t.unit) + ')</label><input id="sh-' + i + '-size" type="number" step="any" data-shock="' + i + '" data-key="size" value="' + (t.unit.indexOf('원') === 0 ? s.size / 10000 : s.size) + '"></div>' +
        '<button type="button" class="btn btn-small btn-danger-ghost" data-delshock="' + i + '">삭제</button></div>';
    }).join('') + '</div></section>';
    if (shocks.length) {
      var r = A.shockImpact(target.data, shocks);
      var row = function (l, b, a, cls) { return '<tr><th scope="row">' + l + '</th><td>' + b + '</td><td class="' + (cls || '') + '">' + a + '</td></tr>'; };
      html += '<section class="card"><h2>충격 결과 (' + (S.ui.shockPlan === 'before' ? '설계 전' : '설계 후') + ' 계획)</h2><div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">항목</th><th scope="col">충격 없음</th><th scope="col">충격 적용</th></tr></thead><tbody>' +
        row('판정', U.statusText(r.statusBase), U.statusText(r.status), r.status === 'achieved' ? 'is-ok' : 'is-bad') +
        row('목표 부족액·여유액', (r.gapBase >= 0 ? '여유 ' : '부족 ') + F.abs(r.gapBase), (r.gap >= 0 ? '여유 ' : '부족 ') + F.abs(r.gap) + ' (' + F.signed(r.gapChange) + ')', r.gap >= 0 ? 'is-ok' : 'is-bad') +
        row('비상금 소진', '—', r.emergencyDepleted ? '소진됨 (최저 ' + F.money(Math.max(0, r.emergencyMin)) + ')' : '소진 안 됨 (최저 ' + F.money(r.emergencyMin) + ')', r.emergencyDepleted ? 'is-bad' : 'is-ok') +
        row('미충당 적자', '—', r.unfunded > 0.5 ? F.money(r.unfunded) : '없음', r.unfunded > 0.5 ? 'is-bad' : '') +
        row('부채 상환 완료', F.ym(base, r.debtFreeBase), F.ym(base, r.debtFree) + (r.debtFree !== null && r.debtFreeBase !== null && r.debtFree !== r.debtFreeBase ? ' (' + (r.debtFree - r.debtFreeBase > 0 ? '+' : '') + (r.debtFree - r.debtFreeBase) + '개월)' : '')) +
        row('목표 달성 지연', r.delayBase === null ? '10년 내 어려움' : r.delayBase + '개월', r.delay === null ? '10년 내 어려움' : r.delay + '개월' + (r.delayBase !== null && r.delay !== null ? ' (' + (r.delay - r.delayBase >= 0 ? '+' : '') + (r.delay - r.delayBase) + ')' : ''), r.delay === 0 ? 'is-ok' : 'is-bad') +
        '</tbody></table></div><p class="muted small">목표 달성 지연 = 같은 계획을 유지할 때 세 조건을 모두 충족하는 첫 달 − 이사 예정월. 투자 손실은 시작월에 한 번 반영, 보증금 반환 지연은 반환월을 뒤로 미룹니다.</p></section>';
    }
    return html;
  }

  // ---------- 생활비 역산 ----------
  function reverseView(S) {
    var p = plans(S), d = p.after.data, base = d.basis.baseMonth;
    var startYm = S.ui.cutStart || C.ymAdd(base, Math.max(1, C.ymDiff(base, S.todayYm)));
    var minEss = S.ui.cutMinEss !== undefined ? S.ui.cutMinEss : (d.expenses.minEssential || d.expenses.essential);
    var html = header(S) + '<section class="card"><h2>목표 시점을 유지하려면 월 생활비를 최소 얼마 줄여야 하나</h2>' +
      '<p class="muted small">기준 계획: <span class="plan-tag after">' + esc(vLabel(p.after)) + '</span> · 이사 예정 ' + d.basis.moveMonth + '</p>' +
      '<div class="field-grid"><div class="field"><label for="cutStart">절감 시작월</label><input id="cutStart" type="month" value="' + startYm + '" data-ui="cutStart"></div>' +
      '<div class="field"><label for="cutMin">최소 필수생활비</label><div class="input-wrap"><input id="cutMin" type="text" inputmode="decimal" value="' + Math.round(minEss / 10000) + '" data-ui="cutMinEss"><span class="unit">만원</span></div><p class="help">현재 필수생활비 ' + F.money(d.expenses.essential) + ' · 선택 지출 ' + F.money(d.expenses.optional) + '</p></div></div>';
    var start = C.ymDiff(base, startYm);
    if (!(start >= 1)) return html + '<p class="field-error">시작월은 기준월(' + base + ') 이후여야 합니다.</p></section>';
    var rc = A.reverseCut(d, { start: start, minEssential: minEss });
    html += '</section><section class="card"><div class="card-head"><h2>역산 결과</h2><span class="badge">전체 월별 계산 반복</span></div>';
    if (rc.alreadyAchieved) html += '<p class="is-ok"><strong>이미 세 조건을 모두 충족합니다.</strong> 추가 절감이 필요하지 않습니다.</p>';
    else if (!rc.feasible) html += '<p class="banner banner-bad"><strong>생활비 절감만으로 달성 불가</strong> — 절감 가능한 최대 금액(월 ' + F.money(rc.maxCut) + ' = 선택 지출 전액 + 필수생활비 중 최소선 초과분)을 모두 줄여도 목표 시점에 세 조건을 충족하지 못합니다.</p>';
    else {
      html += '<p class="big-answer">' + rc.startYm + '부터 매월 <strong>' + F.money(rc.required) + '</strong> 절감</p>' +
        '<ul class="plain-list"><li>선택 지출에서 ' + F.money(rc.fromOptional) + (rc.fromEssential ? ', 필수생활비에서 ' + F.money(rc.fromEssential) + ' (최소선 ' + F.money(rc.minEssential) + ' 유지)' : '') + '</li>' +
        '<li>절감한 돈은 부채가 남아 있으면 이자율 높은 대출부터 추가 상환하고, 다 갚으면 저축으로 갑니다.</li>' +
        '<li>적용 후 확인: ' + rc.check.conds.map(function (c) { return c.label + ' ' + (c.ok ? '충족' : '미충족'); }).join(' · ') + ' → ' + U.statusText(rc.check.status) + '</li></ul>' +
        '<button type="button" class="btn" data-action="applyCut">이 결과로 새 수정안 저장</button>';
    }
    html += '<p class="muted small">참고값(단순 계산): 현재 부족액 ' + F.abs(Math.min(0, rc.baseGap)) + ' ÷ 남은 ' + rc.remaining + '개월 = 월 ' + F.money(rc.reference) + '. 이자·비상금 우선 배분·부채 조건을 반영하지 않으므로 결정에는 위의 월별 계산 결과를 사용합니다.</p></section>';
    var alt = rc.alt;
    html += '<section class="card"><h2>별도 대안</h2><ul class="suggest-list">' +
      '<li><span>' + (alt.extraIncome !== null ? '월 추가 소득 ' + F.money(alt.extraIncome) + '이 ' + rc.startYm + '부터 있으면 달성(부채가 남아 있으면 상환 우선)' : '월 1,000만원 이하 추가 소득으로는 달성 어려움') + '</span></li>' +
      '<li><span>목표 보증금을 ' + F.money(alt.targetFit) + '로 ' + F.money(alt.targetCut) + ' 낮추면 주거자금 조건 충족' + (alt.targetFitStillShort ? ' — 단, 부채·비상금 조건은 별도로 미충족' : '') + '</span></li>' +
      '<li><span>' + (alt.extendBy !== null ? '지금 계획 그대로 목표 시점을 ' + alt.extendBy + '개월 늦추면(' + alt.extendYm + ') 달성' : '지금 계획으로는 10년 안에 달성 어려움') + '</span></li></ul></section>';
    if (S.ui.cutApplied) html += '<section class="card"><h2>적용 전후 비교</h2>' + S.ui.cutApplied + '</section>';
    return html;
  }

  // ---------- 정책·상품 ----------
  function policyView(S) {
    var p = plans(S), d = p.after.data, prof = S.client.profile;
    var rv = A.policyReview(d, prof);
    var noProd = JSON.parse(JSON.stringify(d)); noProd.products = [];
    var r1 = C.simulate(d), r0 = C.simulate(noProd);
    var html = header(S) + '<section class="card"><h2>정책 적용 전후 (설계 후 계획 기준)</h2><div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">항목</th><th scope="col">정책상품 제외</th><th scope="col">정책상품 포함</th></tr></thead><tbody>' +
      '<tr><th scope="row">목표일 사용 가능 주거자금</th><td>' + F.money(r0.at.usableHousing) + '</td><td>' + F.money(r1.at.usableHousing) + ' (' + F.signed(r1.at.usableHousing - r0.at.usableHousing) + ')</td></tr>' +
      '<tr><th scope="row">월 납입 부담</th><td>0원</td><td>' + F.money(rv.allocated - (d.plan.extraRepayment || 0)) + ' (잉여자금의 ' + F.pct(rv.available > 0 ? (rv.allocated - (d.plan.extraRepayment || 0)) / rv.available * 100 : null) + ')</td></tr>' +
      '<tr><th scope="row">판정</th><td>' + U.statusText(r0.status) + '</td><td>' + U.statusText(r1.status) + '</td></tr></tbody></table></div>' +
      (rv.duplicate ? '<p class="banner banner-bad">상품 납입 + 추가 상환(' + F.money(rv.allocated) + ')이 월 잉여자금(' + F.money(rv.available) + ')보다 큽니다. 같은 돈을 여러 곳에 배정하고 있습니다.</p>' : '<p class="muted small">같은 자금 중복 배정 없음: 상품 납입 + 추가 상환 ' + F.money(rv.allocated) + ' ≤ 월 잉여자금 ' + F.money(rv.available) + '</p>') + '</section>';
    rv.items.forEach(function (it) { html += policyCard(it, d, S); });
    return html;
  }
  function chip(f) { return f.status === 'confirmed' ? '<span class="chip chip-ok">확인</span>' : '<span class="chip chip-warn">확인 필요</span>'; }
  function src(id) { var s = FP.Policies.SOURCES[id]; return s ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' : '—'; }
  function checks(list) { return '<ul class="check-list">' + list.map(function (c) { return '<li>' + U.pill(c.result, c.result === 'pass' ? '충족' : c.result === 'fail' ? '불충족' : '확인 필요') + ' <strong>' + esc(c.label) + '</strong> — ' + esc(c.detail) + '</li>'; }).join('') + '</ul>'; }
  function policyCard(it, d, S) {
    var pol = it.policy;
    var rows = Object.keys(pol.fields).map(function (k) { var f = pol.fields[k]; var v = f.value === null ? '' : typeof f.value === 'object' ? (Array.isArray(f.value) ? f.value.map(function (x) { return '≤' + F.money(x.max) + ' ' + x.rate + '%'; }).join(', ') : '') : typeof f.value === 'number' && f.value < 1 ? (f.value * 100) + '%' : typeof f.value === 'number' ? F.money(f.value) : f.value === true ? '예' : String(f.value); return '<tr><td>' + esc(v) + (f.note ? '<div class="muted small">' + esc(f.note) + '</div>' : '') + '</td><td>' + chip(f) + '</td><td class="small">' + (f.source ? src(f.source) : '—') + '</td></tr>'; }).join('');
    var html = '<section class="card policy"><div class="card-head wrap"><h2>' + esc(pol.name) + '</h2><span class="muted small">' + esc(pol.agency) + ' · 확인일 ' + pol.checkedAt + '</span></div>';
    if (it.checks) html += '<h3 class="sub-head">가입 가능성</h3>' + checks(it.checks);
    if (it.maturityYm) html += '<p><strong>만기와 이사 시점:</strong> 만기 ' + it.maturityYm + ' / 이사 ' + d.basis.moveMonth + ' → ' + (it.maturityOk ? '<span class="is-ok">이사 전 만기 — 목표 재원에 포함 가능</span>' : '<span class="is-bad">이사 후 만기 — 목표일 주거자금에 넣지 않음(만기 전 잔액은 사용 제한)</span>') + '</p>';
    if (it.monthly) html += '<p><strong>납입 부담:</strong> 월 ' + F.money(it.monthly) + ' (월 잉여자금의 ' + F.pct(it.burden) + ')</p>';
    if (it.cash) html += '<p><strong>현금흐름 효과(만기 시):</strong> 본인 납입 ' + F.money(it.cash.principal) + ' · 정부기여금 ' + F.money(it.cash.gov) + '(일반형 6% 매칭) · 이자 확인 필요 · ' + esc(it.cash.tax) + '</p>';
    if (it.annualBenefit !== undefined) html += '<p><strong>감면 효과:</strong> 연 ' + F.money(it.annualBenefit) + '(월 ' + F.money(it.monthlyBenefit) + ') — 감면 종료 후 실수령이 그만큼 줄어드는 것을 계산에 반영</p>';
    if (it.lockedAtTarget) html += '<p><strong>목표일 영향:</strong> 만기 전 잔액 약 ' + F.money(it.lockedAtTarget) + '(기업기여 확인 시) 사용 제한 · 같은 돈을 주거자금으로 모으지 못해 목표일 주거자금 ' + F.money(it.housingLoss) + ' 감소</p>';
    if (it.note) html += '<p class="muted small">' + esc(it.note) + '</p>';
    if (it.loan) html += loanBox(it.loan, S);
    html += '<details><summary>저장된 조건과 출처 (' + Object.keys(pol.fields).length + '개)</summary><div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">조건</th><th scope="col">상태</th><th scope="col">출처</th></tr></thead><tbody>' + rows + '</tbody></table></div></details></section>';
    return html;
  }
  function loanBox(L0, S) {
    var p = plans(S), L = A.loanCompare(p.after.data, S.client.profile, { applySmePref: S.ui.loanPref });
    return '<div class="loan-box"><p class="banner banner-warn"><strong>' + esc(L.label) + '</strong> 기본 계획은 ‘신규 대출 없이 이사’를 유지합니다.</p>' + checks(L.eligible) +
      '<label class="check"><input type="checkbox" data-toggle="loanPref"' + (S.ui.loanPref ? ' checked' : '') + '><span>중소기업 취업청년 우대 0.3%p 적용해 보기 (2024-04-26 이후 신규분, 수탁은행 심사로 확정)</span></label>' +
      '<div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">항목</th><th scope="col">무대출 기본안</th><th scope="col">대출 활용 비교안</th></tr></thead><tbody>' +
      '<tr><th scope="row">필요 자기자금</th><td>' + F.money(L.ownNeededNoLoan) + '</td><td>' + F.money(L.ownNeededLoan) + '</td></tr>' +
      '<tr><th scope="row">예상 대출 가능액(승인 아님)</th><td>0원</td><td>' + F.money(L.loan) + ' (보증금의 80%·1.5억원 한도)</td></tr>' +
      '<tr><th scope="row">적용 금리(변동)</th><td>—</td><td>' + (L.finalRate === null ? '소득 기준 초과' : L.rate + '%' + (L.pref ? ' − 우대 ' + L.pref + '%p = ' + L.finalRate + '%' : '')) + '</td></tr>' +
      '<tr><th scope="row">이사 후 월 이자 부담</th><td>0원</td><td>' + (L.monthlyInterest === null ? '—' : F.money(L.monthlyInterest)) + '</td></tr>' +
      '<tr><th scope="row">이사 시점 부채</th><td>기존 ' + F.money(L.existingDebtAtMove) + '</td><td>기존 ' + F.money(L.existingDebtAtMove) + ' + 신규 ' + F.money(L.newDebt) + '</td></tr>' +
      '<tr><th scope="row">판정</th><td>' + U.statusText(L.noLoan.status) + '</td><td>대출 활용 시 자기자금 ' + (L.withLoan.gap >= 0 ? '충족' : '부족 ' + F.abs(L.withLoan.gap)) + ' — 무대출 목표 충족 아님</td></tr></tbody></table></div>' +
      '<p class="muted small">대출금은 소득이나 순자산 증가로 계산하지 않습니다.</p></div>';
  }

  // ---------- 소득 가정 ----------
  function incomeView(S) {
    var p = plans(S), d = p.after.data, prof = S.client.profile;
    var sc = A.incomeScenarios(d, S.ui.customRaise !== undefined ? { raisePct: S.ui.customRaise } : null);
    var sens = A.sensitivity(d);
    var age = A.ageAt(prof.birthMonth, d.basis.baseMonth), tenure = C.ymDiff(prof.employStart, d.basis.baseMonth);
    var html = header(S) + '<section class="card"><h2>임금 상승 시나리오 (설계 후 계획)</h2><p class="muted small">1~2%는 확정 전망이 아닌 시뮬레이션 가정입니다. 세전 인상률이 실수령에 그대로 반영된다고 보지 않고, 실수령 반영률 ' + (d.income.netPassThrough || 0.75) + '배를 곱합니다(단순화 가정 — 실제 세금·보험료 계산 아님). 인상 적용 달: 매년 ' + (d.income.raiseMonth || 1) + '월.' + (d.income.promotion && d.income.promotion.month ? ' 승진 인상 ' + d.income.promotion.month + ' 세전 ' + d.income.promotion.pct + '% (' + (d.income.promotion.stack ? '연간 인상과 중복 적용' : '승진 후 12개월 내 연간 인상 생략') + ')' : ' 승진 인상 없음') + '</p>' +
      '<div class="field-inline"><label for="customRaise">사용자 지정 연 인상률</label><div class="input-wrap narrow"><input id="customRaise" type="text" inputmode="decimal" data-ui="customRaise" value="' + (S.ui.customRaise !== undefined ? S.ui.customRaise : '') + '" placeholder="예: 3"><span class="unit">%</span></div></div>' +
      '<div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">가정</th><th scope="col">목표일 실수령</th><th scope="col">주거자금 부족·여유</th><th scope="col">판정</th></tr></thead><tbody>' +
      sc.map(function (x) { return '<tr><th scope="row">' + esc(x.label) + '</th><td>' + F.money(x.salaryAtTarget) + '</td><td class="' + (x.gap >= 0 ? 'is-ok' : 'is-bad') + '">' + (x.gap >= 0 ? '여유 ' : '부족 ') + F.abs(x.gap) + '</td><td>' + U.statusText(x.status) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    var ex = (d.extraIncome || []);
    var al = d.allocation || {}; var rs = al.ratios || {}; var sum = (Number(rs.emergency) || 0) + (Number(rs.debt) || 0) + (Number(rs.housing) || 0);
    html += '<section class="card"><h2>성과급·환급 등 초과소득</h2><p class="muted small">반복 급여와 따로 관리합니다. ‘예상’ 상태는 기본 계획의 확정 재원에 넣지 않습니다.</p>' +
      (ex.length ? '<ul class="plain-list">' + ex.map(function (x) { return '<li>' + x.month + ' · ' + F.money(x.amount) + ' · ' + ({ bonus: '성과급', refund: '환급금', other: '기타' }[x.kind] || x.kind) + ' — ' + (x.status === 'confirmed' ? U.pill('ok', '확정 · 계획 재원') : U.pill('check', '예상 · 계획 재원 아님')) + '</li>'; }).join('') + '</ul>' : '<p class="muted">등록된 초과소득 없음</p>') +
      '<p><strong>배분 규칙:</strong> ' + (al.mode === 'ratio' ? '비율 — 비상금 ' + (rs.emergency || 0) + '% · 부채 ' + (rs.debt || 0) + '% · 주거자금 ' + (rs.housing || 0) + '% ' + (Math.abs(sum - 100) < 0.001 ? U.pill('ok', '합계 100%') : U.pill('bad', '합계 ' + sum + '% — 100%가 되어야 함')) : '순서 — 비상금 부족분 보충 → 부채 추가 상환 → 주거자금') + '. 이미 충족된 항목의 남는 몫은 다음 항목으로 넘어갑니다. (계획 버전 탭에서 수정)</p></section>';
    html += '<section class="card"><h2>현재 소득 수준을 설정한 이유</h2><dl class="kv">' +
      '<dt>연령</dt><dd>' + age + '세 (기준월)</dd><dt>근속</dt><dd>' + Math.floor(tenure / 12) + '년 ' + (tenure % 12) + '개월 (' + prof.employStart + ' 취업)</dd><dt>직종</dt><dd>' + esc(prof.job) + '</dd><dt>기업 규모</dt><dd>' + (prof.companySize === 'sme' ? '중소기업' : esc(prof.companySize)) + '</dd><dt>근무 지역</dt><dd>' + esc(prof.region) + '</dd>' +
      '<dt>소득</dt><dd>세전 연 ' + F.money(prof.annualGross) + ' / 실수령 월 ' + F.money(d.income.netMonthly) + '</dd></dl>' +
      '<p class="banner banner-warn"><strong>공모전용 가상 고객의 소득 가정</strong> — 이 소득은 비교 가능한 공식 통계에 연결하지 않았습니다. 그래서 ‘평균보다 높다·낮다’고 주장하지 않습니다. 통계를 붙일 때는 기준연도, 대상 집단, 평균·중앙값, 세전·세후, 월·연 단위를 함께 적고, 실수령 월급을 세전 평균 연봉과 직접 비교하지 않습니다.</p></section>';
    html += '<section class="card"><h2>소득 감소 민감도 (설계 후 계획, 다음 달부터 계속)</h2><div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">실수령 감소</th><th scope="col">주거자금 부족·여유</th><th scope="col">미충당 적자</th><th scope="col">판정</th></tr></thead><tbody>' +
      sens.map(function (x) { return '<tr><th scope="row">' + (x.drop ? '−' + x.drop + '%' : '변화 없음') + '</th><td class="' + (x.gap >= 0 ? 'is-ok' : 'is-bad') + '">' + (x.gap >= 0 ? '여유 ' : '부족 ') + F.abs(x.gap) + '</td><td>' + (x.unfunded > 0.5 ? F.money(x.unfunded) : '없음') + '</td><td>' + U.statusText(x.status) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    return html;
  }

  // ---------- 계획 버전·편집 ----------
  function editView(S) {
    var draft = S.ui.draft;
    var html = '<section class="card"><div class="card-head"><h2>계획 버전</h2></div><div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">구분</th><th scope="col">버전</th><th scope="col">이름·메모</th><th scope="col">작성</th><th scope="col"></th></tr></thead><tbody>' +
      S.plans.map(function (p) { return '<tr><td>' + (p.kind === 'before' ? '<span class="plan-tag before">설계 전</span>' : '<span class="plan-tag after">설계 후</span>') + '</td><td>v' + p.version + '</td><td>' + esc(p.label || '') + '<div class="muted small">' + esc(p.note || '') + '</div></td><td class="small">' + esc(p.author) + '<br>' + F.date(p.createdAt) + '</td><td><button type="button" class="btn btn-small btn-secondary" data-edit="' + p.id + '">이 버전으로 새 안 작성</button></td></tr>'; }).join('') +
      '</tbody></table></div><p class="muted small">저장하면 새 버전이 추가됩니다. 이전 버전과 설계 전 계획, 고객의 실행 기록은 바뀌지 않습니다.</p></section>';
    if (!draft) return html;
    var res = C.simulate(draft.data), v = A.verdict(res);
    html += '<section class="card draft"><div class="card-head wrap"><h2>새 안 작성 <span class="muted small">(원본: ' + esc(draft.fromLabel) + ')</span></h2>' + U.pill(v.status, v.label) + '</div>' +
      '<p class="draft-preview" id="draftPreview">목표일 ' + res.at.ym + ' · 주거자금 ' + (res.gap >= 0 ? '여유 ' : '부족 ') + F.abs(res.gap) + ' · 부채 완료 ' + F.ym(draft.data.basis.baseMonth, res.debtFree) + '</p>' +
      '<form id="draftForm" novalidate>';
    PF.GROUPS.forEach(function (g) { html += '<fieldset class="group"><legend>' + esc(g.title) + '</legend><div class="field-grid">' + g.fields.map(function (f) { return fieldHtml('pf', f.path, f, PF.get(draft.data, f.path)); }).join('') + '</div></fieldset>'; });
    Object.keys(PF.LISTS).forEach(function (k) {
      var L = PF.LISTS[k], arr = draft.data[k] || [];
      html += '<fieldset class="group"><legend>' + esc(L.title) + '</legend>' + arr.map(function (item, i) {
        return '<div class="list-row"><div class="field-grid">' + L.fields.map(function (f) { return fieldHtml('pl', k + '.' + i + '.' + f.key, f, item[f.key]); }).join('') + '</div><button type="button" class="btn btn-small btn-danger-ghost" data-dellist="' + k + '" data-idx="' + i + '">삭제</button></div>';
      }).join('') + '<button type="button" class="btn btn-small btn-secondary" data-addlist="' + k + '">+ 추가</button></fieldset>';
    });
    html += '<fieldset class="group"><legend>저장</legend><div class="field-grid">' +
      '<div class="field"><label for="draftKind">구분</label><select id="draftKind"><option value="after"' + (draft.kind === 'after' ? ' selected' : '') + '>설계 후(수정안)</option><option value="before"' + (draft.kind === 'before' ? ' selected' : '') + '>설계 전(진단 정정)</option></select></div>' +
      '<div class="field"><label for="draftLabel">버전 이름</label><input id="draftLabel" type="text" maxlength="60" value="' + esc(draft.label || '') + '"></div>' +
      '<div class="field"><label for="draftNote">변경 메모</label><input id="draftNote" type="text" maxlength="500" value="' + esc(draft.note || '') + '"></div></div>' +
      '<p class="field-error" id="draftError" hidden></p><div class="btn-row"><button type="button" class="btn" data-action="saveDraft">새 버전으로 저장</button><button type="button" class="btn btn-secondary" data-action="cancelDraft">작성 취소</button></div></fieldset></form></section>';
    return html;
  }
  function fieldHtml(scope, path, f, v) {
    var id = scope + '-' + path.replace(/\./g, '_');
    if (f.type === 'bool') return '<div class="field field-check"><label class="check"><input type="checkbox" id="' + id + '" data-pf="' + path + '" data-scope="' + scope + '"' + (v ? ' checked' : '') + '><span>' + esc(f.label) + '</span></label>' + (f.help ? '<p class="help">' + esc(f.help) + '</p>' : '') + '</div>';
    if (f.type === 'select') return '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label><select id="' + id + '" data-pf="' + path + '" data-scope="' + scope + '">' + f.options.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>' + (f.help ? '<p class="help">' + esc(f.help) + '</p>' : '') + '</div>';
    if (f.type === 'ym') return '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label><input id="' + id + '" type="month" data-pf="' + path + '" data-scope="' + scope + '" data-type="ym" value="' + esc(v || '') + '">' + (f.help ? '<p class="help">' + esc(f.help) + '</p>' : '') + '<p class="field-error" hidden></p></div>';
    if (f.type === 'text') return '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label><input id="' + id + '" type="text" maxlength="80" data-pf="' + path + '" data-scope="' + scope + '" data-type="text" value="' + esc(v || '') + '"></div>';
    var shown = v === undefined || v === null || v === '' ? '' : f.type === 'money' ? Math.round(v / 100) / 100 : v;
    var unit = f.unit || (f.type === 'money' ? '만원' : f.type === 'pct' ? '%' : '');
    return '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label><div class="input-wrap"><input id="' + id + '" type="text" inputmode="decimal" data-pf="' + path + '" data-scope="' + scope + '" data-type="' + f.type + '" value="' + esc(shown) + '"' + (f.min !== undefined ? ' data-min="' + f.min + '"' : '') + (f.max !== undefined ? ' data-max="' + f.max + '"' : '') + '>' + (unit ? '<span class="unit">' + unit + '</span>' : '') + '</div>' + (f.help ? '<p class="help">' + esc(f.help) + '</p>' : '') + '<p class="field-error" hidden></p></div>';
  }

  // ---------- 실행 기록(설계사 조회) ----------
  function recordsView(S) {
    var p = plans(S), ex = A.execution(p.after.data, FP.Monthly.finalRecords(S.records, S.x ? S.x.closures.map(function (c) { return c.month; }) : []), { today: S.today, settings: S.settings });
    var al = A.alerts(ex, { now: S.today, linked: !!S.sync, lastSync: S.sync && S.sync.lastSync });
    var html = '<section class="card"><div class="card-head"><h2>고객 실행 현황</h2><span class="muted small">설계사는 조회만 가능</span></div>' +
      '<p>기준 계획 <span class="plan-tag after">' + esc(vLabel(p.after)) + '</span> · 이번 달 ' + ex.ym + ' · 기록된 달 ' + ex.recordedMonths.length + '개 · 기록 없는 달 ' + ex.noRecord.length + '개</p>' +
      '<div class="two-col"><div><h3 class="sub-head">예측 (목표일 주거자금)</h3><ul class="plain-list"><li>당초 계획대로 실행: ' + (ex.forecastPlan.gap >= 0 ? '여유 ' : '부족 ') + F.abs(ex.forecastPlan.gap) + ' · ' + U.statusText(ex.forecastPlan.status) + '</li><li>최근 실행 추세 지속(실행률 ' + F.pct(ex.trendFactor * 100, 0) + ', 최근 ' + ex.trendBasis + '개월 기준): ' + (ex.forecastTrend.gap >= 0 ? '여유 ' : '부족 ') + F.abs(ex.forecastTrend.gap) + ' · ' + U.statusText(ex.forecastTrend.status) + '</li></ul></div>' +
      '<div><h3 class="sub-head">경보</h3>' + alertList(al) + '</div></div></section>';
    html += '<section class="card"><h2>실행 기록 원장</h2><div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">월</th><th scope="col">항목</th><th scope="col">금액</th><th scope="col">출처</th><th scope="col">상태</th></tr></thead><tbody>' +
      (S.records.length ? S.records.map(function (r) { return '<tr' + (r.voidedAt ? ' class="voided"' : '') + '><td>' + r.month + '</td><td>' + catLabel(r.category, p.after.data) + '</td><td>' + F.money(r.amount) + '</td><td>' + ({ manual: '직접 입력', transaction: '거래 확인' }[r.source] || r.source) + '</td><td>' + (r.voidedAt ? '대체·취소됨' : '반영') + '</td></tr>'; }).join('') : '<tr><td colspan="5">기록 없음</td></tr>') + '</tbody></table></div></section>';
    return html;
  }
  function catLabel(c, d) { if (c.indexOf('product:') === 0) { var p = (d.products || []).filter(function (x) { return 'product:' + x.id === c; })[0]; return p ? p.name : '정책상품'; } return { debt: '부채 상환', emergency: '비상금', housing: '주거자금', expense: '생활비', 'expense:essential': '필수생활비', 'expense:optional': '선택 지출', income: '소득' }[c] || c; }
  function alertList(al) {
    if (!al.length) return '<p class="is-ok">경보 없음</p>';
    return '<ul class="alert-list">' + al.map(function (a) { return '<li class="alert-' + a.level + '"><strong>' + ({ warn: '경고', check: '확인 필요', info: '안내' }[a.level]) + '</strong> ' + esc(a.cause) + (a.size !== null && a.size !== undefined ? ' <span class="alert-size">규모 ' + F.money(a.size) + '</span>' : '') + '<div class="alert-action">권장: ' + esc(a.action) + '</div></li>'; }).join('') + '</ul>';
  }

  // ---------- 계산 검증 ----------
  var COLS = [['ym', '월'], ['income', '월 소득'], ['essential', '필수생활비'], ['optional', '선택지출'], ['interest', '부채 이자'], ['principal', '원금 상환'], ['debtBalance', '부채 잔액'], ['productContrib', '상품 납입'], ['productBal', '상품 잔액(제한)'], ['emergencyIn', '비상금 적립'], ['emergencyBal', '비상금 잔액'], ['housingIn', '주거자금 적립'], ['depositIn', '보증금 반환'], ['productPayout', '상품 만기 지급'], ['housingBal', '주거자금 잔액'], ['investBal', '투자자산'], ['usableHousing', '사용 가능 주거자금'], ['unfunded', '미충당 적자'], ['status', '목표 달성 여부']];
  function verifyView(S) {
    var p = plans(S), pl = S.ui.verifyPlan === 'before' ? p.before : p.after, res = C.simulate(pl.data);
    var rows = res.rows.slice(0, res.T + 1);
    var st = function (r) { return r.status === 'achieved' ? '달성' : (r.status === 'partial' ? '부분 충족' : '미달') + '(' + [!r.debtClear && '부채', !r.emergencyOk && '비상금', !r.housingOk && '주거'].filter(Boolean).join('·') + ')'; };
    return '<section class="card"><div class="card-head wrap"><h2>월별 계산표</h2><div class="segmented" role="group" aria-label="계획"><button type="button" data-verify="after" aria-pressed="' + (S.ui.verifyPlan !== 'before') + '">설계 후</button><button type="button" data-verify="before" aria-pressed="' + (S.ui.verifyPlan === 'before') + '">설계 전</button></div></div>' +
      '<p class="muted small">' + esc(vLabel(pl)) + ' · 단위: 만원(표시 반올림, CSV는 원) · 0행 = ' + res.base + ' 말 초기 처리 결과</p><div class="btn-row"><button type="button" class="btn" data-action="csv">CSV 내려받기</button></div>' +
      '<div class="table-scroll calc-wrap"><table class="calc-table"><thead><tr>' + COLS.map(function (c) { return '<th scope="col">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr' + (r.month === res.T ? ' class="target-row"' : '') + '>' + COLS.map(function (c, i) { var v = c[0] === 'ym' ? r.ym : c[0] === 'status' ? st(r) : F.man(r[c[0]], 1); return i === 0 ? '<th scope="row">' + v + '</th>' : '<td' + (c[0] === 'status' ? ' class="' + (r.status === 'achieved' ? 'is-ok' : 'is-bad') + '"' : '') + '>' + v + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></section>';
  }
  function csv(S) {
    var p = plans(S), pl = S.ui.verifyPlan === 'before' ? p.before : p.after, res = C.simulate(pl.data);
    var lines = [COLS.map(function (c) { return c[0] === 'ym' || c[0] === 'status' ? c[1] : c[1] + '(원)'; }).concat(['부채 상환 완료', '비상금 확보', '주거자금 충족']).join(',')];
    res.rows.slice(0, res.T + 1).forEach(function (r) { lines.push(COLS.map(function (c) { return c[0] === 'ym' ? r.ym : c[0] === 'status' ? r.status : Math.round(r[c[0]]); }).concat([r.debtClear ? 'Y' : 'N', r.emergencyOk ? 'Y' : 'N', r.housingOk ? 'Y' : 'N']).join(',')); });
    return '﻿# ' + (pl.kind === 'before' ? '설계 전' : '설계 후') + ' v' + pl.version + '\r\n' + lines.join('\r\n');
  }

  FP.Planner = { TABS: TABS, plans: plans, diag: diag, path: pathView, drawPath: drawPath, shock: shockView, reverse: reverseView, policy: policyView, income: incomeView, edit: editView, records: recordsView, verify: verifyView, csv: csv, alertList: alertList, catLabel: catLabel, vLabel: vLabel, verdictBlock: verdictBlock };
})(this);
