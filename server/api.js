/*
 * API — 모든 고객 데이터 요청은 서버에서 권한을 검사합니다.
 * ------------------------------------------------------------
 * 설계사: 배정된 고객의 정보·실적 조회, 계획 초안 저장, 고객에게 계획 제시
 * 고객  : 자기 정보(client_data) 수정, 실적·계좌·거래내역 관리, 제시된 계획 확인·선택
 * 저장이 커밋된 뒤에만 changes.publish → 실시간 전달(server/changes.js)
 */
'use strict';
const auth = require('./auth');
const linking = require('./linking/provider');
const changes = require('./changes');
const Calc = require('../public/js/engine/calc.js');
const CD = require('../public/js/engine/clientData.js');
const Policies = require('../public/js/data/policies.js');
const jobs = require('./jobs');

const CATEGORIES = /^(debt|emergency|housing|expense|expense:essential|expense:optional|income|product:[A-Za-z0-9_-]{1,20})$/;
const CAT_LABEL = { debt: '부채 상환', emergency: '비상금 적립', housing: '주거자금 저축', 'expense:essential': '필수 지출', 'expense:optional': '선택 지출', expense: '지출', income: '추가 소득' };
const catLabel = (c) => CAT_LABEL[c] || (c.indexOf('product:') === 0 ? '상품 납입(' + c.slice(8) + ')' : c);
const man = (v) => Math.round(Number(v) / 10000).toLocaleString('ko-KR') + '만원';

class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; if (extra) Object.assign(this, extra); } }
function need(cond, status, msg, extra) { if (!cond) throw new HttpError(status, msg, extra); }
async function audit(h, user, action, target) { await h.run('INSERT INTO audit (user_id, action, target, at) VALUES (?,?,?,?)', user ? user.id : null, action, target || null, new Date().toISOString()); }
function now() { return new Date().toISOString(); }
function money(v) { const n = Number(v); need(v !== null && v !== '' && isFinite(n) && Math.abs(n) < 1e11, 400, '금액을 숫자로 입력해 주세요.'); return n; }
const j = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

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

// ---------- 고객 입력 정보 값 검사(미입력 null과 실제 0을 구분) ----------
function cleanValue(type, v, label, options) {
  if (v === null || v === undefined || v === '') return null;
  if (type === 'money') { const n = Number(v); need(isFinite(n) && n >= 0 && n < 1e11, 400, label + ': 0 이상의 금액을 입력해 주세요.'); return Math.round(n); }
  if (type === 'int') { const n = Number(v); need(Number.isInteger(n) && n >= 1 && n <= 600, 400, label + ': 1~600 사이 정수로 입력해 주세요.'); return n; }
  if (type === 'pct') { const n = Number(v); need(isFinite(n) && n >= 0 && n <= 30, 400, label + ': 연이율은 0~30(%) 사이로 입력해 주세요.'); return n; }
  if (type === 'ym') { need(Calc.ymValid(String(v)), 400, label + ': 연월을 YYYY-MM 형식으로 입력해 주세요.'); return String(v); }
  if (type === 'select') { need(options.some((o) => o[0] === v), 400, label + ': 선택지에서 골라 주세요.'); return v; }
  const s = String(v).trim(); need(s.length <= 60, 400, label + ': 60자 이내로 입력해 주세요.'); return s || null;
}
function cleanList(key, arr) {
  const L = CD.LISTS[key]; need(Array.isArray(arr), 400, L.label + ' 목록 형식이 아닙니다.'); need(arr.length <= 20, 400, L.label + '은(는) 20건까지 입력할 수 있습니다.');
  return arr.map((row, i) => {
    const o = { id: String((row && row.id) || key[0] + (i + 1)).slice(0, 20) };
    L.fields.forEach(([k, label, type, opts]) => { o[k] = cleanValue(type, row ? row[k] : null, L.label + ' ' + (i + 1) + '번 ' + label, opts); });
    return o;
  });
}
const FIELD_MAP = Object.fromEntries(CD.FIELDS.map((f) => [f.path, f]));

async function loadClientData(h, cid) {
  const r = await h.get('SELECT data, version, field_versions, updated_at, updated_by FROM client_data WHERE client_id = ?', Number(cid));
  if (!r) return { data: {}, version: 0, fieldVersions: {}, updatedAt: null, updatedBy: null };
  return { data: j(r.data, {}), version: Number(r.version), fieldVersions: j(r.field_versions, {}), updatedAt: r.updated_at, updatedBy: r.updated_by };
}

