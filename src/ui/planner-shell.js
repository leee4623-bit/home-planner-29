/* 설계사 화면 틀: 6단계 진행 막대 + 왼쪽 사이드바 + 페이지. 1 상담 시작, 2 고객 정보·목표. */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;
  var St = P.store;
  var dates = P.dates;

  var STEPS = ['상담', '정보', '진단', '설계', '실행', '점검'];
  var GROUPS = [
    { step: 1, title: '1 상담 시작', pages: [['overview', '고객 개요'], ['scope', '상담 범위'], ['risk', '위험성향']] },
    { step: 2, title: '2 고객 정보·목표', pages: [['info', '고객 정보·목표'], ['history', '변경 이력']] },
    { step: 3, title: '3 진단', pages: [['diagnosis', '판정·지표·유동성']] },
    { step: 4, title: '4 설계안', pages: [['plans', '계획 버전·제안'], ['tools', '설계 도구']] },
    { step: 5, title: '5 실행', pages: [['execution', '실행 기록·예측']] },
    { step: 6, title: '6 점검', pages: [['alerts', '경보·수정안'], ['settings', '경보 기준'], ['verify', '계산 검증'], ['report', '상담 리포트']] }
  ];
  var pages = (ui.plannerPages = ui.plannerPages || {});

  function stepOf(key) {
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].pages.some(function (p) { return p[0] === key; })) return GROUPS[i].step;
    }
    return 1;
  }

  ui.screens.planner = function (c) {
    var key = pages[c.view.plannerPage] ? c.view.plannerPage : 'overview';
    var step = stepOf(key);
    var progress = '<nav class="progress" aria-label="재무설계 6단계"><ol>' + STEPS.map(function (s, i) {
      return '<li><button data-action="planner-step" data-step="' + (i + 1) + '"' + (step === i + 1 ? ' aria-current="step"' : '') + '>' + (i + 1) + ' ' + s + '</button></li>';
    }).join('') + '</ol></nav>';
    var side = '<nav class="sidebar" aria-label="설계사 메뉴">' + GROUPS.map(function (g) {
      return '<h3>' + g.title + '</h3>' + g.pages.map(function (p) {
        return '<button data-action="planner-page" data-page="' + p[0] + '"' + (key === p[0] ? ' aria-current="page"' : '') + '>' + p[1] + '</button>';
      }).join('');
    }).join('') + '</nav>';
    return progress + '<div class="planner-wrap">' + side + '<main class="planner-main" id="main">' + pages[key](c) + '</main></div>';
  };

  Object.assign(ui.actions, {
    'planner-page': function (c, el) { ui.setView({ plannerPage: el.getAttribute('data-page'), confirm: null }); },
    'planner-step': function (c, el) {
      var g = GROUPS[Number(el.getAttribute('data-step')) - 1];
      ui.setView({ plannerPage: g.pages[0][0], confirm: null });
    }
  });

  /* ---------- 공통 ---------- */
  ui.pageHead = function (title, sub, actions) {
    return '<div class="page-head"><div><h1>' + ui.esc(title) + '</h1>' + (sub ? '<p class="muted small">' + sub + '</p>' : '') + '</div>' +
      (actions ? '<div class="btn-row">' + actions + '</div>' : '') + '</div>';
  };

  function cond(j, key) { return j.conditions.filter(function (x) { return x.key === key; })[0]; }
  ui.cond = cond;

  /* ---------- 1. 고객 개요 ---------- */
  pages.overview = function (c) {
    var k = c.state.customer;
    var j = c.d.current.judgement;
    var h = cond(j, 'housing');
    var age = dates.ageAt(k.birth, c.d.month);
    var pendingRev = c.d.pending.filter(function (p) { return p.status === '확인 대기'; }).length;
    var activeAlerts = (c.state.alerts || []).filter(function (a) { return a.status !== '해소'; }).length;
    var ms = c.d.thisMonth;
    var missed = ms.items.filter(function (i) { return i.state === '미달'; }).length;
    return ui.pageHead('고객 개요', '기준일 ' + ui.esc(c.d.today) + ' · 실행 기준 「' + ui.esc(c.d.plan.name) + '」', '<button class="btn" data-action="tour-start">둘러보기(약 2분)</button>') +
      '<section class="card"><p class="conclusion' + (j.status === '전체 목표 달성' ? ' ok' : '') + '">' +
      (j.status === '전체 목표 달성' ? '확정 기록 반영 후 <strong>전체 목표 달성</strong> 경로입니다.' :
        '확정 기록 반영 후 이사월(' + ui.esc(c.d.plan.targetMonth) + ') 판정은 <strong>' + ui.esc(j.label) + '</strong>' + (h && !h.met ? ', 주거자금 ' + fmt.num1(h.shortfall) + '만원 부족' : '') + '입니다.') +
      '</p></section>' +
      '<section class="kpis k4">' +
      ui.kpi('판정(기록 반영)', ui.judgementBadge(j)) +
      ui.kpi('이번 달 미달 항목', '<span class="num">' + missed + '<small>건</small></span>', ms.recordStatus ? '기록 ' + ms.recordStatus : '기록 없음') +
      ui.kpi('활성 경보', '<span class="num">' + activeAlerts + '<small>건</small></span>') +
      ui.kpi('확인 대기 수정안', '<span class="num">' + pendingRev + '<small>건</small></span>') +
      '</section>' +
      '<section class="cols-2"><div class="card"><h2>기본정보</h2>' + ui.table(['항목', '값'], [
        ['이름', k.name], ['나이', k.age ? '만 ' + k.age + '세' : age === null ? '—' : '만 ' + age + '세(' + k.birth + ' 출생)'], ['직업·회사', k.job + ' · ' + k.companySize],
        ['가구', k.household || '—'], ['재직', k.tenure ? k.tenure + '년 차' : (k.firstJob || '—')], ['월 실수령', fmt.num1(k.netMonthly) + '만원'], ['직전연도 총급여', fmt.num1(k.grossPrevYear) + '만원']
      ], { caption: '기본정보' }) + '</div>' +
      '<div class="card"><h2>목표</h2>' + ui.table(['항목', '값'], [
        ['이사 예정월(실행 기준)', c.d.plan.targetMonth],
        ['목표 보증금 + 이사비', fmt.num1(c.d.current.input.goal.depositTarget) + ' + ' + fmt.num1(c.d.current.input.goal.movingCost) + '만원'],
        ['비상금 목표', fmt.num1(c.d.current.input.goal.emergencyTarget) + '만원'],
        ['고금리 기준', '연 ' + fmt.short(c.d.current.input.assumptions.highRateThreshold * 100) + '% 이상']
      ], { caption: '목표' }) + '</div></section>';
  };

  /* ---------- 1. 상담 범위 ---------- */
  pages.scope = function () {
    return ui.pageHead('상담 범위', '이번 상담에서 다루는 것과 다루지 않는 것') +
      '<section class="cols-2"><div class="card"><h2>' + ui.badge('이번 범위', 'ok') + '</h2><ul class="rows">' +
      '<li>주거자금(이사 보증금·이사비) 마련</li><li>부채 상환(고금리 우선)</li><li>비상금 확보</li></ul></div>' +
      '<div class="card"><h2>' + ui.badge('범위 밖', 'muted') + '</h2><ul class="rows">' +
      '<li>보험(위험관리)</li><li>은퇴 설계</li><li>투자 상품 선택·추천</li></ul>' +
      '<p class="small muted">부양가족이 생기거나, 이직하거나, 연 1회 정기 점검 때 다시 다룹니다.</p></div></section>' +
      '<section class="card"><h2>진행 방식</h2><p>설계사가 계획을 세워 제시하고, 고객이 선택한 계획만 실행 기준이 됩니다. 이후 고객이 매달 실행을 기록하고, 앱이 계획과 비교해 경보와 수정안을 만듭니다.</p>' +
      '<p class="small muted">모든 계산은 결정론적 월별 계산이며 확률(성공 확률 등)로 표현하지 않습니다. 충격 시나리오는 "이 충격이 오면"의 조건부 결과입니다.</p></section>';
  };

  /* ---------- 1. 위험성향 ---------- */
  pages.risk = function (c) {
    var rv = P.risk.review(c.state.customer, c.d.today);
    var r = c.state.customer.risk || {};
    var row = function (src, x) {
      return x ? [src, x.type, x.date, x.source || '앱 설문(' + x.score + '점)', x.purpose || '—', x.netAtThatTime ? fmt.num1(x.netAtThatTime) + '만원' : '—'] : [src, '없음', '—', '—', '—', '—'];
    };
    return ui.pageHead('위험성향', '금융기관 결과와 앱 설문을 따로 저장합니다') +
      '<section class="card"><p class="conclusion">적용 성향: <strong>' + ui.esc(rv.applied) + '</strong></p>' +
      (rv.recommend ? '<div class="notice warn"><div><strong>앱 설문 재진단 권고</strong><ul>' + rv.reasons.map(function (x) { return '<li>' + ui.esc(x) + '</li>'; }).join('') + '</ul></div></div>' : '<p class="notice ok">재진단 사유가 없습니다.</p>') +
      '</section><section class="card"><h2>진단 기록</h2>' + ui.table(['구분', '유형', '진단일', '출처', '목적', '진단 당시 실수령'], [row('금융기관', r.institution), row('앱 설문', r.appSurvey)], { caption: '위험성향 기록' }) +
      '<p class="small muted">나이나 소득만으로 성향을 추정하지 않습니다. 성향이 확인되지 않으면(없음·24개월 경과) 보수적으로 적용합니다. 설문은 고객 화면 → 더보기에서 고객이 직접 합니다.</p></section>';
  };

  /* ---------- 2. 고객 정보·목표 ---------- */
  var INFO_ROWS = [
    ['birth', '출생 연월'], ['firstJob', '최초 취업월'], ['companySize', '회사 규모'], ['grossPrevYear', '직전연도 총급여'], ['netMonthly', '월 실수령'],
    ['cash', '목적 미지정 현금'], ['emergency', '비상금'], ['housing', '주거자금'], ['investment', '투자자산'], ['pension', '연금']
  ];

  function show(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return fmt.num1(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  pages.info = function (c) {
    var k = c.state.customer;
    var plan = c.d.plan;
    var since = (c.state.changeLog || []).filter(function (e) { return /^(내 정보 변경|고객정보 수정)/.test(e.what) && e.at >= (plan.date || ''); });
    var te = k.taxExemption || {};
    var issues = c.d.issues;
    var rows = INFO_ROWS.map(function (r) { return [r[1], (k.unknown || []).indexOf(r[0]) >= 0 ? '미확인' : show(k[r[0]])]; }).concat([
      ['소득세 감면', te.applied ? te.start + ' ~ ' + te.end + ' (종료 후 −' + fmt.short(te.monthlyEffect) + '만원)' : '미적용'],
      ['보증금 반환', k.depositReturn ? fmt.num1(k.depositReturn.amount) + '만원 · ' + k.depositReturn.month : '—'],
      ['목표 보증금 / 이사비 / 비상금', show(k.goal.depositTarget) + ' / ' + show(k.goal.movingCost) + ' / ' + show(k.goal.emergencyTarget)]
    ]);
    var debts = (k.debts || []).map(function (d) { return [d.name, ui.n1(d.balance), { html: fmt.short(d.rate * 100) + '%' }, d.method === 'equalPrincipal' ? '원금균등(월 원금 ' + fmt.short(d.monthlyPrincipal) + ')' : '원리금균등', ui.n1(d.monthlyPayment), d.rate >= c.d.current.input.assumptions.highRateThreshold ? { html: ui.badge('고금리', 'warn') } : '저금리']; });
    return ui.pageHead('고객 정보·목표', '첫 화면에서 입력한 고객정보입니다. 수정하면 두 화면 결과가 함께 다시 계산됩니다.',
      '<button class="btn" data-action="edit-info">고객정보 수정</button> <button class="btn btn-primary" data-action="planner-latest-version">최신 정보로 새 안 작성</button>') +
      '<section class="card"><h2>입력 검증 ' + (issues.length ? ui.badge(issues.length + '건', issues.some(function (i) { return i.level === 'error'; }) ? 'bad' : issues.some(function (i) { return i.level === 'warn'; }) ? 'warn' : 'info') : ui.badge('이상 없음', 'ok')) + '</h2>' +
      (issues.length ? ui.table(['수준', '내용'], issues.map(function (i) { return [{ html: ui.badge(i.level === 'error' ? '오류' : i.level === 'warn' ? '주의' : '참고', i.level === 'error' ? 'bad' : i.level === 'warn' ? 'warn' : 'info') }, { html: ui.esc(i.message), cls: 'l' }]; }), { caption: '입력 검증' }) : '') + '</section>' +
      '<section class="card"><h2>실행 기준 계획 작성(' + ui.esc(plan.date || '') + ') 이후 바뀐 정보</h2>' +
      (since.length ? ui.table(['날짜', '누가', '항목', '이전', '이후'], since.map(function (e) {
        return [e.at, e.who, e.what.replace('내 정보 변경: ', '').replace('고객정보 수정: ', ''), { html: ui.esc(show(e.detail && e.detail.before)), cls: 'l' }, { html: ui.esc(show(e.detail && e.detail.after)), cls: 'l' }];
      }), { caption: '바뀐 정보' }) + '<p class="small muted">계산은 항상 최신 고객 정보를 씁니다. 바뀐 정보를 반영한 안을 고객에게 다시 제시하려면 [최신 정보로 새 안 작성]을 누르세요.</p>'
        : '<p class="muted">계획 작성 이후 바뀐 고객 정보가 없습니다.</p>') + '</section>' +
      '<section class="cols-2"><div class="card"><h2>고객 정보</h2>' + ui.table(['항목', '값'], rows, { caption: '고객 정보' }) + '</div>' +
      '<div class="card"><h2>부채</h2>' + ui.table(['이름', '잔액', '연 금리', '상환 방식', '월 약정', '구분'], debts, { caption: '부채' }) + '</div></section>';
  };

  pages.history = function (c) {
    var log = (c.state.changeLog || []).slice().reverse();
    return ui.pageHead('변경 이력', '누가 · 언제 · 어떤 항목 · 어느 버전') +
      '<section class="card">' + ui.table(['날짜', '누가', '내용', '버전'], log.map(function (e) {
        return [e.at, e.who, { html: ui.esc(e.what), cls: 'l' }, e.version || '—'];
      }), { caption: '변경 이력' }) + '</section>';
  };

  Object.assign(ui.actions, {
    'planner-latest-version': function (c) {
      var r = St.createPlanVersion(c.state, c.state.activePlanId, {}, null, {
        name: '최신 정보 반영안(' + c.d.today + ')', memo: '고객 정보 최신값 기준으로 다시 작성', author: '설계사'
      });
      ui.app.view.plannerPage = 'plans';
      ui.commit(r.state, '새 안을 만들었어요. 설계안 화면에서 고객에게 제시할 수 있어요.');
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
