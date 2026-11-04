/*
 * 시연 모드 데이터 (DB가 비어 있고 시연 모드가 켜져 있을 때 한 번)
 * ------------------------------------------------------------
 * - 모든 시연 계정과 고객은 demo=1로 표시되고, 화면에 '시연 모드 · 가상 데이터'로 표시됩니다.
 * - 비밀번호: FP_DEMO_PASSWORD(기본 1234). 실제 운영에서는 FP_DEMO=0으로 끄고 관리자 기능으로 계정을 만듭니다.
 * - 권한 분리 확인용 '다른 고객'(other@demo.kr)은 만들지만 로그인 화면 버튼은 없습니다.
 * - 이전 버전의 '미배정 설계사'(planner2@demo.kr) 계정은 만들지 않으며, 기존 DB에 있으면 비활성화합니다.
 */
'use strict';
const { hashPassword } = require('./auth');
const Sample = require('../public/js/data/sampleCase.js');
const CD = require('../public/js/engine/clientData.js');

async function retireOldDemo(db) {
  // 이전 버전에서 만든 미배정 시연 설계사: 로그인·세션 차단, 배정 해제
  const u = await db.get("SELECT id FROM users WHERE email = 'planner2@demo.kr'");
  if (u) {
    await db.run('UPDATE users SET disabled = 1, demo = 1 WHERE id = ?', u.id);
    await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    await db.run('DELETE FROM assignments WHERE planner_id = ?', u.id);
  }
  await db.run("UPDATE users SET demo = 1 WHERE email LIKE '%@demo.kr'");
}

