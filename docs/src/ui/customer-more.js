/* 더보기: 내 정보, 위험성향 설문, 정책상품, 데이터 내보내기·불러오기·초기화, 앱 설치 안내 */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;
  var St = P.store;
  var dates = P.dates;

  var MENU = [
    { key: 'info', label: '내 정보', desc: '기본정보·소득·자산·부채·목표' },
    { key: 'risk', label: '위험성향 설문', desc: '10문항 · 금융기관 결과와 따로 저장' },
    { key: 'products', label: '상품 조건·비교', desc: '정책상품 가입 조건, 은행 예·적금 후보, 목표일 재원 여부' },
    { key: 'data', label: '데이터 관리', desc: '내보내기·불러오기·시연 데이터로 초기화' },
    { key: 'install', label: '앱 설치 안내', desc: '홈 화면에 추가하기' },
    { key: 'tour', label: '둘러보기 다시 보기', desc: '설계 전후 진단부터 고객 선택까지 4단계(약 2분)' }
  ];

  function back() {
    return '<button class="link-btn" data-action="more" data-key="">← 더보기</button>';
  }

  function issuesBox(c) {
    var list = c.d.issues;
    if (!list.length) return '<p class="notice ok"><span aria-hidden="true">✓</span>입력 내용에 모순이 없어요.</p>';
    return '<div class="notice ' + (list.some(function (i) { return i.level === 'error'; }) ? 'bad' : 'warn') + '"><div><strong>확인할 내용 ' + list.length + '건</strong><ul class="rows">' +
      list.map(function (i) { return '<li><span class="small">' + ui.esc(i.message) + '</span>' + ui.badge(i.level === 'error' ? '오류' : i.level === 'warn' ? '주의' : '참고', i.level === 'error' ? 'bad' : i.level === 'warn' ? 'warn' : 'info') + '</li>'; }).join('') +
      '</ul><p class="small muted">저장은 되지만 계산 결과가 실제와 다를 수 있어요.</p></div></div>';
  }

  /** 내 정보: 입력한 고객정보 요약(미확인 표시). 수정은 첫 화면과 같은 입력 화면에서 한다. */
  ui.factValue = function (k, key, val, unit) {
    if ((k.unknown || []).indexOf(key) >= 0) return '<span class="muted">미확인</span>';
    if (val === null || val === undefined || val === '') return '<span class="muted">미확인</span>';
    return typeof val === 'number' ? fmt.num1(val) + (unit === undefined ? '만원' : unit) : ui.esc(val);
  };

  function infoView(c) {
    var k = c.state.customer;
    var fv = function (key, val, unit) { return ui.factValue(k, key, val, unit); };
    var d0 = (k.debts || [])[0];
    var lv = (k.livingItems || []).map(function (it) {
      return '<li><span>' + ui.esc(it.label) + (it.essential ? ' <span class="small muted">필수</span>' : '') + '</span><span class="num">' + fv('lv_' + it.key, it.amount) + '</span></li>';
    }).join('');
    var row = function (l, v) { return '<li><span>' + l + '</span><span class="num">' + v + '</span></li>'; };
    return back() + '<section class="card"><div class="card-head"><h2>내 정보</h2><button class="btn btn-sm btn-primary" data-action="edit-info">고객정보 수정</button></div>' + issuesBox(c) +
      '<h3>기본정보</h3><ul class="kv">' + row('이름', ui.esc(k.name)) + row('만 나이', k.age ? k.age + '세' : '<span class="muted">미확인</span>') + row('가구', fv('household', k.household)) + row('직업·회사', ui.esc([k.job, k.companySize].filter(Boolean).join(' · ') || '미확인')) + '</ul>' +
      '<h3>소득과 지출</h3><ul class="kv">' + row('월 실수령', fv('netMonthly', k.netMonthly)) + row('연 총급여', fv('grossPrevYear', k.grossPrevYear)) +
      row('기존 저축·투자(월)', k.existingSaving && k.existingSaving.monthly !== null && k.existingSaving.monthly !== undefined ? fmt.num1(k.existingSaving.monthly) + '만원' + (k.existingSaving.note ? ' <span class="small muted">' + ui.esc(k.existingSaving.note) + '</span>' : '') : '<span class="muted">미확인</span>') + '</ul>' +
      (lv ? '<ul class="kv sub">' + lv + '</ul>' : '') +
      '<h3>자산과 부채</h3><ul class="kv">' + row('현금·입출금', fv('cash', k.cash)) + row('만기 예·적금', fv('savings', k.savings)) + row('투자자산', fv('investment', k.investment)) + row('연금저축', fv('pension', k.pension)) +
      row('비상금(별도)', fv('emergency', k.emergency)) + row('주거자금(별도)', fv('housing', k.housing)) +
      row('임차보증금', k.depositReturn ? fmt.num1(k.depositReturn.amount) + '만원 · ' + ui.esc(k.depositReturn.month) + ' 반환' : fv('depositCurrent', null)) +
      row('부채', d0 ? ui.esc(d0.name) + ' ' + fmt.num1(d0.balance) + '만원 · 연 ' + fmt.short(d0.rate * 100) + '% · ' + (d0.method === 'equalPrincipal' ? '원금균등' : '원리금균등') : '없음') + '</ul>' +
      '<h3>목표와 선호</h3><ul class="kv">' + row('목표 보증금', fv('depositTarget', k.goal.depositTarget)) + row('부대비용', fv('movingCost', k.goal.movingCost)) + row('비상금 목표', fv('emergencyTarget', k.goal.emergencyTarget)) +
      row('결혼 계획', fv('marriagePlan', k.marriagePlan)) + '</ul>' +
      '<p class="small muted">수정하면 고객용·설계사용 화면 결과가 함께 다시 계산돼요. 확정한 계획은 바뀌지 않아요.</p></section>' +
      (ui.selfCheckCard ? ui.selfCheckCard(c) : '');
  }

  function riskView(c) {
    var rv = P.risk.review(c.state.customer, c.d.today);
    var inst = (c.state.customer.risk || {}).institution;
    var app = (c.state.customer.risk || {}).appSurvey;
    var answers = (app && app.answers) || {};
    return back() + '<section class="card"><h2>위험성향</h2>' +
      '<div class="compare"><div><div class="label">금융기관 결과</div>' + (inst ? '<strong>' + ui.esc(inst.type) + '</strong><div class="small muted">' + ui.esc(inst.date) + ' · ' + ui.esc(inst.source) + '</div>' : '<span class="muted">없음</span>') + '</div>' +
      '<div><div class="label">앱 설문 결과</div>' + (app ? '<strong>' + ui.esc(app.type) + '</strong><div class="small muted">' + ui.esc(app.date) + ' · ' + app.score + '점</div>' : '<span class="muted">아직 안 함</span>') + '</div></div>' +
      '<p>지금 계획에 적용하는 성향: <strong>' + ui.esc(rv.applied) + '</strong></p>' +
      (rv.recommend ? '<div class="notice warn"><div><strong>설문을 다시 하시길 권해요</strong><ul>' + rv.reasons.map(function (r) { return '<li class="small">' + ui.esc(r) + '</li>'; }).join('') + '</ul></div></div>' : '') +
      '<p class="small muted">나이나 소득만으로 성향을 추정하지 않아요. 확인된 성향이 없으면 보수적으로 적용해요.</p></section>' +
      '<section class="card"><h2>위험성향 설문(10문항)</h2><form data-submit="save-risk">' +
      P.risk.QUESTIONS.map(function (q, qi) {
        return '<fieldset><legend>' + (qi + 1) + '. ' + ui.esc(q.text) + '</legend>' + q.options.map(function (o, oi) {
          return '<label class="choice"><input type="radio" name="' + q.id + '" value="' + oi + '"' + (Number(answers[q.id]) === oi && answers[q.id] !== undefined ? ' checked' : '') + ' required>' + ui.esc(o) + '</label>';
        }).join('') + '</fieldset>';
      }).join('') + '<button class="btn btn-primary btn-block" type="submit">결과 저장</button></form></section>';
  }

  function productsView(c) {
    var plan = c.d.plan;
    var high = c.d.current.rows.length ? c.d.current.rows[0].debtHigh : 0;
    return back() + P.policies.POLICIES.map(function (pol) {
      var e = P.policy.checkEligibility(pol, c.state.customer, c.d.next);
      var maturity = pol.termMonths && pol.kind === 'saving' ? dates.addMonths(c.d.next, pol.termMonths) : null;
      var late = maturity && dates.parseYM(maturity) > dates.parseYM(plan.targetMonth);
      return '<section class="card"><div class="card-head"><h2>' + ui.esc(pol.name) + '</h2>' + ui.badge(e.status) + '</div>' +
        '<p class="small muted">' + ui.esc(pol.agency) + ' · 확인일 ' + ui.esc(pol.checkedAt) + ' 기준 · 자료 상태 ' + ui.esc(pol.status) + '</p>' +
        '<ul class="rows sub">' + pol.conditions.map(function (t) { return '<li>' + ui.esc(t) + '</li>'; }).join('') + '</ul>' +
        ui.fold('내 조건 확인', '<ul class="rows">' + e.checks.map(function (k) { return '<li><span class="small">' + ui.esc(k.label) + ': ' + ui.esc(k.detail) + '</span>' + ui.badge(k.result) + '</li>'; }).join('') + '</ul>') +
        (maturity ? '<p class="small">다음 달 가입 시 만기 ' + ui.esc(maturity) + (late ? ' — ' + ui.badge('목표일 재원 아님', 'warn') : ' — 이사 전 만기') + '</p>' : '') +
        (pol.kind === 'saving' && high > 0.05 ? '<p class="small muted">고금리 부채가 남아 있으면 먼저 상환하는 쪽이 유리할 수 있어요.</p>' : '') +
        (pol.kind === 'loan' ? '<p class="small muted">대출 활용 비교안으로만 보여주며, 대출금은 소득이나 순자산 증가로 세지 않아요.</p>' : '') +
        '<p class="small muted">' + ui.esc(pol.source) + '. 가입·신청 전 공식 기관에서 다시 확인하세요.</p></section>';
    }).join('') + ui.bankCard(c);
  }

  function dataView(c) {
    var mode = ui.app.store.mode;
    var confirm = c.view.confirm === 'reset-demo'
      ? '<div class="notice warn" role="alert"><div><p><strong>설계 예시로 되돌릴까요?</strong> 지금 기록·계획 버전·설정이 모두 지워져요. 먼저 내보내기를 해 두면 다시 불러올 수 있어요.</p>' +
        '<div class="btn-row"><button class="btn btn-danger" data-action="reset-demo">초기화</button><button class="btn" data-action="cancel-confirm">취소</button></div></div></div>'
      : '<button class="btn btn-danger btn-block" data-action="reset-demo-confirm">설계 예시로 되돌리기</button>';
    return back() + '<section class="card"><h2>데이터 관리</h2>' +
      '<p class="small">' + (mode === 'storage' ? '데이터는 이 기기의 브라우저에만 저장돼요. 다른 사람이 바꿀 수 없어요.' : '이 브라우저에는 저장할 수 없어 창을 닫으면 사라져요. 내보내기로 보관하세요.') + '</p>' +
      '<div class="btn-row"><button class="btn btn-primary" data-action="export-json">데이터 내보내기(JSON)</button>' +
      '<label class="btn" for="import-file">불러오기</label><input id="import-file" class="sr-only" type="file" accept=".json,application/json" data-change="import-json"></div>' +
      '<p class="small muted">불러올 때는 파일 내용을 먼저 보여 드리고, 반영을 눌러야 바뀌어요. 다른 기기와 자동으로 공유되지 않아요.</p></section>' +
      '<section class="card"><h2>설계 예시</h2><p class="small muted">설계 예시(사례 보고서 가상 고객)의 처음 상태로 되돌립니다.</p>' + confirm + '</section>' +
      '<section class="card"><h2>처음부터 다시</h2><p class="small muted">모든 데이터를 지우고 고객정보 입력 화면부터 다시 시작합니다.</p><button class="btn btn-danger btn-block" data-action="start-over-confirm">처음부터 다시 입력</button>' +
      (c.view.confirm === 'start-over' ? '<div class="notice warn" role="alert"><div><p><strong>모든 데이터를 지울까요?</strong> 이 브라우저에 백업 1개를 남깁니다.</p><div class="btn-row"><button class="btn btn-danger" data-action="start-over">지우고 다시 입력</button><button class="btn" data-action="cancel-confirm">취소</button></div></div></div>' : '') + '</section>';
  }

  function installView() {
    return back() + '<section class="card"><h2>앱 설치 안내</h2>' +
      '<p><strong>아이폰(Safari)</strong>: 공유 버튼 → ‘홈 화면에 추가’</p>' +
      '<p><strong>안드로이드(Chrome)</strong>: 오른쪽 위 메뉴 → ‘앱 설치’ 또는 ‘홈 화면에 추가’</p>' +
      '<p class="small muted">설치하면 인터넷이 없어도 열 수 있어요(웹 주소로 열었을 때). 파일을 직접 열었을 때는 설치 기능이 없지만 다른 기능은 그대로 쓸 수 있어요.</p></section>';
  }

  ui.screens.more = function (c) {
    switch (c.view.more) {
      case 'info': return infoView(c);
      case 'risk': return riskView(c);
      case 'products': return productsView(c);
      case 'data': return dataView(c);
      case 'install': return installView();
    }
    var warn = c.d.issues.filter(function (i) { return i.level !== 'info'; }).length;
    var rv = P.risk.review(c.state.customer, c.d.today);
    return '<section class="card"><h2>더보기</h2><ul class="rows">' + MENU.map(function (m) {
      var b = m.key === 'info' && warn ? ui.badge('확인 ' + warn + '건', 'warn') : m.key === 'risk' && rv.recommend ? ui.badge('재진단 권고', 'warn') : '';
      return '<li><button class="link-btn" style="text-align:left;flex:1" data-action="' + (m.key === 'tour' ? 'tour-start' : 'more') + '" data-key="' + m.key + '"><span class="t">' + m.label + '</span><br><span class="small muted" style="font-weight:400">' + m.desc + '</span></button>' + b + '</li>';
    }).join('') + '</ul></section>';
  };

  function num(fd, k) {
    var v = String(fd.get(k) || '').trim();
    return v === '' ? 0 : Number(v);
  }

  Object.assign(ui.actions, {
    more: function (c, el) { ui.setView({ more: el.getAttribute('data-key') || null, confirm: null }); },

    'save-risk': function (c, form, fd) {
      var answers = {};
      P.risk.QUESTIONS.forEach(function (q) { if (fd.get(q.id) !== null) answers[q.id] = Number(fd.get(q.id)); });
      var res = P.risk.scoreSurvey(answers);
      if (!res.complete) { ui.toast('10문항에 모두 답해 주세요(' + res.answered + '/10).'); return; }
      ui.commit(St.saveRiskSurvey(c.state, res, answers, '고객'), '위험성향 결과: ' + res.type + '(' + res.score + '점)');
    },

    'export-json': function (c) {
      var text = St.exportJSON(c.state);
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '재무플래너-' + c.d.today + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      ui.toast('내보냈어요. 다운로드 폴더를 확인하세요.');
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
