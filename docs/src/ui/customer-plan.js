/* 내 계획: 판정(쉬운 말 → 상세), 자금 경로 차트, 제안 선택, 수정안 비교·적용, 자동 적용 동의, 버전 */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;
  var engine = P.engine;
  var St = P.store;

  var EVENT_TYPES = ['emergencyReached', 'highDebtPaidOff', 'depositReturn', 'taxExemptionEnd', 'productMaturity', 'move'];

  function judgementDetail(j, input) {
    var rows = j.conditions.map(function (k) {
      var val = k.key === 'debt' ? '남은 잔액 ' + fmt.num1(k.value) + '만원' : fmt.num1(k.value) + ' / ' + fmt.num1(k.target) + '만원';
      return '<li><div class="row-main"><div class="t">' + ui.esc(k.label) + '</div><div class="s">' + val +
        (k.met ? '' : ' · 부족 ' + fmt.num1(k.shortfall) + '만원') + '</div></div><div class="row-side">' + ui.badge(k.met ? '충족' : '미달') + '</div></li>';
    }).join('');
    var ex = j.excludedLowRateDebt;
    return '<ul class="rows">' + rows + '</ul>' +
      (ex !== null && ex > 0.05 ? '<p class="small muted">저금리 부채(학자금 등)는 조건 제외 — 잔액 ' + fmt.num1(ex) + '만원 ' + ui.help('고금리 부채') + '</p>' : '') +
      '<p class="small muted">기준: ' + ui.esc(j.month) + ' 말 · 목표 보증금 ' + fmt.short(input.goal.depositTarget) + ' + 이사비 ' + fmt.short(input.goal.movingCost) + '만원 · 비상금 목표 ' + fmt.short(input.goal.emergencyTarget) + '만원</p>';
  }

  function easySentence(j) {
    if (j.status === '전체 목표 달성') return '세 가지 목표를 모두 채울 수 있어요.';
    var bad = j.conditions.filter(function (k) { return !k.met; }).map(function (k) {
      return k.key === 'housing' ? '이사 자금 ' + fmt.short(k.shortfall) + '만원' : k.key === 'emergency' ? '비상금 ' + fmt.short(k.shortfall) + '만원' : '고금리 부채 ' + fmt.short(k.shortfall) + '만원';
    });
    return bad.join(', ') + (j.status === '부분 충족' ? '이 남지만 이사 자금은 충분해요.' : '이 모자라요.');
  }

  function chart(c) {
    var d = c.d;
    var pts = function (rows) { return rows.map(function (r) { return { month: r.month, value: r.usable }; }); };
    var series = [];
    if (d.before) series.push({ key: 'before', label: '설계 전 예상', color: '--chart-before', dashed: true, points: pts(d.before.rows) });
    series.push({ key: 'plan', label: '설계 후 예상', color: '--chart-plan', dashed: true, points: pts(d.paths.plan.rows) });
    series.push({ key: 'actual', label: '실제 실행(확정 기록)', color: '--chart-actual', dots: true, points: d.paths.actual.map(function (a) { return { month: a.month, value: a.usable }; }) });
    if (d.paths.lastConfirmed) {
      var from = d.paths.lastConfirmed;
      series.push({ key: 'trend', label: '최근 추세가 이어지면', color: '--chart-trend', dashed: true,
        points: d.paths.trend.rows.filter(function (r) { return r.month >= from; }).map(function (r) { return { month: r.month, value: r.usable }; }) });
    }
    var goal = d.current.input.goal;
    var seen = {};
    var events = d.current.events.filter(function (e) {
      if (EVENT_TYPES.indexOf(e.type) < 0 || seen[e.type + e.month]) return false;
      seen[e.type + e.month] = true;
      return true;
    }).sort(function (a, b) { return a.month < b.month ? -1 : 1; });
    return ui.fundChart({
      title: '사용 가능 주거자금 경로',
      series: series,
      target: { value: goal.depositTarget + goal.movingCost, label: '목표 ' + fmt.short(goal.depositTarget + goal.movingCost) },
      events: events
    });
  }

  /** 제안 적용 시 결과(기록 반영 기준, 지금 실행 기준 위에 얹어서 계산). proposal 없으면 지금 계획 그대로. */
  function previewOf(c, proposal, option) {
    var eff = proposal ? St.effectiveChanges(c.state, proposal, option) : { basePlanId: c.state.activePlanId, planChanges: {}, goalChanges: {} };
    var basePlanId = eff.basePlanId;
    var planChanges = eff.planChanges;
    var goalChanges = eff.goalChanges;
    var eo = P.tracking.recordEngineOpts(c.state, basePlanId, 'plan');
    var opts = Object.assign({}, eo, { planOverrides: planChanges || {}, goalOverrides: goalChanges || {} });
    if (planChanges && planChanges.targetMonth) opts.endMonth = planChanges.targetMonth;
    var r = engine.runPlan(c.state, basePlanId, opts);
    var tm = r.input.targetMonth;
    return { result: r, row: engine.rowAt(r, tm), judgement: r.judgement, targetMonth: tm, goal: r.input.goal, rebased: !!eff.rebased };
  }

  function confirmRow(c, key, label, action, attrs) {
    if (c.view.confirm === key) {
      return '<div class="notice info" role="alert"><div><p><strong>' + ui.esc(label) + '을(를) 적용할까요?</strong> 새 계획 버전이 생기고 실행 기준이 바뀝니다. 이전 버전과 기록은 그대로 남아요.</p>' +
        '<div class="btn-row"><button class="btn btn-primary" data-action="' + action + '"' + attrs + '>적용 확정</button><button class="btn" data-action="cancel-confirm">취소</button></div></div></div>';
    }
    return null;
  }

  function revisionCard(c, p) {
    var base = previewOf(c, null);
    var after = previewOf(c, p);
    var adj = (p.planChanges && p.planChanges.budgetAdjustments || []).slice(-1)[0];
    var firstMonth = adj ? adj.start : null;
    var optBefore = firstMonth ? engine.rowAt(base.result, firstMonth) : null;
    var optAfter = firstMonth ? engine.rowAt(after.result, firstMonth) : null;
    var auto = P.alerts.canAutoApply(c.state, p);
    var pending = p.status === '확인 대기';
    var conf = confirmRow(c, 'apply:' + p.id, p.title, 'apply-proposal', ' data-id="' + ui.esc(p.id) + '"');
    return '<section class="card" aria-labelledby="rev-' + ui.esc(p.id) + '"><div class="card-head"><h2 id="rev-' + ui.esc(p.id) + '">수정안 · ' + ui.esc(p.kind || '') + '</h2>' + ui.badge(p.status) + '</div>' +
      '<p><strong>' + ui.esc(p.title) + '</strong></p><p class="small muted">' + ui.esc(p.reason || '') + '</p><p>' + ui.esc(p.summary || '') + '</p>' +
      '<div class="compare" role="group" aria-label="적용 전후 비교">' +
      '<div><div class="label">지금 계획</div>' + ui.badge(base.judgement.label, base.judgement.status) + '<div class="small">이사 때 쓸 돈 ' + fmt.num1(base.row.usable) + '</div>' +
      (optBefore ? '<div class="small">' + ui.esc(firstMonth) + ' 선택지출 ' + fmt.num1(optBefore.optional) + '</div>' : '') + '</div>' +
      '<div><div class="label">적용하면</div>' + ui.badge(after.judgement.label, after.judgement.status) + '<div class="small">이사 때 쓸 돈 ' + fmt.num1(after.row.usable) + ' (' + ui.delta(after.row.usable - base.row.usable, true) + ')</div>' +
      (optAfter ? '<div class="small">' + ui.esc(firstMonth) + ' 선택지출 ' + fmt.num1(optAfter.optional) + '</div>' : '') + '</div></div>' +
      (after.rebased ? '<p class="small muted">이 수정안을 만든 뒤 실행 기준이 바뀌어, 지금 실행 기준에 더해 다시 계산했어요.</p>' : '') +
      '<p class="small muted">' + (auto.ok ? '자동 적용 동의 범위 안의 조정이에요.' : '자동 적용 대상 아님: ' + ui.esc(auto.reasons[0] || '')) + '</p>' +
      (pending ? (conf || '<div class="btn-row"><button class="btn btn-primary" data-action="confirm" data-key="apply:' + ui.esc(p.id) + '">적용</button>' +
        '<button class="btn" data-action="hold-proposal" data-id="' + ui.esc(p.id) + '">보류</button></div>') : '') + '</section>';
  }

  function abcCard(c, p) {
    var presented = p.status === '고객에게 제시됨';
    var opts = p.options.map(function (o) {
      var pv = previewOf(c, p, o);
      var chosen = p.chosenKey === o.key;
      var key = 'apply:' + p.id + ':' + o.key;
      var conf = confirmRow(c, key, o.key + '안 ' + o.name, 'apply-proposal', ' data-id="' + ui.esc(p.id) + '" data-option="' + ui.esc(o.key) + '"');
      return '<div class="option' + (chosen ? ' chosen' : '') + '"><div class="option-head"><strong>' + ui.esc(o.key + '안 · ' + o.name) + '</strong>' +
        ui.badge(pv.judgement.label, pv.judgement.status) + '</div><p class="small">' + ui.esc(o.summary) + '</p>' +
        '<p class="small muted">이사 ' + ui.esc(pv.targetMonth) + ' · 이사 때 쓸 돈 ' + fmt.num1(pv.row.usable) + ' / 목표 ' + fmt.short(pv.goal.depositTarget + pv.goal.movingCost) + '만원</p>' +
        (presented ? (conf || '<button class="btn btn-sm" data-action="confirm" data-key="' + key + '">이 안 선택</button>') : chosen ? ui.badge('선택함', 'ok') : '') + '</div>';
    }).join('');
    return '<section class="card" aria-labelledby="abc-' + ui.esc(p.id) + '"><div class="card-head"><h2 id="abc-' + ui.esc(p.id) + '">설계사 제안</h2>' + ui.badge(p.status) + '</div>' +
      '<p><strong>' + ui.esc(p.title) + '</strong></p><p class="small muted">A·B·C는 위험 등급이 아니라 서로 다른 실행 전략이에요. 고른 안이 새 실행 기준이 됩니다.' +
      (p.basePlanId !== c.state.activePlanId && presented ? ' 제안을 받은 뒤 실행 기준이 바뀌어, 지금 실행 기준에 더해 다시 계산한 결과예요.' : '') + '</p>' + opts + '</section>';
  }

  function consentCard(c) {
    var k = c.state.autoApplyConsent || { enabled: false, monthlyLimit: 10, essentialFloorRatio: 0.9 };
    return '<section class="card" aria-labelledby="consent-h"><h2 id="consent-h">자동 적용 동의 ' + ui.help('자동 적용') + '</h2>' +
      '<form data-submit="save-consent">' +
      '<label class="choice"><input type="checkbox" name="enabled"' + (k.enabled ? ' checked' : '') + '>생활비 예산 조정 수정안은 확인 없이 바로 적용</label>' +
      '<div class="grid-2"><div class="field"><label for="cs-limit">월 조정 한도(만원)</label><input id="cs-limit" name="monthlyLimit" type="number" min="0" step="0.5" value="' + ui.esc(k.monthlyLimit) + '"></div>' +
      '<div class="field"><label for="cs-floor">필수생활비 하한</label><select id="cs-floor" name="floor">' +
      [1, 0.95, 0.9].map(function (r) { return '<option value="' + r + '"' + (Number(k.essentialFloorRatio) === r ? ' selected' : '') + '>지금의 ' + Math.round(r * 100) + '%</option>'; }).join('') + '</select></div></div>' +
      '<p class="small muted">목표일 변경, 신규 대출, 위험 확대, 상품 가입·해지, A/B/C 선택은 자동 적용하지 않아요.' + (k.agreedAt ? ' 동의일 ' + ui.esc(k.agreedAt) + '.' : '') + '</p>' +
      '<button class="btn btn-block" type="submit">저장</button></form></section>';
  }

  function versions(c) {
    var list = c.state.plans.slice().reverse();
    return '<ul class="rows">' + list.map(function (p) {
      var active = p.id === c.state.activePlanId;
      return '<li><div class="row-main"><div class="t">' + ui.esc(p.name || p.id) + '</div><div class="s">' + ui.esc(p.kind || '') + ' · ' + ui.esc(p.date || '') +
        ' · 이사 ' + ui.esc(p.targetMonth) + (p.memo ? ' · ' + ui.esc(p.memo) : '') + '</div></div><div class="row-side">' + (active ? ui.badge('실행 기준', 'ok') : '') + '</div></li>';
    }).join('') + '</ul>';
  }

  /** 계산 조건별 결과(A·B·C)와 지급일 예상 가용자금. 같은 납입 계획을 다른 조건으로 계산하므로 합산하지 않는다. */
  ui.modelsCard = function (c, opts) {
    opts = opts || {};
    var list = P.models.compare(c.state, c.state.activePlanId, c.d.recOpts);
    var tm = list[0].result.input.targetMonth;
    // 좁은 화면에서도 읽히도록 표 대신 줄 목록으로 보여 준다.
    var rows = '<ul class="rows">' + list.map(function (x) {
      return '<li><div class="row-main"><div class="t">' + ui.esc(x.key) + ' · ' + ui.esc(x.condition) + '</div>' +
        '<div class="s">마지막 월 납입 제외 <span class="num">' + fmt.num1(x.paydayUsable) + '</span> (' + ui.delta(x.paydayDiff, true) + ')</div></div>' +
        '<div class="row-side"><strong class="num">' + fmt.num1(x.usable) + '</strong><br>' + ui.delta(x.diff, true) + '</div></li>';
    }).join('') + '</ul>';
    var a = list[0];
    var head = a.diff >= 0
      ? '원금만으로도 목표(' + fmt.short(a.target) + ')를 ' + fmt.num1(a.diff) + '만원 넘지만 여유가 작아요.'
      : '원금 기준으로는 목표(' + fmt.short(a.target) + ')보다 ' + fmt.num1(-a.diff) + '만원 모자라요.';
    var pay = a.paydayDiff < 0 ? ' 잔금일이 ' + ui.esc(tm) + ' 월말 납입(' + fmt.num1(a.lastMonthIn) + ')보다 빠르면 원금 기준 ' + fmt.num1(-a.paydayDiff) + '만원이 부족해요.' : '';
    return '<section class="card" aria-labelledby="models-h"><h2 id="models-h">계산 조건별 결과 · ' + ui.esc(tm) + ' 말</h2>' +
      '<p class="conclusion">' + head + pay + '</p>' +
      rows + '<p class="small muted">오른쪽 큰 숫자는 ' + ui.esc(tm) + ' 말 사용 가능 주거자금, 그 아래는 목표(' + fmt.short(a.target) + ') 대비 차이예요.</p>' +
      '<p class="small muted">세 수치는 같은 납입 계획을 서로 다른 조건으로 계산한 결과라 합산하지 않습니다. B는 특정 은행 상품의 만기금이 아니고, C는 미래 금리를 확정한 값이 아닙니다. 계약 전에는 급여일·적금 만기일·보증금 반환일·계약금·잔금일을 대조한 지급일별 가용자금표로 다시 확인하세요.</p></section>';
  };

  ui.screens.plan = function (c) {
    var j = c.d.current.judgement;
    var props = (c.state.proposals || []).slice();
    var order = { '확인 대기': 0, '고객에게 제시됨': 1, '보류': 2, '적용됨': 3 };
    props.sort(function (a, b) { return (order[a.status] || 9) - (order[b.status] || 9); });
    var cards = props.filter(function (p) { return p.status !== '적용됨' && p.status !== '대체됨' && p.status !== '작성 중'; }).map(function (p) { return p.options ? abcCard(c, p) : revisionCard(c, p); }).join('');
    var done = props.filter(function (p) { return p.status === '적용됨'; });
    return '<section class="card" aria-labelledby="plan-j"><div class="card-head"><h2 id="plan-j">목표 판정</h2>' + ui.judgementBadge(j) + '</div>' +
      '<p class="conclusion">' + ui.esc(easySentence(j)) + '</p>' +
      ui.fold('세 가지 조건 자세히', judgementDetail(j, c.d.current.input)) + '</section>' +
      ui.modelsCard(c) +
      '<section class="card" aria-labelledby="plan-c"><h2 id="plan-c">자금 경로 ' + ui.help('사용 가능 주거자금') + '</h2>' + chart(c) +
      '<p class="small muted">점선은 예상, 실선과 점은 확인한 기록이에요. 기록이 없는 달은 선을 끊어요. ' + ui.help('최근 추세') + '</p></section>' +
      (cards || '<section class="card"><h2>제안·수정안</h2>' + ui.empty('지금 확인할 제안이 없어요.') + '</section>') +
      (done.length ? '<section class="card"><h2>적용한 제안</h2><ul class="rows">' + done.map(function (p) {
        return '<li><div class="row-main"><div class="t">' + ui.esc(p.title) + '</div><div class="s">' + ui.esc(p.appliedAt || '') + ' · ' + ui.esc(p.appliedBy || '') + (p.chosenKey ? ' · ' + ui.esc(p.chosenKey) + '안' : '') + '</div></div><div class="row-side">' + ui.badge('적용됨') + '</div></li>';
      }).join('') + '</ul></section>' : '') +
      consentCard(c) +
      '<section class="card"><h2>계획 버전</h2><p class="small muted">계획은 덮어쓰지 않고 쌓여요.</p>' + versions(c) + '</section>';
  };

  Object.assign(ui.actions, {
    confirm: function (c, el) { ui.setView({ confirm: el.getAttribute('data-key') }, true); },
    'apply-proposal': function (c, el) {
      var id = el.getAttribute('data-id');
      var opt = el.getAttribute('data-option');
      var r = St.applyProposal(c.state, id, { optionKey: opt || undefined, who: '고객' });
      ui.commit(r.state, '적용했어요. 새 실행 기준: ' + St.findPlan(r.state, r.planId).name);
    },
    'hold-proposal': function (c, el) {
      ui.commit(St.holdProposal(c.state, el.getAttribute('data-id'), '고객'), '보류했어요. 나중에 다시 볼 수 있어요.');
    },
    'save-consent': function (c, form, fd) {
      var s = St.setAutoApplyConsent(c.state, {
        enabled: fd.get('enabled') === 'on',
        monthlyLimit: Math.max(0, Number(fd.get('monthlyLimit')) || 0),
        essentialFloorRatio: Number(fd.get('floor')) || 0.9
      }, '고객');
      ui.commit(s, '자동 적용 설정을 저장했어요.');
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
