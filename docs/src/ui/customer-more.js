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

  var LABELS = {
    name: '이름', birth: '출생 연월', firstJob: '최초 취업월', job: '직업', companySize: '회사 규모', region: '지역',
    grossPrevYear: '직전연도 총급여', netMonthly: '월 실수령', taxExemption: '중소기업 취업 청년 소득세 감면',
    cash: '목적 미지정 현금·예금', emergency: '비상금', housing: '주거자금', investment: '투자자산', pension: '연금',
    depositReturn: '보증금 반환', debts: '부채', goal: '목표'
  };

  function back() {
    return '<button class="link-btn" data-action="more" data-key="">← 더보기</button>';
  }

  function input(name, label, value, type, attrs) {
    return '<div class="field"><label for="f-' + name + '">' + label + '</label><input id="f-' + name + '" name="' + name + '" type="' + (type || 'text') + '" value="' + ui.esc(value === undefined || value === null ? '' : value) + '"' + (attrs || '') + '></div>';
  }
  function money(name, label, value) { return input(name, label + '(만원)', value, 'number', ' min="0" step="0.1" inputmode="decimal"'); }

  function issuesBox(c) {
    var list = c.d.issues;
    if (!list.length) return '<p class="notice ok"><span aria-hidden="true">✓</span>입력 내용에 모순이 없어요.</p>';
    return '<div class="notice ' + (list.some(function (i) { return i.level === 'error'; }) ? 'bad' : 'warn') + '"><div><strong>확인할 내용 ' + list.length + '건</strong><ul class="rows">' +
      list.map(function (i) { return '<li><span class="small">' + ui.esc(i.message) + '</span>' + ui.badge(i.level === 'error' ? '오류' : i.level === 'warn' ? '주의' : '참고', i.level === 'error' ? 'bad' : i.level === 'warn' ? 'warn' : 'info') + '</li>'; }).join('') +
      '</ul><p class="small muted">저장은 되지만 계산 결과가 실제와 다를 수 있어요.</p></div></div>';
  }

  function infoView(c) {
    var k = c.state.customer;
    var te = k.taxExemption || {};
    var dr = k.depositReturn || {};
    var g = k.goal || {};
    var debts = (k.debts || []).slice();
    while (debts.length < 3) debts.push({ name: '', balance: '', rate: '', monthlyPayment: '' });
    var sizes = ['중소기업', '중견기업', '대기업', '공공기관', '기타'];
    return back() + '<section class="card"><h2>내 정보</h2>' + issuesBox(c) +
      '<form data-submit="save-info">' +
      '<fieldset><legend>기본정보</legend>' + input('name', '이름', k.name) +
      '<div class="grid-2">' + input('birth', '출생 연월', k.birth, 'month') + input('firstJob', '최초 취업월', k.firstJob, 'month') + '</div>' +
      '<div class="grid-2">' + input('job', '직업', k.job) +
      '<div class="field"><label for="f-size">회사 규모</label><select id="f-size" name="companySize">' + sizes.map(function (s) { return '<option' + (k.companySize === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div></div>' +
      input('region', '지역', k.region) + '</fieldset>' +
      '<fieldset><legend>소득</legend><div class="grid-2">' + money('grossPrevYear', '직전연도 총급여', k.grossPrevYear) + money('netMonthly', '월 실수령', k.netMonthly) + '</div>' +
      '<label class="choice"><input type="checkbox" name="teApplied"' + (te.applied ? ' checked' : '') + '>중소기업 취업 청년 소득세 감면 적용 중(급여에 이미 반영)</label>' +
      '<div class="grid-2">' + input('teStart', '감면 시작월', te.start, 'month') + input('teEnd', '감면 종료월', te.end, 'month') + '</div>' +
      money('teEffect', '감면 종료 후 줄어드는 월 실수령', te.monthlyEffect) + '</fieldset>' +
      '<fieldset><legend>자산</legend><div class="grid-2">' + money('cash', '목적 미지정 현금', k.cash) + money('emergency', '비상금', k.emergency) +
      money('housing', '주거자금', k.housing) + money('investment', '투자자산', k.investment) + money('pension', '연금', k.pension) + money('drAmount', '돌려받을 보증금', dr.amount) + '</div>' +
      input('drMonth', '보증금 반환월', dr.month, 'month') + '</fieldset>' +
      '<fieldset><legend>부채(최대 3개)</legend>' + debts.slice(0, 3).map(function (d, i) {
        return '<div class="option"><div class="grid-2">' + input('d' + i + 'name', '이름', d.name) + money('d' + i + 'balance', '잔액', d.balance) +
          input('d' + i + 'rate', '연 금리(%)', d.rate === '' ? '' : Math.round(Number(d.rate) * 10000) / 100, 'number', ' min="0" step="0.01"') + money('d' + i + 'pay', '월 약정 상환', d.monthlyPayment) + '</div></div>';
      }).join('') + '<p class="small muted">이름을 비우면 그 부채는 저장하지 않아요.</p></fieldset>' +
      '<fieldset><legend>목표</legend><div class="grid-2">' + money('gDeposit', '목표 보증금', g.depositTarget) + money('gMoving', '이사비', g.movingCost) + money('gEmergency', '비상금 목표', g.emergencyTarget) + '</div></fieldset>' +
      '<p class="small muted">설계사는 이 정보를 조회만 하고 고칠 수 없어요. 바꾼 항목은 변경 이력에 남아요.</p>' +
      '<button class="btn btn-primary btn-block" type="submit">저장</button></form></section>';
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
      ? '<div class="notice warn" role="alert"><div><p><strong>시연 데이터로 되돌릴까요?</strong> 지금 기록·계획 버전·설정이 모두 지워져요. 먼저 내보내기를 해 두면 다시 불러올 수 있어요.</p>' +
        '<div class="btn-row"><button class="btn btn-danger" data-action="reset-demo">초기화</button><button class="btn" data-action="cancel-confirm">취소</button></div></div></div>'
      : '<button class="btn btn-danger btn-block" data-action="reset-demo-confirm">시연 데이터로 초기화</button>';
    return back() + '<section class="card"><h2>데이터 관리</h2>' +
      '<p class="small">' + (mode === 'storage' ? '데이터는 이 기기의 브라우저에만 저장돼요. 다른 사람이 바꿀 수 없어요.' : '이 브라우저에는 저장할 수 없어 창을 닫으면 사라져요. 내보내기로 보관하세요.') + '</p>' +
      '<div class="btn-row"><button class="btn btn-primary" data-action="export-json">데이터 내보내기(JSON)</button>' +
      '<label class="btn" for="import-file">불러오기</label><input id="import-file" class="sr-only" type="file" accept=".json,application/json" data-change="import-json"></div>' +
      '<p class="small muted">불러오면 지금 데이터를 파일 내용으로 바꿔요.</p></section>' +
      '<section class="card"><h2>시연 데이터</h2><p class="small muted">시연 고객(사례 보고서 가상 고객 B안)의 처음 상태로 되돌립니다.</p>' + confirm + '</section>';
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

    'save-info': function (c, form, fd) {
      var debts = [];
      for (var i = 0; i < 3; i++) {
        var name = String(fd.get('d' + i + 'name') || '').trim();
        if (!name) continue;
        // 원금균등 상환 방식·월 원금 같은 화면에 없는 필드는 같은 이름의 기존 부채에서 이어받는다.
        var prev = (c.state.customer.debts || []).filter(function (d) { return d.name === name; })[0] || {};
        debts.push(Object.assign({}, prev, { name: name, balance: num(fd, 'd' + i + 'balance'), rate: num(fd, 'd' + i + 'rate') / 100, monthlyPayment: num(fd, 'd' + i + 'pay') }));
      }
      var patch = {
        name: String(fd.get('name') || '').trim(),
        birth: fd.get('birth') || '',
        firstJob: fd.get('firstJob') || '',
        job: String(fd.get('job') || '').trim(),
        companySize: fd.get('companySize'),
        region: String(fd.get('region') || '').trim(),
        grossPrevYear: num(fd, 'grossPrevYear'),
        netMonthly: num(fd, 'netMonthly'),
        taxExemption: { applied: fd.get('teApplied') === 'on', start: fd.get('teStart') || '', end: fd.get('teEnd') || '', monthlyEffect: num(fd, 'teEffect') },
        cash: num(fd, 'cash'), emergency: num(fd, 'emergency'), housing: num(fd, 'housing'), investment: num(fd, 'investment'), pension: num(fd, 'pension'),
        depositReturn: { amount: num(fd, 'drAmount'), month: fd.get('drMonth') || '' },
        debts: debts,
        goal: { depositTarget: num(fd, 'gDeposit'), movingCost: num(fd, 'gMoving'), emergencyTarget: num(fd, 'gEmergency') }
      };
      var r = St.updateCustomer(c.state, patch, '고객', LABELS);
      if (!r.changed.length) { ui.toast('바뀐 내용이 없어요.'); return; }
      ui.commit(r.state, '내 정보를 저장했어요(' + r.changed.length + '개 항목).');
    },

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
    },

    'import-json': function (c, el) {
      var f = el.files && el.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var r = St.importJSON(String(reader.result));
        if (!r.ok) { ui.toast(r.errors[0]); return; }
        ui.commit(r.state, '불러왔어요.');
      };
      reader.onerror = function () { ui.toast('파일을 읽지 못했어요. 다시 시도해 주세요.'); };
      reader.readAsText(f, 'utf-8');
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
