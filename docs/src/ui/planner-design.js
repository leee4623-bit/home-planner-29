/* 4. 설계안: 계획 버전·새 안·A/B/C·고객에게 제시 / 설계 도구 5종(역산·충격·소득·정책·상품) */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;
  var St = P.store;
  var dates = P.dates;
  var engine = P.engine;
  var pages = ui.plannerPages;

  function findPlan(s, id) { return St.findPlan(s, id); }

  /* ---------- 계획 버전과 제안 ---------- */

  var CHANGE_FIELDS = ['essential', 'optional', 'extraRepayment', 'pensionMonthly', 'targetMonth', 'products', 'budgetAdjustments', 'goal'];

  function diffPlans(a, b) {
    var planChanges = {};
    var goalChanges = null;
    CHANGE_FIELDS.forEach(function (k) {
      if (JSON.stringify(a[k] || null) === JSON.stringify(b[k] || null)) return;
      if (k === 'goal') goalChanges = b.goal || {};
      else planChanges[k] = b[k];
    });
    return { planChanges: planChanges, goalChanges: goalChanges };
  }

  function planRow(c, p) {
    var res = engine.runPlan(c.state, p.id);
    var active = p.id === c.state.activePlanId;
    var presented = (c.state.proposals || []).some(function (x) { return x.sourcePlanId === p.id && x.status !== '보류'; });
    var canPresent = !active && p.kind !== '설계 전' && !presented;
    return [
      { html: '<strong>' + ui.esc(p.name || p.id) + '</strong><br><span class="small muted">' + ui.esc(p.id) + ' · ' + ui.esc(p.kind || '') + ' · ' + ui.esc(p.date || '') + (p.parentId ? ' · 바탕 ' + ui.esc(p.parentId) : '') + '</span>', cls: 'l' },
      p.targetMonth, ui.n1(p.essential), ui.n1(p.optional), ui.n1(p.extraRepayment),
      { html: (p.products || []).length ? (p.products || []).map(function (x) { return '월 ' + fmt.short(x.monthly); }).join(', ') : '—' },
      { html: (p.budgetAdjustments || []).length ? (p.budgetAdjustments || []).length + '건' : '—' },
      { html: ui.judgementBadge(res.judgement) },
      { html: (active ? ui.badge('실행 기준', 'ok') + ' ' : '') +
        '<button class="btn btn-sm" data-action="plan-edit" data-id="' + ui.esc(p.id) + '">이 버전으로 새 안</button>' +
        (canPresent ? ' <button class="btn btn-sm btn-primary" data-action="plan-present" data-id="' + ui.esc(p.id) + '">고객에게 제시</button>' : presented && !active ? ' ' + ui.badge('제시함', 'info') : ''), cls: 'l' }
    ];
  }

  function editForm(c) {
    var base = findPlan(c.state, c.view.editFrom);
    if (!base) return '';
    var prod = (base.products || [])[0];
    return '<section class="card"><h2>「' + ui.esc(base.name) + '」을 바탕으로 새 안 작성</h2><form data-submit="plan-create" class="form-inline">' +
      '<input type="hidden" name="from" value="' + ui.esc(base.id) + '">' +
      '<div class="field"><label for="pe-name">안 이름</label><input id="pe-name" name="name" type="text" value="' + ui.esc(base.name + ' 수정') + '" required></div>' +
      '<div class="field"><label for="pe-ess">필수생활비</label><input id="pe-ess" name="essential" type="number" step="0.1" min="0" value="' + ui.esc(base.essential) + '"></div>' +
      '<div class="field"><label for="pe-opt">선택지출</label><input id="pe-opt" name="optional" type="number" step="0.1" min="0" value="' + ui.esc(base.optional) + '"></div>' +
      '<div class="field"><label for="pe-ext">월 추가 상환</label><input id="pe-ext" name="extraRepayment" type="number" step="0.1" min="0" value="' + ui.esc(base.extraRepayment) + '"></div>' +
      '<div class="field"><label for="pe-pen">연금 월 납입</label><input id="pe-pen" name="pensionMonthly" type="number" step="1" min="0" value="' + ui.esc(base.pensionMonthly || 0) + '"></div>' +
      '<div class="field"><label for="pe-tm">이사 예정월</label><input id="pe-tm" name="targetMonth" type="month" value="' + ui.esc(base.targetMonth) + '"></div>' +
      '<div class="field"><label for="pe-pm">' + ui.esc(prod && prod.name ? prod.name : '청년미래적금') + ' 월 납입(0이면 제외)</label><input id="pe-pm" name="productMonthly" type="number" step="1" min="0"' + (prod && prod.type === 'bank' ? '' : ' max="50"') + ' value="' + (prod ? ui.esc(prod.monthly) : 0) + '"></div>' +
      '<div class="field" style="flex:1 1 260px"><label for="pe-memo">메모(바뀐 이유)</label><input id="pe-memo" name="memo" type="text" value=""></div>' +
      '<div class="btn-row"><button class="btn btn-primary" type="submit">새 안 저장</button><button class="btn" type="button" data-action="plan-edit-cancel">취소</button></div>' +
      '</form><p class="small muted">새 안은 버전으로 쌓이고, 고객에게 제시해 고객이 적용해야 실행 기준이 됩니다. 기간별 예산 조정은 바탕 버전 것을 그대로 가져갑니다.</p></section>';
  }

  function proposalRows(c) {
    var list = (c.state.proposals || []).slice().reverse();
    if (!list.length) return '<p class="muted">작성한 제안이 없습니다.</p>';
    return ui.table(['제안', '종류', '상태', '바탕', '내용', ''], list.map(function (p) {
      var detail = p.options
        ? p.options.map(function (o) { return '<strong>' + o.key + '</strong> ' + ui.esc(o.name) + ': ' + ui.esc(o.summary); }).join('<br>') + (p.chosenKey ? '<br>' + ui.badge('고객 선택: ' + p.chosenKey + '안', 'ok') : '')
        : ui.esc(p.summary || '');
      return [
        { html: '<strong>' + ui.esc(p.title) + '</strong><br><span class="small muted">' + ui.esc(p.createdAt || '') + ' · ' + ui.esc(p.author || '') + '</span>', cls: 'l' },
        p.type === '설계안' ? 'A/B/C' : (p.kind || p.type), { html: ui.badge(p.status) }, p.basePlanId || '—',
        { html: '<span class="small">' + detail + '</span>', cls: 'l' },
        { html: p.status === '작성 중' ? '<button class="btn btn-sm btn-primary" data-action="proposal-present" data-id="' + ui.esc(p.id) + '">고객에게 제시</button>' : '' }
      ];
    }), { caption: '제안 목록' });
  }

  pages.plans = function (c) {
    return ui.pageHead('계획 버전·제안', '계획은 덮어쓰지 않고 쌓입니다. 고객이 선택·적용해야 실행 기준이 됩니다.',
      '<button class="btn btn-primary" data-action="abc-build">A/B/C 제안 자동 작성</button>') +
      (c.view.abcMsg ? '<p class="notice info">' + ui.esc(c.view.abcMsg) + '</p>' : '') +
      editForm(c) +
      '<section class="card"><h2>계획 버전</h2>' + ui.table(['버전', '이사월', '필수', '선택', '추가 상환', '정책상품', '기간 조정', '판정(계획값)', ''],
        c.state.plans.slice().reverse().map(function (p) { return planRow(c, p); }), { caption: '계획 버전' }) + '</section>' +
      '<section class="card"><h2>제안·수정안</h2><p class="small muted">A/B/C는 위험 등급이 아니라 서로 다른 실행 전략입니다. 자동 작성은 확정 기록을 반영한 역산 결과로 만듭니다.</p>' + proposalRows(c) + '</section>';
  };

  Object.assign(ui.actions, {
    'plan-edit': function (c, el) { ui.setView({ editFrom: el.getAttribute('data-id') }); },
    'plan-edit-cancel': function () { ui.setView({ editFrom: null }, true); },
    'plan-create': function (c, form, fd) {
      var base = findPlan(c.state, fd.get('from'));
      var pm = Number(fd.get('productMonthly')) || 0;
      var products = pm > 0
        ? [Object.assign({ policyId: 'youth-future', start: dates.addMonths(c.d.month, 1), months: 36, conditional: true }, (base.products || [])[0] || {}, { monthly: pm })]
        : [];
      var changes = {
        essential: Number(fd.get('essential')) || 0,
        optional: Number(fd.get('optional')) || 0,
        extraRepayment: Number(fd.get('extraRepayment')) || 0,
        pensionMonthly: Number(fd.get('pensionMonthly')) || 0,
        targetMonth: fd.get('targetMonth') || base.targetMonth,
        products: products
      };
      var r = St.createPlanVersion(c.state, base.id, changes, null, { name: String(fd.get('name') || '').trim() || base.name + ' 수정', memo: String(fd.get('memo') || ''), author: '설계사', kind: '설계 후' });
      ui.app.view.editFrom = null;
      ui.commit(r.state, '새 안 ' + r.planId + '을 만들었어요.');
    },
    'plan-present': function (c, el) {
      var p = findPlan(c.state, el.getAttribute('data-id'));
      var active = findPlan(c.state, c.state.activePlanId);
      var d = diffPlans(active, p);
      var parts = P.metrics.explainDiff(active, p).map(function (x) { return x.text; });
      if (!Object.keys(d.planChanges).length && !d.goalChanges) { ui.toast('실행 기준과 다른 점이 없어요.'); return; }
      var s = St.addProposal(c.state, {
        id: 'rev-plan-' + p.id,
        type: '수정안',
        kind: '설계사 수정안',
        status: '확인 대기',
        createdAt: c.d.today,
        basePlanId: active.id,
        sourcePlanId: p.id,
        title: '「' + p.name + '」 제안',
        reason: p.memo || '설계사가 새 안을 제시했어요.',
        summary: parts.length ? parts.join(', ') : '기간별 예산 조정·목표 변경',
        planChanges: d.planChanges,
        goalChanges: d.goalChanges || undefined,
        author: '설계사'
      });
      ui.commit(s, '고객에게 제시했어요. 고객 화면 → 내 계획에서 확인할 수 있어요.');
    },
    'abc-build': function (c) {
      var r = P.proposals.buildStrategyProposal(c.state, c.state.activePlanId);
      if (!r.ok) { ui.setView({ abcMsg: r.reason }, true); return; }
      ui.app.view.abcMsg = r.skipped.length ? '만들지 못한 안: ' + r.skipped.join(' ') : null;
      ui.commit(St.addProposal(c.state, r.proposal), 'A/B/C 제안을 작성했어요. 확인 후 [고객에게 제시]를 누르세요.');
    },
    'proposal-present': function (c, el) {
      ui.commit(St.presentProposal(c.state, el.getAttribute('data-id'), '설계사'), '고객에게 제시했어요.');
    }
  });

  /* ---------- 설계 도구 ---------- */

  var TOOLS = [['solver', '생활비 역산'], ['scenario', '충격 시나리오'], ['income', '소득 가정'], ['policy', '정책 조건'], ['products', '상품 비교']];

  pages.tools = function (c) {
    var t = c.view.tool || 'solver';
    var body = TOOL_PAGES[t](c);
    return ui.pageHead('설계 도구', '실행 기준 「' + ui.esc(c.d.plan.name) + '」 · 확정 기록 반영 기준') +
      '<nav class="subtabs" aria-label="설계 도구">' + TOOLS.map(function (x) {
        return '<button data-action="tool" data-tool="' + x[0] + '"' + (t === x[0] ? ' aria-current="page"' : '') + '>' + x[1] + '</button>';
      }).join('') + '</nav>' + body;
  };

  function eo(c) { return c.d.recOpts; }

  var TOOL_PAGES = {};

  TOOL_PAGES.solver = function (c) {
    var from = c.view.solverFrom || c.d.next;
    var floor = c.view.solverFloor || 0.9;
    var opts = { fromMonth: from, essentialFloorRatio: floor, engineOpts: eo(c) };
    var r = P.solver.solveAll(c.state, c.state.activePlanId, opts);
    var lc = r.livingCut;
    var conclusion = lc.alreadyMet ? '이미 전체 목표를 달성합니다. 줄일 필요가 없습니다.'
      : lc.feasible ? ui.esc(from) + '부터 생활비를 <strong>월 ' + fmt.num1(lc.cut) + '만원</strong> 줄이면 이사월 판정이 전체 목표 달성으로 바뀝니다.'
        : '<strong>생활비 절감만으로는 목표를 맞출 수 없습니다.</strong> ' + ui.esc(lc.reason);
    return '<section class="card"><form data-submit="solver-run" class="form-inline">' +
      '<div class="field"><label for="sv-from">절감 시작월</label><input id="sv-from" name="from" type="month" value="' + ui.esc(from) + '"></div>' +
      '<div class="field"><label for="sv-floor">필수생활비 하한</label><select id="sv-floor" name="floor">' + [1, 0.95, 0.9, 0.85].map(function (x) { return '<option value="' + x + '"' + (x === floor ? ' selected' : '') + '>지금의 ' + Math.round(x * 100) + '%</option>'; }).join('') + '</select></div>' +
      '<button class="btn" type="submit">다시 계산</button></form></section>' +
      '<section class="card"><p class="conclusion">' + conclusion + '</p>' +
      (lc.feasible && !lc.alreadyMet ? '<div class="kpis k4">' +
        ui.kpi('월 절감액(표시값, 0.1 올림)', ui.money(lc.cut), '정확값 ' + fmt.num1(lc.exact)) +
        ui.kpi('선택지출에서', ui.money(lc.optionalCut)) + ui.kpi('필수생활비에서', ui.money(lc.essentialCut), '하한 ' + fmt.num1(lc.floor)) +
        ui.kpi('적용 후 판정', ui.judgementBadge(lc.after)) + '</div>' +
        '<div class="btn-row"><button class="btn btn-primary" data-action="solver-version" data-from="' + ui.esc(from) + '" data-floor="' + floor + '">이 결과로 새 안 작성</button></div>' : '') +
      '</section><section class="card"><h2>별도 대안</h2>' + ui.table(['대안', '필요한 값', '설명'], [
        ['월 추가 소득', { html: r.extraIncome.feasible ? (r.extraIncome.alreadyMet ? '필요 없음' : '월 ' + fmt.num1(r.extraIncome.amount) + '만원') : '불가' }, { html: ui.esc(r.extraIncome.feasible ? from + '부터 매달 확정 소득이 이만큼 늘면 달성' : r.extraIncome.reason), cls: 'l' }],
        ['목표 보증금 낮추기', { html: r.lowerTarget.alreadyMet ? '필요 없음' : fmt.num1(r.lowerTarget.current) + ' → ' + fmt.num1(r.lowerTarget.newDepositTarget) }, { html: ui.esc(r.lowerTarget.feasible ? '주거 부족액만큼 낮춤' : r.lowerTarget.reason || ''), cls: 'l' }],
        ['목표 시점 늦추기', { html: r.delay.feasible ? (r.delay.alreadyMet ? '필요 없음' : r.delay.targetMonth + '(' + r.delay.delayMonths + '개월)') : '불가' }, { html: ui.esc(r.delay.feasible ? '생활비·목표 금액은 그대로' : r.delay.reason), cls: 'l' }],
        ['참고: 단순 나눗셈', { html: r.naive.value === null ? '—' : '월 ' + fmt.num1(r.naive.value) + '만원' }, { html: ui.esc('주거 부족 ' + fmt.num1(r.naive.shortfall) + ' ÷ ' + r.naive.months + '개월. ' + r.naive.note), cls: 'l' }]
      ], { caption: '별도 대안' }) + '</section>';
  };

  var PCT_TYPES = { incomeDrop: true, livingRise: true, investmentLoss: true };

  function defaultScenarios(c) {
    // 보고서 표 17의 민감도 시나리오를 기본값으로 둔다(2027-11 시작).
    var st = '2027-11';
    return [
      { type: 'incomeDrop', enabled: true, start: st, months: 6, value: 0.2, living: 185 },
      { type: 'jobLoss', enabled: false, start: st, months: 3, value: 0, living: 165, pausePension: true },
      { type: 'livingRise', enabled: false, start: '2026-11', months: 0, value: 0.023 },
      { type: 'depositTargetRise', enabled: false, value: 400 },
      { type: 'investmentLoss', enabled: false, start: '2027-06', value: 0.2 },
      { type: 'depositDelay', enabled: false, value: 6 }
    ];
  }

  TOOL_PAGES.scenario = function (c) {
    var list = c.view.scn || defaultScenarios(c);
    var T = P.scenarios.SCENARIO_TYPES;
    var form = '<form data-submit="scenario-run">' + ui.table(['켜기', '충격', '시작월', '기간(개월, 0=끝까지)', '크기', '기간 중 대응'], list.map(function (s, i) {
      var t = T[s.type];
      var val = PCT_TYPES[s.type] ? Math.round(s.value * 1000) / 10 : s.value;
      return [
        { html: '<input type="checkbox" name="on' + i + '" aria-label="' + t.label + ' 켜기"' + (s.enabled ? ' checked' : '') + '>' },
        { html: '<strong>' + t.label + '</strong>', cls: 'l' },
        { html: t.needsStart ? '<input type="month" name="start' + i + '" value="' + ui.esc(s.start) + '" aria-label="' + t.label + ' 시작월">' : '—' },
        { html: t.needsMonths ? '<input type="number" min="0" name="months' + i + '" value="' + ui.esc(s.months) + '" aria-label="' + t.label + ' 기간">' : '—' },
        { html: '<input type="number" step="0.1" name="value' + i + '" value="' + ui.esc(val) + '" aria-label="' + t.label + ' ' + t.valueLabel + '"> <span class="small muted">' + t.valueLabel + '(' + t.unit + ')</span>' },
        { html: (s.type === 'incomeDrop' || s.type === 'jobLoss')
          ? '<input type="number" min="0" step="1" style="width:6em" name="living' + i + '" value="' + ui.esc(s.living || '') + '" placeholder="그대로" aria-label="' + t.label + ' 기간 생활비"> <span class="small muted">생활비(만원)</span><br><label class="small"><input type="checkbox" name="pp' + i + '"' + (s.pausePension ? ' checked' : '') + '> 연금 납입 중지</label>'
          : '—' }
      ];
    }), { caption: '충격 시나리오 입력', maxHeight: 'none' }) + '<div class="btn-row"><button class="btn btn-primary" type="submit">켠 충격을 함께 적용</button></div></form>';
    var r = P.scenarios.compare(c.state, c.state.activePlanId, list, eo(c));
    var tm = r.base.input.targetMonth;
    var b = engine.rowAt(r.base, tm);
    var s = engine.rowAt(r.shocked, engine.rowAt(r.shocked, tm) ? tm : r.shocked.input.targetMonth);
    var goal = r.shocked.input.goal;
    var chart = ui.fundChart({
      width: 640, height: 240, title: '충격 전후 자금 경로',
      series: [
        { key: 'base', label: '충격 없음', color: '--chart-plan', dashed: true, points: r.base.rows.map(function (x) { return { month: x.month, value: x.usable }; }) },
        { key: 'shock', label: '충격 적용', color: '--chart-trend', dashed: true, points: r.shocked.rows.map(function (x) { return { month: x.month, value: x.usable }; }) }
      ],
      target: { value: goal.depositTarget + goal.movingCost, label: '목표 ' + fmt.short(goal.depositTarget + goal.movingCost) }
    });
    return '<section class="card"><h2>충격 조합</h2><p class="small muted">확률이 아니라 "이 충격이 오면"의 조건부 결과입니다. 여러 개를 동시에 켤 수 있습니다.</p>' + form + '</section>' +
      '<section class="card"><p class="conclusion">' + ui.esc(r.sentences.join(' ')) + '</p>' +
      '<div class="kpis k4">' + ui.kpi('판정(충격 없음)', ui.judgementBadge(r.base.judgement)) + ui.kpi('판정(충격 적용)', ui.judgementBadge(r.shocked.judgement)) +
      ui.kpi('이사 때 쓸 돈 변화', b && s ? ui.delta(s.usable - b.usable, true) + '<small>만원</small>' : '—') +
      ui.kpi('최대 미충당 적자', ui.money(r.maxDeficit)) + '</div>' + chart + '</section>';
  };

  TOOL_PAGES.income = function (c) {
    var pid = c.state.activePlanId;
    var custom = c.view.customGrowth === undefined ? 3 : c.view.customGrowth;
    var rates = [0, 0.01, 0.02, custom / 100];
    var growthRows = rates.map(function (g, i) {
      var r = engine.runPlan(c.state, pid, P.scenarios.withIncomeGrowth(c.state, pid, g, eo(c)));
      var row = engine.rowAt(r, r.input.targetMonth);
      return [(i === 3 ? '사용자 지정 ' : '') + '연 ' + fmt.short(g * 100) + '%', '연 ' + fmt.short(g * 75) + '%', ui.n1(row.usable), { html: ui.judgementBadge(r.judgement) }];
    });
    var sens = P.scenarios.sensitivityTable(c.state, pid, [0.05, 0.1, 0.15, 0.2], eo(c));
    var bonus = c.view.bonus || { amount: 200, month: dates.addMonths(c.d.month, 2), status: '예상' };
    var withBonus = engine.runPlan(c.state, pid, Object.assign({}, eo(c), { windfalls: [bonus] }));
    var base = c.d.current;
    var bRow = engine.rowAt(withBonus, bonus.month);
    var tm = base.input.targetMonth;
    var note = (c.state.settings && c.state.settings.incomeNote) || '';
    return '<section class="card"><h2>임금 상승 가정</h2><p class="small muted">임금 상승률에 실수령 반영률 0.75를 곱해 매년 1월에 적용합니다.</p>' +
      '<form data-submit="income-custom" class="form-inline"><div class="field"><label for="ig">사용자 지정 상승률(%)</label><input id="ig" name="g" type="number" step="0.1" value="' + ui.esc(custom) + '"></div><button class="btn" type="submit">적용</button></form>' +
      ui.table(['임금 상승률', '실수령 반영', '이사 때 쓸 돈', '판정'], growthRows, { caption: '임금 상승 가정' }) + '</section>' +
      '<section class="card"><h2>소득 감소 민감도</h2>' + ui.table(['실수령 감소', '이사 때 쓸 돈', '변화', '주거 부족액', '판정'], sens.map(function (x) {
        return [x.cut ? '−' + Math.round(x.cut * 100) + '%' : '현재', ui.n1(x.usable), { html: ui.delta(x.delta, true) }, ui.n1(x.shortfall), { html: ui.badge(x.status, x.status.split('(')[0]) }];
      }), { caption: '소득 감소 민감도' }) + '</section>' +
      '<section class="card"><h2>초과소득(성과급 등)</h2><form data-submit="bonus-run" class="form-inline">' +
      '<div class="field"><label for="bn-a">금액(만원)</label><input id="bn-a" name="amount" type="number" min="0" step="1" value="' + ui.esc(bonus.amount) + '"></div>' +
      '<div class="field"><label for="bn-m">받는 달</label><input id="bn-m" name="month" type="month" value="' + ui.esc(bonus.month) + '"></div>' +
      '<div class="field"><label for="bn-s">상태</label><select id="bn-s" name="status"><option' + (bonus.status === '예상' ? ' selected' : '') + '>예상</option><option' + (bonus.status === '확정' ? ' selected' : '') + '>확정</option></select></div>' +
      '<button class="btn" type="submit">계산</button></form>' +
      (bonus.status === '예상' ? '<p class="notice info">"예상" 상태의 초과소득은 확정 재원에서 빼고 계산합니다. 확정되면 다시 계산하세요.</p>'
        : '<p>배분 규칙(비상금 → 고금리 부채 → 주거자금): 비상금 ' + fmt.num1(bRow ? bRow.windfallToEmergency : 0) + ', 고금리 부채 ' + fmt.num1(bRow ? bRow.windfallToDebt : 0) + ', 주거자금 ' + fmt.num1(bRow ? bRow.windfallToHousing : 0) + '만원.</p>' +
          '<p>이사 때 쓸 돈 ' + fmt.num1(engine.rowAt(base, tm).usable) + ' → ' + fmt.num1(engine.rowAt(withBonus, tm).usable) + '만원, 판정 ' + ui.judgementBadge(withBonus.judgement) + '</p>') + '</section>' +
      '<section class="card"><h2>현재 소득 수준을 설정한 이유</h2><form data-submit="income-note"><div class="field"><label for="in-note" class="sr-only">설정 이유</label>' +
      '<textarea id="in-note" name="note" rows="3" placeholder="예: 2026년 9월 급여명세서 실수령 290만원 기준, 감면 반영분 포함">' + ui.esc(note) + '</textarea></div><button class="btn" type="submit">저장</button></form></section>';
  };

  TOOL_PAGES.policy = function (c) {
    var r = P.proposals.policyCheck(c.state, c.state.activePlanId);
    if (!r.items.length) {
      // 계획에 정책상품이 없으면, 기본 재원에서 뺀 이유(가입 조건·만기와 목표일)를 같은 기준으로 보여 준다
      var cand = P.proposals.compareSavings(c.state, c.state.activePlanId, 50);
      return '<section class="card"><p class="conclusion">실행 기준 계획에는 정책상품을 <strong>기본 주거재원으로 넣지 않았습니다.</strong></p>' +
        '<p class="small">지원율이 높아도 가입 가능성, 납입 가능액, 만기일, 중도해지 조건이 자금 사용 시점(' + ui.esc(c.d.plan.targetMonth) + ')과 맞을 때만 재원으로 넣습니다. 다음 달 가입을 가정한 결과입니다.</p>' +
        ui.table(['상품', '가입 조건', '만기(다음 달 가입 시)', '목표일 재원', '확인일'], cand.map(function (x) {
          return [{ html: ui.esc(x.name), cls: 'l' }, { html: ui.badge(x.eligibility.status) }, '<span class="num">' + ui.esc(x.maturity) + '</span>',
            { html: x.targetFunding ? ui.badge('목표일 전 만기', 'ok') : ui.badge('목표일 재원 아님', 'warn') }, ui.esc(x.checkedAt)];
        }), { caption: '정책상품 적합성' }) +
        '<p class="small muted">청년미래적금: 신청 이력이 없고, 총급여·재직 연차만으로 우대형(12%)을 확정할 수 없으며(가구소득·심사 필요), 지금 가입해도 만기가 목표일보다 늦습니다. 재직자 우대 저축공제: 회사 참여와 지원비율이 확인되지 않았습니다. 이사 후 장기목표로 다시 검토합니다(사례 보고서 9장).</p></section>';
    }
    return '<section class="card"><p class="conclusion">정책상품을 넣으면 이사월(' + ui.esc(r.targetMonth) + ')에 쓸 돈이 <strong>' + fmt.num1(Math.abs(r.diff)) + '만원 ' + (r.diff >= 0 ? '많아집니다' : '적어집니다') + '</strong>(정부기여분에서 납입액에 붙지 못한 이자를 뺀 차이).</p>' +
      ui.table(['구분', '이사 때 쓸 돈', '판정'], [
        ['정책상품 포함', ui.n1(r.with.usable), { html: ui.judgementBadge(r.with.judgement) }],
        ['정책상품 제외', ui.n1(r.without.usable), { html: ui.judgementBadge(r.without.judgement) }]
      ], { caption: '정책상품 포함·제외 비교' }) + '<p class="small muted">' + ui.help('조건부 재원') + ' 조건부 재원은 포함·제외 결과를 둘 다 보고 판단하세요.</p></section>' +
      r.items.map(function (it) {
        return '<section class="card"><div class="card-head"><h2>' + ui.esc(it.name) + (it.conditional ? ' · 조건부 재원' : '') + '</h2>' + ui.badge(it.eligibility.status) + '</div>' +
          ui.table(['가입 조건', '결과', '내용'], it.eligibility.checks.map(function (k) { return [k.label, { html: ui.badge(k.result) }, { html: ui.esc(k.detail), cls: 'l' }]; }), { caption: '가입 조건' }) +
          '<div class="kpis k4" style="margin-top:10px">' + ui.kpi('월 납입', ui.money(it.monthly)) + ui.kpi('만기', '<span class="num">' + ui.esc(it.maturity) + '</span>', it.beforeMove ? '이사 전 만기' : ui.badge('목표일 재원 아님', 'warn')) +
          ui.kpi('납입 부담(잉여 대비)', '<span class="num">' + (it.burden === null ? '—' : fmt.pct(it.burden)) + '</span>') + ui.kpi('예상 만기 지급', ui.money(it.expectedPayout), '은행 이자 0% 가정') + '</div>' +
          '<p class="small muted">확인일 ' + ui.esc(it.policy.checkedAt) + ' 기준 · 자료 상태 ' + ui.esc(it.policy.status) + ' · ' + ui.esc(it.policy.note || '') + '</p></section>';
      }).join('') +
      '<section class="card"><h2>같은 돈이 두 번 배정되지 않는지</h2><ul class="rows">' + r.checks.map(function (k) {
        return '<li><span>' + ui.esc(k.label) + '</span>' + ui.badge(k.ok ? '충족' : '불충족') + '</li>';
      }).join('') + '</ul><p class="small muted">월별 계산 결과로 직접 확인한 값입니다.</p></section>';
  };

  TOOL_PAGES.products = function (c) {
    var monthly = c.view.cmpMonthly || 30;
    var list = P.proposals.compareSavings(c.state, c.state.activePlanId, monthly);
    var anyHigh = list.some(function (x) { return x.highDebtLeft > 0.05; });
    var loan = P.policies.getPolicy('beotimmok-youth');
    var goal = c.d.current.input.goal;
    var loanMax = Math.min(goal.depositTarget * loan.loanRatio, loan.loanCap);
    var le = P.policy.checkEligibility(loan, c.state.customer, c.d.next);
    return '<section class="card"><form data-submit="cmp-run" class="form-inline"><div class="field"><label for="cm">월 납입액(만원)</label><input id="cm" name="m" type="number" min="1" step="1" value="' + ui.esc(monthly) + '"></div><button class="btn" type="submit">비교</button></form>' +
      '<p class="small muted">같은 납입액·다음 달 가입·은행 이자 0%(확인 전) 가정으로 비교합니다. 특정 상품을 추천하지 않습니다.</p>' +
      ui.table(['상품', '가입 조건', '월 납입', '기간', '기여·매칭', '원금', '예상 만기 지급', '세금', '만기', '목표일 재원'], list.map(function (x) {
        return [x.name, { html: ui.badge(x.eligibility.status) }, ui.n1(x.monthly), x.months + '개월', fmt.pct(x.contributionRate), ui.n1(x.principal), ui.n1(x.payout), x.tax, x.maturity,
          { html: x.targetFunding ? ui.badge('목표일 전 만기', 'ok') : ui.badge('목표일 재원 아님', 'warn') }];
      }), { caption: '정책형 저축상품 비교' }) +
      (anyHigh ? '<p class="notice warn">고금리 부채가 남아 있습니다. 같은 돈으로 먼저 상환하는 쪽이 유리할 수 있습니다.</p>' : '') + '</section>' +
      '<section class="card"><h2>대출 활용 비교안 · ' + ui.esc(loan.name) + '</h2>' +
      '<p>목표 보증금 ' + fmt.num1(goal.depositTarget) + '만원 기준 대출 한도(보증금의 80%, 최대 1.5억)는 ' + fmt.num1(loanMax) + '만원입니다. 가입 조건: ' + ui.badge(le.status) + '</p>' +
      '<p class="small muted">비교용으로만 보여줍니다. 무대출 목표 충족으로 계산하지 않으며, 대출금은 소득이나 순자산 증가로 세지 않습니다. 확인일 ' + ui.esc(loan.checkedAt) + ' 기준.</p></section>' +
      ui.bankCard(c);
  };

  /** 은행 예·적금 후보(사례 보고서 표 12) — 같은 월 납입·기간·세금 가정 */
  ui.bankCard = function (c) {
    var bm = c.view.bankMonthly || 80;
    var bn = c.view.bankMonths || 21;
    var bl = c.view.bankLump || 1000;
    var start = c.view.bankStart || '2027-07';
    var rows = P.models.compareBank(c.state, c.state.activePlanId, bm, bn, bl, start);
    return '<section class="card"><h2>은행 예·적금 후보 비교</h2>' +
      '<form data-submit="bank-run" class="form-inline">' +
      '<div class="field"><label for="bk-m">적금 월 납입(만원)</label><input id="bk-m" name="m" type="number" min="1" step="1" value="' + ui.esc(bm) + '"></div>' +
      '<div class="field"><label for="bk-n">기간(개월)</label><input id="bk-n" name="n" type="number" min="1" max="36" step="1" value="' + ui.esc(bn) + '"></div>' +
      '<div class="field"><label for="bk-l">예금 원금(만원)</label><input id="bk-l" name="l" type="number" min="100" step="10" value="' + ui.esc(bl) + '"></div>' +
      '<div class="field"><label for="bk-s">가입월</label><input id="bk-s" name="s" type="month" value="' + ui.esc(start) + '"></div>' +
      '<button class="btn" type="submit">비교</button></form>' +
      ui.table(['상품', '설계상 용도', '적용 금리(기본 / 우대)', '원금', '세후 만기금(기본)', '세후 만기금(우대 충족 시)', '만기', '목표일 재원', '확인일'], rows.map(function (x) {
        if (x.payout === undefined) return [{ html: ui.esc(x.name), cls: 'l' }, { html: ui.esc(x.use), cls: 'l' }, { html: ui.esc(x.note), cls: 'l' }, '—', '—', '—', '—', '—', ui.esc(x.checkedAt)];
        return [{ html: '<a href="' + ui.esc(x.source.url) + '" target="_blank" rel="noopener">' + ui.esc(x.name) + '</a>', cls: 'l' }, { html: ui.esc(x.use), cls: 'l' },
          (x.baseRate * 100).toFixed(2) + '%' + (x.prefRate ? ' / ' + (x.prefRate * 100).toFixed(2) + '%' : ''), ui.n1(x.principal), ui.n1(x.payout), x.payoutPref === null ? '—' : ui.n1(x.payoutPref), x.maturity,
          { html: x.targetFunding ? ui.badge('목표일 전 만기', 'ok') : ui.badge('목표일 재원 아님', 'warn') }, ui.esc(x.checkedAt)];
      }), { caption: '은행 예·적금 후보' }) +
      '<p class="small muted">금리는 조사일(2026-11-03, 사례 보고서 표 12) 공시 기준 세전 연이율이며, 가입할 때 같은 금리·판매가 유지된다는 뜻이 아닙니다. 적금 이자 근사 = 월 납입 × 연이율 × n(n+1)/24(실제 지급액은 납입일·일수·원단위 처리에 따라 다름), 세금 15.4%(이자소득세 14% + 지방소득세 1.4%). 우대금리는 조건 충족을 확인할 때만 반영합니다. 예금자보호는 금융회사별 1인당 원금과 소정의 이자를 합해 1억 원까지입니다. 특정 상품을 추천하지 않습니다.</p></section>';
  };

  Object.assign(ui.actions, {
    tool: function (c, el) { ui.setView({ tool: el.getAttribute('data-tool') }, true); },
    'solver-run': function (c, f, fd) { ui.setView({ solverFrom: fd.get('from'), solverFloor: Number(fd.get('floor')) }, true); },
    'solver-version': function (c, el) {
      var from = el.getAttribute('data-from');
      var lc = P.solver.solveLivingCut(c.state, c.state.activePlanId, { fromMonth: from, essentialFloorRatio: Number(el.getAttribute('data-floor')), engineOpts: eo(c) });
      if (!lc.feasible || !lc.planChanges) { ui.toast('새 안으로 만들 결과가 없어요.'); return; }
      var r = St.createPlanVersion(c.state, c.state.activePlanId, lc.planChanges, null, { name: '생활비 역산안(월 ' + fmt.short(lc.cut) + ' 절감)', memo: from + '부터 생활비 월 ' + fmt.short(lc.cut) + '만원 절감', author: '설계사', kind: '설계 후' });
      ui.app.view.plannerPage = 'plans';
      ui.commit(r.state, '역산 결과로 새 안 ' + r.planId + '을 만들었어요.');
    },
    'scenario-run': function (c, f, fd) {
      var list = (c.view.scn || defaultScenarios(c)).map(function (s, i) {
        var raw = Number(fd.get('value' + i));
        return Object.assign({}, s, {
          enabled: fd.get('on' + i) === 'on',
          start: fd.get('start' + i) || s.start,
          months: fd.get('months' + i) === null ? s.months : Number(fd.get('months' + i)) || 0,
          value: Number.isFinite(raw) ? (PCT_TYPES[s.type] ? raw / 100 : raw) : s.value,
          living: fd.get('living' + i) === null ? s.living : Math.max(0, Number(fd.get('living' + i)) || 0),
          pausePension: fd.get('living' + i) === null ? s.pausePension : fd.get('pp' + i) === 'on'
        });
      });
      ui.setView({ scn: list }, true);
    },
    'income-custom': function (c, f, fd) { ui.setView({ customGrowth: Number(fd.get('g')) || 0 }, true); },
    'bonus-run': function (c, f, fd) { ui.setView({ bonus: { amount: Number(fd.get('amount')) || 0, month: fd.get('month'), status: fd.get('status') } }, true); },
    'income-note': function (c, f, fd) { ui.commit(St.updateSettings(c.state, { incomeNote: String(fd.get('note') || '') }, '설계사', '소득 가정 메모'), '저장했어요.'); },
    'cmp-run': function (c, f, fd) { ui.setView({ cmpMonthly: Math.max(1, Number(fd.get('m')) || 30) }, true); },
    'bank-run': function (c, f, fd) {
      ui.setView({ bankMonthly: Math.max(1, Number(fd.get('m')) || 80), bankMonths: Math.min(36, Math.max(1, Math.round(Number(fd.get('n')) || 21))), bankLump: Math.max(100, Number(fd.get('l')) || 1000), bankStart: fd.get('s') || '2027-07' }, true);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