/*
 * 고객 정보 저장(변경 항목만). baseVersion = 화면이 불러온 버전.
 * - 그 사이 다른 기기에서 같은 항목을 바꿨다면 409(충돌 항목 목록) → 조용히 덮어쓰지 않음.
 * - 다른 항목만 바뀌었다면 병합해서 저장.
 * - 값이 그대로인 항목은 무시(중복 저장 안전).
 */
async function saveClientData(t, user, cid, body) {
  const set = body.set || {};
  const keys = Object.keys(set);
  need(keys.length, 400, '바뀐 항목이 없습니다.');
  need(keys.length <= 60, 400, '한 번에 저장할 항목이 너무 많습니다.');
  const cur = await loadClientData(t, cid);
  const base = Number(body.baseVersion);
  need(Number.isInteger(base) && base >= 0, 400, '불러온 데이터 버전(baseVersion)이 필요합니다.');
  const clean = {};
  keys.forEach((k) => {
    if (CD.LISTS[k]) clean[k] = cleanList(k, set[k]);
    else { const f = FIELD_MAP[k]; need(f, 400, '알 수 없는 항목입니다: ' + k); clean[k] = cleanValue(f.type, set[k], f.label, f.options); }
  });
  const getv = (o, k) => { const v = CD.LISTS[k] ? o[k] : CD.get(o, k); return v === undefined ? null : v; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const conflicts = [], changed = [];
  keys.forEach((k) => {
    const curV = getv(cur.data, k);
    if (same(curV, clean[k])) return; // 이미 같은 값(재시도·중복 저장)
    if ((cur.fieldVersions[k] || 0) > base) conflicts.push({ path: k, label: CD.label(k), current: CD.fmt(k, curV), mine: CD.fmt(k, clean[k]) });
    else changed.push(k);
  });
  if (conflicts.length) throw new HttpError(409, '다른 기기에서 같은 항목이 먼저 저장되었습니다. 최신 값을 확인한 뒤 다시 저장해 주세요.', { code: 'conflict', conflicts, version: cur.version });
  if (!changed.length) return { version: cur.version, unchanged: true, updatedAt: cur.updatedAt };
  const next = JSON.parse(JSON.stringify(cur.data)), fv = Object.assign({}, cur.fieldVersions), v = cur.version + 1, ts = now();
  const items = changed.map((k) => ({ path: k, label: CD.label(k), from: CD.fmt(k, getv(cur.data, k)), to: CD.fmt(k, clean[k]) }));
  changed.forEach((k) => { if (CD.LISTS[k]) next[k] = clean[k]; else CD.set(next, k, clean[k]); fv[k] = v; });
  if (cur.version === 0) await t.run('INSERT INTO client_data (client_id, data, version, field_versions, updated_at, updated_by) VALUES (?,?,?,?,?,?)', cid, JSON.stringify(next), v, JSON.stringify(fv), ts, user.id);
  else {
    const r = await t.run('UPDATE client_data SET data = ?, version = ?, field_versions = ?, updated_at = ?, updated_by = ? WHERE client_id = ? AND version = ?', JSON.stringify(next), v, JSON.stringify(fv), ts, user.id, cid, cur.version);
    need(r.changes === 1, 409, '동시에 저장되었습니다. 다시 시도해 주세요.', { code: 'conflict', conflicts: [] });
  }
  const ev = await changes.log(t, { clientId: cid, user, entity: 'client_data', version: v, items, text: items.length + '개 항목 변경' });
  return { version: v, updatedAt: ts, changed: items, event: ev };
}

async function nextPlanVersion(h, cid, kind) { const r = await h.get('SELECT MAX(version) AS v FROM plans WHERE client_id = ? AND kind = ?', cid, kind); return Number((r && r.v) || 0) + 1; }

function routes(db, opts) {
  opts = opts || {};
  const r = [];
  const add = (method, pattern, fn, o) => r.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, opts: o || {} });
  const pub = (evs) => changes.publish(db, Array.isArray(evs) ? evs : [evs]);
  const rerun = async (cid) => { try { await jobs.evaluate(db, Number(cid)); } catch (e) { console.error('점검 오류:', e.message); } };

  async function clientOf(user, id) {
    need(await auth.canAccess(db, user, id), 403, '이 고객의 정보를 볼 권한이 없습니다.');
    const c = await db.get('SELECT id, profile, created_at FROM clients WHERE id = ?', Number(id));
    need(c, 404, '고객을 찾을 수 없습니다.');
    return c;
  }

  add('GET', '/api/me', (q) => ({ user: q.user, demoMode: !!opts.demoMode }));

  add('GET', '/api/clients', async (q) => {
    if (q.user.role === 'client') return { clients: (await db.all('SELECT id, profile FROM clients WHERE id = ?', q.user.clientId)).map(rowClient) };
    // 비활성 설계사이거나 배정이 없으면 빈 목록 → 화면에 '현재 배정된 고객이 없습니다'
    return { clients: (await db.all('SELECT c.id, c.profile FROM clients c JOIN assignments a ON a.client_id = c.id JOIN users u ON u.id = a.planner_id WHERE a.planner_id = ? AND u.disabled = 0 ORDER BY c.id', q.user.id)).map(rowClient) };
  });

  add('GET', '/api/clients/:id', async (q) => ({ client: rowClient(await clientOf(q.user, q.p.id)) }));

  // ---------- 고객 입력 정보 ----------
  add('GET', '/api/clients/:id/data', async (q) => {
    await clientOf(q.user, q.p.id);
    const cd = await loadClientData(db, Number(q.p.id));
    const by = cd.updatedBy ? await db.get('SELECT name, role FROM users WHERE id = ?', cd.updatedBy) : null;
    return { data: cd.data, version: cd.version, fieldVersions: cd.fieldVersions, updatedAt: cd.updatedAt, updatedBy: by ? by.name : null, latestChange: await changes.latestId(db) };
  });
  add('PATCH', '/api/clients/:id/data', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid);
    need(q.user.role === 'client', 403, '고객 정보는 고객 본인이 수정합니다. 설계사는 조회만 할 수 있습니다.');
    const out = await db.tx((t) => saveClientData(t, q.user, cid, q.body));
    if (out.event) { pub(out.event); delete out.event; }
    return out;
  });
  add('GET', '/api/clients/:id/history', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid);
    const rows = await changes.since(db, q.user, [cid], 0, 5000);
    return { history: rows.slice(-200).reverse() };
  });

  // ---------- 동기화: 마지막으로 받은 번호 이후 변경(연결 복구·주기 조회용) ----------
  add('GET', '/api/sync', async (q) => {
    if (q.query.get('latestOnly')) return { changes: [], latest: await changes.latestId(db), serverTime: now() };
    const ids = await auth.allowedClients(db, q.user);
    const sinceId = Number(q.query.get('since') || 0);
    const list = await changes.since(db, q.user, ids, sinceId, 500);
    return { changes: list, latest: list.length ? list[list.length - 1].id : Math.max(sinceId, await changes.latestId(db)), serverTime: now() };
  });

  // ---------- 계획(버전 추가만, 덮어쓰기 없음) ----------
  // 설계사: 모든 버전(초안 포함). 고객: 설계 전 진단, 제시받은 계획, 실행 기준이 된 계획만.
  add('GET', '/api/clients/:id/plans', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid);
    let rows = await db.all('SELECT p.id, p.kind, p.version, p.label, p.note, p.data, p.created_at, p.data_version, u.name AS author FROM plans p JOIN users u ON u.id = p.created_by WHERE p.client_id = ? ORDER BY p.kind, p.version', cid);
    if (q.user.role === 'client') {
      const ok = new Set((await db.all('SELECT plan_id AS id FROM baselines WHERE client_id = ? UNION SELECT plan_id AS id FROM plan_offers WHERE client_id = ? UNION SELECT selected_plan_id AS id FROM strategy_sets WHERE client_id = ? AND selected_plan_id IS NOT NULL', cid, cid, cid)).map((x) => Number(x.id)));
      rows = rows.filter((x) => x.kind === 'before' || ok.has(Number(x.id)));
    }
    return { plans: rows.map((x) => ({ id: Number(x.id), kind: x.kind, version: Number(x.version), label: x.label, note: x.note, createdAt: x.created_at, author: x.author, dataVersion: x.data_version == null ? null : Number(x.data_version), data: JSON.parse(x.data) })) };
  });
  add('POST', '/api/clients/:id/plans', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'planner', 403, '계획은 설계사만 저장할 수 있습니다.');
    const b = q.body; need(b.kind === 'before' || b.kind === 'after', 400, '계획 종류(설계 전/설계 후)를 정해 주세요.');
    validatePlan(b.data);
    const out = await db.tx(async (t) => {
      // 작성 중 고객 정보가 바뀌었으면 알리고 확인을 받음(조용히 덮어쓰지 않음)
      const cd = await t.get('SELECT version FROM client_data WHERE client_id = ?', cid);
      const curV = cd ? Number(cd.version) : 0;
      if (b.dataVersion != null && Number(b.dataVersion) < curV && b.acknowledgeStale !== true) {
        const since = await t.all("SELECT summary FROM changes WHERE client_id = ? AND entity = 'client_data' AND version > ? ORDER BY id", cid, Number(b.dataVersion));
        const items = []; since.forEach((x) => (j(x.summary, {}).items || []).forEach((it) => items.push(it)));
        throw new HttpError(409, '분석 기준 정보가 변경되었습니다. 최신 정보로 다시 계산하거나, 확인 후 그대로 저장해 주세요.', { code: 'staleBasis', items, version: curV });
      }
      const v = await nextPlanVersion(t, cid, b.kind);
      const ins = await t.run('INSERT INTO plans (client_id, kind, version, label, note, data, created_by, created_at, data_version) VALUES (?,?,?,?,?,?,?,?,?)',
        cid, b.kind, v, String(b.label || '').slice(0, 60), String(b.note || '').slice(0, 500), JSON.stringify(b.data), q.user.id, now(), b.dataVersion == null ? curV : Number(b.dataVersion));
      await audit(t, q.user, 'plan.create', 'client:' + cid + ':' + b.kind + ':v' + v);
      const ev = await changes.log(t, { clientId: cid, user: q.user, entity: 'plan', version: v, audience: 'planner', text: '설계사 초안 저장: ' + (b.kind === 'before' ? '설계 전' : '설계 후') + ' v' + v, ref: { planId: ins.id } });
      return { id: ins.id, version: v, ev };
    });
    pub(out.ev); delete out.ev; return out;
  });

  // ---------- 계획 제시 → 고객 확인·선택 → 실행 기준 ----------
  add('GET', '/api/clients/:id/offers', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid);
    return { offers: (await db.all('SELECT o.*, u.name AS author FROM plan_offers o JOIN users u ON u.id = o.created_by WHERE o.client_id = ? ORDER BY o.id DESC', cid)).map(rowOffer) };
  });
  add('POST', '/api/clients/:id/offers', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'planner', 403, '계획 제시는 설계사가 합니다.');
    const out = await db.tx(async (t) => {
      const pl = await t.get("SELECT id, version, label FROM plans WHERE id = ? AND client_id = ? AND kind = 'after'", Number(q.body.planId), cid);
      need(pl, 404, '제시할 설계 후 계획을 찾을 수 없습니다.');
      await t.run("UPDATE plan_offers SET status = 'withdrawn', decided_at = ? WHERE client_id = ? AND status = 'presented'", now(), cid);
      const ins = await t.run('INSERT INTO plan_offers (client_id, plan_id, status, note, created_by, created_at) VALUES (?,?,?,?,?,?)', cid, pl.id, 'presented', String(q.body.note || '').slice(0, 300), q.user.id, now());
      await t.run('INSERT OR IGNORE INTO notifications (client_id, type, dkey, fact, impact, action, created_at, push_state) VALUES (?,?,?,?,?,?,?,?)',
        cid, 'revision', 'offer:' + ins.id, '설계사가 새 계획(설계 후 v' + pl.version + ')을 제시했습니다.', '선택하기 전까지 현재 실행 기준 계획은 바뀌지 않습니다.', '‘월별 실행·알림’에서 비교하고 선택하거나 보류해 주세요.', now(), 'pending');
      await audit(t, q.user, 'offer.present', 'client:' + cid + ':plan:' + pl.id);
      const ev = await changes.log(t, { clientId: cid, user: q.user, entity: 'offer', text: '새 계획 제시: 설계 후 v' + pl.version, ref: { offerId: ins.id, planId: pl.id } });
      return { id: ins.id, ev };
    });
    pub(out.ev); delete out.ev; return out;
  });
  add('POST', '/api/clients/:id/offers/:oid/:act', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid);
    const act = q.p.act; need(['accept', 'decline', 'withdraw'].includes(act), 404, '없는 요청입니다.');
    need(act === 'withdraw' ? q.user.role === 'planner' : q.user.role === 'client', 403, act === 'withdraw' ? '제시 철회는 설계사가 합니다.' : '제시된 계획의 선택은 고객이 합니다.');
    if (act === 'accept') need(q.body.confirm === true, 400, '선택 내용을 확인해 주세요.');
    const out = await db.tx(async (t) => {
      const o = await t.get('SELECT * FROM plan_offers WHERE id = ? AND client_id = ?', Number(q.p.oid), cid);
      need(o, 404, '제시된 계획을 찾을 수 없습니다.');
      if (act === 'accept' && o.status === 'accepted') return { ok: true, already: true }; // 재시도 안전
      need(o.status === 'presented', 409, '이미 처리된 제시입니다.');
      const st = act === 'accept' ? 'accepted' : act === 'decline' ? 'declined' : 'withdrawn';
      await t.run('UPDATE plan_offers SET status = ?, decided_at = ? WHERE id = ?', st, now(), o.id);
      if (act === 'accept') await t.run('INSERT INTO baselines (client_id, plan_id, set_by, set_at, reason) VALUES (?,?,?,?,?)', cid, o.plan_id, q.user.id, now(), '고객 선택(제시 #' + o.id + ')');
      await audit(t, q.user, 'offer.' + act, 'client:' + cid + ':offer:' + o.id);
      const pl = await t.get('SELECT version FROM plans WHERE id = ?', o.plan_id);
      const ev = await changes.log(t, { clientId: cid, user: q.user, entity: act === 'accept' ? 'baseline' : 'offer', text: (act === 'accept' ? '고객이 설계 후 v' + pl.version + '을 실행 기준으로 선택' : act === 'decline' ? '고객이 제시된 계획 보류' : '설계사가 제시 철회'), ref: { offerId: o.id, planId: Number(o.plan_id) } });
      return { ok: true, ev };
    });
    if (out.ev) { pub(out.ev); delete out.ev; }
    if (act === 'accept' && !out.already) await rerun(cid);
    return out;
  });

  // ---------- 실행 기록(월별 실적) ----------
  add('GET', '/api/clients/:id/records', async (q) => {
    await clientOf(q.user, q.p.id);
    return { records: (await db.all('SELECT id, month, category, amount, source, tx_id AS "txId", note, voided_at AS "voidedAt", created_at AS "createdAt" FROM records WHERE client_id = ? ORDER BY month, id', Number(q.p.id))).map(numId) };
  });
  add('POST', '/api/clients/:id/records', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'client', 403, '실행 기록은 고객 본인이 입력합니다.');
    const b = q.body; need(Calc.ymValid(b.month), 400, '대상 월(YYYY-MM)을 확인해 주세요.'); need(CATEGORIES.test(b.category), 400, '항목을 확인해 주세요.');
    const amount = money(b.amount); need(amount >= 0, 400, '0 이상으로 입력해 주세요.');
    const out = await db.tx(async (t) => {
      need(!(await t.get('SELECT 1 AS ok FROM month_closures WHERE client_id = ? AND month = ?', cid, b.month)) || b.allowClosed === true, 409, b.month + '은(는) 이미 확정된 달입니다. 확정된 달의 실적을 바꾸려면 확인이 필요합니다.', { code: 'closed' });
      const cur = await t.get('SELECT id, amount FROM records WHERE client_id = ? AND month = ? AND category = ? AND voided_at IS NULL ORDER BY id DESC LIMIT 1', cid, b.month, b.category);
      if (cur && Number(cur.amount) === amount) return { id: Number(cur.id), unchanged: true }; // 같은 값 재전송 → 두 번 반영하지 않음
      // 같은 달·같은 항목의 기존 기록은 '대체됨' → 한 달에 한 항목은 한 번만 반영
      const ts = now();
      await t.run('UPDATE records SET voided_at = ? WHERE client_id = ? AND month = ? AND category = ? AND voided_at IS NULL', ts, cid, b.month, b.category);
      const ins = await t.run('INSERT INTO records (client_id, month, category, amount, source, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', cid, b.month, b.category, amount, 'manual', String(b.note || '').slice(0, 200), q.user.id, ts);
      await audit(t, q.user, 'record.create', 'client:' + cid + ':' + b.month + ':' + b.category);
      const ev = await changes.log(t, { clientId: cid, user: q.user, entity: 'record', items: [{ path: 'record:' + b.month + ':' + b.category, label: b.month + ' ' + catLabel(b.category), from: cur ? man(cur.amount) : '미입력', to: man(amount) }], text: b.month + ' 실적 기록', ref: { month: b.month } });
      return { id: ins.id, ev };
    });
    if (out.ev) { pub(out.ev); delete out.ev; await rerun(cid); }
    return out;
  });
  add('DELETE', '/api/clients/:id/records/:rid', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'client', 403, '실행 기록은 고객 본인만 취소할 수 있습니다.');
    const out = await db.tx(async (t) => {
      const rec = await t.get('SELECT * FROM records WHERE id = ? AND client_id = ?', Number(q.p.rid), cid);
      need(rec, 404, '기록을 찾을 수 없습니다.');
      if (rec.voided_at) return { ok: true, already: true };
      await t.run('UPDATE records SET voided_at = ? WHERE id = ?', now(), rec.id);
      return { ok: true, ev: await changes.log(t, { clientId: cid, user: q.user, entity: 'record', items: [{ path: 'record:' + rec.month + ':' + rec.category, label: rec.month + ' ' + catLabel(rec.category), from: man(rec.amount), to: '취소' }], text: rec.month + ' 실적 취소', ref: { month: rec.month } }) };
    });
    if (out.ev) { pub(out.ev); delete out.ev; await rerun(cid); }
    return out;
  });

  // ---------- 계좌(끝 4자리만 저장) ----------
  add('GET', '/api/clients/:id/accounts', async (q) => { await clientOf(q.user, q.p.id); return { accounts: (await db.all('SELECT id, label, masked, purpose FROM accounts WHERE client_id = ?', Number(q.p.id))).map(numId) }; });
  add('POST', '/api/clients/:id/accounts', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'client', 403, '계좌는 고객 본인이 등록합니다.');
    const b = q.body; const masked = linking.maskAccount(b.number);
    need(masked, 400, '계좌번호 끝 4자리 이상을 입력해 주세요.');
    need(/^(salary|spending|emergency|housing|debt|product:[A-Za-z0-9_-]{1,20})$/.test(b.purpose), 400, '계좌 용도를 선택해 주세요.');
    await db.run('INSERT INTO accounts (client_id, label, masked, purpose, created_at) VALUES (?,?,?,?,?)', cid, String(b.label || '계좌').slice(0, 30), masked, b.purpose, now());
    pub(await changes.log(db, { clientId: cid, user: q.user, entity: 'account', text: '계좌 등록(' + masked + ')' }));
    return { ok: true };
  });

  // ---------- 거래내역 ----------
  add('GET', '/api/clients/:id/transactions', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid);
    const sync = (await db.get('SELECT provider, last_sync AS "lastSync", last_error AS "lastError" FROM sync_status WHERE client_id = ?', cid)) || null;
    const rows = await db.all('SELECT id, date, amount, description, from_masked AS "fromMasked", to_masked AS "toMasked", source, suggested, classification, confirmed_at AS "confirmedAt", record_id AS "recordId" FROM transactions WHERE client_id = ? ORDER BY date DESC, id DESC LIMIT 300', cid);
    return { sync, transactions: rows.map((t) => Object.assign(numId(t), { recordId: t.recordId == null ? null : Number(t.recordId), suggested: t.suggested ? JSON.parse(t.suggested) : null })) };
  });
  async function storeTx(user, cid, rows, source) {
    const accounts = await db.all('SELECT label, masked, purpose FROM accounts WHERE client_id = ?', cid);
    let added = 0, dup = 0;
    await db.tx(async (t) => {
      for (const x of rows) {
        const key = [x.date, x.amount, x.from, x.to, x.description].join('|');
        const res = await t.run('INSERT OR IGNORE INTO transactions (client_id, date, amount, description, from_masked, to_masked, source, suggested, import_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', cid, x.date, x.amount, x.description, x.from, x.to, source, JSON.stringify(linking.suggest({ amount: x.amount, description: x.description, from: x.from, to: x.to }, accounts)), key, now());
        if (res.changes) added++; else dup++;
      }
      await t.run('INSERT INTO sync_status (client_id, provider, last_sync, last_error) VALUES (?,?,?,NULL) ON CONFLICT(client_id) DO UPDATE SET provider = excluded.provider, last_sync = excluded.last_sync, last_error = NULL', cid, source, now());
    });
    if (added) pub(await changes.log(db, { clientId: cid, user, entity: 'transactions', text: '거래내역 ' + added + '건 추가(' + (source === 'csv' ? '파일' : '시연 연동') + ')' }));
    return { added, duplicates: dup };
  }
  add('POST', '/api/clients/:id/transactions/import', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'client', 403, '거래내역은 고객 본인이 가져옵니다.');
    const parsed = linking.parseCsv(q.body.csv);
    need(parsed.rows.length || !parsed.errors.length, 400, parsed.errors.join(' '));
    need(parsed.rows.length <= 2000, 413, '한 번에 2,000건까지 가져올 수 있습니다.');
    return Object.assign(await storeTx(q.user, cid, parsed.rows, 'csv'), { errors: parsed.errors.slice(0, 10) });
  }, { bodyLimit: 2_000_000 });
  add('POST', '/api/clients/:id/transactions/sync', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'client', 403, '고객 본인만 불러올 수 있습니다.');
    need(Calc.ymValid(q.body.month), 400, '월을 확인해 주세요.');
    const accounts = await db.all('SELECT label, masked, purpose FROM accounts WHERE client_id = ?', cid);
    return Object.assign(await storeTx(q.user, cid, linking.DemoProvider.fetchTransactions(accounts, q.body.month), 'demo'), { provider: linking.DemoProvider.label });
  });
  add('POST', '/api/clients/:id/transactions/:tid/confirm', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'client', 403, '거래 분류는 고객 본인이 확인합니다.');
    let cls = q.body.classification;
    need(/^(debt|emergency|housing|expense|expense:essential|expense:optional|income|ownTransfer|exclude|product:[A-Za-z0-9_-]{1,20})$/.test(cls), 400, '분류를 선택해 주세요.');
    if (cls === 'expense') cls = 'expense:optional';
    const out = await db.tx(async (t) => {
      const tx = await t.get('SELECT * FROM transactions WHERE id = ? AND client_id = ?', Number(q.p.tid), cid);
      need(tx, 404, '거래를 찾을 수 없습니다.');
      if (tx.confirmed_at) { need(tx.classification === cls, 409, '이미 확인한 거래입니다.'); return { ok: true, already: true, recordId: tx.record_id == null ? null : Number(tx.record_id) }; }
      const month = tx.date.slice(0, 7);
      let recordId = null;
      if (/^(debt|emergency|housing|product:|expense:)/.test(cls)) {
        // 같은 이체의 반대쪽 기록(받은 통장 쪽)이 이미 실적으로 연결됐으면 중복 반영하지 않음
        const twin = await t.get('SELECT id, record_id FROM transactions WHERE client_id = ? AND id != ? AND date = ? AND ABS(amount) = ABS(CAST(? AS DOUBLE PRECISION)) AND from_masked = ? AND to_masked = ? AND record_id IS NOT NULL', cid, tx.id, tx.date, tx.amount, tx.from_masked, tx.to_masked);
        if (twin) recordId = Number(twin.record_id);
        else {
          const manual = await t.get("SELECT id, amount FROM records WHERE client_id = ? AND month = ? AND category = ? AND source = 'manual' AND voided_at IS NULL", cid, month, cls);
          if (manual && !q.body.replaceManual) throw new HttpError(409, '이 달 ‘' + catLabel(cls) + '’에 직접 입력한 기록(' + man(manual.amount) + ')이 있습니다. 거래로 대체할지 선택해 주세요.', { code: 'manualExists' });
          if (manual) await t.run('UPDATE records SET voided_at = ? WHERE id = ?', now(), manual.id);
          recordId = (await t.run('INSERT INTO records (client_id, month, category, amount, source, tx_id, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', cid, month, cls, Math.abs(tx.amount), 'transaction', tx.id, tx.description, q.user.id, now())).id;
        }
      }
      await t.run('UPDATE transactions SET classification = ?, confirmed_at = ?, record_id = ? WHERE id = ?', cls, now(), recordId, tx.id);
      // 지출로 확인한 거래가 예정 결제(카드대금 등)와 금액이 같으면 그 예정 항목은 결제됨으로 → 중복 집계 방지
      if (cls.indexOf('expense:') === 0) await t.run('UPDATE scheduled SET paid = 1 WHERE id = (SELECT id FROM scheduled WHERE client_id = ? AND month = ? AND paid = 0 AND amount = CAST(? AS DOUBLE PRECISION) LIMIT 1)', cid, month, Math.abs(tx.amount));
      const ev = await changes.log(t, { clientId: cid, user: q.user, entity: 'record', items: recordId ? [{ path: 'record:' + month + ':' + cls, label: month + ' ' + catLabel(cls), from: '', to: man(Math.abs(tx.amount)) + '(거래 확인)' }] : [], text: '거래 분류 확인', ref: { month } });
      return { ok: true, recordId, ev };
    });
    if (out.ev) { pub(out.ev); delete out.ev; await rerun(cid); }
    return out;
  });

  // ---------- 경보 설정 ----------
  add('GET', '/api/clients/:id/settings', async (q) => { await clientOf(q.user, q.p.id); const s = await db.get('SELECT data FROM settings WHERE client_id = ?', Number(q.p.id)); return { settings: s ? JSON.parse(s.data) : {} }; });
  add('PUT', '/api/clients/:id/settings', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid);
    const s = q.body.settings || {}; const clean = {};
    [['dueDay', 1, 31], ['graceDays', 0, 15], ['cumTolerancePct', 0, 100], ['budgetTolerancePct', 0, 100], ['emergencyMinMonths', 0, 24], ['staleDays', 1, 90]].forEach(([k, lo, hi]) => {
      const v = Number(s[k]); need(isFinite(v) && v >= lo && v <= hi, 400, k + ' 값은 ' + lo + '~' + hi + ' 사이여야 합니다.'); clean[k] = v;
    });
    await db.run('INSERT INTO settings (client_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', cid, JSON.stringify(clean), now());
    pub(await changes.log(db, { clientId: cid, user: q.user, entity: 'settings', text: '경보 기준 변경' }));
    await rerun(cid);
    return { settings: clean };
  });

  // ---------- 기존 브라우저(시연판) 데이터 가져오기: 미리보기 → 고객 확인 → 저장 ----------
  function parseImport(body) {
    const f = body.file; need(f && typeof f === 'object' && f.format === 'fp-export-1', 400, '재무플래너 시연판에서 내보낸 파일이 아닙니다.');
    const set = {}; const d = f.clientData || {};
    CD.FIELDS.forEach((x) => { const v = CD.get(d, x.path); if (v !== undefined && v !== null && v !== '') set[x.path] = cleanValue(x.type, v, x.label, x.options); });
    Object.keys(CD.LISTS).forEach((k) => { if (Array.isArray(d[k])) set[k] = cleanList(k, d[k]); });
    const recs = (Array.isArray(f.records) ? f.records : []).slice(0, 500).map((x) => { need(Calc.ymValid(x.month) && CATEGORIES.test(x.category), 400, '실적 형식이 올바르지 않습니다.'); return { month: x.month, category: x.category, amount: money(x.amount), note: String(x.note || '').slice(0, 200) }; });
    return { set, recs, exportedAt: String(f.exportedAt || ''), demo: !!f.demo };
  }
  add('POST', '/api/clients/:id/import/preview', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'client', 403, '고객 본인만 가져올 수 있습니다.');
    const p = parseImport(q.body); const cur = await loadClientData(db, cid);
    const fields = Object.keys(p.set).map((k) => ({ path: k, label: CD.label(k), current: CD.fmt(k, CD.LISTS[k] ? cur.data[k] : CD.get(cur.data, k)), incoming: CD.fmt(k, p.set[k]) })).filter((x) => x.current !== x.incoming);
    return { exportedAt: p.exportedAt, demo: p.demo, fields, records: p.recs.map((x) => ({ month: x.month, label: catLabel(x.category), amount: man(x.amount) })), version: cur.version };
  }, { bodyLimit: 1_000_000 });
  add('POST', '/api/clients/:id/import/commit', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid); need(q.user.role === 'client', 403, '고객 본인만 가져올 수 있습니다.');
    need(q.body.confirm === true, 400, '가져올 내용을 확인해 주세요.');
    const p = parseImport(q.body);
    const out = await db.tx(async (t) => {
      const evs = []; let res = { unchanged: true };
      const cur = await loadClientData(t, cid);
      const changedSet = {}; Object.keys(p.set).forEach((k) => { const cv = CD.LISTS[k] ? cur.data[k] : CD.get(cur.data, k); if (JSON.stringify(cv === undefined ? null : cv) !== JSON.stringify(p.set[k])) changedSet[k] = p.set[k]; });
      if (Object.keys(changedSet).length) { res = await saveClientData(t, q.user, cid, { baseVersion: cur.version, set: changedSet }); if (res.event) evs.push(res.event); }
      let added = 0;
      for (const x of p.recs) {
        const ex = await t.get('SELECT id, amount FROM records WHERE client_id = ? AND month = ? AND category = ? AND voided_at IS NULL', cid, x.month, x.category);
        if (ex && Number(ex.amount) === x.amount) continue;
        if (ex) await t.run('UPDATE records SET voided_at = ? WHERE id = ?', now(), ex.id);
        await t.run('INSERT INTO records (client_id, month, category, amount, source, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', cid, x.month, x.category, x.amount, 'import', x.note || '시연판에서 가져옴', q.user.id, now());
        added++;
      }
      if (added) evs.push(await changes.log(t, { clientId: cid, user: q.user, entity: 'record', text: '시연판에서 실적 ' + added + '건 가져옴' }));
      await audit(t, q.user, 'import.commit', 'client:' + cid);
      return { fields: Object.keys(changedSet).length, records: added, version: res.version, evs };
    });
    pub(out.evs); delete out.evs; if (out.records) await rerun(cid);
    return out;
  }, { bodyLimit: 1_000_000 });

  add('GET', '/api/policies', () => ({ policies: Policies.LIST, sources: Policies.SOURCES, checkedAt: Policies.CHECKED }));
  const h = { clientOf, need, audit, HttpError, pushKeys: opts.pushKeys, pub, rerun, loadClientData };
  require('./api2').extend(add, db, h);
  require('./products').extend(add, db, h);
  return r;
}

function numId(x) { if (x && x.id != null) x.id = Number(x.id); return x; }
function rowClient(c) { return { id: Number(c.id), profile: JSON.parse(c.profile) }; }
function rowOffer(o) { return { id: Number(o.id), planId: Number(o.plan_id), status: o.status, note: o.note, author: o.author, createdAt: o.created_at, decidedAt: o.decided_at }; }

module.exports = { routes, HttpError, loadClientData, saveClientData };
