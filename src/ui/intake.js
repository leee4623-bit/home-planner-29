/*
 * 첫 화면 흐름: 고객정보 입력 → 입력 완료·저장 → 고객용·설계사용 선택 → 각 화면.
 * - 입력 화면은 처음 입력과 '고객정보 수정'에 함께 쓴다.
 * - 오류는 칸 옆에 보이고, 이미 적은 값은 그대로 남는다.
 * - 저장에 실패하면 성공으로 표시하지 않고 입력값을 유지한다.
 * - 고객용·설계사용 구분은 로그인이 아니라 화면 모드 선택이다.
 */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;
  var I = P.intake;
  var St = P.store;

  function app() { return ui.app; }
  var esc = ui.esc;

  /* ---------- 입력칸 ---------- */

  function tag(f) {
    return f.required ? '<span class="req">필수</span>' : '<span class="opt">선택</span>';
  }

  function field(f, values, errors, extraCls) {
    var id = 'in-' + f.key;
    var v = values[f.key] === undefined || values[f.key] === null ? '' : String(values[f.key]);
    var err = errors[f.key];
    var desc = [];
    if (f.hint) desc.push(id + '-h');
    if (err) desc.push(id + '-e');
    var aria = (desc.length ? ' aria-describedby="' + desc.join(' ') + '"' : '') + (err ? ' aria-invalid="true"' : '') + (f.required ? ' aria-required="true"' : '');
    var ctl;
    if (f.type === 'select') {
      ctl = '<select id="' + id + '" name="' + f.key + '"' + aria + '><option value="">' + (f.required ? '골라 주세요' : '선택 안 함(미확인)') + '</option>' +
        f.options.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else {
      var type = f.type === 'date' ? 'date' : f.type === 'month' ? 'month' : 'text';
      var mode = f.type === 'money' || f.type === 'number' ? ' inputmode="decimal" autocomplete="off"' : '';
      var ph = (f.type === 'money' || f.type === 'number') && !f.required ? ' placeholder="미확인"' : f.type === 'month' ? ' placeholder="2029-10"' : '';
      ctl = '<input id="' + id + '" name="' + f.key + '" type="' + type + '" value="' + esc(v) + '"' + mode + ph + (f.maxLength ? ' maxlength="' + f.maxLength + '"' : '') + aria + '>';
    }
    if (f.unit) ctl = '<div class="input-unit">' + ctl + '<span class="unit" aria-hidden="true">' + esc(f.unit) + '</span></div>';
    return '<div class="field' + (err ? ' has-error' : '') + (extraCls ? ' ' + extraCls : '') + '">' +
      '<label for="' + id + '">' + esc(f.label) + (f.unit ? ' <span class="unit-l">(' + esc(f.unit) + ')</span>' : '') + ' ' + tag(f) + '</label>' + ctl +
      (f.hint ? '<p class="hint" id="' + id + '-h">' + esc(f.hint) + '</p>' : '') +
      (err ? '<p class="err" id="' + id + '-e"><span aria-hidden="true">!</span> ' + esc(err) + '</p>' : '') + '</div>';
  }

  function livingTable(values, errors) {
    var total = 0;
    var unknown = 0;
    var rows = I.LIVING.map(function (l) {
      var f = I.BY_KEY['lv_' + l[0]];
      var v = values[f.key] === undefined ? '' : String(values[f.key]);
      if (v.trim() === '') unknown++; else if (Number.isFinite(Number(v))) total += Number(v);
      var err = errors[f.key];
      var id = 'in-' + f.key;
      return '<div class="lv-row' + (err ? ' has-error' : '') + '">' +
        '<label for="' + id + '" class="lv-name">' + esc(l[1]) + '</label>' +
        '<div class="input-unit"><input id="' + id + '" name="' + f.key + '" type="text" inputmode="decimal" autocomplete="off" placeholder="미확인" value="' + esc(v) + '"' +
        (err ? ' aria-invalid="true" aria-describedby="' + id + '-e"' : '') + '><span class="unit" aria-hidden="true">만원/월</span></div>' +
        '<label class="lv-ess"><input type="checkbox" name="ess_' + l[0] + '"' + (values['ess_' + l[0]] === 'on' ? ' checked' : '') + '> 필수</label>' +
        (err ? '<p class="err" id="' + id + '-e"><span aria-hidden="true">!</span> ' + esc(err) + '</p>' : '') + '</div>';
    }).join('');
    return '<fieldset class="living"><legend>월 생활비 <span class="req">필수(1개 이상)</span></legend>' +
      '<p class="hint">항목마다 금액(만원/월)을 적고, 줄일 수 없는 지출은 ‘필수’에 표시하세요. 없는 항목은 0, 모르는 항목은 비워 두세요.</p>' +
      rows + '<p class="lv-total" aria-live="polite">합계 <strong id="lv-sum">' + fmt.num1(total) + '</strong>만원/월' + (unknown ? ' <span class="muted">(미확인 ' + unknown + '개 제외)</span>' : '') + '</p></fieldset>';
  }

  function section(key, values, errors) {
    var sec = I.SECTIONS.filter(function (s) { return s.key === key; })[0];
    var fs = I.FIELDS.filter(function (f) { return f.section === key && !f.living && !f.group; });
    var body = '<div class="fgrid">' + fs.map(function (f) { return field(f, values, errors); }).join('') + '</div>';
    if (key === 'income') body += livingTable(values, errors);
    if (key === 'assets') {
      var ds = I.FIELDS.filter(function (f) { return f.group === 'debt'; });
      body += '<fieldset class="sub"><legend>부채 <span class="opt">선택</span></legend><p class="hint">부채가 없으면 잔액을 0으로 두세요. 잔액이 있으면 금리·기간이 필요해요.</p>' +
        '<div class="fgrid">' + ds.map(function (f) { return field(f, values, errors); }).join('') + '</div></fieldset>';
    }
    return '<section class="card intake-sec" aria-labelledby="sec-' + key + '"><h2 id="sec-' + key + '">' + esc(sec.title) + '</h2>' + body + '</section>';
  }

  function errorSummary(errors) {
    var keys = Object.keys(errors);
    if (!keys.length) return '';
    return '<div class="notice bad" role="alert" id="intake-errors"><div><strong>' + keys.length + '개 항목을 확인해 주세요.</strong> 적은 값은 그대로 남아 있어요.<ul>' +
      keys.map(function (k) {
        var f = I.BY_KEY[k];
        return '<li><a href="#in-' + esc(k) + '" data-action="intake-focus" data-key="' + esc(k) + '">' + esc(f ? f.label : k) + '</a>: ' + esc(errors[k]) + '</li>';
      }).join('') + '</ul></div></div>';
  }

  /* ---------- 입력 화면 ---------- */

  ui.intakeScreen = function () {
    var a = app();
    var v = a.view;
    var edit = v.intakeMode === 'edit';
    var values = v.intakeDraft || (edit && a.state ? I.fromState(a.state) : I.emptyValues());
    var errors = v.intakeErrors || {};
    var source = v.intakeSource || (edit && a.state && a.state.intake ? a.state.intake.source : 'manual');
    var example = source === 'example';
    var confirm = v.intakeConfirm
      ? '<div class="notice warn" role="alertdialog" aria-labelledby="ex-q"><div><p id="ex-q"><strong>이미 적은 내용이 있어요. 설계 예시로 바꿀까요?</strong> 지금 입력칸의 값이 예시 값으로 바뀝니다(아직 저장 전이라 저장된 정보는 그대로예요).</p>' +
        '<div class="btn-row"><button class="btn btn-danger" data-action="intake-example-yes">예시로 바꾸기</button><button class="btn" data-action="intake-example-no">취소</button></div></div></div>'
      : '';
    var saveErr = v.intakeSaveError
      ? '<div class="notice bad" role="alert"><div><p><strong>저장하지 못했어요.</strong> 이 브라우저 저장소에 쓸 수 없습니다(' + esc(v.intakeSaveError) + '). 입력값은 그대로 남아 있어요.</p>' +
        '<div class="btn-row"><button class="btn btn-primary" data-action="intake-retry-save">다시 저장</button><button class="btn" data-action="intake-continue-unsaved">저장 없이 이번 창에서만 계속</button></div>' +
        '<p class="small muted">저장 없이 계속하면 창을 닫을 때 사라집니다. 더보기 → 데이터 관리의 내보내기(JSON)로 보관할 수 있어요.</p></div></div>'
      : '';
    return '<header class="topbar"><div class="topbar-inner"><div class="brand">재무플래너</div>' +
      (edit ? '<button class="btn btn-sm" data-action="intake-cancel">수정 취소하고 돌아가기</button>' : '') + '</div>' +
      '<div class="demo-note">' + (example ? '가상 고객 데이터(설계 예시)를 입력칸에 채웠어요. 실제 고객이 아닙니다.' : '입력한 정보는 이 기기의 브라우저에만 저장돼요. 다른 기기와 자동으로 공유되지 않아요.') + '</div></header>' +
      '<main class="intake-main" id="main">' + (ui.importConfirm ? ui.importConfirm() : '') +
      '<section class="card intake-intro"><h1>' + (edit ? '고객정보 수정' : '고객정보 입력') + '</h1>' +
      '<p>' + (edit ? '고친 정보로 고객용·설계사용 화면의 결과가 함께 다시 계산됩니다. 설계안의 수동 조정값은 바꾸지 않고, 다시 볼 부분을 알려 드려요.'
        : '먼저 고객정보를 한 페이지에 입력하고 저장하면, 고객용·설계사용 화면을 골라 결과를 볼 수 있어요.') + '</p>' +
      '<ul class="legend-list small"><li><span class="req">필수</span> 꼭 입력 · <span class="opt">선택</span> 모르면 비워 두기</li><li>빈 칸은 <strong>미확인</strong>, 실제로 없으면 <strong>0</strong>을 입력 · 금액 단위는 만원</li></ul>' +
      '<div class="btn-row"><button class="btn" data-action="intake-example">설계 예시 불러오기</button>' +
      (!edit ? '<label class="btn" for="import-file-intake">저장해 둔 파일 불러오기(JSON)</label><input id="import-file-intake" class="sr-only" type="file" accept=".json,application/json" data-change="import-json">' : '') + '</div>' +
      (example ? '<div class="notice info"><span aria-hidden="true">i</span><p>설계 예시는 재무설계 사례 보고서의 <strong>가상 고객</strong> 초기 정보입니다(기준일 2026-11-03, 설계 시작월 2026-11 고정). 생활비 200·대출 700 상환·연금 월 10 같은 설계 내용은 넣지 않았고, 저장하면 보고서 설계안이 별도 계획 버전으로 붙습니다. 값은 고칠 수 있어요.</p></div>' : '') +
      confirm + saveErr + errorSummary(errors) + '</section>' +
      '<form id="intake-form" data-submit="intake-save" novalidate>' +
      '<input type="hidden" name="_source" value="' + esc(source) + '">' +
      '<div class="intake-grid">' + I.SECTIONS.map(function (s) { return section(s.key, values, errors); }).join('') + '</div>' +
      '<p class="small muted intake-submit-note">' + (edit ? '수정 완료' : '입력 완료') + '를 누르면 필수값과 숫자 범위를 검사한 뒤 이 기기에 저장합니다.</p>' +
      '<div class="intake-submit"><button class="btn btn-primary btn-block" type="submit">' + (edit ? '수정 완료' : '입력 완료') + '</button></div>' +
      '</form></main>';
  };

  function formValues(fd) {
    var v = {};
    I.FIELDS.forEach(function (f) { var x = fd.get(f.key); v[f.key] = x === null ? '' : String(x); });
    I.LIVING.forEach(function (l) { v['ess_' + l[0]] = fd.get('ess_' + l[0]) === 'on' ? 'on' : ''; });
    return v;
  }

  function readForm() {
    var f = document.getElementById('intake-form');
    return f ? formValues(new FormData(f)) : (app().view.intakeDraft || I.emptyValues());
  }

  function focusFirstError(errors) {
    var k = Object.keys(errors)[0];
    if (!k) return;
    setTimeout(function () {
      var el = document.getElementById('in-' + k);
      if (el && el.focus) { el.focus(); if (el.scrollIntoView) el.scrollIntoView({ block: 'center' }); }
    }, 0);
  }

  function rerender(patch, keepScroll) {
    Object.assign(app().view, patch);
    ui.render();
    if (!keepScroll) root.scrollTo(0, 0);
  }

  /** 입력 화면 열기(처음 입력 / 고객정보 수정) */
  ui.openIntake = function (mode) {
    var a = app();
    a.view.intakeReturn = { screen: a.view.screen, role: a.view.role };
    rerender({ screen: 'intake', intakeMode: mode, intakeDraft: null, intakeErrors: null, intakeConfirm: false, intakeSaveError: null, intakeSource: null });
  };

  function trySave(s, after) {
    var a = app();
    var saved = a.store.save(s);
    if (!saved.ok) {
      a.pendingState = s;
      a.pendingAfter = after;
      rerender({ intakeSaveError: saved.error || '저장소 사용 불가' }, true);
      return false;
    }
    finish(s, after);
    return true;
  }

  function finish(s, after) {
    var a = app();
    a.state = s;
    a.d = null;
    a.pendingState = null;
    a.view.intakeDraft = null;
    a.view.intakeErrors = null;
    a.view.intakeSaveError = null;
    a.view.intakeConfirm = false;
    a.view.intakeSource = null;
    a.staleDemo = false;
    Object.assign(a.view, after.view);
    ui.render();
    root.scrollTo(0, 0);
    ui.toast(after.msg);
  }

  Object.assign(ui.actions, {
    'intake-example': function () {
      var cur = readForm();
      if (I.hasContent(cur)) { rerender({ intakeDraft: cur, intakeConfirm: true }, true); return; }
      rerender({ intakeDraft: I.exampleValues(), intakeSource: 'example', intakeErrors: null, intakeConfirm: false }, true);
      ui.toast('가상 고객 정보를 채웠어요. 필요하면 고친 뒤 입력 완료를 누르세요.');
    },
    'intake-example-yes': function () {
      rerender({ intakeDraft: I.exampleValues(), intakeSource: 'example', intakeErrors: null, intakeConfirm: false }, true);
      ui.toast('가상 고객 정보로 바꿨어요.');
    },
    'intake-example-no': function () { rerender({ intakeConfirm: false }, true); },
    'intake-focus': function (c, el) {
      var t = document.getElementById('in-' + el.getAttribute('data-key'));
      if (t) { t.focus(); if (t.scrollIntoView) t.scrollIntoView({ block: 'center' }); }
    },
    'intake-cancel': function () {
      var a = app();
      var back = a.view.intakeReturn || { screen: 'choose' };
      rerender({ screen: back.screen === 'intake' ? 'choose' : back.screen || 'choose', role: back.role || a.view.role, intakeDraft: null, intakeErrors: null, intakeSaveError: null, intakeConfirm: false });
    },
    'intake-save': function (c, form, fd) {
      var a = app();
      var values = formValues(fd);
      var source = String(fd.get('_source') || 'manual');
      a.view.intakeDraft = values;
      a.view.intakeSource = source;
      a.view.intakeSaveError = null;
      if (a.view.intakeMode === 'edit' && a.state) {
        var who = a.view.role === 'planner' ? '설계사' : '고객';
        var r = I.applyEdit(a.state, values, who);
        if (!r.ok) { rerender({ intakeErrors: r.errors }, true); focusFirstError(r.errors); return; }
        if (!r.changed.length) {
          var back = a.view.intakeReturn || { screen: 'choose' };
          rerender({ screen: back.screen === 'intake' ? 'choose' : back.screen || 'choose', intakeDraft: null, intakeErrors: null });
          ui.toast('바뀐 내용이 없어요.');
          return;
        }
        var s = P.alerts.syncAlerts(r.state).state;
        var ret = a.view.intakeReturn || { screen: 'choose' };
        trySave(s, { view: { screen: ret.screen === 'intake' ? 'choose' : ret.screen || 'choose', role: ret.role || a.view.role }, msg: '고객정보를 저장했어요(' + r.changed.length + '개 항목). 두 화면 결과를 다시 계산했어요.' });
        return;
      }
      var b = I.buildState(values, source);
      if (!b.ok) { rerender({ intakeErrors: b.errors }, true); focusFirstError(b.errors); return; }
      var s2 = St.migrate ? St.migrate(b.state) : b.state;
      s2 = P.alerts.syncAlerts(s2).state;
      trySave(s2, { view: { screen: 'choose' }, msg: '저장했어요. 이 기기 브라우저에만 저장됩니다.' });
    },
    'intake-retry-save': function () {
      var a = app();
      if (a.pendingState) trySave(a.pendingState, a.pendingAfter);
    },
    'intake-continue-unsaved': function () {
      var a = app();
      if (!a.pendingState) return;
      var after = a.pendingAfter;
      finish(a.pendingState, { view: after.view, msg: '저장하지 않고 계속해요. 창을 닫으면 입력이 사라집니다.' });
    },

    /* 화면 선택 */
    'choose-role': function (c, el) { ui.setView({ screen: 'main', role: el.getAttribute('data-role') }); },
    'go-choose': function () { ui.setView({ screen: 'choose' }); },
    'edit-info': function () { ui.openIntake('edit'); },
    'start-over-confirm': function () { ui.setView({ confirm: 'start-over' }, true); },
    'start-over': function () {
      // 지우기 전에 지금 상태를 백업 키에 남긴다(실수 방지)
      var a = app();
      try { root.localStorage.setItem('jaemu-planner-before-start-over', JSON.stringify(a.state)); } catch (e) { /* 무시 */ }
      a.store.clear();
      a.state = null;
      a.d = null;
      rerender({ screen: 'intake', intakeMode: 'new', intakeDraft: null, intakeErrors: null, intakeSource: null, confirm: null });
      ui.toast('처음부터 입력해요. 지운 데이터는 이 브라우저에 백업해 두었어요.');
    },
    'review-dismiss': function (c) {
      var s = JSON.parse(JSON.stringify(c.state));
      (s.review || []).forEach(function (r) { r.dismissed = true; });
      ui.commit(s, '확인했어요.');
    }
  });

  // 생활비 합계를 입력하는 대로 보여 준다
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.name || t.name.indexOf('lv_') !== 0) return;
      var form = t.form;
      var out = document.getElementById('lv-sum');
      if (!form || !out) return;
      var sum = 0;
      I.LIVING.forEach(function (l) { var x = Number(String(form.elements['lv_' + l[0]].value || '').replace(/,/g, '')); if (Number.isFinite(x)) sum += x; });
      out.textContent = fmt.num1(sum);
    });
  }

  /* ---------- 화면 선택 ---------- */

  function factLine(c) {
    var k = c.state.customer;
    var goal = c.d.current.input.goal;
    return '<dl class="facts">' +
      '<div><dt>고객</dt><dd>' + esc(k.name) + (k.isExample ? ' ' + ui.badge('가상 고객 데이터', 'info') : '') + '</dd></div>' +
      '<div><dt>기준일</dt><dd>' + esc(c.d.today) + (c.state.demoToday ? ' <span class="small muted">(예시 고정)</span>' : '') + '</dd></div>' +
      '<div><dt>목표</dt><dd>' + esc(ui.ymText(c.d.plan.targetMonth)) + ' · 보증금+부대비용 ' + fmt.short(goal.depositTarget + goal.movingCost) + '만원</dd></div>' +
      '<div><dt>실행 기준</dt><dd>' + esc(c.d.plan.name) + '</dd></div>' +
      '<div><dt>목표 판정</dt><dd>' + ui.judgementBadge(c.d.current.judgement) + '</dd></div></dl>';
  }

  ui.reviewBanner = function (c) {
    var open = (c.state.review || []).filter(function (r) { return !r.dismissed && r.items && r.items.length; });
    if (!open.length) return '';
    var items = [];
    open.forEach(function (r) { r.items.forEach(function (x) { items.push(x); }); });
    return '<div class="review-note notice warn" role="status"><div><strong>고객정보가 바뀌어 다시 검토할 부분이 있어요</strong><ul>' +
      items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<div class="btn-row">' + (c.view.screen === 'main' && c.view.role === 'planner' ? '<button class="btn btn-sm" data-action="planner-page" data-page="plans">계획 버전 보기</button>' : '') +
      '<button class="btn btn-sm" data-action="review-dismiss">확인했어요</button></div></div></div>';
  };

  ui.chooseScreen = function (c) {
    var confirm = c.view.confirm === 'start-over'
      ? '<div class="notice warn" role="alert"><div><p><strong>모든 데이터를 지우고 고객정보 입력부터 다시 할까요?</strong> 기록·계획 버전·설정이 지워져요(이 브라우저에 백업 1개를 남깁니다). 먼저 내보내기를 해 두면 다시 불러올 수 있어요.</p>' +
        '<div class="btn-row"><button class="btn btn-danger" data-action="start-over">지우고 다시 입력</button><button class="btn" data-action="cancel-confirm">취소</button></div></div></div>'
      : '';
    return '<header class="topbar"><div class="topbar-inner"><div class="brand">재무플래너</div>' +
      '<button class="btn btn-sm" data-action="edit-info">고객정보 수정</button></div>' +
      '<div class="demo-note">' + (c.state.customer.isExample ? '가상 고객 데이터(설계 예시)입니다. 실제 금융정보가 아닙니다.' : '이 기기의 브라우저에만 저장돼요. 다른 기기와 자동으로 공유되지 않아요.') + '</div></header>' +
      '<main class="choose-main" id="main">' + (ui.importConfirm ? ui.importConfirm() : '') +
      '<section class="card"><h1>어떤 화면으로 볼까요?</h1>' + factLine(c) +
      '<p class="small muted">두 화면은 같은 고객정보와 같은 계산 결과를 씁니다. 로그인 없이 화면 모드만 바꾸는 방식이에요.</p></section>' +
      ui.reviewBanner(c) +
      '<div class="choose-grid">' +
      '<button class="choose-card" data-action="choose-role" data-role="customer"><span class="cc-h">고객용 화면</span>' +
      '<span class="cc-d">이번 달 계획 · 실제 입력 · 진행 상황 · 알림 · 제안된 수정안 확인</span><span class="cc-go">고객용으로 보기 →</span></button>' +
      '<button class="choose-card" data-action="choose-role" data-role="planner"><span class="cc-h">설계사용 화면</span>' +
      '<span class="cc-d">고객 진단 · 설계 전후 비교 · 목표 판정 · 설계안 조정 · 충격 시나리오 · 필요 저축액 역산</span><span class="cc-go">설계사용으로 보기 →</span></button>' +
      '</div>' +
      '<section class="card"><h2>데이터</h2><p class="small">' + (app().store.mode === 'storage' ? '고객정보와 계획·실제 기록은 이 기기의 브라우저에 저장돼요. 다른 기기와 자동으로 공유되거나 실시간 연동되지 않아요.' : '이 브라우저에는 저장할 수 없어 창을 닫으면 사라져요. 내보내기로 보관하세요.') + '</p>' +
      '<div class="btn-row"><button class="btn" data-action="edit-info">고객정보 수정</button><button class="btn" data-action="export-json">내보내기(JSON)</button>' +
      '<label class="btn" for="import-file-choose">불러오기(JSON)</label><input id="import-file-choose" class="sr-only" type="file" accept=".json,application/json" data-change="import-json">' +
      '<button class="btn btn-danger" data-action="start-over-confirm">처음부터 다시 입력</button></div>' + confirm + '</section></main>';
  };

  /* ---------- 불러오기 확인 ---------- */

  ui.importConfirm = function () {
    var a = app();
    var pi = a.pendingImport;
    if (!pi) return '';
    var s = pi.state;
    var k = s.customer || {};
    return '<section class="card import-confirm" role="alertdialog" aria-labelledby="imp-h"><h2 id="imp-h">이 파일을 불러올까요?</h2>' +
      '<dl class="facts"><div><dt>파일</dt><dd>' + esc(pi.fileName || '') + '</dd></div>' +
      '<div><dt>고객</dt><dd>' + esc(k.name || '이름 없음') + (k.isExample ? ' ' + ui.badge('가상 고객 데이터', 'info') : '') + '</dd></div>' +
      '<div><dt>계획 버전</dt><dd>' + (s.plans || []).length + '개</dd></div>' +
      '<div><dt>실행 기록</dt><dd>' + (s.records || []).length + '개월</dd></div>' +
      '<div><dt>내보낸 날</dt><dd>' + esc(pi.exportedAt || '알 수 없음') + '</dd></div></dl>' +
      '<p class="small">' + (a.state ? '반영하면 지금 이 기기의 데이터(고객 ' + esc((a.state.customer || {}).name || '') + ')가 파일 내용으로 바뀌어요. 먼저 지금 데이터를 내보내 두면 되돌릴 수 있어요.' : '반영하면 이 기기에 저장하고 화면 선택으로 넘어가요.') + '</p>' +
      '<div class="btn-row"><button class="btn btn-primary" data-action="import-apply">반영</button><button class="btn" data-action="import-cancel">취소</button></div></section>';
  };

  Object.assign(ui.actions, {
    'import-json': function (c, el) {
      var f = el.files && el.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        var r = St.importJSON(text);
        el.value = '';
        if (!r.ok) { ui.toast(r.errors[0]); return; }
        var exportedAt = null;
        try { exportedAt = JSON.parse(text).exportedAt || null; } catch (e) { /* 무시 */ }
        app().pendingImport = { state: r.state, fileName: f.name, exportedAt: exportedAt };
        ui.render();
        root.scrollTo(0, 0);
      };
      reader.onerror = function () { ui.toast('파일을 읽지 못했어요. 다시 시도해 주세요.'); };
      reader.readAsText(f, 'utf-8');
    },
    'import-cancel': function () { app().pendingImport = null; ui.render(); ui.toast('불러오기를 취소했어요.'); },
    'import-apply': function () {
      var a = app();
      var pi = a.pendingImport;
      if (!pi) return;
      var s = P.alerts.syncAlerts(pi.state).state;
      var saved = a.store.save(s);
      a.pendingImport = null;
      a.state = s;
      a.d = null;
      a.staleDemo = false;
      Object.assign(a.view, { screen: 'choose', confirm: null });
      ui.render();
      root.scrollTo(0, 0);
      ui.toast(saved.ok ? '불러와 저장했어요.' : '불러왔지만 이 브라우저에 저장하지 못했어요. 창을 닫으면 사라집니다.');
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
