/*
 * 정기 점검(서버) — 1시간마다 + 실적·거래·설정이 바뀔 때마다 고객별로 실행
 * ------------------------------------------------------------
 * 1) 월말 정산: 지난달이 끝나고 유예기간이 지났고, 그 달 미확인 거래가 없으면 '확정'(system)
 * 2) 자동 재계산(숫자만) → 수정안 생성(기준 계획은 바꾸지 않음)
 * 3) 고객이 자동 적용에 동의했고 수정안이 동의 범위 안(예산 조정만, 월 한도·필수생활비 하한)이면 앱 내부 예산만 새 버전으로 적용
 * 4) 알림 생성(같은 상황 중복 방지) → 수신 설정·방해금지 시간 확인 후 Web Push(구독이 있을 때)
 */
'use strict';
const Calc = require('../public/js/engine/calc.js');
const Analysis = require('../public/js/engine/analysis.js');
const Monthly = require('../public/js/engine/monthly.js');
const push = require('./push');
const changes = require('./changes');

const DEFAULT_NOTIF = { types: { overspend: true, savingShort: true, emergencyLow: true, goalFlip: true, surplus: true, revision: true }, quietStart: '22:00', quietEnd: '08:00', push: true, lockDetails: false };
const DEFAULT_CONSENT = { enabled: false, monthlyLimit: 100000, floor: 0, agreedAt: null };

function nowIso(d) { return (d || new Date()).toISOString(); }
function j(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }

async function baselinePlan(h, cid) {
  const b = await h.get('SELECT plan_id FROM baselines WHERE client_id = ? ORDER BY id DESC LIMIT 1', cid);
  const row = b ? await h.get('SELECT * FROM plans WHERE id = ?', b.plan_id)
    : await h.get("SELECT * FROM plans WHERE client_id = ? AND kind = 'after' ORDER BY version DESC LIMIT 1", cid);
  return row ? { id: Number(row.id), version: Number(row.version), kind: row.kind, data: JSON.parse(row.data) } : null;
}

async function context(db, cid, now) {
  const plan = await baselinePlan(db, cid); if (!plan) return null;
  const records = (await db.all('SELECT month, category, amount, source, voided_at AS "voidedAt" FROM records WHERE client_id = ? AND voided_at IS NULL', cid));
  const txs = (await db.all('SELECT id, date, amount, suggested, confirmed_at AS "confirmedAt" FROM transactions WHERE client_id = ?', cid)).map((t) => Object.assign(t, { id: Number(t.id), suggested: j(t.suggested, null) }));
  const scheduled = (await db.all('SELECT id, month, label, amount, category, kind, paid FROM scheduled WHERE client_id = ?', cid)).map((s) => Object.assign(s, { id: Number(s.id), paid: !!Number(s.paid) }));
  const closed = (await db.all('SELECT month FROM month_closures WHERE client_id = ?', cid)).map((r) => r.month);
  const st = await db.get('SELECT data FROM settings WHERE client_id = ?', cid);
  const alertSettings = Object.assign({ dueDay: 25, graceDays: 3, cumTolerancePct: 10, budgetTolerancePct: 10, emergencyMinMonths: 3, staleDays: 7 }, j(st && st.data, {}));
  const ns = await db.get('SELECT data FROM notif_settings WHERE client_id = ?', cid);
  const notif = Object.assign({}, DEFAULT_NOTIF, j(ns && ns.data, {})); notif.types = Object.assign({}, DEFAULT_NOTIF.types, notif.types || {});
  const cs = await db.get('SELECT data FROM auto_consent WHERE client_id = ?', cid);
  const consent = Object.assign({}, DEFAULT_CONSENT, j(cs && cs.data, {}));
  return { plan, data: plan.data, records, txs, scheduled, closed, alertSettings, notif, consent, today: now || new Date() };
}

async function autoClose(db, cid, ctx) {
  const base = ctx.data.basis.baseMonth, today = ctx.today, cur = Monthly.ymOf(today);
  const out = [];
  for (let t = 1; ; t++) {
    const ym = Calc.ymAdd(base, t);
    if (Calc.ymDiff(ym, cur) <= 0) break;
    if (ctx.closed.includes(ym)) continue;
    const [y, m] = ym.split('-').map(Number);
    const end = new Date(y, m, 0, 23, 59, 59); // 그 달 말일
    if ((today - end) / 864e5 < ctx.alertSettings.graceDays) continue;
    if (ctx.txs.some((x) => !x.confirmedAt && x.date.slice(0, 7) === ym)) continue; // 미확인 거래가 있으면 잠정 유지
    const r = await db.run('INSERT OR IGNORE INTO month_closures (client_id, month, closed_at, closed_by) VALUES (?,?,?,?)', cid, ym, nowIso(today), 'system');
    ctx.closed.push(ym); if (r.changes) out.push(ym);
  }
  return out;
}

