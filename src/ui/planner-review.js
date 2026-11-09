/* 5. 실행(원장·예측) / 6. 점검(경보·수정안, 경보 기준, 계산 검증, 상담 리포트) */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;
  var St = P.store;
  var dates = P.dates;
  var engine = P.engine;
  var pages = ui.plannerPages;

  var ITEM_ORDER = ['debt', 'emergency', 'housing', 'product', 'living', 'essential', 'optional'];

  /* ---------- 5. 실행 ---------- */
  pages.execution = function (c) {
    var led = P.tracking.ledger(c.state);
    var headers = ['월', '기록'].concat(ITEM_ORDER.map(function (k) { return { essential: '필수(참고)', optional: '선택(참고)', living: '생활비 합계', debt: '부채 상환', emergency: '비상금', housing: '주거자금', product: '상품 납입' }[k]; }));
    var rows = led.map(function (m) {
      var by = {};
      m.items.forEach(function (i) { by[i.item] = i; });
      return [m.month, { html: m.recordStatus ? ui.badge(m.recordStatus) : ui.badge('기록 없음', 'muted') }].concat(ITEM_ORDER.map(function (k) {
        var i = by[k];
        if (!i) return '—';
        if (i.state === '해당 없음') return { html: '<span class="muted">—</span>' };
        return { html: '<span class="num">' + fmt.num1(i.planned) + ' / ' + (i.actual === null ? '<span class="muted">없음</span>' : '<span class="fixed-val">' + fmt.num1(i.actual) + '</span>') + '</span><br>' + (i.state === '참고' ? '<span class="small muted">' + ui.delta(i.diff, false) + '</span>' : ui.badge(i.state)) };
      }));
    });
    var p = c.d.paths;
    var tm = p.plan.input.targetMonth;
    var line = function (label, r) {
      var row = engine.rowAt(r, tm);
      return [label, ui.n1(row.usable), ui.n1(row.emergency), ui.n1(row.debtHigh), { html: ui.judgementBadge(r.judgement) }];
    };
    var dev = p.deviation || { essential: 0, optional: 0, debt: 0, months: [] };
    return ui.pageHead('실행 기록·예측', '고객이 기록한 값입니다(설계사는 조회만). 계획/실제 · 예정일 + 유예기간이 지나야 미달로 봅니다.') +
      '<section class="cols-2"><div class="card"><h2>' + ui.esc(ui.ymText(c.d.month)) + ' 월 예산 비교</h2>' + ui.budgetChart(c, c.d.month) + '</div>' +
      '<div class="card"><h2>주거자금 진행(기록 반영)</h2>' + ui.housingChart(c, { compareKey: 'cmpBeforeEx' }) + '</div></section>' +
      '<section class="card"><h2>실행 원장</h2>' + ui.table(headers, rows, { caption: '실행 원장' }) +
      '<p class="small muted">생활비 판정은 필수+선택 합계 기준이며, 항목별 값은 참고 숫자입니다.</p></section>' +
      '<section class="card"><h2>이사월(' + ui.esc(tm) + ') 예측</h2>' + ui.table(['가정', '이사 때 쓸 돈', '비상금', '고금리 부채', '판정'], [
        line('당초 계획대로(기록 반영 전)', p.plan),
        line('기록 반영 후 계획대로', p.withRecords),
        line('최근 추세가 이어지면', p.trend)
      ], { caption: '예측' }) +
      '<p class="small muted">최근 추세: 확정 기록 ' + ui.esc(dev.months.join(', ') || '없음') + ' 기준, 계획 대비 매달 필수 ' + fmt.signed(dev.essential) + ' · 선택 ' + fmt.signed(dev.optional) + ' · 상환 ' + fmt.signed(dev.debt) + '만원이 이어진다고 가정.</p></section>';
  };

  /* ---------- 6. 경보·수정안 ---------- */
  pages.alerts = function (c) {
    var alerts = (c.state.alerts || []).slice().reverse();
    var revs = (c.state.proposals || []).filter(function (p) { return p.type === '수정안'; }).reverse();
    return ui.pageHead('경보·수정안', '같은 상황의 경보는 한 번만, 수정안은 경보 하나에만 연결됩니다.') +
      '<section class="card"><h2>경보</h2>' + (alerts.length ? ui.table(['경보', '수준', '상태', '발생', '내용', '연결 수정안'], alerts.map(function (a) {
        var prop = a.proposalId ? St.findProposal(c.state, a.proposalId) : null;
        return [{ html: '<strong>' + ui.esc(a.title) + '</strong>', cls: 'l' }, { html: ui.badge(a.severity) }, { html: ui.badge(a.status) }, a.createdAt || '—',
          { html: '<span class="small">' + ui.esc(a.message) + '</span>', cls: 'l' }, { html: prop ? ui.esc(prop.title) + '<br>' + ui.badge(prop.status) : '—', cls: 'l' }];
      }), { caption: '경보' }) : ui.empty('경보가 없습니다.')) + '</section>' +
      '<section class="card"><h2>수정안</h2>' + (revs.length ? ui.table(['수정안', '상태', '바탕', '내용', '처리'], revs.map(function (p) {
        return [{ html: '<strong>' + ui.esc(p.title) + '</strong><br><span class="small muted">' + ui.esc(p.kind || '') + ' · ' + ui.esc(p.createdAt || '') + '</span>', cls: 'l' },
          { html: ui.badge(p.status) }, p.basePlanId, { html: '<span class="small">' + ui.esc(p.summary || '') + '</span>', cls: 'l' },
          { html: p.appliedAt ? ui.esc(p.appliedAt + ' · ' + p.appliedBy + (p.appliedPlanId ? ' → ' + p.appliedPlanId : '')) : '고객 확인 대기', cls: 'l' }];
      }), { caption: '수정안' }) : ui.empty('수정안이 없습니다.')) +
      '<p class="small muted">수정안은 고객이 고객 화면에서 적용하거나 보류합니다. 고객이 자동 적용에 동의하면 한도 안의 생활비 조정만 자동으로 적용됩니다.</p></section>';
  };

  /* ---------- 6. 경보 기준 ---------- */
  pages.settings = function (c) {
    var s = P.tracking.getSettings(c.state);
    var f = function (name, label, val, attrs, hint) {
      return '<div class="field"><label for="st-' + name + '">' + label + '</label><input id="st-' + name + '" name="' + name + '" type="number" value="' + ui.esc(val) + '"' + attrs + '>' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
    };
    return ui.pageHead('경보 기준 설정') + '<section class="card"><form data-submit="save-alert-settings">' +
      '<div class="cols-2">' +
      f('paymentDay', '납입 예정일(매월)', s.paymentDay, ' min="1" max="28"', '일') +
      f('graceDays', '유예기간', s.graceDays, ' min="0" max="20"', '일 — 이 기간이 지나야 미달로 봅니다') +
      f('cumulativeTolerance', '누적 저축 미달 허용', Math.round(s.cumulativeTolerance * 1000) / 10, ' min="0" max="100" step="0.5"', '%') +
      f('overspendTolerance', '생활비 초과 허용', Math.round(s.overspendTolerance * 1000) / 10, ' min="0" max="100" step="0.5"', '% — 필수+선택 합계 기준') +
      f('emergencyMinMonths', '비상금 최소', s.emergencyMinMonths, ' min="0" max="24" step="0.5"', '개월(필수생활비 기준)') +
      f('trendMonths', '최근 추세 기준', s.trendMonths, ' min="1" max="12"', '개월(확정 기록)') +
      '</div><button class="btn btn-primary" type="submit">저장하고 경보 다시 계산</button></form></section>';
  };

  /* ---------- 6. 계산 검증 ---------- */
  var COLS = [
    ['month', '월'], ['income', '소득'], ['essential', '필수'], ['optional', '선택'], ['interest', '이자'], ['principal', '원금 상환'],
    ['debtTotal', '부채 잔액'], ['debtHigh', '고금리 부채'], ['productPay', '상품 납입'], ['productBalance', '상품 잔액'],
    ['emergencyIn', '비상금 적립'], ['emergency', '비상금 잔액'], ['housingIn', '주거자금 적립'], ['depositReturn', '보증금 반환'],
    ['productMaturity', '상품 만기 지급'], ['housing', '주거자금 잔액'], ['investment', '투자자산'], ['usable', '사용 가능 주거자금'],
    ['deficit', '미충당 적자'], ['verdict', '판정']
  ];

  function verifyResult(c) {
    var v = c.view.verify || { planId: c.state.activePlanId, rule: 'default', noProducts: false };
    if (!St.findPlan(c.state, v.planId)) v.planId = c.state.activePlanId;
    return { v: v, r: engine.runPlan(c.state, v.planId, { debtRule: v.rule, excludeProducts: v.noProducts }) };
  }

  pages.verify = function (c) {
    var results = P.cases.runAll(P);
    var passed = results.filter(function (x) { return x.pass; }).length;
    var vr = verifyResult(c);
    var v = vr.v;
    var r = vr.r;
    var caseRows = results.map(function (x) {
      return [x.id, { html: ui.esc(x.title), cls: 'l' }, { html: ui.badge(x.pass ? '통과' : '실패', x.pass ? 'ok' : 'bad') },
        { html: '<span class="small">' + x.checks.map(function (k) {
          var a = typeof k.actual === 'number' ? fmt.num1(k.actual) : k.actual;
          var e = typeof k.expected === 'number' ? fmt.num1(k.expected) : k.expected;
          return ui.esc(k.label) + ' ' + ui.esc(e) + (k.pass ? ' ✓' : ' ✕(실제 ' + ui.esc(a) + ')');
        }).join(' · ') + '</span>', cls: 'l' }];
    });
    var tableRows = r.rows.map(function (row) {
      return COLS.map(function (col) {
        var val = row[col[0]];
        if (col[0] === 'month') return val;
        if (col[0] === 'verdict') return { html: ui.badge(val) };
        return { html: '<span class="num">' + fmt.num1(val) + '</span>' };
      });
    });
    return ui.pageHead('계산 검증', '정답 테스트 · 월별 계산표 · 공개 계산 순서') +
      '<section class="card"><h2>① 정답 테스트 ' + ui.badge(passed + '/' + results.length + ' 통과', passed === results.length ? 'ok' : 'bad') + '</h2>' +
      ui.table(['#', '조건', '결과', '항목별(기대값, 허용 오차 ±' + P.cases.TOLERANCE + ')'], caseRows, { caption: '정답 테스트' }) +
      '<p class="small muted">R은 재무설계 사례 보고서(가상 고객 B안)의 본문 수치를 앱 계산으로 재현하는지 확인합니다. A·B는 이전 시연 고객(김하늘) 자료로 엔진 계산 규칙이 바뀌지 않았는지 확인하는 회귀 시험입니다(A: 원본 앱 재현 호환 모드, B: 기본 모드). 같은 사례를 Node 테스트로도 검사합니다.</p></section>' +
      '<section class="card"><h2>② 월별 계산표</h2><form data-submit="verify-run" class="form-inline">' +
      '<div class="field"><label for="vf-p">계획</label><select id="vf-p" name="planId">' + c.state.plans.map(function (p) { return '<option value="' + ui.esc(p.id) + '"' + (p.id === v.planId ? ' selected' : '') + '>' + ui.esc(p.name + ' (' + p.id + ')') + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="vf-r">상환 규칙</label><select id="vf-r" name="rule"><option value="default"' + (v.rule === 'default' ? ' selected' : '') + '>기본(고금리만 추가 상환)</option><option value="legacy"' + (v.rule === 'legacy' ? ' selected' : '') + '>호환 모드(원본 앱 재현)</option></select></div>' +
      '<label class="choice"><input type="checkbox" name="noProducts"' + (v.noProducts ? ' checked' : '') + '>정책상품 제외</label>' +
      '<button class="btn" type="submit">계산</button><button class="btn btn-primary" type="button" data-action="verify-csv">③ CSV 내려받기</button></form>' +
      '<p class="small muted">계획값만으로 계산한 표입니다(실행 기록 반영 전). 판정: ' + ui.judgementBadge(r.judgement) + '</p>' +
      ui.table(COLS.map(function (x) { return x[1]; }), tableRows, { caption: '월별 계산표', rowClass: function (i) { return r.rows[i].month === r.input.targetMonth ? 'hl' : ''; } }) + '</section>' +
      '<section class="card"><h2>④ 공개 계산 순서</h2><ol>' +
      '<li><strong>초기 처리(시작 전 달 말)</strong>: 목적 미지정 현금에서 정한 금액을 금리가 가장 높은 부채에 상환하고, 정한 금액을 비상금으로 옮긴다.</li>' +
      '<li><strong>소득</strong>: 월 실수령. 소득세 감면 종료 다음 달부터 감면 효과만큼 줄인다.</li>' +
      '<li><strong>생활비</strong>: 필수·선택에 (1 + 생활비 상승률)^⌊(m−1)/12⌋를 곱한다(13·25·37번째 달에 오름).</li>' +
      '<li><strong>부채</strong>: 잔액이 있는 부채의 약정 상환액 합 + 추가 상환이 예산. 이자 = 잔액 × 금리/12, 약정 원금 = min(약정액 − 이자, 잔액). 남은 예산은 금리 높은 순으로 추가 상환하되 기본 모드는 연 4% 이상 부채만(대상이 없으면 저축으로).</li>' +
      '<li><strong>잉여</strong> = 소득 − 생활비 − (이자 + 원금) − 상품 납입.</li>' +
      '<li><strong>잔액 증가</strong>: 이번 달 납입 전 잔액에 비상금·주거자금 연 3%/12, 투자자산 연 4%/12.</li>' +
      '<li><strong>상품</strong>: 납입 기간이면 월 납입액 × (1 + 정부기여율)을 쌓고(은행 이자 0%), 만기월(시작월 + 기간)에 전액을 주거자금으로 옮긴다.</li>' +
      '<li><strong>보증금 반환</strong> 달에 반환액을 주거자금에 더한다.</li>' +
      '<li><strong>배분</strong>: 잉여 ≥ 0이면 비상금을 목표까지 먼저 채우고 나머지는 주거자금. 잉여 &lt; 0이면 비상금 → 주거자금 순으로 차감하고 그래도 모자라면 미충당 적자.</li>' +
      '<li><strong>판정(이사월 말)</strong>: ① 고금리 부채 상환 완료 ② 비상금 ≥ 목표 ③ 사용 가능 주거자금(주거자금 + 투자자산) ≥ 목표 보증금 + 이사비.</li>' +
      '</ol><p class="small muted">계산 중에는 반올림하지 않고 표시할 때만 소수 1자리로 반올림합니다. 단위는 만원.</p></section>';
  };

  /* ---------- 6. 상담 리포트(A4 1쪽) ---------- */
  pages.report = function (c) {
    var k = c.state.customer;
    var j = c.d.current.judgement;
    var plan = c.d.plan;
    var m = c.d.thisMonth;
    var monthIdx = dates.diffMonths(plan.startMonth, c.d.month) + 1;
    var total = dates.diffMonths(plan.startMonth, plan.targetMonth) + 1;
    var alerts = (c.state.alerts || []).filter(function (a) { return a.status !== '해소'; });
    var pend = (c.state.proposals || []).filter(function (p) { return p.status === '확인 대기' || p.status === '고객에게 제시됨'; });
    var next = P.tracking.dueInfo(c.d.next, c.d.today, P.tracking.getSettings(c.state));
    var rowsJ = j.conditions.map(function (x) {
      return '<tr><td>' + ui.esc(x.label) + '</td><td>' + (x.key === 'debt' ? '잔액 ' + fmt.num1(x.value) : fmt.num1(x.value) + ' / ' + fmt.num1(x.target)) + '</td><td>' + ui.badge(x.met ? '충족' : '미달') + (x.met ? '' : ' 부족 ' + fmt.num1(x.shortfall)) + '</td></tr>';
    }).join('');
    var rowsM = m.items.filter(function (i) { return i.state !== '해당 없음' && i.kind !== 'spending'; }).map(function (i) {
      return '<tr><td>' + ui.esc(i.label) + '</td><td>' + fmt.num1(i.planned) + '</td><td>' + (i.actual === null ? '기록 없음' : fmt.num1(i.actual)) + '</td><td>' + ui.badge(i.state) + '</td></tr>';
    }).join('');
    return '<div class="page-head no-print"><h1>상담용 요약 리포트</h1><div class="btn-row"><button class="btn btn-primary" data-action="print">인쇄(A4 1쪽)</button></div></div>' +
      '<article class="report" aria-label="상담용 요약 리포트">' +
      '<h1>재무플래너 상담 요약 — ' + ui.esc(k.name) + '</h1>' +
      '<p>기준일 ' + ui.esc(c.d.today) + ' · 실행 기준 「' + ui.esc(plan.name) + '」(' + ui.esc(plan.id) + ') · 단위 만원 · 시연용 가상 데이터</p>' +
      '<h2>이번 달 위치</h2><p>' + ui.esc(c.d.month) + ' — 계획 ' + total + '개월 중 ' + monthIdx + '번째 달 · 기록 상태: ' + ui.esc(m.recordStatus || '기록 없음') + '</p>' +
      '<table><thead><tr><th>항목</th><th>계획</th><th>실제</th><th>상태</th></tr></thead><tbody>' + rowsM + '</tbody></table>' +
      '<h2>판정(이사월 ' + ui.esc(plan.targetMonth) + ' 말, 확정 기록 반영) — ' + ui.esc(j.label) + '</h2>' +
      '<table><thead><tr><th>조건</th><th>값 / 목표</th><th>결과</th></tr></thead><tbody>' + rowsJ + '</tbody></table>' +
      '<h2>경보 ' + alerts.length + '건</h2>' + (alerts.length ? '<ul>' + alerts.map(function (a) { return '<li><strong>' + ui.esc(a.title) + '</strong> — ' + ui.esc(a.message) + '</li>'; }).join('') + '</ul>' : '<p>없음</p>') +
      '<h2>고객 확인 대기 ' + pend.length + '건</h2>' + (pend.length ? '<ul>' + pend.map(function (p) { return '<li>' + ui.esc(p.title) + ' (' + ui.esc(p.status) + ')</li>'; }).join('') + '</ul>' : '<p>없음</p>') +
      '<h2>다음 점검일</h2><p>' + ui.esc(next.graceEnd) + ' (' + ui.esc(c.d.next) + ' 납입 예정일 ' + ui.esc(next.dueDate) + ' + 유예기간)</p>' +
      '<p style="margin-top:14px;font-size:11px;color:#555">모든 문장은 계산 결과로 만들며 외부 AI를 쓰지 않습니다. 금융상품 권유나 투자 조언이 아니며, 정책 조건은 확인일 기준이므로 가입·신청 전에 공식 기관에서 다시 확인하세요.</p>' +
      '</article>';
  };

  Object.assign(ui.actions, {
    'save-alert-settings': function (c, f, fd) {
      var n = function (k) { return Number(fd.get(k)); };
      var alerts = {
        paymentDay: Math.min(28, Math.max(1, Math.round(n('paymentDay')) || 25)),
        graceDays: Math.max(0, Math.round(n('graceDays')) || 0),
        cumulativeTolerance: Math.max(0, n('cumulativeTolerance') || 0) / 100,
        overspendTolerance: Math.max(0, n('overspendTolerance') || 0) / 100,
        emergencyMinMonths: Math.max(0, n('emergencyMinMonths') || 0),
        trendMonths: Math.max(1, Math.round(n('trendMonths')) || 3)
      };
      ui.commit(St.updateSettings(c.state, { alerts: alerts }, '설계사', '경보 기준'), '경보 기준을 저장하고 경보를 다시 계산했어요.');
    },
    'verify-run': function (c, f, fd) {
      ui.setView({ verify: { planId: fd.get('planId'), rule: fd.get('rule') === 'legacy' ? 'legacy' : 'default', noProducts: fd.get('noProducts') === 'on' } }, true);
    },
    'verify-csv': function (c) {
      var vr = verifyResult(c);
      var lines = [COLS.map(function (x) { return x[1]; }).join(',')].concat(vr.r.rows.map(function (row) {
        return COLS.map(function (col) {
          var v = row[col[0]];
          return typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : '"' + String(v).replace(/"/g, '""') + '"';
        }).join(',');
      }));
      var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '월별계산표-' + vr.v.planId + '-' + (vr.v.rule === 'legacy' ? '호환' : '기본') + (vr.v.noProducts ? '-상품제외' : '') + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      ui.toast('CSV를 내려받았어요(소수 3자리까지, 화면은 1자리).');
    },
    print: function () { root.print(); }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
