// 저장·기록·버전·제안 적용 테스트(명세 7절 C3·C4 포함).
const test = require('node:test');
const assert = require('node:assert/strict');
const St = require('../src/store.js');
const engine = require('../src/engine.js');
const tracking = require('../src/tracking.js');
const demo = require('../data/demo.js');

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
function brokenStorage() {
  const err = () => { throw new Error('QuotaExceededError'); };
  return { getItem: err, setItem: err, removeItem: err };
}

test('C3: 같은 달·같은 항목을 두 번 저장해도 실적이 두 배가 되지 않는다', () => {
  let s = demo.getLegacyDemo();
  s = St.upsertRecord(s, '2026-12', 'optional', 30);
  s = St.upsertRecord(s, '2026-12', 'optional', 30);
  assert.equal(St.getRecord(s, '2026-12').optional, 30);
  s = St.upsertRecord(s, '2026-12', 'optional', 25); // 수정은 대체
  assert.equal(St.getRecord(s, '2026-12').optional, 25);
  assert.equal(s.records.filter((r) => r.month === '2026-12').length, 1);
  // 계획 대비 실제에서도 한 번만 반영
  const m = tracking.monthStatus(s, '2026-12');
  assert.equal(m.items.find((i) => i.item === 'optional').actual, 25);
});

test('C3: 기존 달(2026-09) 항목을 다시 저장하면 대체된다', () => {
  let s = demo.getLegacyDemo();
  s = St.upsertRecord(s, '2026-09', 'debt', 65);
  assert.equal(St.getRecord(s, '2026-09').debt, 65);
});

test('빈 값은 기록 없음, 0은 0원 실행', () => {
  let s = demo.getLegacyDemo();
  s = St.upsertRecord(s, '2026-12', 'emergency', 0);
  assert.equal(St.getRecord(s, '2026-12').emergency, 0);
  s = St.upsertRecord(s, '2026-12', 'emergency', '');
  assert.equal(St.getRecord(s, '2026-12'), null); // 항목이 없으면 그 달 기록도 없음
  assert.throws(() => St.upsertRecord(s, '2026-12', 'emergency', -5), /0 이상/);
  assert.throws(() => St.upsertRecord(s, '2026-12', 'unknown', 5), /항목/);
});

test('기록 변경은 받은 상태를 바꾸지 않고 변경 이력을 남긴다', () => {
  const s = demo.getLegacyDemo();
  const before = JSON.stringify(s);
  const s2 = St.upsertRecord(s, '2026-11', 'essential', 128, { status: '확정' });
  assert.equal(JSON.stringify(s), before);
  const last = s2.changeLog.at(-1);
  assert.equal(last.who, '고객');
  assert.match(last.what, /2026-11 필수 지출 기록 입력/);
  assert.equal(St.getRecord(s2, '2026-11').status, '확정');
});

test('C4: 수정안을 적용하면 새 버전이 생기고 이전 버전과 기록은 그대로 남는다', () => {
  const s = demo.getLegacyDemo();
  const plansBefore = JSON.stringify(s.plans);
  const recordsBefore = JSON.stringify(s.records);
  const { state: s2, planId } = St.applyProposal(s, 'rev-overspend-2026-10');
  assert.equal(planId, 'after-v2');
  assert.equal(s2.plans.length, s.plans.length + 1);
  assert.equal(JSON.stringify(s2.plans.slice(0, s.plans.length)), plansBefore);
  assert.equal(JSON.stringify(s2.records), recordsBefore);
  assert.equal(s2.activePlanId, 'after-v2');
  const v2 = St.findPlan(s2, 'after-v2');
  assert.equal(v2.parentId, 'after-v1');
  assert.equal(v2.selectedBy, '고객');
  assert.equal(St.findProposal(s2, 'rev-overspend-2026-10').status, '적용됨');
  assert.throws(() => St.applyProposal(s2, 'rev-overspend-2026-10'), /이미 적용/);
  // 이전 버전으로 계산하면 결과가 그대로
  assert.equal(engine.runPlan(s2, 'after-v1').judgement.label, engine.runPlan(s, 'after-v1').judgement.label);
});

