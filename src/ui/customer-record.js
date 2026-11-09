/* 이번 달 기록: 항목별 합계(같은 달·항목은 대체), 잠정/확정, 예정 결제, 거래내역 CSV */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;
  var dates = P.dates;
  var St = P.store;

  var ITEMS = ['income', 'debt', 'emergency', 'housing', 'product', 'pension', 'essential', 'optional'];

  function months(c) {
    var out = [];
    var plan = c.d.plan;
    var end = c.d.next;
    for (var m = plan.startMonth; dates.parseYM(m) <= dates.parseYM(end); m = dates.addMonths(m, 1)) out.push(m);
    return out.reverse();
  }

  function recordForm(c, month) {
    var rec = St.getRecord(c.state, month) || {};
    var ms = P.tracking.monthStatus(c.state, month, { planResult: c.d.paths.plan });
    var plannedOf = {};
    ms.items.forEach(function (i) { plannedOf[i.item] = i.planned; });
    var status = rec.status || '잠정';
    var field = function (k) {
      var v = rec[k];
      var planned = plannedOf[k];
      return '<div class="field"><label for="rec-' + k + '">' + St.RECORD_ITEMS[k] + '</label>' +
        '<input id="rec-' + k + '" name="' + k + '" type="number" inputmode="decimal" min="0" step="0.1" value="' + (v === undefined ? '' : ui.esc(v)) + '" placeholder="비워 두면 기록 없음">' +
        '<span class="hint">계획 ' + (planned === undefined ? '—' : fmt.num1(planned)) + '만원' + (v === 0 ? ' · 0원 실행으로 저장됨' : '') + '</span></div>';
    };
    return '<form data-submit="save-record" aria-labelledby="rec-h">' +
      '<input type="hidden" name="month" value="' + ui.esc(month) + '">' +
      '<h3 id="rec-h" class="sr-only">' + ui.esc(month) + ' 기록</h3>' +
      '<fieldset><legend>소득</legend><div class="grid-2">' + ['income'].map(field).join('') + '</div></fieldset>' +
      '<fieldset><legend>저축·상환</legend><div class="grid-2">' + ['debt', 'emergency', 'housing', 'product', 'pension'].map(field).join('') + '</div></fieldset>' +
      '<fieldset><legend>생활비</legend><div class="grid-2">' + ['essential', 'optional'].map(field).join('') + '</div></fieldset>' +
      '<fieldset><legend>기록 상태 ' + ui.help('잠정') + ' ' + ui.help('확정') + '</legend>' +
      '<label class="choice"><input type="radio" name="status" value="잠정"' + (status === '잠정' ? ' checked' : '') + '>잠정 — 달이 끝나지 않았거나 확인 전</label>' +
      '<label class="choice"><input type="radio" name="status" value="확정"' + (status === '확정' ? ' checked' : '') + '>확정 — 이 달 합계를 확인함</label></fieldset>' +
      '<p class="small muted">같은 달·같은 항목을 다시 저장하면 값을 바꿔 씁니다(더하지 않아요). 비워 두면 기록 없음, 0은 0원 실행이에요.</p>' +
      '<button class="btn btn-primary btn-block" type="submit">' + ui.esc(month) + ' 기록 저장</button></form>';
  }

  function scheduled(c) {
    var list = c.state.scheduledPayments || [];
    var rows = list.length
      ? '<ul class="rows">' + list.map(function (p, i) {
        return '<li><div class="row-main"><div class="t">' + ui.esc(p.name) + '</div><div class="s">' + ui.esc(p.kind) + ' · ' + (p.spendMonth ? ui.esc(p.spendMonth) + ' 지출분' : '지출 달 미지정') + '</div></div>' +
          '<div class="row-side">' + ui.money(p.amount) + '<br><button class="link-btn small" data-action="remove-scheduled" data-index="' + i + '" aria-label="' + ui.esc(p.name) + ' 삭제">삭제</button></div></li>';
      }).join('') + '</ul>'
      : '<p class="muted">등록된 예정 결제가 없어요.</p>';
    return rows + '<p class="small muted">예정 결제는 예측용이에요. 실제로 낸 뒤 위 기록에 입력해야 실적이 됩니다(두 번 세지 않도록).</p>' +
      ui.fold('예정 결제 추가', '<form data-submit="add-scheduled">' +
        '<div class="field"><label for="sp-name">이름</label><input id="sp-name" name="name" type="text" placeholder="예: 11월 카드대금" required></div>' +
        '<div class="grid-2"><div class="field"><label for="sp-amt">금액(만원)</label><input id="sp-amt" name="amount" type="number" min="0" step="0.1" required></div>' +
        '<div class="field"><label for="sp-kind">구분</label><select id="sp-kind" name="kind"><option>선택</option><option>필수</option></select></div></div>' +
        '<div class="field"><label for="sp-month">어느 달 지출분인가요?</label><input id="sp-month" name="spendMonth" type="month" value="' + ui.esc(c.d.month) + '"></div>' +
        '<button class="btn btn-block" type="submit">추가</button></form>');
  }

  function csvSection(c, month) {
    var tx = c.view.tx;
    var head = '<p class="small muted">형식: 날짜,금액(원),적요,보낸계좌,받은계좌. 계좌번호는 끝 4자리만 남기고, 본인 계좌끼리 옮긴 돈은 소득·지출로 세지 않아요. 분류는 직접 확인해 주세요. 불러온 거래는 이 화면에서만 쓰고 저장하지 않아요.</p>' +
      '<div class="field"><label for="own-acc">본인 계좌 끝 4자리(쉼표로 구분)</label><input id="own-acc" type="text" inputmode="numeric" value="' + ui.esc((c.state.customer.ownAccounts || []).join(', ')) + '" data-change="own-accounts" placeholder="예: 1111, 2222"></div>' +
      '<div class="btn-row"><label class="btn" for="csv-file">CSV 파일 고르기</label><input id="csv-file" class="sr-only" type="file" accept=".csv,text/csv" data-change="csv-file">' +
      '<button class="btn" data-action="csv-demo">시연용 거래 불러오기</button></div>';
    if (!tx) return head;
    var cats = P.csv.CATEGORIES;
    var monthRows = tx.rows.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { return x.r.month === month; });
    var list = monthRows.length ? '<ul class="rows">' + monthRows.map(function (x) {
      var r = x.r;
      var opts = Object.keys(cats).map(function (k) { return '<option value="' + k + '"' + (r.category === k ? ' selected' : '') + '>' + cats[k] + '</option>'; }).join('');
      return '<li style="flex-wrap:wrap"><div class="row-main" style="flex:1 1 60%"><div class="t">' + ui.esc(r.memo || '(적요 없음)') + '</div>' +
        '<div class="s">' + ui.esc(r.date) + ' · ' + (r.from4 ? '…' + ui.esc(r.from4) : '?') + ' → ' + (r.to4 ? '…' + ui.esc(r.to4) : '?') + '</div></div>' +
        '<div class="row-side">' + ui.money(r.amount) + '</div>' +
        '<div style="flex:1 1 100%;display:flex;gap:8px;align-items:center"><select aria-label="' + ui.esc(r.memo) + ' 분류" data-change="tx-cat" data-index="' + x.i + '">' + opts + '</select>' +
        '<label class="choice" style="white-space:nowrap"><input type="checkbox" data-change="tx-ok" data-index="' + x.i + '"' + (r.confirmed ? ' checked' : '') + '>확인</label></div></li>';
    }).join('') + '</ul>' : '<p class="muted">' + ui.esc(month) + ' 거래가 없어요. 위에서 다른 달을 골라 보세요.</p>';
    var sum = P.csv.summarize(tx.rows, month);
    var keys = Object.keys(sum);
    return head + (tx.errors.length ? '<p class="notice warn">' + ui.esc(tx.errors.join(' ')) + '</p>' : '') +
      '<p class="small"><strong>' + ui.esc(month) + '</strong> 거래 ' + monthRows.length + '건</p>' + list +
      '<div class="btn-row"><button class="btn btn-sm" data-action="tx-all" data-month="' + ui.esc(month) + '">이 달 거래 모두 확인</button></div>' +
      (keys.length ? '<p class="small">확인한 거래 합계: ' + keys.map(function (k) { return St.RECORD_ITEMS[k] + ' ' + fmt.num1(sum[k]); }).join(', ') + '</p>' +
        '<button class="btn btn-primary btn-block" data-action="tx-apply" data-month="' + ui.esc(month) + '">' + ui.esc(month) + ' 기록에 반영(해당 항목 값을 바꿔 씀)</button>' : '<p class="small muted">확인한 거래가 아직 없어요.</p>');
  }

  ui.screens.record = function (c) {
    var list = months(c);
    var month = c.view.recordMonth && list.indexOf(c.view.recordMonth) >= 0 ? c.view.recordMonth : c.d.month;
    var rec = St.getRecord(c.state, month);
    return '<section class="card"><div class="card-head"><h2>이번 달 기록</h2>' + (rec ? ui.badge(rec.status || '확정') : ui.badge('아직 확인 안 됨')) + '</div>' +
      '<div class="field"><label for="rec-month">기록할 달</label><select id="rec-month" data-change="record-month">' +
      list.map(function (m) { return '<option value="' + m + '"' + (m === month ? ' selected' : '') + '>' + ui.ymText(m) + (St.getRecord(c.state, m) ? ' · 기록 있음' : '') + '</option>'; }).join('') +
      '</select></div>' + recordForm(c, month) + '</section>' +
      '<section class="card"><h2>예정 결제</h2>' + scheduled(c) + '</section>' +
      '<section class="card"><h2>거래내역으로 채우기</h2>' + csvSection(c, month) + '</section>';
  };

  function currentMonth(c) {
    var sel = document.getElementById('rec-month');
    return sel ? sel.value : c.d.month;
  }

  Object.assign(ui.actions, {
    'record-month': function (c, el) { ui.setView({ recordMonth: el.value }, true); },

    'save-record': function (c, form, fd) {
      var month = fd.get('month');
      var status = fd.get('status') || '잠정';
      var s = c.state;
      var before = St.getRecord(s, month) || {};
      var changed = 0;
      ITEMS.forEach(function (k) {
        var raw = String(fd.get(k) || '').trim();
        var prev = before[k] === undefined ? '' : String(before[k]);
        if (raw === prev || (raw !== '' && prev !== '' && Number(raw) === Number(prev))) return;
        s = St.upsertRecord(s, month, k, raw === '' ? '' : Number(raw), { status: status });
        changed++;
      });
      var rec = St.getRecord(s, month);
      if (rec && rec.status !== status) { s = St.setRecordStatus(s, month, status); changed++; }
      if (!changed) { ui.toast('바뀐 내용이 없어요.'); return; }
      app().view.recordMonth = month;
      ui.commit(s, ui.ymText(month) + ' 기록을 저장했어요.');
    },

    'add-scheduled': function (c, form, fd) {
      var s = St.addScheduledPayment(c.state, { name: fd.get('name'), amount: Number(fd.get('amount')), kind: fd.get('kind'), spendMonth: fd.get('spendMonth') });
      ui.commit(s, '예정 결제를 등록했어요.');
    },
    'remove-scheduled': function (c, el) {
      ui.commit(St.removeScheduledPayment(c.state, Number(el.getAttribute('data-index'))), '예정 결제를 삭제했어요.');
    },

    'own-accounts': function (c, el) {
      var list = el.value.split(/[,\s]+/).map(P.csv.last4).filter(Boolean);
      var r = St.updateCustomer(c.state, { ownAccounts: list }, '고객', { ownAccounts: '본인 계좌 끝 4자리' });
      if (r.changed.length) ui.commit(r.state, '본인 계좌를 저장했어요.');
    },
    'csv-file': function (c, el) {
      var f = el.files && el.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var res = P.csv.parseTransactions(String(reader.result), c.state.customer.ownAccounts || []);
        var first = res.rows[0];
        ui.setView({ tx: res, recordMonth: first ? first.month : c.view.recordMonth }, true);
        ui.toast('거래 ' + res.rows.length + '건을 불러왔어요. 분류를 확인해 주세요.');
      };
      reader.onerror = function () { ui.toast('파일을 읽지 못했어요. 다시 시도해 주세요.'); };
      reader.readAsText(f, 'utf-8');
    },
    'csv-demo': function (c) {
      var res = P.csv.parseTransactions(P.csv.DEMO_CSV, P.csv.DEMO_OWN);
      ui.setView({ tx: res, recordMonth: res.rows.length ? res.rows[0].month : c.view.recordMonth }, true);
      ui.toast('시연용 거래 ' + res.rows.length + '건을 불러왔어요(본인 계좌 1111·2222·3333).');
    },
    'tx-cat': function (c, el) {
      c.view.tx.rows[Number(el.getAttribute('data-index'))].category = el.value;
      ui.setView({}, true);
    },
    'tx-ok': function (c, el) {
      c.view.tx.rows[Number(el.getAttribute('data-index'))].confirmed = el.checked;
      ui.setView({}, true);
    },
    'tx-all': function (c, el) {
      var m = el.getAttribute('data-month');
      c.view.tx.rows.forEach(function (r) { if (r.month === m) r.confirmed = true; });
      ui.setView({}, true);
    },
    'tx-apply': function (c, el) {
      var m = el.getAttribute('data-month') || currentMonth(c);
      var sum = P.csv.summarize(c.view.tx.rows, m);
      var s = c.state;
      Object.keys(sum).forEach(function (k) { s = St.upsertRecord(s, m, k, sum[k], { status: (St.getRecord(s, m) || {}).status || '잠정' }); });
      ui.commit(s, ui.ymText(m) + ' 기록에 거래 합계를 반영했어요(' + Object.keys(sum).length + '개 항목).');
    }
  });

  function app() { return ui.app; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
