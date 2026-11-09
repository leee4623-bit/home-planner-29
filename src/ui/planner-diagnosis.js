/* 3. 진단: 설계 전·후 목표 판정, 진단 지표(원인 한 줄), 유동성 진단 문단, 설계 전 자금 경로 */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;
  var pages = ui.plannerPages;

  var STATUS_TEXT = { ok: '양호', warn: '주의', bad: '경보', na: '계산 불가' };

  function valText(v, unit) {
    if (v === null || v === undefined) return '계산 불가';
    if (unit === '만원') return fmt.num1(v);
    if (unit === '개월') return fmt.num1(v) + '개월';
    if (unit === '%') return fmt.pct(v);
    return String(v);
  }
  ui.metricText = valText;

  function judgeTable(jb, ja, labels) {
    var rows = ['debt', 'emergency', 'housing'].map(function (k) {
      var b = ui.cond(jb, k);
      var a = ui.cond(ja, k);
      var cell = function (x) {
        return { html: ui.badge(x.met ? '충족' : '미달') + ' <span class="num small">' + (k === 'debt' ? '잔액 ' + fmt.num1(x.value) : fmt.num1(x.value) + ' / ' + fmt.num1(x.target)) + (x.met ? '' : ' · 부족 ' + fmt.num1(x.shortfall)) + '</span>' };
      };
      return [a.label, cell(b), cell(a)];
    });
    rows.push(['판정', { html: ui.judgementBadge(jb) }, { html: ui.judgementBadge(ja) }]);
    return ui.table(['조건', labels[0], labels[1]], rows, { caption: '설계 전·후 목표 판정' });
  }

  /** 규칙 기반 유동성 진단 문단 */
  function liquidityText(m) {
    var get = function (k) { return m.list.filter(function (x) { return x.key === k; })[0]; };
    var em = get('emergencyMonths');
    var liq = get('liquid');
    var res = get('restricted');
    var sale = get('saleable');
    var s = [];
    s.push('즉시 쓸 수 있는 현금성 자산은 ' + fmt.num1(liq.value) + '만원으로 필수생활비 ' + fmt.num1(liq.sub[0].value) + '개월분입니다.');
    if (em.value !== null) {
      s.push('이 중 비상금은 ' + fmt.num1(em.value) + '개월분으로 기준(' + em.threshold.value + '개월) ' + (em.status === 'ok' ? '이상입니다.' : '에 못 미칩니다.'));
    }
    s.push('투자자산 ' + fmt.num1(sale.value) + '만원은 팔 때 가격이 변할 수 있어 현금성과 따로 봅니다.');
    if (res.sub[0].value !== null) {
      s.push('반환 전 보증금·연금 등 바로 쓸 수 없는 자산이 총자산의 ' + fmt.pct(res.sub[0].value) + '(' + fmt.num1(res.value) + '만원)라, ' +
        (res.sub[0].value >= 0.4 ? '자산 규모에 비해 당장 쓸 수 있는 돈이 적은 편입니다.' : '유동성 제약은 크지 않습니다.'));
    }
    return s.join(' ');
  }

  pages.diagnosis = function (c) {
    var before = c.d.beforePlan;
    var activeId = c.state.activePlanId;
    var after = c.d.plan;
    if (!before) {
      return ui.pageHead('진단') + '<section class="card">' + ui.empty('설계 전 진단 계획이 없습니다.') + '</section>';
    }
    var jb = P.engine.runPlan(c.state, before.id).judgement;
    var ja = P.engine.runPlan(c.state, activeId).judgement;
    var cmp = P.metrics.compareMetrics(c.state, before.id, activeId);
    var mrows = cmp.rows.map(function (r) {
      var b = r.before;
      var a = r.after;
      var sub = function (m) { return m.sub.map(function (s) { return s.label + ' ' + valText(s.value, s.unit); }).join(' · '); };
      return [
        { html: ui.esc(r.label) + '<details class="help"><summary aria-label="' + ui.esc(r.label) + ' 정의">?</summary><div><strong>' + ui.esc(r.label) + '</strong><br>' + ui.esc(a.definition) + '<br>기준일: ' + ui.esc(cmp.asOf) + ' · 단위: ' + ui.esc(r.unit) + '</div></details>', cls: 'l' },
        { html: '<span class="num">' + valText(b.value, r.unit) + '</span>' + (b.sub.length ? '<br><span class="small muted">' + ui.esc(sub(b)) + '</span>' : '') },
        { html: '<span class="num fixed-val">' + valText(a.value, r.unit) + '</span>' + (a.sub.length ? '<br><span class="small muted">' + ui.esc(sub(a)) + '</span>' : '') },
        a.threshold ? a.threshold.text : '—',
        { html: a.status === 'info' ? '<span class="muted">—</span>' : ui.badge(STATUS_TEXT[a.status], a.status) },
        { html: ui.esc(r.cause), cls: 'l' }
      ];
    });
    var bres = P.engine.runPlan(c.state, before.id);
    var goal = bres.input.goal;
    var chart = ui.fundChart({
      title: '설계 전 자금 경로',
      width: 640, height: 240,
      series: [{ key: 'before', label: '설계 전 예상(사용 가능 주거자금)', color: '--chart-before', dashed: true, points: bres.rows.map(function (r) { return { month: r.month, value: r.usable }; }) },
        { key: 'em', label: '설계 전 비상금', color: '--chart-trend', dashed: true, points: bres.rows.map(function (r) { return { month: r.month, value: r.emergency }; }) }],
      target: { value: goal.depositTarget + goal.movingCost, label: '목표 ' + fmt.short(goal.depositTarget + goal.movingCost) },
      events: bres.events.filter(function (e) { return ['emergencyReached', 'highDebtPaidOff', 'depositReturn', 'taxExemptionEnd', 'move'].indexOf(e.type) >= 0; })
    });
    var hb = ui.cond(jb, 'housing');
    var ha = ui.cond(ja, 'housing');
    return ui.pageHead('진단', '계획값 기준(실행 기록 반영 전). 기준일 ' + ui.esc(cmp.asOf) + ' · 단위 만원') +
      '<section class="card"><p class="conclusion">설계 전에는 이사월 ' + ui.esc(before.targetMonth) + ' 기준 <strong>' + ui.esc(jb.label) + '</strong>' + (hb.met ? '' : ' — 주거 ' + fmt.num1(hb.shortfall) + '만원 부족') + ', ' +
      '설계 후에는 ' + ui.esc(after.targetMonth) + ' 기준 <strong>' + ui.esc(ja.label) + '</strong>' + (ha.met ? '' : ' — 주거 ' + fmt.num1(ha.shortfall) + '만원 부족') + '입니다.</p>' +
      '<p class="small muted">설계 전과 후는 이사월이 다릅니다(' + ui.esc(before.targetMonth) + ' / ' + ui.esc(after.targetMonth) + '). 같은 달 비교는 계산 검증의 월별 계산표에서 볼 수 있습니다.</p></section>' +
      '<section class="kpis k4">' +
      ui.kpi('월 잉여(설계 전 → 후)', '<span class="num">' + fmt.num1(cmp.before.base.surplus) + ' → ' + fmt.num1(cmp.after.base.surplus) + '</span>', ui.delta(cmp.after.base.surplus - cmp.before.base.surplus, true) + ' 만원') +
      ui.kpi('부채비율', '<span class="num">' + fmt.pct(cmp.after.list.filter(function (m) { return m.key === 'debtRatio'; })[0].value) + '</span>', '기준 40% 이하') +
      ui.kpi('비상자금(설계 후)', '<span class="num">' + fmt.num1(cmp.after.list.filter(function (m) { return m.key === 'emergencyMonths'; })[0].value) + '<small>개월</small></span>', '기준 3개월') +
      ui.kpi('고금리 상환 완료', '<span>' + ui.esc(cmp.before.list.filter(function (m) { return m.key === 'payoff'; })[0].sub[0].value || '—') + ' → ' + ui.esc(cmp.after.list.filter(function (m) { return m.key === 'payoff'; })[0].sub[0].value || '—') + '</span>') +
      '</section>' +
      '<section class="card"><h2>목표 판정(이사월 말 기준)</h2>' + judgeTable(jb, ja, ['설계 전 「' + before.name + '」', '설계 후 「' + after.name + '」']) + '</section>' +
      ui.modelsCard(c) +
      '<section class="card"><h2>진단 지표</h2>' + ui.table(['지표', '설계 전', '설계 후', '기준', '상태(설계 후)', '바뀐 원인'], mrows, { caption: '진단 지표' }) +
      '<p class="small muted">기준값(설정값): 비상자금 3개월 이상, 부채비율 40% 이하(60% 넘으면 경보), 원리금 상환비중 20% 이하(30% 넘으면 경보).</p></section>' +
      '<section class="card"><h2>유동성 진단</h2><p>' + ui.esc(liquidityText(cmp.after)) + '</p><p class="small muted">규칙 기반 문장입니다(설계 후 계획, ' + ui.esc(cmp.asOf) + ' 기준).</p></section>' +
      '<section class="card"><h2>설계 전 자금 경로</h2>' + chart + '</section>';
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
