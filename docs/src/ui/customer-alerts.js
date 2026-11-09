/* 알림함: 같은 상황의 알림은 한 번만, 수정안은 알림 하나에만 연결. 알림 설정·방해금지 시간. */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var St = P.store;

  var TYPE_LABEL = {
    overspend: '생활비 초과',
    missedPayment: '약정 납입 미달',
    cumulativeShortfall: '저축 누적 미달',
    emergencyLow: '비상금 부족'
  };

  function settingsCard(c) {
    var n = (c.state.settings && c.state.settings.notify) || {};
    var types = n.types || {};
    var q = n.quiet || { enabled: false, start: '22:00', end: '08:00' };
    return '<section class="card" aria-labelledby="ns-h"><h2 id="ns-h">알림 설정</h2><form data-submit="save-notify">' +
      '<fieldset><legend>받을 알림</legend>' + Object.keys(TYPE_LABEL).map(function (k) {
        return '<label class="choice"><input type="checkbox" name="type-' + k + '"' + (types[k] !== false ? ' checked' : '') + '>' + TYPE_LABEL[k] + '</label>';
      }).join('') + '</fieldset>' +
      '<fieldset><legend>방해금지 시간</legend><label class="choice"><input type="checkbox" name="quiet"' + (q.enabled ? ' checked' : '') + '>이 시간에는 화면 알림을 띄우지 않기</label>' +
      '<div class="grid-2"><div class="field"><label for="q-s">시작</label><input id="q-s" name="start" type="time" value="' + ui.esc(q.start) + '"></div>' +
      '<div class="field"><label for="q-e">끝</label><input id="q-e" name="end" type="time" value="' + ui.esc(q.end) + '"></div></div></fieldset>' +
      '<p class="small muted">이 앱은 서버가 없어 휴대폰 푸시를 보내지 않아요. 앱을 열면 알림함에 쌓여 있어요. 알림을 꺼도 알림함 기록은 남아요.</p>' +
      '<button class="btn btn-block" type="submit">저장</button></form></section>';
  }

  ui.screens.alerts = function (c) {
    var list = (c.state.alerts || []).slice();
    var rank = { '새 알림': 0, '읽음': 1, '해소': 2 };
    list.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || (a.createdAt < b.createdAt ? 1 : -1); });
    var active = list.filter(function (a) { return a.status !== '해소'; });
    var resolved = list.filter(function (a) { return a.status === '해소'; });
    var item = function (a) {
      var prop = a.proposalId ? St.findProposal(c.state, a.proposalId) : null;
      return '<li style="display:block"><div class="option-head"><div class="t"><strong>' + ui.esc(a.title) + '</strong></div>' + ui.badge(a.severity) + '</div>' +
        '<p class="small">' + ui.esc(a.message) + '</p>' +
        '<div class="small muted">' + ui.esc(TYPE_LABEL[a.type] || '') + ' · ' + ui.esc(a.createdAt || '') + ' · ' + ui.badge(a.status) + '</div>' +
        '<div class="btn-row">' +
        (prop && prop.status !== '적용됨' ? '<button class="btn btn-sm btn-primary" data-action="alert-open" data-id="' + ui.esc(a.id) + '">연결된 수정안 보기</button>' : '') +
        (prop && prop.status === '적용됨' ? ui.badge('수정안 적용됨', 'ok') : '') +
        (a.type === 'cumulativeShortfall' || a.type === 'missedPayment' ? '<button class="btn btn-sm" data-action="alert-record" data-id="' + ui.esc(a.id) + '">기록 확인하기</button>' : '') +
        (a.status === '새 알림' ? '<button class="btn btn-sm" data-action="alert-read" data-id="' + ui.esc(a.id) + '">읽음으로 표시</button>' : '') +
        '</div></li>';
    };
    return '<section class="card" aria-labelledby="al-h"><div class="card-head"><h2 id="al-h">알림함</h2>' +
      (c.d.newAlerts ? ui.badge('새 알림 ' + c.d.newAlerts + '건', '새 알림') : '') + '</div>' +
      (active.length ? '<ul class="rows">' + active.map(item).join('') + '</ul>' : ui.empty('지금 확인할 알림이 없어요.')) +
      (resolved.length ? ui.fold('해소된 알림 ' + resolved.length + '건', '<ul class="rows">' + resolved.map(item).join('') + '</ul>') : '') +
      '<p class="small muted">같은 상황의 알림은 한 번만 만들고, 상황이 사라지면 해소로 옮겨요.</p></section>' + settingsCard(c);
  };

  Object.assign(ui.actions, {
    'alert-read': function (c, el) { ui.commit(P.alerts.markRead(c.state, el.getAttribute('data-id'))); },
    'alert-open': function (c, el) {
      var s = P.alerts.markRead(c.state, el.getAttribute('data-id'));
      ui.app.state = s;
      ui.app.store.save(s);
      ui.app.d = null;
      ui.setView({ tab: 'plan' });
    },
    'alert-record': function (c, el) {
      var a = (c.state.alerts || []).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
      var s = P.alerts.markRead(c.state, a.id);
      ui.app.state = s;
      ui.app.store.save(s);
      ui.app.d = null;
      var m = a.data && a.data.missingMonths && a.data.missingMonths[0] || a.month;
      ui.setView({ tab: 'record', recordMonth: m });
    },
    'save-notify': function (c, form, fd) {
      var types = {};
      ['overspend', 'missedPayment', 'cumulativeShortfall', 'emergencyLow'].forEach(function (k) { types[k] = fd.get('type-' + k) === 'on'; });
      var notify = { types: types, quiet: { enabled: fd.get('quiet') === 'on', start: fd.get('start') || '22:00', end: fd.get('end') || '08:00' } };
      ui.commit(St.updateSettings(c.state, { notify: notify }, '고객', '알림 설정'), '알림 설정을 저장했어요.');
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