async function seed(db, opts) {
  opts = opts || {};
  await retireOldDemo(db);
  const n = Number((await db.get('SELECT COUNT(*) AS n FROM users')).n);
  if (n > 0 || opts.demo === false) return null;
  const pw = opts.password || process.env.FP_DEMO_PASSWORD || '1234';
  const now = new Date().toISOString();
  return db.tx(async (t) => {
    const addUser = async (email, name, role) => (await t.run('INSERT INTO users (email, name, role, pw_hash, created_at, demo) VALUES (?,?,?,?,?,1)', email, name, role, hashPassword(pw), now)).id;
    const planner = await addUser('planner@demo.kr', '박설계(시연)', 'planner');
    const clientUser = await addUser('client@demo.kr', '김하늘(가상)', 'client');
    const otherUser = await addUser('other@demo.kr', '이다른(가상)', 'client');

    const addClient = async (uid, profile) => (await t.run('INSERT INTO clients (user_id, profile, created_at) VALUES (?,?,?)', uid, JSON.stringify(profile), now)).id;
    const c1 = await addClient(clientUser, Sample.PROFILE);
    const c2 = await addClient(otherUser, Object.assign({}, Sample.PROFILE, { name: '이다른(가상)', annualGross: 33000000 }));
    await t.run('INSERT INTO assignments (planner_id, client_id, granted_at) VALUES (?,?,?)', planner, c1, now);
    // c2는 배정된 설계사가 없음(다른 고객 정보가 섞이지 않는지 확인용)

    const addPlan = (cid, kind, v, label, note, data, by, at, dv) => t.run('INSERT INTO plans (client_id, kind, version, label, note, data, created_by, created_at, data_version) VALUES (?,?,?,?,?,?,?,?,?)', cid, kind, v, label, note, JSON.stringify(data), by, at, dv);
    await addPlan(c1, 'before', 1, '설계 전 진단', '현재 소비·상환 습관을 유지하는 경우', Sample.BEFORE, planner, '2026-08-20T10:00:00.000Z', 1);
    const after1 = (await addPlan(c1, 'after', 1, '설계 후 1차 수정안', '선택지출 22만원·필수 5만원 절감, 월 15만원 추가 상환, 청년미래적금(일반형) 월 30만원, 이사월 2029-12', Sample.AFTER, planner, '2026-08-27T10:00:00.000Z', 1)).id;
    await addPlan(c2, 'before', 1, '설계 전 진단', '다른 고객(권한 분리 확인용)', Sample.BEFORE, planner, now, null);

    // 고객 입력 정보(client_data v1): 설계 전 진단 시점에 고객이 입력한 사실 정보(가상)
    const cd = CD.fromPlan(Sample.BEFORE, Sample.PROFILE); cd.goal.moveMonth = Sample.AFTER.basis.moveMonth; // 1차 상담에서 합의한 목표월
    const fv = {}; CD.FIELDS.forEach((f) => { fv[f.path] = 1; }); Object.keys(CD.LISTS).forEach((k) => { fv[k] = 1; });
    await t.run('INSERT INTO client_data (client_id, data, version, field_versions, updated_at, updated_by) VALUES (?,?,?,?,?,?)', c1, JSON.stringify(cd), 1, JSON.stringify(fv), '2026-08-19T10:00:00.000Z', clientUser);
    await t.run('INSERT INTO changes (client_id, actor_id, actor_role, entity, version, summary, at) VALUES (?,?,?,?,?,?,?)', c1, clientUser, 'client', 'client_data', 1, JSON.stringify({ items: [], text: '시연 데이터: 최초 입력', audience: 'all' }), '2026-08-19T10:00:00.000Z');

    // 실행 기록: 2026-09·10 확정, 2026-11 일부
    const rec = (cid, month, cat, amt, note) => t.run('INSERT INTO records (client_id, month, category, amount, source, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', cid, month, cat, amt, 'manual', note || null, clientUser, now);
    await rec(c1, '2026-09', 'debt', 650000);
    await rec(c1, '2026-09', 'emergency', 500000, '계획보다 7만원 적게 적립');
    await rec(c1, '2026-09', 'expense:essential', 1300000);
    await rec(c1, '2026-09', 'expense:optional', 420000);
    await rec(c1, '2026-10', 'debt', 650000);
    await rec(c1, '2026-10', 'expense:essential', 1320000, '관리비·병원비');
    await rec(c1, '2026-10', 'expense:optional', 610000, '경조사 2건');
    await rec(c1, '2026-11', 'debt', 650000, '자동이체');
    await rec(c1, '2026-11', 'expense:optional', 180000, '월중 기록');
    await t.run('INSERT INTO month_closures (client_id, month, closed_at, closed_by) VALUES (?,?,?,?)', c1, '2026-09', '2026-10-02T09:00:00.000Z', 'client');
    await t.run('INSERT INTO month_closures (client_id, month, closed_at, closed_by) VALUES (?,?,?,?)', c1, '2026-10', '2026-11-02T09:00:00.000Z', 'client');
    await t.run('INSERT INTO scheduled (client_id, month, label, amount, category, kind, paid, created_at) VALUES (?,?,?,?,?,?,0,?)', c1, '2026-11', '10월 카드대금(미결제)', 420000, 'optional', 'card', now);
    await t.run('INSERT INTO scheduled (client_id, month, label, amount, category, kind, paid, created_at) VALUES (?,?,?,?,?,?,0,?)', c1, '2026-11', '월세·관리비', 650000, 'essential', 'fixed', now);
    // 설계 후 v1: 설계사가 제시 → 고객이 확인(2026-08-28)해 실행 기준
    await t.run('INSERT INTO plan_offers (client_id, plan_id, status, note, created_by, created_at, decided_at) VALUES (?,?,?,?,?,?,?)', c1, after1, 'accepted', '1차 상담 결과', planner, '2026-08-27T11:00:00.000Z', '2026-08-28T10:00:00.000Z');
    await t.run('INSERT INTO baselines (client_id, plan_id, set_by, set_at, reason) VALUES (?,?,?,?,?)', c1, after1, clientUser, '2026-08-28T10:00:00.000Z', '고객 확인');
    await t.run('INSERT INTO risk_profiles (client_id, kind, type, type_id, diagnosed_at, source, purpose, snapshot, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      c1, 'official', '위험중립형', 3, '2024-05-10', 'OO은행 투자자정보확인서(가상)', '목돈 운용(펀드 가입)', JSON.stringify({ netMonthly: 2600000, totalDebt: 28000000, purpose: '목돈 운용(펀드 가입)' }), planner, now);
    const acc = (cid, label, masked, purpose) => t.run('INSERT INTO accounts (client_id, label, masked, purpose, created_at) VALUES (?,?,?,?,?)', cid, label, masked, purpose, now);
    await acc(c1, '급여 통장', '****1001', 'salary');
    await acc(c1, '주거자금 통장', '****2002', 'housing');
    await acc(c1, '비상금 통장', '****3003', 'emergency');
    await t.run('INSERT INTO settings (client_id, data, updated_at) VALUES (?,?,?)', c1, JSON.stringify({ dueDay: 25, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 3, staleDays: 7 }), now);
    return { password: pw, planner: 'planner@demo.kr', client: 'client@demo.kr', other: 'other@demo.kr', c1, c2 };
  });
}

module.exports = { seed, retireOldDemo };
