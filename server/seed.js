/*
 * 시연용 데이터 넣기 (DB가 비어 있을 때 한 번)
 * 계정 비밀번호는 환경변수로 바꿀 수 있습니다: FP_DEMO_PASSWORD
 * 권한 분리 시연을 위해 '연결되지 않은 설계사'와 '다른 고객'도 만듭니다.
 */
'use strict';
const { hashPassword } = require('./auth');
const Sample = require('../public/js/data/sampleCase.js');

function seed(db, opts) {
  opts = opts || {};
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return null;
  const pw = opts.password || process.env.FP_DEMO_PASSWORD || '1234';
  const now = new Date().toISOString();
  const addUser = (email, name, role) => Number(db.prepare('INSERT INTO users (email, name, role, pw_hash, created_at) VALUES (?,?,?,?,?)').run(email, name, role, hashPassword(pw), now).lastInsertRowid);
  const planner = addUser('planner@demo.kr', '박설계(시연)', 'planner');
  const planner2 = addUser('planner2@demo.kr', '최설계(시연·미배정)', 'planner');
  const clientUser = addUser('client@demo.kr', '김하늘(가상)', 'client');
  const otherUser = addUser('other@demo.kr', '이다른(가상)', 'client');

  const addClient = (uid, profile) => Number(db.prepare('INSERT INTO clients (user_id, profile, created_at) VALUES (?,?,?)').run(uid, JSON.stringify(profile), now).lastInsertRowid);
  const c1 = addClient(clientUser, Sample.PROFILE);
  const c2 = addClient(otherUser, Object.assign({}, Sample.PROFILE, { name: '이다른(가상)', annualGross: 33000000 }));
  db.prepare('INSERT INTO assignments (planner_id, client_id, granted_at) VALUES (?,?,?)').run(planner, c1, now);
  db.prepare('INSERT INTO assignments (planner_id, client_id, granted_at) VALUES (?,?,?)').run(planner2, c2, now);

  const addPlan = (cid, kind, v, label, note, data, by, at) => db.prepare('INSERT INTO plans (client_id, kind, version, label, note, data, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(cid, kind, v, label, note, JSON.stringify(data), by, at);
  addPlan(c1, 'before', 1, '설계 전 진단', '현재 소비·상환 습관을 유지하는 경우', Sample.BEFORE, planner, '2026-08-20T10:00:00.000Z');
  addPlan(c1, 'after', 1, '설계 후 1차 수정안', '선택지출 22만원·필수 5만원 절감, 월 15만원 추가 상환, 청년미래적금(일반형) 월 30만원, 이사월 2029-12', Sample.AFTER, planner, '2026-08-27T10:00:00.000Z');
  addPlan(c2, 'before', 1, '설계 전 진단', '다른 고객(권한 분리 확인용)', Sample.BEFORE, planner2, now);

  // 실행 기록: 2026-09 기록, 2026-10 기록 없음(미확인), 2026-11 일부
  const rec = (cid, month, cat, amt, src, by, note) => db.prepare('INSERT INTO records (client_id, month, category, amount, source, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(cid, month, cat, amt, src, note || null, by, now);
  rec(c1, '2026-09', 'debt', 650000, 'manual', clientUser);
  rec(c1, '2026-09', 'emergency', 500000, 'manual', clientUser, '계획보다 7만원 적게 적립');
  rec(c1, '2026-09', 'expense:essential', 1300000, 'manual', clientUser);
  rec(c1, '2026-09', 'expense:optional', 420000, 'manual', clientUser);
  rec(c1, '2026-10', 'debt', 650000, 'manual', clientUser);
  rec(c1, '2026-10', 'expense:essential', 1320000, 'manual', clientUser, '관리비·병원비');
  rec(c1, '2026-10', 'expense:optional', 610000, 'manual', clientUser, '경조사 2건');
  rec(c1, '2026-11', 'debt', 650000, 'manual', clientUser, '자동이체');
  rec(c1, '2026-11', 'expense:optional', 180000, 'manual', clientUser, '월중 기록');
  // 월 확정: 9·10월은 고객이 확정
  db.prepare('INSERT INTO month_closures (client_id, month, closed_at, closed_by) VALUES (?,?,?,?)').run(c1, '2026-09', '2026-10-02T09:00:00.000Z', 'client');
  db.prepare('INSERT INTO month_closures (client_id, month, closed_at, closed_by) VALUES (?,?,?,?)').run(c1, '2026-10', '2026-11-02T09:00:00.000Z', 'client');
  // 이번 달 예정 결제(잠정 결과에 포함)
  db.prepare('INSERT INTO scheduled (client_id, month, label, amount, category, kind, paid, created_at) VALUES (?,?,?,?,?,?,0,?)').run(c1, '2026-11', '10월 카드대금(미결제)', 420000, 'optional', 'card', now);
  db.prepare('INSERT INTO scheduled (client_id, month, label, amount, category, kind, paid, created_at) VALUES (?,?,?,?,?,?,0,?)').run(c1, '2026-11', '월세·관리비', 650000, 'essential', 'fixed', now);
  // 실행 기준 계획: 고객이 설계 후 v1을 확인(2026-08-28)
  const after1 = db.prepare("SELECT id FROM plans WHERE client_id = ? AND kind = 'after' AND version = 1").get(c1).id;
  db.prepare('INSERT INTO baselines (client_id, plan_id, set_by, set_at, reason) VALUES (?,?,?,?,?)').run(c1, after1, clientUser, '2026-08-28T10:00:00.000Z', '고객 확인');
  // 금융기관 위험성향 결과(가상) — 앱 자체 설문과 별도 항목
  db.prepare('INSERT INTO risk_profiles (client_id, kind, type, type_id, diagnosed_at, source, purpose, snapshot, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(c1, 'official', '위험중립형', 3, '2024-05-10', 'OO은행 투자자정보확인서(가상)', '목돈 운용(펀드 가입)', JSON.stringify({ netMonthly: 2600000, totalDebt: 28000000, purpose: '목돈 운용(펀드 가입)' }), planner, now);

  // 본인 계좌 등록(계좌번호는 끝 4자리만 저장)
  const acc = (cid, label, masked, purpose) => db.prepare('INSERT INTO accounts (client_id, label, masked, purpose, created_at) VALUES (?,?,?,?,?)').run(cid, label, masked, purpose, now);
  acc(c1, '급여 통장', '****1001', 'salary');
  acc(c1, '주거자금 통장', '****2002', 'housing');
  acc(c1, '비상금 통장', '****3003', 'emergency');

  db.prepare('INSERT INTO settings (client_id, data, updated_at) VALUES (?,?,?)').run(c1, JSON.stringify({ dueDay: 25, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 3, staleDays: 7 }), now);
  return { password: pw, planner: 'planner@demo.kr', planner2: 'planner2@demo.kr', client: 'client@demo.kr', other: 'other@demo.kr' };
}

module.exports = { seed };
