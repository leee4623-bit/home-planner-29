// 관리 화면: /api/admin/* 를 Authorization: Bearer <FP_ADMIN_TOKEN>으로 호출(토큰은 메모리에만)
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function call(method, op, body) {
    var tok = $('tok').value.trim(); if (!tok) { show({ error: '관리자 토큰을 입력해 주세요.' }); return; }
    fetch('/api/admin/' + op, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { show(r.ok ? j : { error: j.error || ('실패 ' + r.status) }); }); }, function () { show({ error: '서버에 연결할 수 없습니다.' }); });
  }
  function show(j) {
    if (j && j.users) { $('out').textContent = j.users.map(function (u) { return (u.disabled ? '[중지] ' : '') + (u.demo ? '[시연] ' : '') + u.email + ' · ' + u.name + ' · ' + (u.role === 'planner' ? '설계사' : '고객') + (u.clientId ? ' (고객번호 ' + u.clientId + ')' : ''); }).join('\n') + '\n\n담당 배정:\n' + (j.assignments.map(function (a) { return a.planner + ' → 고객번호 ' + a.clientId; }).join('\n') || '없음'); return; }
    $('out').textContent = j.error ? '오류: ' + j.error : '완료: ' + JSON.stringify(j);
  }
  $('listBtn').onclick = function () { call('GET', 'list'); };
  $('addBtn').onclick = function () { call('POST', 'users', { email: $('nEmail').value, name: $('nName').value, role: $('nRole').value, password: $('nPw').value }); $('nPw').value = ''; };
  $('asgBtn').onclick = function () { call('POST', 'assign', { planner: $('aPl').value, client: $('aCl').value }); };
  $('unBtn').onclick = function () { call('POST', 'unassign', { planner: $('aPl').value, client: $('aCl').value }); };
  $('disBtn').onclick = function () { call('POST', 'disable', { email: $('dEmail').value, disabled: true }); };
  $('enBtn').onclick = function () { call('POST', 'disable', { email: $('dEmail').value, disabled: false }); };
})();
