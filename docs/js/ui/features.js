/*
 * 추가 화면: 위험성향(챗봇 설문) · A/B/C 설계안 · 월별 지출·재계산·수정안 · 알림함
 */
(function (root) {
  'use strict';
  var FP = root.FP, C = FP.Calc, U = FP.UI, F = U.F, esc = U.esc, R = FP.Risk, CFG = FP.RiskConfig, M = FP.Monthly, doc = root.document;
  var NTYPE = { overspend: '예산 초과', savingShort: '납입 부족', emergencyLow: '비상금 부족', goalFlip: '목표 판정 변경', goalShort: '목표 예상액 부족', surplus: '여유자금 확인', revision: '수정안' };

  // 탭 목록은 planner.js·client.js에서 정합니다.

  function S0() { return FP.App.S; }
  function closedList(S) { return S.x ? S.x.closures.map(function (c) { return c.month; }) : []; }
  function basePlan(S) { var bid = S.x && S.x.baselineId; return S.plans.filter(function (p) { return p.id === bid; })[0] || FP.Client.myPlan(S); }
  function gapTxt(g) { return g >= 0 ? '<span class="is-ok">여유 ' + F.abs(g) + '</span>' : '<span class="is-bad">부족 ' + F.abs(g) + '</span>'; }
  function ctxOf(S) { return { data: basePlan(S).data, records: S.records, txs: S.txs, scheduled: S.x.scheduled, closed: closedList(S), today: S.today, consent: S.x.consent, alertSettings: S.settings }; }
  function cid(S) { return S.client.id; }
  function api(m, path, body) { return U.api(m, '/api/clients/' + cid(S0()) + path, body); }
  function done(msg) { return function () { if (msg) U.toast(msg); return FP.reload(); }; }
  function fail(e) { U.toast(e.message, true); }

  // ======================================================================
  // 위험성향 이력 (설계사·고객 공통)
  // ======================================================================
  function latestOf(S, kind) { return S.x.risk.filter(function (r) { return !kind || r.kind === kind; }).slice(-1)[0] || null; }
  function riskHistory(S) {
    if (!S.x.risk.length) return '<p class="muted">저장된 위험성향 결과가 없습니다.</p>';
    return '<div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">구분</th><th scope="col">유형</th><th scope="col">진단일</th><th scope="col">출처</th><th scope="col">당시 목적</th><th scope="col">상태</th></tr></thead><tbody>' +
      S.x.risk.slice().reverse().map(function (r) {
        var st = r.kind === 'official' ? U.badge('금융기관 공식 결과') : (r.result && r.result.status === 'needsReview' ? U.pill('check', '추가 확인 필요') : U.pill('ok', '확인됨'));
        return '<tr><td>' + (r.kind === 'official' ? '금융기관 결과' : '앱 자체 설문<div class="muted small">' + esc(r.version) + '</div>') + '</td><td><strong>' + esc(r.type) + '</strong>' + (r.kind === 'app' ? '<div class="muted small">참고용</div>' : '') + '</td><td>' + esc(r.diagnosedAt) + '</td><td class="small">' + esc(r.source) + '</td><td class="small">' + esc(r.purpose || '—') + '</td><td>' + st + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function resurveyBox(S) {
    var latest = latestOf(S, 'app') || latestOf(S, 'official');
    var reasons = R.resurveyReasons(latest, S.x.snapshot, S.today);
    if (!reasons.length) return '<p class="banner banner-ok">최근 결과 이후 소득·부채·목적에 큰 변화가 없습니다.</p>';
    return '<div class="banner banner-warn"><strong>앱 자체 설문을 권합니다.</strong><ul class="plain-list small">' + reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><p class="small muted">나이나 소득만으로 성향을 추정하지 않습니다. 고객의 답변으로만 판단합니다.</p></div>';
  }

  // ======================================================================
  // A/B/C 카드
  // ======================================================================
  function strategyCards(set, mode, S) {
    var r = set.result, html = '';
    html += '<p class="muted small">세 안 모두 같은 기준월(' + r.base.baseMonth + ')·초기 자산·부채·소득·금리 가정에서 계산했습니다' + (r.sameStart ? ' ' + U.pill('ok', '동일 조건 확인') : ' ' + U.pill('bad', '초기 조건 불일치')) + '. 새로 모으는 주거 핵심자금은 세 안 모두 원금 보전형으로만 운용하고, 기대수익률은 올려 잡지 않았습니다. 검증된 확률모형이 없어 ‘달성 확률’은 표시하지 않습니다.</p>';
    if (r.riskNotice) html += '<p class="banner banner-warn">' + esc(r.riskNotice) + '</p>';
    if (r.noneAchieves) html += '<p class="banner banner-bad"><strong>세 안 모두 목표를 충족하지 못합니다.</strong> 목표금액·목표일·추가 소득을 다시 정해야 합니다.</p>';
    html += '<div class="abc-grid">' + r.options.map(function (o) {
      var sel = set.selectedKey === o.key;
      var row = function (l, v) { return '<div class="abc-row"><dt>' + l + '</dt><dd>' + v + '</dd></div>'; };
      return '<article class="card abc-card' + (sel ? ' is-selected' : '') + '">' +
        '<div class="abc-head"><h3>' + esc(o.title) + '</h3>' + U.pill(o.status, U.statusText(o.status)) + (sel ? U.badge('고객 선택', 'badge-ok') : '') + '</div>' +
        '<p class="small">' + esc(o.summary) + '</p><dl class="abc-dl">' +
        row('월 생활비 예산', F.money(o.budget)) + row('월 부채 상환액', F.money(o.debtPayment)) +
        row('월 비상금 적립', F.money(o.monthlyEmergency) + ' <span class="muted small">(첫 12개월 평균)</span>') + row('월 주거자금 적립', F.money(o.monthlyHousing)) +
        row('월 정책상품 납입', F.money(o.monthlyProducts)) +
        row('적용 정책', o.policies.length ? o.policies.map(function (p) { return esc(p.name) + ' ' + p.start + '~' + p.maturity + '<div class="small">' + p.confirmed.map(function (t) { return '<span class="chip chip-ok">' + esc(t) + '</span>'; }).join(' ') + '</div><div class="muted small">확인 필요(계산 미반영): ' + esc(p.needsCheck.join(' · ')) + '</div>'; }).join('') : '없음') +
        row('목표일', o.moveMonth + (o.moveMonth !== r.base.moveMonth ? ' ' + U.badge('목표일 변경', 'badge-warn') : '')) +
        row('목표일 예상 가용자금', F.money(o.usable) + ' <span class="muted small">/ 필요 ' + F.money(o.target) + '</span>') + row('부족액·여유액', gapTxt(o.gap)) +
        row('목표 충족 조건', '<ul class="cond-list">' + o.verdict.conds.map(function (c) { return '<li class="' + (c.ok ? 'is-ok' : 'is-bad') + '">' + (c.ok ? '✓ ' : '✗ ') + esc(c.label) + '</li>'; }).join('') + '</ul>') +
        row('불리한 상황', U.statusText(o.adverse.status) + ' · ' + gapTxt(o.adverse.gap) + (o.adverse.unfunded > 0.5 ? ' · 메우지 못한 적자 ' + F.money(o.adverse.unfunded) : '') + '<div class="muted small">' + esc(o.adverse.label) + '</div>') +
        row('바꿔야 할 행동', '<ul class="plain-list small">' + o.actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>') +
        row('장점', esc((o.pros || []).join(' · '))) + row('부담', esc((o.cons || []).join(' · '))) +
        (o.compare ? row('조건 비교', '<ul class="plain-list small"><li>목표금액만 조정: ' + F.money(o.compare.targetFit) + (o.compare.targetCut ? '(' + F.money(o.compare.targetCut) + ' 낮춤)' : '') + '</li><li>월 추가 소득으로 보완: ' + (o.compare.extraIncome === null ? '어려움' : F.money(o.compare.extraIncome)) + '</li><li>예상 초과소득 ' + F.money(o.compare.expectedExtra) + '은 확정 전이라 재원에 넣지 않음</li><li>' + esc(o.compare.riskNote) + '</li></ul>') : '') +
        '</dl>' + (mode === 'select' && !set.selectedKey ? '<button type="button" class="btn" data-fx="pickStrategy" data-sid="' + set.id + '" data-key="' + o.key + '">' + o.key + '안 선택</button>' : '') +
        '</article>';
    }).join('') + '</div>';
    return html;
  }

  // ======================================================================
  // 설계사: 성향·A/B/C
  // ======================================================================
  FP.Planner.risk = function (S) {
    var html = '<section class="card"><div class="card-head"><h2>위험성향 결과</h2>' + U.badge(CFG.LABEL + ' ' + CFG.VERSION) + '</div>' + riskHistory(S) + resurveyBox(S) +
      '<details class="small"><summary>금융기관 결과 입력(공식 결과는 앱 설문과 별도 저장)</summary><div class="field-grid">' +
      '<div class="field"><label for="ofType">유형</label><select id="ofType">' + CFG.TYPES.map(function (t) { return '<option>' + t.name + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="ofDate">진단일</label><input id="ofDate" type="date"></div>' +
      '<div class="field"><label for="ofSource">출처(금융기관·서류)</label><input id="ofSource" type="text" maxlength="80"></div>' +
      '<div class="field"><label for="ofPurpose">당시 투자 목적</label><input id="ofPurpose" type="text" maxlength="80"></div></div>' +
      '<button type="button" class="btn btn-secondary" data-fx="addOfficial">금융기관 결과 저장</button></details></section>';
    var afters = S.plans.filter(function (p) { return p.kind === 'after'; });
    var sets = S.x.strategies.slice().reverse();
    html += '<section class="card"><div class="card-head wrap"><h2>A/B/C 재무설계안</h2><span class="muted small">A/B/C는 위험 등급이 아니라 서로 다른 실행 전략입니다.</span></div>' +
      '<div class="field-inline"><label for="abcBase">기준 계획</label><select id="abcBase">' + afters.map(function (p) { return '<option value="' + p.id + '"' + (p.id === S.x.baselineId ? ' selected' : '') + '>v' + p.version + ' · ' + esc(p.label || '') + (p.id === S.x.baselineId ? ' (실행 기준)' : '') + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn" data-fx="newSet">A/B/C 만들기</button></div>' +
      '<p class="muted small">사용 위험성향: ' + (latestOf(S, 'app') ? '앱 설문 ' + esc(latestOf(S, 'app').type) + ' (' + latestOf(S, 'app').diagnosedAt + ')' : latestOf(S, 'official') ? '금융기관 결과만 있음 → 재무 여력 미확인으로 보수적 적용' : '없음 → 원금 보전형으로만 설계') + '</p></section>';
    sets.forEach(function (s, i) {
      if (i > 2) return;
      html += '<section class="card"><div class="card-head wrap"><h2>설계안 #' + s.id + ' ' + ({ draft: U.pill('check', '작성 중'), presented: U.pill('info', '고객에게 제시됨'), selected: U.pill('ok', '고객 선택: ' + s.selectedKey + '안'), withdrawn: U.pill('info', '철회됨') }[s.status]) + '</h2><span class="muted small">기준 계획 #' + s.basePlanId + ' · ' + F.date(s.createdAt) + '</span></div>';
      if (s.status === 'draft') html += paramEditor(s) + '<div class="btn-row"><button type="button" class="btn btn-secondary" data-fx="updateSet" data-sid="' + s.id + '">수정 반영</button><button type="button" class="btn" data-fx="presentSet" data-sid="' + s.id + '">고객에게 제시</button></div>';
      html += strategyCards(s, 'view', S) + '</section>';
    });
    return html;
  };
  function paramEditor(s) {
    var o = s.result.options;
    var f = function (k, key, label, v, type) { var id = 'pe-' + s.id + '-' + k + '-' + key; return '<div class="field"><label for="' + id + '">' + label + '</label>' + (type === 'ym' ? '<input id="' + id + '" type="month" data-pe="' + k + '.' + key + '" value="' + esc(v || '') + '">' : '<div class="input-wrap"><input id="' + id + '" type="text" inputmode="decimal" data-pe="' + k + '.' + key + '" value="' + Math.round((v || 0) / 10000) + '"><span class="unit">만원</span></div>') + '</div>'; };
    return '<details open class="pe"><summary>안별 조정값(설계사 검토)</summary><div class="pe-grid">' + o.map(function (c) {
      var p = c.params;
      return '<fieldset class="group"><legend>' + c.key + '안</legend>' + f(c.key, 'optionalCut', '선택 지출 감축', p.optionalCut) + f(c.key, 'essentialCut', '필수생활비 감축(최소선 유지)', p.essentialCut) + f(c.key, 'extraRepayment', '월 추가 상환', p.extraRepayment) + f(c.key, 'extraRepaymentStart', '추가 상환 시작월', p.extraRepaymentStart, 'ym') + (p.product ? f(c.key, 'productMonthly', '정책상품 월 납입', p.product.monthly) : '') + f(c.key, 'moveMonth', '목표일(이사월)', p.moveMonth, 'ym') + '</fieldset>';
    }).join('') + '</div></details>';
  }
  function collectOverrides(sid) {
    var set = S0().x.strategies.filter(function (s) { return s.id === sid; })[0], ov = {};
    set.result.options.forEach(function (c) { ov[c.key] = JSON.parse(JSON.stringify(c.params)); });
    doc.querySelectorAll('[data-pe^="A."],[data-pe^="B."],[data-pe^="C."]').forEach(function (inp) {
      if (inp.id.indexOf('pe-' + sid + '-') !== 0) return;
      var parts = inp.dataset.pe.split('.'), k = parts[0], key = parts[1], v = inp.value;
      if (key === 'extraRepaymentStart' || key === 'moveMonth') { if (C.ymValid(v)) ov[k][key] = v; return; }
      var n = Number(String(v).replace(/,/g, '')); if (!isFinite(n) || n < 0) return;
      if (key === 'productMonthly') { if (ov[k].product) ov[k].product.monthly = Math.min(500000, n * 10000); return; }
      ov[k][key] = n * 10000;
    });
    return ov;
  }

  // ======================================================================
  // 고객: 챗봇 설문 + 설계안
  // ======================================================================
  var FAQ = [
    [/원금|손실/, '원금 손실은 넣은 돈보다 돌려받는 돈이 적어지는 것입니다. 예금은 원금이 보장되지만(예금자보호 한도 안), 주식·펀드는 원금이 줄 수 있습니다.'],
    [/비상금/, '비상금은 소득이 끊기거나 갑자기 큰돈이 들 때 쓰는 돈입니다. 보통 필수생활비 3~6개월 치를 따로 둡니다. 이 앱은 비상금을 주거자금과 따로 셉니다.'],
    [/etf|ETF|주식|펀드|위험자산/, '주식·펀드·ETF는 값이 오르내리는 위험자산입니다. 오래 둘수록 회복할 시간이 있지만, 3년 안에 꼭 써야 하는 돈은 손실이 나면 메울 시간이 부족합니다.'],
    [/파생|레버리지/, '파생상품·레버리지 상품은 작은 가격 변화에도 손실이 크게 커질 수 있는 상품입니다.'],
    [/유형|성향|점수|등급/, '결과는 ' + CFG.LABEL + '으로 정한 참고용 유형입니다. 금융기관의 공식 투자성향 진단이나 적합성 판단을 대신하지 않습니다. 금융상품에 가입할 때는 그 금융기관의 진단을 따로 받아야 합니다.'],
    [/모르/, '‘잘 모르겠음’을 골라도 됩니다. 다만 재무 여력이나 사용 시점처럼 판단에 꼭 필요한 항목이 비면 결과를 확정하지 않고 다시 여쭤봅니다.']
  ];
  function faqAnswer(q) { for (var i = 0; i < FAQ.length; i++) if (FAQ[i][0].test(q)) return FAQ[i][1]; return '이 질문에는 정해진 설명이 없습니다. 설계사에게 문의해 주세요. (대화 내용은 점수에 반영하지 않습니다.)'; }

  function chatState(S) { if (!S.chat) S.chat = { mode: 'intro', step: 0, answers: {}, faq: [] }; return S.chat; }
  function bubble(who, html) { return '<div class="msg msg-' + who + '"><div class="msg-body">' + html + '</div></div>'; }

  // opts.embedded: ‘내 정보·실적 입력’ 5번 구역 안에 넣을 때(설계안 영역 제외)
  FP.Client.chat = function (S, opts) {
    var embedded = opts && opts.embedded;
    var ch = chatState(S), Q = CFG.QUESTIONS, html = '<div class="chat"><div class="card-head wrap"><h3>위험성향 확인</h3>' + U.badge(CFG.LABEL) + '</div><div class="chat-log" id="chatLog">';
    var off = latestOf(S, 'official'), app = latestOf(S, 'app');
    html += bubble('bot', '안녕하세요. 이사자금 계획에 맞는 실행안을 고르기 전에 <strong>위험을 얼마나 감수할 수 있는지</strong> 확인할게요.' +
      (off ? '<div class="prev-box"><strong>금융기관 결과</strong> ' + esc(off.type) + ' · ' + esc(off.diagnosedAt) + ' · ' + esc(off.source) + '<br><span class="muted small">당시 목적: ' + esc(off.purpose || '—') + '</span></div>' : '') +
      (app ? '<div class="prev-box"><strong>앱 설문 결과</strong> ' + esc(app.type) + '(참고용) · ' + esc(app.diagnosedAt) + ' · ' + esc(app.version) + '</div>' : '') +
      (!off && !app ? '<p>아직 저장된 위험성향 결과가 없어요.</p>' : ''));
    html += bubble('bot', resurveyBox(S).replace('banner ', 'banner inline '));
    if (ch.mode === 'intro') {
      html += '</div><div class="btn-row"><button type="button" class="btn" data-fx="chatStart">' + (app ? '설문 다시 하기' : '설문 시작(10문항, 약 3분)') + '</button></div>';
    } else {
      // 지금까지의 질문과 답
      var upto = ch.mode === 'q' ? ch.step : Q.length;
      for (var i = 0; i < upto; i++) {
        var q = Q[i], a = ch.answers[q.id], o = q.options.filter(function (x) { return x.id === a; })[0];
        html += bubble('bot', '<span class="q-no">' + (i + 1) + '/' + Q.length + '</span> ' + esc(q.text));
        html += bubble('me', o ? esc(o.text) + ' <button type="button" class="link-btn small" data-fx="chatEdit" data-i="' + i + '">수정</button>' : '<span class="muted">미응답</span> <button type="button" class="link-btn small" data-fx="chatEdit" data-i="' + i + '">답하기</button>');
      }
      ch.faq.forEach(function (f) { html += bubble('me', esc(f.q)) + bubble('bot', esc(f.a) + '<div class="muted small">설명용 답변 — 점수에 반영하지 않습니다.</div>'); });
      html += '</div>';
      if (ch.mode === 'q') {
        var cq = Q[ch.step];
        html += '<div class="q-box"><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + Q.length + '" aria-valuenow="' + ch.step + '"><span style="width:' + Math.round(ch.step / Q.length * 100) + '%"></span></div>' +
          '<p class="q-title"><span class="q-no">' + (ch.step + 1) + '/' + Q.length + ' · ' + esc(cq.topic) + '</span><br>' + esc(cq.text) + '</p>' + (cq.help ? '<p class="help">' + esc(cq.help) + '</p>' : '') +
          '<div class="opt-list" role="group" aria-label="선택지">' + cq.options.map(function (o) { return '<button type="button" class="opt' + (ch.answers[cq.id] === o.id ? ' is-on' : '') + (o.unknown ? ' opt-unknown' : '') + '" data-fx="chatAnswer" data-q="' + cq.id + '" data-o="' + o.id + '" aria-pressed="' + (ch.answers[cq.id] === o.id) + '">' + esc(o.text) + '</button>'; }).join('') + '</div>' +
          '<div class="btn-row"><button type="button" class="btn btn-secondary btn-small" data-fx="chatPrev"' + (ch.step === 0 ? ' disabled' : '') + '>이전 문항</button>' + (Object.keys(ch.answers).length === Q.length ? '<button type="button" class="btn btn-secondary btn-small" data-fx="chatToResult">결과 보기</button>' : '') + '</div></div>';
      } else html += resultBox(S, ch);
      html += '<div class="faq-box"><label for="faqIn">궁금한 점 물어보기 <span class="muted small">(설명만 드리고 점수에는 반영하지 않습니다)</span></label><div class="field-inline"><input id="faqIn" type="text" maxlength="100" placeholder="예: 원금 손실이 뭐예요?"><button type="button" class="btn btn-secondary btn-small" data-fx="faqAsk">질문</button></div></div>';
    }
    html += '</div>';
    if (!embedded) html = '<section class="card">' + html + '</section>' + strategySection(S);
    return html;
  };
  function resultBox(S, ch) {
    var r = R.score(ch.answers);
    if (!r.complete) {
      var lab = { will: '위험 감수 의향', cap: '재무 여력', know: '경험·이해도', horizon: '사용 시점·중요도' };
      return '<div class="result-box"><p class="banner banner-warn"><strong>아직 결과를 확정할 수 없습니다.</strong> ' +
        (r.missing.length ? '답하지 않은 문항: ' + r.missing.map(function (id) { return Number(id.slice(1)); }).join(', ') + '번. ' : '') +
        (r.insufficient.length ? '‘잘 모르겠음’이 많아 판단 근거가 부족한 항목: ' + r.insufficient.map(function (d) { return lab[d]; }).join(', ') + '. 빈 답을 임의로 채우지 않습니다.' : '') + '</p><button type="button" class="btn" data-fx="chatReview">답변 검토</button></div>';
    }
    var ind = FP.Analysis.indicators(C.simulate(basePlan(S).data));
    var cross = R.crossCheck(ch.answers, ind);
    var dim = function (k, l) { var v = r.dims[k]; return '<div class="dim"><span>' + l + '</span><div class="bar"><span style="width:' + (v || 0) + '%"></span></div><b>' + (v === null ? '—' : v + '점') + '</b></div>'; };
    return '<div class="result-box"><h3>참고용 위험성향: <strong>' + esc(r.type) + '</strong> ' + (r.status === 'needsReview' ? U.pill('check', '추가 확인 필요') : U.pill('ok', '확인 가능')) + '</h3>' +
      '<p class="small">' + esc(r.typeDesc) + '</p><p class="muted small">' + esc(CFG.LABEL) + ' · ' + esc(r.version) + ' · 종합 ' + r.total + '점' + (r.rawType !== r.type ? ' (점수상 ' + esc(r.rawType) + ' → 제한 규칙으로 ' + esc(r.type) + ')' : '') + '. 금융기관의 공식 적합성·적정성 판단을 대신하지 않습니다.</p>' +
      '<div class="dims">' + dim('will', '위험 감수 의향') + dim('cap', '재무 여력') + dim('know', '경험·이해도') + dim('horizon', '사용 시점·중요도') + '</div>' +
      '<p><strong>손실 감수 의향과 재무 여력의 차이:</strong> ' + (r.gap > 0 ? '의향이 여력보다 ' + r.gap + '점 높습니다.' : r.gap < 0 ? '여력이 의향보다 ' + Math.abs(r.gap) + '점 높습니다.' : '같습니다.') + '</p>' +
      (r.restrictions.length ? '<p><strong>적용된 제한:</strong></p><ul class="plain-list small">' + r.restrictions.map(function (x) { return '<li>' + esc(x.reason) + ' → 최대 ' + esc(x.maxType) + '</li>'; }).join('') + '</ul>' : '') +
      (r.flags.length ? '<div class="banner banner-warn"><strong>추가 확인 필요</strong><ul class="plain-list small">' + r.flags.map(function (f) { return '<li>' + esc(f.reason) + '</li>'; }).join('') + '</ul></div>' : '') +
      (cross.length ? '<div class="banner banner-warn"><strong>계획 자료와 다른 답변</strong><ul class="plain-list small">' + cross.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><span class="small">답변을 바꾸지 않고 그대로 저장합니다. 설계사가 확인합니다.</span></div>' : '') +
      '<p><strong>판단에 영향을 준 주요 답변</strong></p><ul class="plain-list small">' + r.keyAnswers.map(function (k) { return '<li>' + esc(k.topic) + ': ' + esc(k.answer) + '</li>'; }).join('') + '</ul>' +
      '<p class="banner banner-info"><strong>3년 주거목표에서 유의할 점</strong> 성향과 관계없이 이사 때 꼭 필요한 주거 핵심자금은 <strong>' + esc(r.housingCoreMax) + '</strong> 수준(원금 보전형)으로만 운용합니다. 위험자산은 목표를 채우고 남는 별도 여유자금이 있을 때만 검토합니다.</p>' +
      '<div class="btn-row"><button type="button" class="btn btn-secondary" data-fx="chatReview">답변 검토</button><button type="button" class="btn" data-fx="chatSave">결과 확인·저장</button></div></div>';
  }
  function strategySection(S) {
    var sets = S.x.strategies.filter(function (s) { return s.status === 'presented' || s.status === 'selected'; });
    var set = sets[sets.length - 1];
    if (!set) return '<section class="card"><h2>A/B/C 재무설계안</h2><p class="muted">설계사가 아직 설계안을 보내지 않았습니다.</p></section>';
    var intro = set.status === 'selected' ? set.selectedKey + '안을 실행 기준 계획으로 저장했어요(' + F.date(set.selectedAt) + '). 다른 안으로 바꾸려면 설계사에게 문의해 주세요.' :
      '설계사가 세 가지 실행 전략을 보냈어요. <strong>A안</strong>은 비상금과 대출 상환을 먼저, <strong>B안</strong>은 생활비 조정과 저축의 균형, <strong>C안</strong>은 목표 조건을 바꿔 달성 가능성을 높이는 방법입니다. 같은 출발 조건으로 계산했으니 목표일 예상 가용자금과 불리한 상황 결과를 비교해 보세요.';
    return '<section class="card"><div class="card-head"><h2>A/B/C 재무설계안</h2></div>' + bubble('bot', intro) + strategyCards(set, 'select', S) + '</section>';
  }

  // ======================================================================
  // 월별 지출 · 재계산 · 수정안 (고객 편집 / 설계사 조회)
  // ======================================================================
  function monthlyView(S) {
    var isClient = S.user.role === 'client', ctx = ctxOf(S), tb = M.table(ctx), rc = M.recalc(ctx);
    var bp = basePlan(S);
    var html = '<section class="card"><div class="card-head wrap"><h2>월별 계획 vs 실제 지출</h2><span class="muted small">실행 기준 계획: v' + bp.version + ' ' + esc(bp.label || '') + '</span></div>' +
      '<p class="muted small">' + U.pill('check', '잠정') + ' 월중: 확정 지출 + 미확인 거래 + 결제 전 예정 항목을 더한 예상치(실적으로 쓰지 않음) · ' + U.pill('ok', '확정') + ' 월말 정산 또는 고객 확인 후 계산에 반영. 본인 계좌 간 이체·상환·저축 납입은 지출로 세지 않고, 예정 결제와 같은 금액의 미확인 거래는 한 번만 셉니다.</p>' +
      '<div class="table-scroll"><table class="compare-table monthly-table"><thead><tr><th scope="col">월</th><th scope="col">상태</th><th scope="col">계획 필수/선택</th><th scope="col">확정 필수/선택</th><th scope="col">미확인 거래</th><th scope="col">예정 결제</th><th scope="col">합계(예상)</th><th scope="col">계획 대비</th>' + (isClient ? '<th scope="col"></th>' : '') + '</tr></thead><tbody>' +
      tb.rows.slice().reverse().map(function (r) {
        var st = r.closed ? U.pill('ok', '확정') : r.status === 'provisional' ? U.pill('check', '잠정') : U.pill('info', '기록 없음');
        return '<tr><th scope="row">' + r.ym + '</th><td>' + st + '</td><td>' + F.money(r.planned.essential) + ' / ' + F.money(r.planned.optional) + '</td><td>' + F.money(r.actual.essential) + ' / ' + F.money(r.actual.optional) + (r.actual.unspecified ? '<div class="muted small">미분류 ' + F.money(r.actual.unspecified) + '</div>' : '') + '</td><td>' + (r.pendingTx ? F.money(r.pendingTx) : '—') + '</td><td>' + (r.scheduledUnpaid ? F.money(r.scheduledUnpaid) : '—') + '</td><td>' + (r.projected === null ? '—' : F.money(r.projected)) + '</td><td class="' + (r.diff > 0 ? 'is-bad' : r.diff < 0 ? 'is-ok' : '') + '">' + (r.diff === null ? '—' : F.signed(r.diff)) + '</td>' +
          (isClient ? '<td>' + (r.closed ? '' : '<button type="button" class="btn btn-small btn-secondary" data-fx="closeMonth" data-ym="' + r.ym + '">이 달 확정</button>') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></section>';

    // 이번 달
    var cur = tb.rows[tb.rows.length - 1];
    if (cur && !cur.closed) {
      var pr = tb.plan.rows[cur.t];
      var plannedSave = Math.max(0, pr.emergencyIn) + Math.max(0, pr.housingIn - pr.depositIn - pr.productPayout) + pr.productContrib;
      var proj = cur.projected === null ? 0 : cur.projected;
      var free = pr.income - proj - pr.debtPaid - plannedSave;
      html += '<section class="card"><h2>' + F.ymKo(cur.ym) + ' 잠정 결과</h2><div class="two-col"><div><ul class="plain-list"><li>예산 ' + F.money(cur.planned.total) + ' 중 확정 지출 ' + F.money(cur.actual.total) + ', 미확인 거래 ' + F.money(cur.pendingTx) + ', 결제 전 예정 ' + F.money(cur.scheduledUnpaid) + '</li>' +
        '<li>남은 생활비 예산: <strong>' + F.money(Math.max(0, cur.planned.total - proj)) + '</strong>' + (proj > cur.planned.total ? ' <span class="is-bad">(예산 ' + F.abs(cur.planned.total - proj) + ' 초과 예상)</span>' : '') + '</li>' +
        '<li>실제 여유자금(잠정) = 소득 ' + F.money(pr.income) + ' − 예상 지출 ' + F.money(proj) + ' − 필수 상환 ' + F.money(pr.debtPaid) + ' − 계획 저축 ' + F.money(plannedSave) + ' = <strong class="' + (free < 0 ? 'is-bad' : '') + '">' + F.signed(free) + '</strong></li></ul>' +
        '<p class="muted small">계획보다 적게 썼더라도 남은 생활비·예정 결제·필수 상환을 빼기 전에는 저축 가능액으로 보지 않습니다. 월이 확정되면 여유자금 후보로 바뀌고, 잔액을 확인한 뒤 배분합니다.</p></div>' +
        '<div><h3 class="sub-head">예정 결제(카드대금·고정비)</h3><ul class="plain-list">' + (S.x.scheduled.filter(function (s) { return s.month === cur.ym; }).map(function (s) { return '<li>' + esc(s.label) + ' ' + F.money(s.amount) + ' · ' + (s.category === 'essential' ? '필수' : '선택') + ' · ' + (s.paid ? U.pill('ok', '결제됨') : U.pill('check', '결제 전') + (isClient ? ' <button type="button" class="link-btn small" data-fx="schPaid" data-id="' + s.id + '">결제됨</button> <button type="button" class="link-btn small" data-fx="schDel" data-id="' + s.id + '">삭제</button>' : '')) + '</li>'; }).join('') || '<li class="muted">없음</li>') + '</ul>' +
        (isClient ? '<div class="field-grid sch-form"><div class="field"><label for="schLabel">이름</label><input id="schLabel" type="text" maxlength="30" placeholder="예: 11월 카드대금"></div><div class="field"><label for="schAmt">금액</label><div class="input-wrap"><input id="schAmt" type="text" inputmode="decimal"><span class="unit">만원</span></div></div><div class="field"><label for="schCat">항목</label><select id="schCat"><option value="optional">선택 지출</option><option value="essential">필수생활비</option></select></div><div class="field"><label for="schKind">종류</label><select id="schKind"><option value="card">미결제 카드대금</option><option value="fixed">예정된 고정비</option></select></div></div><button type="button" class="btn btn-secondary btn-small" data-fx="schAdd" data-ym="' + cur.ym + '">예정 결제 추가</button>' : '') + '</div></div></section>';
    }

    // 재계산
    var f = rc.forecast, p = rc.plan;
    html += '<section class="card"><div class="card-head wrap"><h2>자동 재계산</h2><span class="muted small">' + (rc.closedYm ? rc.closedYm + '까지 확정 실적 반영' : '확정된 달 없음') + ' · 남은 ' + rc.remaining + '개월(' + rc.startYm + '~' + f.res.at.ym + ')</span></div>' +
      '<p class="muted small">자동 재계산은 숫자만 다시 계산합니다. 실행 기준 계획은 아래 수정안을 확인해야 바뀝니다. 이자·상환·상품 만기·정책 혜택·보증금 반환일은 같은 월별 계산 엔진으로 반영합니다.</p>' +
      '<div class="metrics-grid">' +
      mcard('목표일 부족·여유', gapTxt(p.gap) + ' → ' + gapTxt(f.gap), '계획(실적 반영 전) → 예상(실적 반영)') +
      mcard('추가로 필요한 저축 총액', rc.neededTotal === null ? '<span class="is-bad">추가 저축만으로 어려움</span>' : F.money(rc.neededTotal), rc.neededExtra === null ? '' : '월 ' + F.money(rc.neededExtra) + ' × ' + rc.remaining + '개월 (부채가 남아 있으면 상환 먼저)') +
      mcard('남은 기간 월 필요 저축액', rc.neededMonthlySaving === null ? '—' : F.money(rc.neededMonthlySaving), '현재 계획 평균 ' + F.money(rc.plannedMonthlySaving) + ' + 추가 ' + F.money(rc.neededExtra || 0)) +
      mcard('권장 월 생활비 예산', rc.recommendedBudget === null ? '<span class="is-bad">절감만으로 불가</span>' : F.money(rc.recommendedBudget), '현재 ' + F.money(rc.budgetNow) + ' · 필수생활비 하한 ' + F.money(rc.floor) + ' · 최대 절감 ' + F.money(rc.maxCut)) +
      mcard('부채 상환 완료', F.ym(rc.base, p.debtFree) + ' → ' + F.ym(rc.base, f.debtFree), '') +
      mcard('목표일 비상금', F.money(p.emergencyAtTarget) + ' → ' + F.money(f.emergencyAtTarget), '') + '</div>' +
      (rc.cutOnlyFeasible ? '' : '<div class="banner banner-bad"><strong>생활비 절감만으로는 부족합니다.</strong><ul class="plain-list small"><li>목표일 조정: ' + (rc.alternatives.extendTo ? rc.alternatives.extendTo + '(' + rc.alternatives.extendBy + '개월 연장)' : '10년 안에 어려움') + '</li><li>목표 보증금 조정: ' + F.money(rc.alternatives.targetFit) + '(' + F.money(rc.alternatives.targetCut) + ' 낮춤)</li><li>월 추가 소득: ' + (rc.alternatives.extraIncome === null ? '어려움' : F.money(rc.alternatives.extraIncome)) + '</li></ul><span class="small">목표일·목표금액 변경, 신규 대출, 위험 확대, 상품 해지는 자동으로 적용하지 않습니다.</span></div>') +
      (rc.lastFinal ? '<p class="small">최근 확정 월 ' + rc.lastFinal.ym + ': 계획 ' + F.money(rc.lastFinal.planned) + ' / 실제 ' + F.money(rc.lastFinal.actualExpense) + (rc.lastFinal.overspend > 0 ? ' → <span class="is-bad">초과 ' + F.money(rc.lastFinal.overspend) + '</span>(초과분만큼 그 달 저축이 줄어든 것으로 계산)' : rc.lastFinal.slack > 0 ? ' → <span class="is-ok">덜 씀 ' + F.money(rc.lastFinal.slack) + '</span>(잔액 확인 전까지 저축으로 보지 않음)' : '') + '</p>' : '') + '</section>';

    // 수정안
    var revs = S.x.revisions;
    html += '<section class="card" id="revList"><h2>수정안</h2>' + (revs.length ? revs.map(function (rv) { return revCard(rv, isClient); }).join('') : '<p class="muted">아직 수정안이 없습니다.</p>') + '</section>';
    if (isClient) html += consentBox(S);
    else html += '<section class="card"><h2>고객 문의</h2>' + (S.x.inquiries.length ? '<ul class="plain-list">' + S.x.inquiries.map(function (q) { return '<li>' + F.date(q.createdAt) + ' — ' + esc(q.message) + (q.notificationId ? ' <span class="muted small">(알림 #' + q.notificationId + ')</span>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="muted">문의 없음</p>') + '</section>';
    return html;
  }
  function mcard(l, v, sub) { return '<article class="card metric"><h3 class="metric-label">' + l + '</h3><div class="metric-value">' + v + '</div>' + (sub ? '<p class="metric-note">' + sub + '</p>' : '') + '</article>'; }
  function revCard(rv, isClient) {
    var s = rv.summary || {}, cmp = s.compare;
    var st = { pending: U.pill('check', '확인 대기'), applied: U.pill('ok', '적용됨'), held: U.pill('info', '보류'), auto: U.pill('ok', '자동 적용(동의 범위)'), info: U.pill('bad', '절감만으로 불가'), stale: U.pill('info', '지난 수정안') }[rv.status];
    var kind = { overspend: '초과 지출 보완', goalFlip: '목표 미달 보완', surplus: '여유자금 배분' }[rv.kind] || rv.kind;
    var html = '<article class="rev" id="rev-' + rv.id + '"><div class="rev-head"><strong>#' + rv.id + ' ' + kind + '</strong> ' + st + ' <span class="muted small">' + (rv.month || '') + ' · ' + F.date(rv.createdAt) + '</span></div><ul class="plain-list small">' + (s.changes || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>';
    if (cmp) {
      var row = function (l, a, b) { return '<tr><th scope="row">' + l + '</th><td>' + a + '</td><td>' + b + '</td></tr>'; };
      html += '<div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">수정 전후(같은 실적 기준)</th><th scope="col">수정 전</th><th scope="col">수정 후</th></tr></thead><tbody>' +
        row('판정', U.statusText(cmp.before.status), U.statusText(cmp.after.status)) + row('목표일 부족·여유', gapTxt(cmp.before.gap), gapTxt(cmp.after.gap)) +
        row(s.startYm + ' 생활비 예산', F.money(cmp.before.budget), F.money(cmp.after.budget)) + row('부채 상환 완료', F.ym(FP.App.S.plans[0].data.basis.baseMonth, cmp.before.debtFree), F.ym(FP.App.S.plans[0].data.basis.baseMonth, cmp.after.debtFree)) +
        row('목표일 비상금', F.money(cmp.before.emergency), F.money(cmp.after.emergency)) + '</tbody></table></div>';
    }
    if (s.infeasible && s.alternatives) html += '<p class="small">대안: 목표일 ' + (s.alternatives.extendTo || '조정 어려움') + ' · 목표 보증금 ' + F.money(s.alternatives.targetFit) + ' · 월 추가 소득 ' + (s.alternatives.extraIncome === null ? '어려움' : F.money(s.alternatives.extraIncome)) + ' (자동 적용하지 않음)</p>';
    if (isClient && (rv.status === 'pending' || rv.status === 'held') && !s.infeasible) {
      html += (s.needsBalanceCheck ? '<label class="check"><input type="checkbox" id="bal-' + rv.id + '"><span>통장에 ' + F.money(s.amount) + '이 실제로 남아 있는 것을 확인했습니다</span></label>' : '') +
        '<div class="btn-row"><button type="button" class="btn btn-small" data-fx="revApply" data-id="' + rv.id + '">적용</button>' + (rv.status === 'pending' ? '<button type="button" class="btn btn-small btn-secondary" data-fx="revHold" data-id="' + rv.id + '">보류</button>' : '') + '</div>' +
        '<p class="muted small">적용하면 새 계획 버전이 만들어지고 실행 기준이 됩니다. 이전 버전은 그대로 남습니다. 앱 안의 예산만 바뀌며 실제 계좌이체·자동이체는 바뀌지 않습니다.</p>';
    }
    return html + '</article>';
  }
  function consentBox(S) {
    var c = S.x.consent;
    return '<section class="card"><h2>자동 적용 동의</h2><p class="small">기본값은 <strong>수정안을 만들고 고객이 확인해야 적용</strong>입니다. 동의하면 아래 범위 안의 <strong>생활비 예산 조정</strong>만 앱이 자동으로 새 버전에 적용합니다.</p>' +
      '<ul class="plain-list small"><li>목표일 변경, 신규 대출, 위험 확대, 상품 해지는 동의해도 자동 적용하지 않습니다.</li><li>앱 안의 예산만 바뀌며 실제 계좌이체·자동이체는 바뀌지 않습니다.</li><li>자동 적용한 내용도 알림함과 계획 버전 이력에 남습니다.</li></ul>' +
      '<div class="field-grid"><label class="check"><input type="checkbox" id="csEnabled"' + (c.enabled ? ' checked' : '') + '><span>동의한 범위 안에서 자동 적용</span></label>' +
      '<div class="field"><label for="csLimit">월 조정 한도</label><div class="input-wrap"><input id="csLimit" type="text" inputmode="decimal" value="' + Math.round(c.monthlyLimit / 10000) + '"><span class="unit">만원</span></div></div>' +
      '<div class="field"><label for="csFloor">필수생활비 하한</label><div class="input-wrap"><input id="csFloor" type="text" inputmode="decimal" value="' + Math.round(c.floor / 10000) + '"><span class="unit">만원</span></div><p class="help">계획의 최소 필수생활비보다 낮게 정해도 그 값 아래로는 줄이지 않습니다.</p></div></div>' +
      (c.agreedAt ? '<p class="muted small">동의일 ' + F.date(c.agreedAt) + '</p>' : '') + '<button type="button" class="btn btn-secondary" data-fx="saveConsent">저장</button></section>';
  }
  FP.Planner.monthly = monthlyView;
  FP.Client.monthlyCore = monthlyView;
  FP.Client.monthly = function (S) { return FP.Client.monthlyAll(S); };

  // ======================================================================
  // 알림함
  // ======================================================================
  FP.Client.inbox = function (S) { return FP.Client.inboxAll(S); };
  FP.Client.inboxCore = function (S) {
    var ns = S.x.notifSettings, list = S.x.notifications;
    var revOf = function (id) { return S.x.revisions.filter(function (r) { return r.id === id; })[0]; };
    var html = '<section class="card"><div class="card-head wrap"><h2>알림함</h2><button type="button" class="btn btn-small btn-secondary" data-fx="evaluate">지금 점검</button></div>' +
      (list.length ? '<ul class="inbox">' + list.map(function (n) {
        var rv = n.revisionId && revOf(n.revisionId);
        return '<li class="note' + (n.readAt ? '' : ' unread') + '" id="note-' + n.id + '"><div class="note-head">' + (n.readAt ? '' : '<span class="dot" aria-label="읽지 않음"></span>') + '<strong>' + (NTYPE[n.type] || n.type) + '</strong><span class="muted small">' + F.date(n.createdAt) + (n.pushState === 'sent' ? ' · 푸시 보냄' : '') + '</span></div>' +
          '<dl class="note-body"><dt>발생</dt><dd>' + esc(n.fact) + '</dd><dt>영향</dt><dd>' + esc(n.impact) + '</dd><dt>제안</dt><dd>' + esc(n.action) + '</dd></dl>' +
          '<div class="btn-row">' + (rv ? '<button type="button" class="btn btn-small btn-secondary" data-fx="goRev" data-id="' + rv.id + '" data-nid="' + n.id + '">수정 전후 비교</button>' : '') +
          (rv && (rv.status === 'pending' || rv.status === 'held') && !(rv.summary && rv.summary.needsBalanceCheck) ? '<button type="button" class="btn btn-small" data-fx="revApply" data-id="' + rv.id + '" data-nid="' + n.id + '">적용</button>' : '') +
          (rv && rv.status === 'pending' ? '<button type="button" class="btn btn-small btn-secondary" data-fx="revHold" data-id="' + rv.id + '" data-nid="' + n.id + '">보류</button>' : '') +
          '<button type="button" class="btn btn-small btn-secondary" data-fx="ask" data-nid="' + n.id + '">설계사 문의</button>' + (n.readAt ? '' : '<button type="button" class="link-btn small" data-fx="read" data-nid="' + n.id + '">읽음</button>') + '</div></li>';
      }).join('') + '</ul>' : '<p class="muted">알림이 없습니다.</p>') + '</section>';
    var push = pushSupport();
    html += '<section class="card"><h2>알림 설정</h2><div class="field-grid">' + Object.keys(NTYPE).map(function (k) { return '<label class="check"><input type="checkbox" data-nt="' + k + '"' + (ns.types[k] !== false ? ' checked' : '') + '><span>' + NTYPE[k] + '</span></label>'; }).join('') + '</div>' +
      '<div class="field-grid"><div class="field"><label for="qStart">방해금지 시작</label><input id="qStart" type="time" value="' + esc(ns.quietStart) + '"></div><div class="field"><label for="qEnd">방해금지 끝</label><input id="qEnd" type="time" value="' + esc(ns.quietEnd) + '"></div>' +
      '<label class="check"><input type="checkbox" id="nsPush"' + (ns.push ? ' checked' : '') + '><span>기기 알림(푸시) 받기</span></label><label class="check"><input type="checkbox" id="nsLock"' + (ns.lockDetails ? ' checked' : '') + '><span>잠금 화면에 알림 내용 보이기(금액 포함될 수 있음)</span></label></div>' +
      '<p class="muted small">예산 초과 기준은 ‘경보·설정’의 생활비 예산 초과 허용(%)을 따릅니다. 같은 상황의 알림은 한 번만 만듭니다.</p><button type="button" class="btn btn-secondary" data-fx="saveNotif">설정 저장</button></section>';
    html += (root.FP_STATIC ? '<p class="banner banner-warn"><strong>시연판 알림 방식: 앱 실행 시 표시되는 알림</strong> — 이 링크(GitHub Pages)에는 서버가 없어 앱을 닫은 상태의 정기 점검과 푸시가 없습니다. 앱을 열거나 ‘지금 점검’을 누를 때 같은 규칙으로 점검해 알림함에 넣습니다. 서버판(PC 실행·Render 배포)은 아래 방식으로 동작합니다.</p>' : '') + '<section class="card"><h2>이 기기에서 알림 받기</h2><p class="small"><strong>서버판 전달 방식:</strong> 서버가 1시간마다(그리고 실적이 바뀔 때마다) 점검해 알림함에 넣고, 이 기기에서 허용한 경우 Web Push로 보냅니다. 앱을 닫아 두어도 서버가 켜져 있고 기기가 인터넷에 연결되어 있으면 받습니다. 방해금지 시간에는 보내지 않고 끝난 뒤 보냅니다. 잠금 화면에는 기본적으로 잔액·부채·거래내역 없이 ‘새 알림이 있습니다’만 표시합니다.</p>' +
      '<p class="small">상태: ' + (push.ok ? (Notification.permission === 'granted' ? U.pill('ok', '허용됨') : Notification.permission === 'denied' ? U.pill('bad', '거부됨 — 앱 안 알림함으로만 받습니다') : U.pill('info', '아직 요청하지 않음')) : U.pill('info', push.reason)) + (S.x.pushSubscribed ? ' ' + U.pill('ok', '이 계정 구독 있음') : '') + '</p>' +
      '<div class="btn-row">' + (push.ok ? '<button type="button" class="btn" data-fx="pushOn">이 기기에서 알림 받기</button><button type="button" class="btn btn-secondary" data-fx="pushOff">이 기기 알림 끄기</button><button type="button" class="btn btn-secondary" data-fx="pushTest">시험 알림 보내기</button>' : '') + '</div>' +
      '<p class="muted small">푸시를 지원하지 않거나 거부한 경우에도 알림은 이 알림함에 그대로 쌓이며, 앱을 열 때 표시됩니다. 아이폰은 홈 화면에 설치한 앱(iOS 16.4 이상)에서만 푸시를 받을 수 있습니다.</p></section>';
    return html;
  };
  function pushSupport() {
    if (root.FP_PREVIEW) return { ok: false, reason: '미리보기에서는 지원하지 않음' };
    if (root.FP_STATIC) return { ok: false, reason: '시연판은 서버가 없어 푸시를 보낼 수 없음 — 앱을 열 때 알림함에 표시' };
    if (!('serviceWorker' in navigator) || !('PushManager' in root) || !('Notification' in root)) return { ok: false, reason: '이 브라우저는 푸시 미지원 — 앱 실행 시 알림함에 표시' };
    if (!root.isSecureContext) return { ok: false, reason: 'https 또는 localhost에서만 가능' };
    return { ok: true };
  }
  function keyBytes(b64) { var pad = '='.repeat((4 - b64.length % 4) % 4), raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); var a = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; }
  function pushOn() {
    // 브라우저 권한은 버튼을 눌렀을 때만 요청
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { U.toast('알림을 허용하지 않아 앱 안 알림함으로만 받습니다.'); return FP.reload(); }
      return Promise.all([navigator.serviceWorker.ready, U.api('GET', '/api/push/key')]).then(function (r) {
        return r[0].pushManager.getSubscription().then(function (old) { return old || r[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(r[1].publicKey) }); });
      }).then(function (sub) { return U.api('POST', '/api/push/subscribe', { subscription: sub.toJSON() }); })
        .then(function () { var ns = S0().x.notifSettings; ns.push = true; return api('PUT', '/notif-settings', { settings: ns }); })
        .then(done('이 기기에서 알림을 받습니다.'));
    }).catch(fail);
  }
  function pushOff() {
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      var ep = sub ? sub.endpoint : ''; return (sub ? sub.unsubscribe() : Promise.resolve()).then(function () { return U.api('POST', '/api/push/unsubscribe', { endpoint: ep }); });
    }).then(done('이 기기 알림을 껐습니다.')).catch(fail);
  }

  // ======================================================================
  // 이벤트
  // ======================================================================
  doc.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fx]'); if (!b) return;
    var S = S0(), fx = b.dataset.fx, ch = S.chat ? chatState(S) : null;
    if (b.dataset.nid && fx !== 'read' && fx !== 'ask') api('POST', '/notifications/' + b.dataset.nid + '/read').catch(function () {});
    switch (fx) {
      case 'addOfficial': return api('POST', '/risk/official', { type: doc.getElementById('ofType').value, diagnosedAt: doc.getElementById('ofDate').value, source: doc.getElementById('ofSource').value, purpose: doc.getElementById('ofPurpose').value }).then(done('금융기관 결과를 저장했습니다.')).catch(fail);
      case 'newSet': return api('POST', '/strategies', { basePlanId: Number(doc.getElementById('abcBase').value) }).then(done('A/B/C 설계안을 만들었습니다(작성 중).')).catch(fail);
      case 'updateSet': return api('PUT', '/strategies/' + b.dataset.sid, { overrides: collectOverrides(Number(b.dataset.sid)) }).then(done('조정값을 반영해 다시 계산했습니다.')).catch(fail);
      case 'presentSet': return U.dialog({ title: '고객에게 제시할까요?', body: '<p>제시하면 이 설계안은 더 이상 수정할 수 없고, 고객 알림함에 알림이 갑니다.</p>', actions: [{ text: '취소' }, { text: '제시', cls: 'btn-primary', onClick: function () { api('POST', '/strategies/' + b.dataset.sid + '/present').then(done('고객에게 제시했습니다.')).catch(fail); } }] });
      case 'pickStrategy': {
        var set = S.x.strategies.filter(function (s) { return s.id === Number(b.dataset.sid); })[0], o = set.result.options.filter(function (x) { return x.key === b.dataset.key; })[0];
        return U.dialog({ title: o.key + '안을 실행 기준 계획으로 저장할까요?', body: '<p>' + esc(o.title) + '</p><ul class="plain-list small">' + o.actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul><p class="small">목표일 ' + o.moveMonth + ' · 목표일 예상 ' + (o.gap >= 0 ? '여유 ' : '부족 ') + F.abs(o.gap) + ' · ' + U.statusText(o.status) + '</p><label class="check"><input type="checkbox" id="pickOk"><span>내용을 확인했고 이 안으로 실행하겠습니다</span></label>', actions: [{ text: '취소' }, { text: '선택·저장', cls: 'btn-primary', keep: true, onClick: function () { if (!doc.getElementById('pickOk').checked) return U.toast('확인란을 선택해 주세요.', true); U.closeDialog(); api('POST', '/strategies/' + set.id + '/select', { key: o.key, confirm: true }).then(done(o.key + '안을 실행 기준 계획으로 저장했습니다.')).catch(fail); } }] });
      }
      case 'chatStart': S.chat = { mode: 'q', step: 0, answers: {}, faq: [] }; return FP.rerender();
      case 'chatAnswer': ch.answers[b.dataset.q] = b.dataset.o; var idx = CFG.QUESTIONS.findIndex(function (q) { return q.id === b.dataset.q; }); var next = -1; for (var i = idx + 1; i < CFG.QUESTIONS.length; i++) if (!ch.answers[CFG.QUESTIONS[i].id]) { next = i; break; } if (next < 0) for (var k = 0; k < CFG.QUESTIONS.length; k++) if (!ch.answers[CFG.QUESTIONS[k].id]) { next = k; break; } if (next < 0) ch.mode = 'result'; else ch.step = next; FP.rerender(); return scrollChat();
      case 'chatPrev': ch.step = Math.max(0, ch.step - 1); return FP.rerender();
      case 'chatEdit': ch.mode = 'q'; ch.step = Number(b.dataset.i); return FP.rerender();
      case 'chatReview': { var miss = CFG.QUESTIONS.findIndex(function (q) { return !ch.answers[q.id]; }); ch.mode = 'q'; ch.step = miss >= 0 ? miss : 0; return FP.rerender(); }
      case 'chatToResult': ch.mode = 'result'; return FP.rerender();
      case 'chatSave': return api('POST', '/risk/app', { answers: ch.answers }).then(function () { S.chat = null; U.toast('위험성향 결과를 저장했습니다. 과거 결과는 이력으로 남습니다.'); return FP.reload(); }).catch(fail);
      case 'faqAsk': { var inp = doc.getElementById('faqIn'), q2 = inp.value.trim(); if (!q2) return; ch.faq.push({ q: q2, a: faqAnswer(q2) }); FP.rerender(); return scrollChat(); }
      case 'closeMonth': return U.dialog({ title: b.dataset.ym + '을 확정할까요?', body: '<p>확정하면 이 달의 지출이 실적으로 계산에 반영되고, 초과·여유에 따라 수정안이 만들어질 수 있습니다. 미확인 거래나 결제 전 예정 항목이 있으면 먼저 정리해야 합니다.</p>', actions: [{ text: '취소' }, { text: '확정', cls: 'btn-primary', onClick: function () { api('POST', '/months/' + b.dataset.ym + '/close', { confirm: true }).then(done(b.dataset.ym + ' 지출을 확정했습니다.')).catch(fail); } }] });
      case 'schAdd': { var amt = Number(doc.getElementById('schAmt').value.replace(/,/g, '')); if (!(amt > 0)) return U.toast('금액(만원)을 입력해 주세요.', true); return api('POST', '/scheduled', { month: b.dataset.ym, label: doc.getElementById('schLabel').value, amount: Math.round(amt * 10000), category: doc.getElementById('schCat').value, kind: doc.getElementById('schKind').value }).then(done('예정 결제를 추가했습니다.')).catch(fail); }
      case 'schPaid': return api('POST', '/scheduled/' + b.dataset.id + '/paid').then(done('결제됨으로 표시했습니다. 실제 지출 기록이나 거래 확인으로 금액을 남겨 주세요.')).catch(fail);
      case 'schDel': return api('DELETE', '/scheduled/' + b.dataset.id).then(done()).catch(fail);
      case 'revApply': {
        var cb = doc.getElementById('bal-' + b.dataset.id);
        return U.dialog({ title: '수정안 #' + b.dataset.id + '을 적용할까요?', body: '<p>새 계획 버전이 만들어지고 실행 기준이 됩니다. 이전 버전은 남습니다. 앱 안의 예산만 바뀌며 실제 계좌이체는 바뀌지 않습니다.</p>', actions: [{ text: '취소' }, { text: '적용', cls: 'btn-primary', onClick: function () { api('POST', '/revisions/' + b.dataset.id + '/apply', { balanceConfirmed: cb ? cb.checked : undefined }).then(done('수정안을 적용했습니다.')).catch(fail); } }] });
      }
      case 'revHold': return api('POST', '/revisions/' + b.dataset.id + '/hold').then(done('보류했습니다. 언제든 다시 적용할 수 있습니다.')).catch(fail);
      case 'goRev': S.ui.tab = 'monthly'; S.ui.scrollTo = 'rev-' + b.dataset.id; try { history.replaceState(null, '', '#monthly'); } catch (x) { /* 무시 */ } return FP.reload();
      case 'read': return api('POST', '/notifications/' + b.dataset.nid + '/read').then(done()).catch(fail);
      case 'ask': return U.dialog({ title: '설계사에게 문의', body: '<div class="field"><label for="askMsg">문의 내용</label><textarea id="askMsg" rows="4" maxlength="500"></textarea></div>', actions: [{ text: '취소' }, { text: '보내기', cls: 'btn-primary', onClick: function () { var m = doc.getElementById('askMsg').value; api('POST', '/notifications/' + b.dataset.nid + '/ask', { message: m }).then(done('설계사에게 문의를 보냈습니다.')).catch(fail); } }] });
      case 'saveNotif': {
        var types = {}; doc.querySelectorAll('[data-nt]').forEach(function (x) { types[x.dataset.nt] = x.checked; });
        return api('PUT', '/notif-settings', { settings: { types: types, quietStart: doc.getElementById('qStart').value, quietEnd: doc.getElementById('qEnd').value, push: doc.getElementById('nsPush').checked, lockDetails: doc.getElementById('nsLock').checked } }).then(done('알림 설정을 저장했습니다.')).catch(fail);
      }
      case 'saveConsent': {
        var lim = Number(doc.getElementById('csLimit').value), fl = Number(doc.getElementById('csFloor').value);
        if (!isFinite(lim) || !isFinite(fl)) return U.toast('숫자(만원)를 입력해 주세요.', true);
        return api('PUT', '/consent', { consent: { enabled: doc.getElementById('csEnabled').checked, monthlyLimit: Math.round(lim * 10000), floor: Math.round(fl * 10000) } }).then(done('자동 적용 설정을 저장했습니다.')).catch(fail);
      }
      case 'evaluate': return api('POST', '/evaluate').then(function (r) { U.toast('점검 완료: 새 알림 ' + r.notifications + '건, 새 수정안 ' + r.revisions + '건' + (r.closed.length ? ', 확정된 달 ' + r.closed.join(', ') : '')); return FP.reload(); }).catch(fail);
      case 'pushOn': return pushOn();
      case 'pushOff': return pushOff();
      case 'pushTest': return U.api('POST', '/api/push/test').then(function (r) { U.toast(r.sent ? '시험 알림을 보냈습니다.' : '보내지 못했습니다(응답 ' + r.lastStatus + ').', !r.sent); }).catch(fail);
    }
  });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'faqIn') { e.preventDefault(); var b = doc.querySelector('[data-fx="faqAsk"]'); if (b) b.click(); } });
  function scrollChat() { var l = doc.getElementById('chatLog'); if (l) l.scrollTop = l.scrollHeight; var q = doc.querySelector('.q-box, .result-box'); if (q && q.scrollIntoView) q.scrollIntoView({ block: 'nearest' }); }

  FP.Features = {
    onLoad: function (S) { /* 채팅 상태는 다시 불러와도 유지 */ },
    afterRender: function (S) {
      if (S.ui.scrollTo) { var el = doc.getElementById(S.ui.scrollTo); if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); } S.ui.scrollTo = null; }
      if (S.ui.tab === 'input') { var l = doc.getElementById('chatLog'); if (l) l.scrollTop = l.scrollHeight; }
    },
    strategyCards: strategyCards, strategySection: strategySection, alertsAndInbox: null
  };
})(this);