test('C4: A/B/C 중 하나를 고르면 그 안으로 새 버전, 목표 변경은 그 버전에만', () => {
  const s = demo.getLegacyDemo();
  assert.throws(() => St.applyProposal(s, 'abc-2026-11'), /골라/);
  const { state: s2, planId } = St.applyProposal(s, 'abc-2026-11', { optionKey: 'C' });
  const v = St.findPlan(s2, planId);
  assert.equal(v.goal.depositTarget, 4770);
  assert.equal(s2.customer.goal.depositTarget, 5000);         // 고객 목표는 그대로
  assert.equal(engine.runPlan(s2, planId).judgement.status, '전체 목표 달성');
  assert.equal(engine.runPlan(s2, 'after-v1').judgement.status, '미달'); // 이전 버전 판정 그대로
  assert.equal(St.findProposal(s2, 'abc-2026-11').chosenKey, 'C');
});

test('버전 번호는 덮어쓰지 않고 쌓인다', () => {
  let s = demo.getLegacyDemo();
  s = St.createPlanVersion(s, 'after-v1', { optional: 35 }, null, { name: '선택 35' }).state;
  s = St.createPlanVersion(s, 'after-v1', { optional: 33 }, null, { name: '선택 33' }).state;
  s = St.createPlanVersion(s, 'before-v1', {}, null, {}).state;
  assert.deepEqual(s.plans.map((p) => p.id), ['before-v1', 'after-v1', 'after-v2', 'after-v3', 'before-v2']);
  assert.equal(s.activePlanId, 'after-v1'); // 만들기만 하고 실행 기준은 고객이 선택
});

test('보류하면 상태만 바뀌고 계획은 그대로', () => {
  const s = St.holdProposal(demo.getLegacyDemo(), 'rev-overspend-2026-10');
  assert.equal(St.findProposal(s, 'rev-overspend-2026-10').status, '보류');
  assert.equal(s.activePlanId, 'after-v1');
});

test('저장소: 첫 방문이면 빈 상태(고객정보 입력부터), 저장 후 다시 읽으면 같은 상태', () => {
  const st = St.createStore(memStorage());
  const first = st.load();
  assert.equal(first.source, 'empty');
  assert.equal(first.firstVisit, true);
  assert.equal(first.state, null);
  const s2 = St.upsertRecord(demo.getDemo(), '2026-12', 'debt', 65);
  assert.deepEqual(st.save(s2), { ok: true, mode: 'storage' });
  const again = st.load();
  assert.equal(again.source, 'saved');
  assert.equal(St.getRecord(again.state, '2026-12').debt, 65);
  const reset = st.reset();
  assert.equal(St.getRecord(reset, '2026-12'), null);
});

test('저장소: 읽기·쓰기가 실패하면 메모리 모드로 계속 동작', () => {
  const st = St.createStore(brokenStorage());
  const { state } = st.load();
  assert.equal(st.mode, 'memory');
  assert.equal(state, null);
  const s2 = St.upsertRecord(demo.getDemo(), '2026-12', 'debt', 65);
  const saved = st.save(s2);
  assert.equal(saved.mode, 'memory');
  assert.equal(saved.ok, false); // 저장 실패를 성공으로 알리지 않는다
  assert.equal(St.getRecord(st.load().state, '2026-12').debt, 65);
  const none = St.createStore(null);
  assert.equal(none.mode, 'memory');
  assert.equal(none.load().source, 'empty');
  assert.equal(none.save(s2).ok, false);
});

test('저장소: 깨진 저장값은 지우지 않고 백업한 뒤 입력 화면부터 연다', () => {
  const m = memStorage();
  m.setItem(St.STORAGE_KEY, '{망가진');
  const r = St.createStore(m).load();
  assert.equal(r.source, 'empty');
  assert.equal(r.corrupt, true);
  assert.equal(m.getItem(St.BACKUP_KEY), '{망가진');
  assert.equal(m.getItem(St.STORAGE_KEY), '{망가진'); // 원본도 그대로
  m.setItem(St.STORAGE_KEY, JSON.stringify({ customer: {}, plans: [] }));
  assert.equal(St.createStore(m).load().source, 'empty');
});