async function clientUserId(h, cid) { const r = await h.get('SELECT user_id FROM clients WHERE id = ?', cid); return r && Number(r.user_id); }

// h: db 또는 트랜잭션 핸들
async function applyRevision(h, cid, rev, byUserId, how) {
  const data = JSON.parse(rev.data);
  const v = Number(((await h.get("SELECT MAX(version) AS v FROM plans WHERE client_id = ? AND kind = 'after'", cid)) || {}).v || 0) + 1;
  const label = how === 'auto' ? '자동 적용(동의 범위)' : '수정안 적용';
  const pid = (await h.run('INSERT INTO plans (client_id, kind, version, label, note, data, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    cid, 'after', v, label, (JSON.parse(rev.summary).changes || []).join(' / ').slice(0, 500), JSON.stringify(data), byUserId, nowIso())).id;
  await h.run('INSERT INTO baselines (client_id, plan_id, set_by, set_at, reason) VALUES (?,?,?,?,?)', cid, pid, byUserId, nowIso(), label + ' #' + rev.id);
  await h.run('UPDATE revisions SET status = ?, decided_at = ?, applied_plan_id = ? WHERE id = ?', how === 'auto' ? 'auto' : 'applied', nowIso(), pid, rev.id);
  return { planId: pid, version: v };
}

async function addNotice(db, cid, n, revId) {
  const r = await db.run('INSERT OR IGNORE INTO notifications (client_id, type, dkey, fact, impact, action, revision_id, amounts, created_at, push_state) VALUES (?,?,?,?,?,?,?,?,?,?)',
    cid, n.type, n.key, n.fact, n.impact || '', n.action || '', revId || null, JSON.stringify(n.amounts || {}), nowIso(), 'pending');
  return r.changes ? r.id : null;
}

/*
 * evaluate(db, cid, opts) → { closed, revisions, notifications }
 * 같은 고객의 점검이 동시에 돌지 않도록 고객별로 줄을 세웁니다(재시도·동시 저장 시 수정안·알림 중복 방지 — DB 고유 제약과 이중 방어).
 */
const running = new Map();
function evaluate(db, cid, opts) {
  const key = cid;
  const prev = running.get(key) || Promise.resolve();
  const p = prev.catch(() => {}).then(() => evaluateNow(db, cid, opts));
  running.set(key, p);
  p.finally(() => { if (running.get(key) === p) running.delete(key); }).catch(() => {});
  return p;
}
async function evaluateNow(db, cid, opts) {
  opts = opts || {};
  const ctx = await context(db, cid, opts.now); if (!ctx) return { skipped: true };
  const newlyClosed = await autoClose(db, cid, ctx);
  const rc = Monthly.recalc(ctx);
  const ex = Analysis.execution(ctx.data, Monthly.finalRecords(ctx.records, ctx.closed), { today: ctx.today, settings: ctx.alertSettings });
  const prev = await db.get('SELECT status FROM eval_state WHERE client_id = ?', cid);
  const prevStatus = prev ? prev.status : rc.plan.status;
  const created = [], revs = []; let autoApplied = null;

  // 수정안
  const kinds = [];
  if (rc.lastFinal && rc.lastFinal.overspend > rc.lastFinal.planned * ctx.alertSettings.budgetTolerancePct / 100) kinds.push('overspend');
  else if (prevStatus === 'achieved' && rc.forecast.status !== 'achieved') kinds.push('goalFlip');
  if (rc.lastFinal && rc.lastFinal.slack >= 10000) kinds.push('surplus');
  for (const kind of kinds) {
    const month = rc.closedYm || rc.startYm;
    if (await db.get('SELECT 1 AS ok FROM revisions WHERE client_id = ? AND kind = ? AND month = ? AND base_plan_id = ?', cid, kind, month, ctx.plan.id)) continue;
    const p = Monthly.proposal(ctx, rc, kind);
    if (!p.applicable && !p.infeasible) continue;
    const summary = { changes: p.changes, compare: p.compare || null, amount: p.amount || null, autoEligible: p.autoEligible, needsBalanceCheck: !!p.needsBalanceCheck, infeasible: !!p.infeasible, alternatives: p.alternatives, startYm: p.startYm, remaining: rc.remaining };
    const info = await db.run('INSERT OR IGNORE INTO revisions (client_id, base_plan_id, kind, month, status, data, summary, created_at) VALUES (?,?,?,?,?,?,?,?)',
      cid, ctx.plan.id, kind, month, p.infeasible ? 'info' : 'pending', p.data ? JSON.stringify(p.data) : null, JSON.stringify(summary), nowIso());
    if (!info.changes) continue;
    const rev = await db.get('SELECT * FROM revisions WHERE id = ?', info.id);
    // 자동 적용: 동의했고 예산 조정만이며 범위 안일 때만. 목표일·대출·위험·해지는 대상 아님(수정안 종류가 예산 조정뿐)
    if (ctx.consent.enabled && p.autoEligible && (kind === 'overspend' || kind === 'goalFlip')) {
      const uid = await clientUserId(db, cid);
      autoApplied = await db.tx((t) => applyRevision(t, cid, rev, uid, 'auto'));
    }
    const fresh = await db.get('SELECT * FROM revisions WHERE id = ?', rev.id);
    revs.push(Number(fresh.id));
    if (ctx.notif.types.revision) { const id = await addNotice(db, cid, Monthly.revisionNotice({ id: fresh.id, kind, month, status: fresh.status, compare: p.compare }), fresh.id); if (id) created.push(id); }
  }

  // 알림
  for (const n of Monthly.notices(ctx, rc, ex, prevStatus)) {
    if (!ctx.notif.types[n.type]) continue;
    const rev = (n.type === 'overspend' || n.type === 'surplus' || n.type === 'goalFlip') ? await db.get('SELECT id FROM revisions WHERE client_id = ? AND month = ? AND kind = ? ORDER BY id DESC LIMIT 1', cid, n.month || rc.startYm, n.type) : null;
    const id = await addNotice(db, cid, n, rev && rev.id); if (id) created.push(id);
  }
  await db.run('INSERT INTO eval_state (client_id, status, gap, at) VALUES (?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET status = excluded.status, gap = excluded.gap, at = excluded.at', cid, rc.forecast.status, rc.forecast.gap, nowIso());
  if (created.length || revs.length || newlyClosed.length) {
    const text = [newlyClosed.length ? newlyClosed.join('·') + ' 자동 확정' : '', revs.length ? '수정안 ' + revs.length + '건' : '', created.length ? '알림 ' + created.length + '건' : '', autoApplied ? '동의 범위 자동 적용(v' + autoApplied.version + ')' : ''].filter(Boolean).join(', ');
    changes.publish(db, [await changes.log(db, { clientId: cid, user: null, entity: autoApplied ? 'baseline' : 'evaluation', text })]);
  }
  return { closed: newlyClosed, revisions: revs, notifications: created, recalc: rc };
}

// 대기 중인 푸시 발송(방해금지 시간 밖일 때). 잠금 화면에는 기본적으로 금액을 넣지 않음.
async function dispatch(db, cid, keys, opts) {
  opts = opts || {};
  const ctx = await context(db, cid, opts.now); if (!ctx) return { sent: 0 };
  const pend = await db.all("SELECT * FROM notifications WHERE client_id = ? AND push_state = 'pending' ORDER BY id", cid);
  if (!pend.length) return { sent: 0 };
  const subs = await db.all('SELECT * FROM push_subs WHERE client_id = ?', cid);
  if (!ctx.notif.push || !subs.length) { await db.run("UPDATE notifications SET push_state = 'none' WHERE client_id = ? AND push_state = 'pending'", cid); return { sent: 0, reason: 'noSubscription' }; }
  if (Monthly.inQuiet(ctx.notif.quietStart, ctx.notif.quietEnd, ctx.today)) return { sent: 0, reason: 'quiet' };
  const sender = opts.sender || ((sub, payload) => push.send(keys, sub, payload, process.env.FP_VAPID_SUBJECT || 'mailto:planner-demo@example.com'));
  let sent = 0;
  for (const n of pend) {
    const payload = { title: '재무플래너', body: ctx.notif.lockDetails ? n.fact : '새 알림이 있습니다. 앱에서 확인해 주세요.', tag: n.dkey, url: '/#inbox' };
    let okAny = false;
    for (const s of subs) {
      try {
        const r = await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        if (r.ok) okAny = true; if (r.gone) await db.run('DELETE FROM push_subs WHERE id = ?', s.id);
      } catch (e) { /* 네트워크 오류 — 다음 점검 때 재시도하지 않고 알림함에만 남김 */ }
    }
    await db.run('UPDATE notifications SET push_state = ? WHERE id = ?', okAny ? 'sent' : 'failed', n.id);
    if (okAny) sent++;
  }
  return { sent };
}

async function runAll(db, keys, opts) {
  const ids = (await db.all('SELECT id FROM clients')).map((r) => Number(r.id));
  for (const id of ids) { try { await evaluate(db, id, opts); await dispatch(db, id, keys, opts); } catch (e) { console.error('점검 오류(고객 ' + id + '):', e.message); } }
}

module.exports = { evaluate, dispatch, runAll, context, applyRevision, baselinePlan, DEFAULT_NOTIF, DEFAULT_CONSENT };
