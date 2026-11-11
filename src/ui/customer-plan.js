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
    var a = list[0];
    var ref = list.filter(function (x) { return x.reference; })[0];
    var head = a.diff >= 0
      ? '원금 기준(최종 판단 기준)으로 ' + ui.esc(ui.ymText(tm)) + ' 말 본인 주거재원 ' + fmt.num1(a.usable) + '만원, 목표(' + fmt.short(a.target) + ')보다 ' + fmt.num1(a.diff) + '만원 많아요.'
      : '원금 기준(최종 판단 기준)으로 목표(' + fmt.short(a.target) + ')보다 ' + fmt.num1(-a.diff) + '만원 모자라요.';
    var row = function (l, v, s2) { return '<li><div class="row-main"><div class="t">' + l + '</div>' + (s2 ? '<div class="s">' + s2 + '</div>' : '') + '</div><div class="row-side"><strong class="num">' + v + '</strong></div></li>'; };
    return '<section class="card" aria-labelledby="models-h"><h2 id="models-h">본인 주거재원 · ' + ui.esc(tm) + ' 말</h2>' +
      '<p class="conclusion">' + head + '</p><ul class="rows">' +
      row('원금 기준(이자 제외, 기존 보증금 반환 포함)', fmt.num1(a.usable), '목표 대비 ' + ui.delta(a.diff, true)) +
      row('마지막 달 적립(' + fmt.num1(a.lastMonthIn) + ') 전에 써야 할 때', fmt.num1(a.paydayUsable), '목표 대비 ' + ui.delta(a.paydayDiff, true)) +
      (ref ? row('참고: 적금 세후 이자를 더하면', fmt.num1(ref.usable), '이자 ' + fmt.num1(ref.usable - a.usable) + '은 금리가 바뀔 수 있어 재원에 넣지 않아요') : '') +
      '</ul><p class="small muted">이자 수익을 넣지 않은 원금 기준이 최종 판단 기준이에요. 실제 계약 실행은 아래 가구 조달표의 지급 후 잔액(완충자금 기준)으로 따로 판단해요.</p></section>' +
      (ui.householdCard ? ui.householdCard(c) : '');
  };

  /** 가구 전세 조달·지급일 잔액(보고서 표 2·9·19·21) */
  ui.householdCard = function (c) {
    var res = c.d.current;
    var h = P.household.compute(c.state, res);
    if (!h) return '';
    var hh = c.state.household;
    var kv = function (l, v, cls) { return '<li><span>' + l + '</span><span class="num' + (cls ? ' ' + cls : '') + '">' + v + '</span></li>'; };
    return '<section class="card" aria-labelledby="hh-h"><div class="card-head"><h2 id="hh-h">가구 전세 조달과 지급 후 잔액</h2>' + ui.badge(h.ok ? '완충자금 충족' : '완충자금 미달', h.ok ? 'good' : 'bad') + '</div>' +
      '<p class="conclusion">모든 지급을 마친 뒤 비상금과 별도로 ' + fmt.num1(h.after) + '만원이 남아요(최소 완충자금 ' + fmt.short(h.bufferMin) + ' ' + (h.ok ? '충족, 추가 여유 ' + fmt.num1(h.margin) : '미달') + '). ' +
      '두 사람의 마지막 달 적립(본인 ' + fmt.num1(h.ownLast) + '·배우자 ' + fmt.short(h.spouseLast) + ') 전에 잔금을 치르면 ' + fmt.num1(h.early) + '만 남아 기준에 ' + (h.early >= h.bufferMin ? '맞아요' : '모자라요(추가 재원 ' + fmt.num1(h.earlyNeed) + ' 필요)') + '.</p>' +
      '<ul class="kv">' + kv('본인 주거재원', fmt.num1(h.own)) + kv('배우자 분담', fmt.num1(h.spouseTotal)) + kv(ui.esc(hh.loan.label || '전세대출'), fmt.num1(h.loan) + (h.loanRatio ? ' <span class="small muted">(보증금의 ' + fmt.short(h.loanRatio * 100) + '%)</span>' : '')) +
      kv('가구 조달 합계', fmt.num1(h.funding)) + kv('전세보증금 + 부대비용', fmt.num1(h.deposit) + ' + ' + fmt.num1(h.moving)) + kv('<strong>지급 후 잔액</strong>', '<strong>' + fmt.num1(h.after) + '</strong>', h.ok ? 'up' : 'down') + '</ul>' +
      ui.fold('본인 계좌의 지급일 흐름', '<ul class="kv">' + h.flow.map(function (f) { return kv(ui.esc(f.label) + ' <span class="small muted">' + ui.esc(f.note) + '</span>', fmt.num1(f.balance)); }).join('') + '</ul>' +
        '<p class="small muted">누적 조달액(주거자금 그래프)과 계약금을 낸 뒤의 실제 계좌잔액은 다릅니다. 계약금은 지급한 달에 잔액에서 빠져요.</p>') +
      ui.fold('조건이 바뀌면', '<ul class="kv">' +
        kv('부대비용 한계(완충자금 ' + fmt.short(h.bufferMin) + ' 유지)', fmt.num1(h.movingLimit) + '까지') +
        kv('배우자 자금 500 감소 시 지급 후 잔액', fmt.num1(h.spouseCut500), h.spouseCut500 < h.bufferMin ? 'down' : '') +
        kv('전세보증금 10% 상승(' + fmt.num1(h.depositUp10.deposit) + ') 시 필요 대출', fmt.num1(h.depositUp10.loanNeeded)) + '</ul>') +
      '<p class="small muted">' + ui.esc(hh.note || '') + ' 대출은 승인 전에는 확정 재원이 아니고, 결혼비용은 이 재원에서 빼지 않는다는 조건이에요.</p></section>';
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
      '<section class="card" aria-labelledby="plan-c"><h2 id="plan-c">주거자금 진행 ' + ui.help('사용 가능 주거자금') + '</h2>' + ui.housingChart(c) +
      '<p class="small muted">확정 기록까지 반영하고, 그 뒤는 계획대로 간다고 본 예상이에요.</p></section>' +
      '<section class="card" aria-labelledby="plan-ba"><h2 id="plan-ba">설계 전·후 목표 비교</h2>' + ui.beforeAfterChart(c) + '</section>' +
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