test('저장소: 예전 저장본(입력 완료 표시 없음)은 자동 삭제 없이 이어서 쓴다', () => {
  const m = memStorage();
  const old = demo.getLegacyDemo();
  delete old.intake;
  m.setItem(St.STORAGE_KEY, JSON.stringify(old));
  const r = St.createStore(m).load();
  assert.equal(r.source, 'saved');
  assert.equal(r.state.intake.done, true);
  assert.equal(r.state.customer.name, old.customer.name);
});

test('내보내기·불러오기 왕복, 잘못된 파일은 사람이 읽을 수 있는 오류', () => {
  const s = St.upsertRecord(demo.getLegacyDemo(), '2026-12', 'debt', 65);
  const back = St.importJSON(St.exportJSON(s));
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.records, s.records);
  assert.equal(St.importJSON('not json').ok, false);
  assert.match(St.importJSON('not json').errors[0], /JSON/);
  const bad = St.importJSON(JSON.stringify({ customer: {}, plans: [{ id: 'x', startMonth: '2026', targetMonth: '2029-12' }] }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /형식/);
});

test('마이그레이션: 상태가 없던 기록은 확정, 빠진 목록은 빈 배열', () => {
  const s = demo.getLegacyDemo();
  delete s.records[0].status;
  delete s.alerts;
  const m = St.migrate(s);
  assert.equal(m.records[0].status, '확정');
  assert.deepEqual(m.alerts, []);
});

test('자동 적용 동의는 고객 이력으로 남는다', () => {
  const s = St.setAutoApplyConsent(demo.getLegacyDemo(), { enabled: true, monthlyLimit: 10 });
  assert.equal(s.autoApplyConsent.enabled, true);
  assert.equal(s.autoApplyConsent.agreedAt, '2026-11-05');
  assert.match(s.changeLog.at(-1).what, /자동 적용 동의 켬/);
});

test('실행 기준이 바뀐 뒤 수정안을 적용하면 지금 실행 기준 위에 얹는다(이전 선택이 사라지지 않음)', () => {
  let s = demo.getLegacyDemo();
  const a = St.applyProposal(s, 'abc-2026-11', { optionKey: 'A' });           // after-v2: A안
  const r = St.applyProposal(a.state, 'rev-overspend-2026-10');               // after-v3
  const v3 = St.findPlan(r.state, r.planId);
  assert.equal(v3.parentId, 'after-v2');
  const adj = v3.budgetAdjustments;
  assert.equal(adj.length, 2);
  assert.equal(adj[0].optional, -6);                                         // A안 조정 유지
  assert.ok(Math.abs(adj[1].optional + 25 / 3) < 1e-9);                      // 수정안 조정 추가
  assert.equal(St.findProposal(r.state, 'rev-overspend-2026-10').rebasedFrom, 'after-v1');
});

test('목표 변경 버전(C안) 위에 수정안을 얹어도 목표 변경이 유지된다', () => {
  const c = St.applyProposal(demo.getLegacyDemo(), 'abc-2026-11', { optionKey: 'C' });
  const r = St.applyProposal(c.state, 'rev-overspend-2026-10');
  assert.equal(St.findPlan(r.state, r.planId).goal.depositTarget, 4770);
});

test('저장된 옛 시연 데이터는 덮어쓰지 않고 새 버전이 있다고 알린다', () => {
  const m = memStorage();
  const old = demo.getLegacyDemo();
  old.demoVersion = 1;
  old.records[0].optional = 99; // 사용자가 바꾼 값
  m.setItem(St.STORAGE_KEY, JSON.stringify(old));
  const r = St.createStore(m).load();
  assert.equal(r.staleDemo, true);
  assert.equal(r.state.records[0].optional, 99);
  m.setItem(St.STORAGE_KEY, JSON.stringify(demo.getDemo())); // 현재 시연 데이터는 최신
  assert.equal(St.createStore(m).load().staleDemo, false);
});
