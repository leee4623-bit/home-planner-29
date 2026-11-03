/*
 * API — 모든 고객 데이터 요청은 서버에서 권한을 검사합니다.
 * ------------------------------------------------------------
 * 설계사: 배정된 고객의 계획 조회·새 버전 저장, 실행 기록·거래내역 조회(수정 불가)
 * 고객  : 자기 계획 조회(수정 불가), 자기 실행 기록·계좌·거래내역·경보 설정 관리
 */
'use strict';
const auth = require('./auth');
const linking = require('./linking/provider');
const Calc = require('../public/js/engine/calc.js');
const Policies = require('../public/js/data/policies.js');

const CATEGORIES = /^(debt|emergency|housing|expense|expense:essential|expense:optional|income|product:[A-Za-z0-9_-]{1,20})$/;
const jobs = require('./jobs');
const rerun = (db, cid) => { try { jobs.evaluate(db, Number(cid)); } catch (e) { console.error('점검 오류:', e.message); } };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function need(cond, status, msg) { if (!cond) throw new HttpError(status, msg); }
function audit(db, user, action, target) { db.prepare('INSERT INTO audit (user_id, action, target, at) VALUES (?,?,?,?)').run(user ? user.id : null, action, target || null, new Date().toISOString()); }
function now() { return new Date().toISOString(); }
function money(v) { const n = Number(v); need(isFinite(n) && Math.abs(n) < 1e11, 400, '금액을 숫자로 입력해 주세요.'); return n; }

function validatePlan(d) {
  need(d && typeof d === 'object', 400, '계획 데이터가 없습니다.');
  need(d.basis && Calc.ymValid(d.basis.baseMonth) && Calc.ymValid(d.basis.moveMonth), 400, '기준월과 이사 예정월(YYYY-MM)을 입력해 주세요.');
  need(Calc.ymDiff(d.basis.baseMonth, d.basis.moveMonth) >= 1 && Calc.ymDiff(d.basis.baseMonth, d.basis.moveMonth) <= 120, 400, '이사 예정월은 기준월 이후 120개월 이내여야 합니다.');
  if (d.allocation && d.allocation.mode === 'ratio') {
    const r = d.allocation.ratios || {}; const s = Number(r.emergency || 0) + Number(r.debt || 0) + Number(r.housing || 0);
    need(Math.abs(s - 100) < 0.001, 400, '초과소득 배분 비율의 합계가 100%가 되어야 합니다. (현재 ' + s + '%)');
  }
  need(JSON.stringify(d).length < 200000, 413, '계획 데이터가 너무 큽니다.');
}

function clientOf(db, user, id) {
  need(auth.canAccess(db, user, id), 403, '이 고객의 정보를 볼 권한이 없습니다.');
  const c = db.prepare('SELECT id, profile, created_at FROM clients WHERE id = ?').get(Number(id));
  need(c, 404, '고객을 찾을 수 없습니다.');
  return c;
}

