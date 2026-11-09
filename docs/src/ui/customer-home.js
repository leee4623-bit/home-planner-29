/* 고객 홈: 한 줄 요약(결론) → 핵심 숫자 → 이번 달 할 일 → 확인할 제안 1건 */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;
  var engine = P.engine;
  var dates = P.dates;

  function cond(j, key) {
    return j.conditions.filter(function (c) { return c.key === key; })[0];
  }

  /** 규칙 기반 한 줄 요약 */
  function summary(c) {
    var j = c.d.current.judgement;
    var plan = c.d.plan;
    var when = '이사 때(' + ui.ymText(plan.targetMonth) + ')';
    if (j.status === '판정 불가') return { cls: '', html: '계획의 시작월과 이사월을 먼저 확인해 주세요.' };
    if (j.status === '전체 목표 달성') {
      return { cls: 'ok', html: '이대로면 ' + when + ' <strong>목표를 모두 채울 수 있어요.</strong>' };
    }
    var h = cond(j, 'housing');
    var parts = [];
    if (!h.met) {
      parts.push('이대로면 ' + when + ' <strong>' + fmt.short(h.shortfall) + '만원이 모자라요.</strong>');
    } else {
      parts.push('이대로면 ' + when + ' 주거자금은 충분해요.');
    }
    var others = [];
    var e = cond(j, 'emergency');
    var dbt = cond(j, 'debt');
    if (!dbt.met) others.push('고금리 부채가 ' + fmt.short(dbt.shortfall) + '만원 남아요');
    if (!e.met) others.push('비상금이 ' + fmt.short(e.shortfall) + '만원 부족해요');
    if (others.length) parts.push(others.join(', ') + '.');
    var sv = c.d.solve;
    if (sv && sv.feasible && sv.cut > 0) {
      parts.push(ui.ymText(sv.fromMonth) + '부터 생활비를 <strong class="fix">월 ' + fmt.short(sv.cut) + '만원</strong> 줄이면 맞출 수 있어요.');
    } else if (sv && !sv.feasible) {
      parts.push('<span class="muted">' + ui.esc(sv.reason) + '</span>');
    }
    return { cls: '', html: parts.join(' ') };
  }

  function checklist(c) {
    var m = c.d.thisMonth;
    if (!m.inPlan) return ui.empty('이번 달은 실행 기준 계획 기간 밖이에요.', '내 계획 보기', 'tab', ' data-tab="plan"');
    var savings = m.items.filter(function (i) { return i.kind === 'saving' && i.state !== '해당 없음'; });
    var living = m.items.filter(function (i) { return i.kind === 'livingTotal'; })[0];
    var spend = m.items.filter(function (i) { return i.kind === 'spending'; });
    var row = function (i, higherGood) {
      return '<li><div class="row-main"><div class="t">' + ui.esc(i.label) + (i.partial ? ' <span class="small muted">(일부 기록)</span>' : '') + '</div>' +
        '<div class="s">계획 ' + fmt.num1(i.planned) + ' · 실제 ' + (i.actual === null ? '기록 없음' : '<span class="fixed-val">' + fmt.num1(i.actual) + '</span>') +
        (i.diff !== null && i.diff !== undefined ? ' · 차이 ' + ui.delta(i.diff, higherGood) : '') + '</div></div>' +
        '<div class="row-side">' + ui.badge(i.state) + '</div></li>';
    };
    var subRows = spend.map(function (i) {
      return '<li><span>' + ui.esc(i.label) + '</span><span class="num">' + fmt.num1(i.planned) + ' → ' +
        (i.actual === null ? '<span class="muted">기록 없음</span>' : fmt.num1(i.actual) + ' (' + ui.delta(i.diff, false) + ')') + '</span></li>';
    }).join('');
    return '<ul class="rows">' + savings.map(function (i) { return row(i, true); }).join('') + row(living, false) + '</ul>' +
      '<ul class="rows sub" aria-label="생활비 항목별 참고 숫자">' + subRows + '</ul>' +
      '<p class="small muted">납입 예정일 ' + ui.esc(m.dueDate) + ', 유예기간 ' + ui.esc(m.graceEnd) + '까지. 그 전에는 기록이 없어도 미달로 보지 않아요. ' + ui.help('유예기간') + '</p>' +
      '<div class="btn-row"><button class="btn btn-primary btn-block" data-action="tab" data-tab="record">이번 달 기록하기</button></div>';
  }

  function proposalCard(c) {
    var p = c.d.pending.filter(function (x) { return x.type === '수정안'; })[0] || c.d.pending[0];
    if (!p) return '';
    var isRev = p.type === '수정안';
    return '<section class="card" aria-labelledby="home-prop"><div class="card-head"><h2 id="home-prop">확인할 ' + (isRev ? '수정안' : '제안') + '</h2>' + ui.badge(p.status) + '</div>' +
      '<p><strong>' + ui.esc(p.title) + '</strong></p><p class="small muted">' + ui.esc(isRev ? p.summary : '설계사가 세 가지 실행 전략을 제시했어요. 비교해 보고 고르세요.') + '</p>' +
      (c.d.pending.length > 1 ? '<p class="small muted">이 밖에 확인할 제안 ' + (c.d.pending.length - 1) + '건</p>' : '') +
      '<div class="btn-row"><button class="btn btn-primary" data-action="tab" data-tab="plan">' + (isRev ? '수정안 보기' : '제안 비교하기') + '</button></div></section>';
  }

  ui.screens.home = function (c) {
    var sm = summary(c);
    var cur = c.d.current;
    var plan = c.d.plan;
    var tm = plan.targetMonth;
    var row = engine.rowAt(cur, tm);
    var goal = cur.input.goal;
    var need = goal.depositTarget + goal.movingCost;
    var monthsLeft = Math.max(0, dates.diffMonths(c.d.month, tm));
    var lastRow = cur.lastConfirmed ? engine.rowAt(cur, cur.lastConfirmed) : null;
    var hasProposal = c.d.pending.length > 0;

    return (ui.tourWelcome ? ui.tourWelcome(c) : '') + '<section class="card" aria-labelledby="home-sum"><h2 id="home-sum" class="sr-only">한 줄 요약</h2>' +
      '<p class="conclusion ' + sm.cls + '">' + sm.html + '</p>' +
      (hasProposal ? '<div class="btn-row"><button class="btn btn-primary" data-action="tab" data-tab="plan">' +
        (c.d.pending.some(function (p) { return p.type === '수정안'; }) ? '수정안 보기' : '제안 보기') + '</button></div>' : '') +
      '<p class="small muted">확정 기록까지 반영하고, 그 뒤는 계획대로 간다고 본 결과예요. ' + ui.help('판정') + '</p></section>' +

      '<section class="kpis" aria-label="핵심 숫자">' +
      ui.kpi('이사까지', '<span class="num">' + monthsLeft + '<small>개월</small></span>', ui.ymText(tm)) +
      ui.kpi('이사 때 쓸 돈(예상) ' + ui.help('사용 가능 주거자금'), row ? '<span class="est">' + ui.money(row.usable) + '</span>' : '—', '목표 ' + fmt.short(need) + '만원') +
      ui.kpi('비상금(확정 기록 기준)', lastRow ? ui.money(lastRow.emergency, 'fixed-val') : '—', '목표 ' + fmt.short(goal.emergencyTarget) + '만원') +
      ui.kpi('고금리 부채 상환', '<span class="num est">' + (cur.payoff.high ? ui.ymText(cur.payoff.high) : '없음') + '</span>', '예상 완료월') +
      '</section>' +

      '<section class="card" aria-labelledby="home-todo"><div class="card-head"><h2 id="home-todo">이번 달 할 일 · ' + ui.ymText(c.d.month) + '</h2>' +
      (c.d.thisMonth.recordStatus ? ui.badge(c.d.thisMonth.recordStatus) : ui.badge('아직 확인 안 됨')) + '</div>' + checklist(c) + '</section>' +
      proposalCard(c);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