function routes(db, opts) {
  opts = opts || {};
  const r = [];
  const add = (method, pattern, fn, opts) => r.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, opts: opts || {} });

  add('GET', '/api/me', (q) => ({ user: q.user }));

  add('GET', '/api/clients', (q) => {
    if (q.user.role === 'client') return { clients: db.prepare('SELECT id, profile FROM clients WHERE id = ?').all(q.user.clientId).map(rowClient) };
    return { clients: db.prepare('SELECT c.id, c.profile FROM clients c JOIN assignments a ON a.client_id = c.id WHERE a.planner_id = ? ORDER BY c.id').all(q.user.id).map(rowClient) };
  });

  add('GET', '/api/clients/:id', (q) => ({ client: rowClient(clientOf(db, q.user, q.p.id)) }));
  add('POST', '/api/clients/:id/profile', (q) => {
    clientOf(db, q.user, q.p.id); need(q.user.role === 'planner', 403, '고객 정보는 설계사만 수정할 수 있습니다.');
    const p = q.body.profile; need(p && typeof p === 'object', 400, '고객 정보가 없습니다.');
    db.prepare('UPDATE clients SET profile = ? WHERE id = ?').run(JSON.stringify(p), Number(q.p.id));
    audit(db, q.user, 'profile.update', 'client:' + q.p.id); return { ok: true };
  });

  // 계획: 버전 목록과 데이터 (덮어쓰기 없음)
  add('GET', '/api/clients/:id/plans', (q) => {
    clientOf(db, q.user, q.p.id);
    const rows = db.prepare('SELECT p.id, p.kind, p.version, p.label, p.note, p.data, p.created_at, u.name AS author FROM plans p JOIN users u ON u.id = p.created_by WHERE p.client_id = ? ORDER BY p.kind, p.version').all(Number(q.p.id));
    return { plans: rows.map((x) => ({ id: x.id, kind: x.kind, version: x.version, label: x.label, note: x.note, createdAt: x.created_at, author: x.author, data: JSON.parse(x.data) })) };
  });
  add('POST', '/api/clients/:id/plans', (q) => {
    clientOf(db, q.user, q.p.id); need(q.user.role === 'planner', 403, '계획은 설계사만 저장할 수 있습니다.');
    const b = q.body; need(b.kind === 'before' || b.kind === 'after', 400, '계획 종류(설계 전/설계 후)를 정해 주세요.');
    validatePlan(b.data);
    const cur = db.prepare('SELECT MAX(version) AS v FROM plans WHERE client_id = ? AND kind = ?').get(Number(q.p.id), b.kind);
    const v = (cur && cur.v ? cur.v : 0) + 1;
    const info = db.prepare('INSERT INTO plans (client_id, kind, version, label, note, data, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(Number(q.p.id), b.kind, v, String(b.label || '').slice(0, 60), String(b.note || '').slice(0, 500), JSON.stringify(b.data), q.user.id, now());
    audit(db, q.user, 'plan.create', 'client:' + q.p.id + ':' + b.kind + ':v' + v);
    return { id: Number(info.lastInsertRowid), version: v };
  });

  // 실행 기록
  add('GET', '/api/clients/:id/records', (q) => {
    clientOf(db, q.user, q.p.id);
    return { records: db.prepare('SELECT id, month, category, amount, source, tx_id AS txId, note, voided_at AS voidedAt, created_at AS createdAt FROM records WHERE client_id = ? ORDER BY month, id').all(Number(q.p.id)) };
  });
  add('POST', '/api/clients/:id/records', (q) => {
    clientOf(db, q.user, q.p.id); need(q.user.role === 'client', 403, '실행 기록은 고객 본인이 입력합니다.');
    const b = q.body; need(Calc.ymValid(b.month), 400, '월(YYYY-MM)을 확인해 주세요.'); need(CATEGORIES.test(b.category), 400, '항목을 확인해 주세요.');
    const amount = money(b.amount); need(amount >= 0, 400, '0 이상으로 입력해 주세요.');
    // 같은 달·같은 항목의 기존 기록은 '대체됨'으로 표시 → 한 달에 한 번만 반영
    const ts = now();
    db.prepare('UPDATE records SET voided_at = ? WHERE client_id = ? AND month = ? AND category = ? AND voided_at IS NULL').run(ts, Number(q.p.id), b.month, b.category);
    const info = db.prepare('INSERT INTO records (client_id, month, category, amount, source, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(Number(q.p.id), b.month, b.category, amount, 'manual', String(b.note || '').slice(0, 200), q.user.id, ts);
    audit(db, q.user, 'record.create', 'client:' + q.p.id + ':' + b.month + ':' + b.category);
    rerun(db, q.p.id);
    return { id: Number(info.lastInsertRowid) };
  });
  add('DELETE', '/api/clients/:id/records/:rid', (q) => {
    clientOf(db, q.user, q.p.id); need(q.user.role === 'client', 403, '실행 기록은 고객 본인만 취소할 수 있습니다.');
    const ok = db.prepare('UPDATE records SET voided_at = ? WHERE id = ? AND client_id = ? AND voided_at IS NULL').run(now(), Number(q.p.rid), Number(q.p.id));
    need(ok.changes === 1, 404, '기록을 찾을 수 없습니다.');
    rerun(db, q.p.id);
    return { ok: true };
  });

  // 계좌(끝 4자리만 저장)
  add('GET', '/api/clients/:id/accounts', (q) => { clientOf(db, q.user, q.p.id); return { accounts: db.prepare('SELECT id, label, masked, purpose FROM accounts WHERE client_id = ?').all(Number(q.p.id)) }; });
  add('POST', '/api/clients/:id/accounts', (q) => {
    clientOf(db, q.user, q.p.id); need(q.user.role === 'client', 403, '계좌는 고객 본인이 등록합니다.');
    const b = q.body; const masked = linking.maskAccount(b.number);
    need(masked, 400, '계좌번호 끝 4자리 이상을 입력해 주세요.');
    need(/^(salary|spending|emergency|housing|debt|product:[A-Za-z0-9_-]{1,20})$/.test(b.purpose), 400, '계좌 용도를 선택해 주세요.');
    db.prepare('INSERT INTO accounts (client_id, label, masked, purpose, created_at) VALUES (?,?,?,?,?)').run(Number(q.p.id), String(b.label || '계좌').slice(0, 30), masked, b.purpose, now());
    return { ok: true };
  });

  // 거래내역
  add('GET', '/api/clients/:id/transactions', (q) => {
    clientOf(db, q.user, q.p.id);
    const sync = db.prepare('SELECT provider, last_sync AS lastSync, last_error AS lastError FROM sync_status WHERE client_id = ?').get(Number(q.p.id)) || null;
    return { sync, transactions: db.prepare('SELECT id, date, amount, description, from_masked AS fromMasked, to_masked AS toMasked, source, suggested, classification, confirmed_at AS confirmedAt, record_id AS recordId FROM transactions WHERE client_id = ? ORDER BY date DESC, id DESC LIMIT 300').all(Number(q.p.id)).map((t) => Object.assign(t, { suggested: t.suggested ? JSON.parse(t.suggested) : null })) };
  });
  function storeTx(cid, rows, source) {
    const accounts = db.prepare('SELECT label, masked, purpose FROM accounts WHERE client_id = ?').all(cid);
    let added = 0, dup = 0;
    const ins = db.prepare('INSERT OR IGNORE INTO transactions (client_id, date, amount, description, from_masked, to_masked, source, suggested, import_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    rows.forEach((t) => {
      const key = [t.date, t.amount, t.from, t.to, t.description].join('|');
      const res = ins.run(cid, t.date, t.amount, t.description, t.from, t.to, source, JSON.stringify(linking.suggest({ amount: t.amount, description: t.description, from: t.from, to: t.to }, accounts)), key, now());
      if (res.changes) added++; else dup++;
    });
    db.prepare('INSERT INTO sync_status (client_id, provider, last_sync, last_error) VALUES (?,?,?,NULL) ON CONFLICT(client_id) DO UPDATE SET provider = excluded.provider, last_sync = excluded.last_sync, last_error = NULL').run(cid, source, now());
    return { added, duplicates: dup };
  }
  add('POST', '/api/clients/:id/transactions/import', (q) => {
    clientOf(db, q.user, q.p.id); need(q.user.role === 'client', 403, '거래내역은 고객 본인이 가져옵니다.');
    const parsed = linking.parseCsv(q.body.csv);
    need(parsed.rows.length || !parsed.errors.length, 400, parsed.errors.join(' '));
    need(parsed.rows.length <= 2000, 413, '한 번에 2,000건까지 가져올 수 있습니다.');
    return Object.assign(storeTx(Number(q.p.id), parsed.rows, 'csv'), { errors: parsed.errors.slice(0, 10) });
  }, { bodyLimit: 2_000_000 });
  add('POST', '/api/clients/:id/transactions/sync', (q) => {
    clientOf(db, q.user, q.p.id); need(q.user.role === 'client', 403, '고객 본인만 불러올 수 있습니다.');
    need(Calc.ymValid(q.body.month), 400, '월을 확인해 주세요.');
    const accounts = db.prepare('SELECT label, masked, purpose FROM accounts WHERE client_id = ?').all(Number(q.p.id));
    return Object.assign(storeTx(Number(q.p.id), linking.DemoProvider.fetchTransactions(accounts, q.body.month), 'demo'), { provider: linking.DemoProvider.label });
  });
  add('POST', '/api/clients/:id/transactions/:tid/confirm', (q) => {
    clientOf(db, q.user, q.p.id); need(q.user.role === 'client', 403, '거래 분류는 고객 본인이 확인합니다.');
    const cid = Number(q.p.id);
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND client_id = ?').get(Number(q.p.tid), cid);
    need(tx, 404, '거래를 찾을 수 없습니다.'); need(!tx.confirmed_at, 409, '이미 확인한 거래입니다.');
    let cls = q.body.classification;
    need(/^(debt|emergency|housing|expense|expense:essential|expense:optional|income|ownTransfer|exclude|product:[A-Za-z0-9_-]{1,20})$/.test(cls), 400, '분류를 선택해 주세요.');
    const month = tx.date.slice(0, 7);
    let recordId = null;
    if (cls === 'expense') cls = 'expense:optional';
    if (/^(debt|emergency|housing|product:|expense:)/.test(cls)) {
      // 같은 이체의 반대쪽 기록(받은 통장 쪽)이 이미 실적으로 연결됐으면 중복 반영하지 않음
      const twin = db.prepare('SELECT id, record_id FROM transactions WHERE client_id = ? AND id != ? AND date = ? AND ABS(amount) = ABS(?) AND from_masked = ? AND to_masked = ? AND record_id IS NOT NULL').get(cid, tx.id, tx.date, tx.amount, tx.from_masked, tx.to_masked);
      if (twin) recordId = twin.record_id;
      else {
        const manual = db.prepare("SELECT id, amount FROM records WHERE client_id = ? AND month = ? AND category = ? AND source = 'manual' AND voided_at IS NULL").get(cid, month, cls);
        if (manual && !q.body.replaceManual) throw Object.assign(new HttpError(409, '이 달 ‘' + cls + '’에 직접 입력한 기록(' + Math.round(manual.amount / 10000) + '만원)이 있습니다. 거래로 대체할지 선택해 주세요.'), { code: 'manualExists' });
        if (manual) db.prepare('UPDATE records SET voided_at = ? WHERE id = ?').run(now(), manual.id);
        recordId = Number(db.prepare('INSERT INTO records (client_id, month, category, amount, source, tx_id, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(cid, month, cls, Math.abs(tx.amount), 'transaction', tx.id, tx.description, q.user.id, now()).lastInsertRowid);
      }
    }
    db.prepare('UPDATE transactions SET classification = ?, confirmed_at = ?, record_id = ? WHERE id = ?').run(cls, now(), recordId, tx.id);
    // 지출로 확인한 거래가 예정 결제(카드대금 등)와 금액이 같으면 그 예정 항목은 결제됨으로 → 중복 집계 방지
    if (cls.indexOf('expense:') === 0) db.prepare('UPDATE scheduled SET paid = 1 WHERE id = (SELECT id FROM scheduled WHERE client_id = ? AND month = ? AND paid = 0 AND amount = ? LIMIT 1)').run(cid, month, Math.abs(tx.amount));
    rerun(db, cid);
    return { ok: true, recordId };
  });

  // 경보 설정
  add('GET', '/api/clients/:id/settings', (q) => { clientOf(db, q.user, q.p.id); const s = db.prepare('SELECT data FROM settings WHERE client_id = ?').get(Number(q.p.id)); return { settings: s ? JSON.parse(s.data) : {} }; });
  add('PUT', '/api/clients/:id/settings', (q) => {
    clientOf(db, q.user, q.p.id);
    const s = q.body.settings || {}; const clean = {};
    [['dueDay', 1, 31], ['graceDays', 0, 15], ['cumTolerancePct', 0, 100], ['budgetTolerancePct', 0, 100], ['emergencyMinMonths', 0, 24], ['staleDays', 1, 90]].forEach(([k, lo, hi]) => {
      const v = Number(s[k]); need(isFinite(v) && v >= lo && v <= hi, 400, k + ' 값은 ' + lo + '~' + hi + ' 사이여야 합니다.'); clean[k] = v;
    });
    db.prepare('INSERT INTO settings (client_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(Number(q.p.id), JSON.stringify(clean), now());
    rerun(db, q.p.id);
    return { settings: clean };
  });

  add('GET', '/api/policies', () => ({ policies: Policies.LIST, sources: Policies.SOURCES, checkedAt: Policies.CHECKED }));
  require('./api2').extend(add, db, { clientOf, need, audit, HttpError, pushKeys: opts.pushKeys });
  return r;
}

function rowClient(c) { return { id: c.id, profile: JSON.parse(c.profile) }; }

module.exports = { routes, HttpError };
