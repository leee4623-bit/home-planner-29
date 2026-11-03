/*
 * API 확장 — 위험성향, A/B/C안, 실행 기준 계획, 월별 지출(예정 결제·월 확정), 수정안, 알림, 자동 적용 동의, Web Push
 * 모든 경로는 api.js의 clientOf(서버 권한 검사)를 거칩니다.
 */
'use strict';
const Calc = require('../public/js/engine/calc.js');
const Analysis = require('../public/js/engine/analysis.js');
const Risk = require('../public/js/engine/risk.js');
const Strategies = require('../public/js/engine/strategies.js');
const jobs = require('./jobs');

const j = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const now = () => new Date().toISOString();
const TYPES = ['안정형', '안정추구형', '위험중립형', '적극투자형', '공격투자형'];

function extend(add, db, h) {
  const { clientOf, need, audit, HttpError, pushKeys } = h;
  const P = (q) => Number(q.p.id);
  const rerun = (cid) => { try { jobs.evaluate(db, cid); } catch (e) { console.error(e); } };

  function riskRows(cid) {
    return db.prepare('SELECT * FROM risk_profiles WHERE client_id = ? ORDER BY diagnosed_at, id').all(cid).map((r) => ({
      id: r.id, kind: r.kind, type: r.type, typeId: r.type_id, diagnosedAt: r.diagnosed_at, source: r.source, purpose: r.purpose,
      answers: j(r.answers, null), result: j(r.result, null), version: r.version, snapshot: j(r.snapshot, {}), createdAt: r.created_at
    }));
  }
  function plansOf(cid) { return db.prepare('SELECT * FROM plans WHERE client_id = ?').all(cid); }
  function baseline(cid) { return jobs.baselinePlan(db, cid); }
  function snapshotOf(cid) {
    const b = baseline(cid); if (!b) return {};
    const d = Calc.normalize(b.data);
    return { netMonthly: d.income.netMonthly, totalDebt: d.debts.reduce((s, x) => s + x.balance, 0), purpose: '주거자금 마련(' + d.basis.moveMonth + ' 이사)', planId: b.id };
  }

  // 한 번에 불러오기
  add('GET', '/api/clients/:id/extra', (q) => {
    const cid = P(q); clientOf(db, q.user, cid);
    const b = db.prepare('SELECT plan_id, set_at, reason FROM baselines WHERE client_id = ? ORDER BY id').all(cid);
    const ctx = jobs.context(db, cid);
    return {
      risk: riskRows(cid), snapshot: snapshotOf(cid), riskVersion: Risk.CFG.VERSION,
      strategies: db.prepare('SELECT * FROM strategy_sets WHERE client_id = ? ORDER BY id').all(cid).filter((s) => q.user.role === 'planner' || s.status !== 'draft').map((s) => ({ id: s.id, basePlanId: s.base_plan_id, riskId: s.risk_id, status: s.status, overrides: j(s.overrides, {}), result: j(s.result, null), note: s.note, createdAt: s.created_at, presentedAt: s.presented_at, selectedKey: s.selected_key, selectedAt: s.selected_at, selectedPlanId: s.selected_plan_id })),
      baselineId: ctx ? ctx.plan.id : null, baselines: b.map((x) => ({ planId: x.plan_id, setAt: x.set_at, reason: x.reason })),
      scheduled: ctx ? ctx.scheduled : [], closures: db.prepare('SELECT month, closed_at AS closedAt, closed_by AS closedBy FROM month_closures WHERE client_id = ? ORDER BY month').all(cid),
      revisions: db.prepare('SELECT * FROM revisions WHERE client_id = ? ORDER BY id DESC').all(cid).map((r) => ({ id: r.id, basePlanId: r.base_plan_id, kind: r.kind, month: r.month, status: r.status, summary: j(r.summary, {}), createdAt: r.created_at, decidedAt: r.decided_at, appliedPlanId: r.applied_plan_id })),
      notifications: db.prepare('SELECT * FROM notifications WHERE client_id = ? ORDER BY id DESC LIMIT 100').all(cid).map((n) => ({ id: n.id, type: n.type, key: n.dkey, fact: n.fact, impact: n.impact, action: n.action, revisionId: n.revision_id, amounts: j(n.amounts, {}), createdAt: n.created_at, readAt: n.read_at, pushState: n.push_state })),
      notifSettings: ctx ? ctx.notif : jobs.DEFAULT_NOTIF, consent: ctx ? ctx.consent : jobs.DEFAULT_CONSENT,
      inquiries: db.prepare('SELECT id, notification_id AS notificationId, message, created_at AS createdAt FROM inquiries WHERE client_id = ? ORDER BY id DESC').all(cid),
      pushSubscribed: !!db.prepare('SELECT 1 FROM push_subs WHERE client_id = ? AND user_id = ?').get(cid, q.user.id)
    };
  });

  // ---------- 위험성향 ----------
  add('POST', '/api/clients/:id/risk/official', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'planner', 403, '금융기관 결과는 설계사가 확인 후 입력합니다.');
    const b = q.body; need(TYPES.includes(b.type), 400, '유형을 선택해 주세요.'); need(/^\d{4}-\d{2}-\d{2}$/.test(b.diagnosedAt || ''), 400, '진단일(YYYY-MM-DD)을 입력해 주세요.');
    need(String(b.source || '').trim(), 400, '출처(금융기관·서류명)를 입력해 주세요.');
    db.prepare('INSERT INTO risk_profiles (client_id, kind, type, type_id, diagnosed_at, source, purpose, snapshot, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(cid, 'official', b.type, TYPES.indexOf(b.type) + 1, b.diagnosedAt, String(b.source).slice(0, 80), String(b.purpose || '').slice(0, 80), JSON.stringify(b.snapshot || {}), q.user.id, now());
    audit(db, q.user, 'risk.official', 'client:' + cid); return { ok: true };
  });
  add('POST', '/api/clients/:id/risk/app', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '앱 설문은 고객 본인이 답합니다.');
    const answers = q.body.answers || {};
    const res = Risk.score(answers); // 서버에서 다시 채점(화면 값을 믿지 않음)
    need(res.complete, 400, '판단에 필요한 답변이 빠졌습니다: ' + res.missing.concat(res.insufficient).join(', '));
    const snap = snapshotOf(cid);
    db.prepare('INSERT INTO risk_profiles (client_id, kind, type, type_id, diagnosed_at, source, purpose, answers, result, version, snapshot, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(cid, 'app', res.type, res.typeId, now().slice(0, 10), Risk.CFG.LABEL + ' 설문', snap.purpose || '', JSON.stringify(answers), JSON.stringify(res), Risk.CFG.VERSION, JSON.stringify(snap), q.user.id, now());
    audit(db, q.user, 'risk.app', 'client:' + cid); return { ok: true, result: res };
  });

  // ---------- A/B/C ----------
  function riskForStrategy(cid) {
    const rows = riskRows(cid);
    const app = rows.filter((r) => r.kind === 'app').pop();
    if (app) return { id: app.id, typeId: app.typeId, type: app.type, status: app.result.status, flags: app.result.flags, housingCoreMax: app.result.housingCoreMax, source: '앱 설문 ' + app.diagnosedAt };
    const off = rows.filter((r) => r.kind === 'official').pop();
    if (off) return { id: off.id, typeId: off.typeId, type: off.type, status: 'needsReview', flags: [{ id: 'officialOnly', reason: '금융기관 결과만 있고 앱 설문(재무 여력 확인)이 없습니다.' }], source: off.source + ' ' + off.diagnosedAt };
    return null;
  }
  function profileOf(cid) { return j(db.prepare('SELECT profile FROM clients WHERE id = ?').get(cid).profile, {}); }
  function buildSet(cid, basePlanId, overrides) {
    const pl = db.prepare('SELECT * FROM plans WHERE id = ? AND client_id = ?').get(Number(basePlanId), cid);
    need(pl, 404, '기준 계획을 찾을 수 없습니다.');
    const risk = riskForStrategy(cid);
    const r = Strategies.build(JSON.parse(pl.data), risk, profileOf(cid), overrides || {});
    return { pl, risk, r };
  }
  add('POST', '/api/clients/:id/strategies', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'planner', 403, '설계안은 설계사가 만듭니다.');
    const { pl, risk, r } = buildSet(cid, q.body.basePlanId, q.body.overrides);
    const id = Number(db.prepare('INSERT INTO strategy_sets (client_id, base_plan_id, risk_id, status, overrides, result, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(cid, pl.id, risk ? risk.id : null, 'draft', JSON.stringify(q.body.overrides || {}), JSON.stringify(r), String(q.body.note || '').slice(0, 300), q.user.id, now()).lastInsertRowid);
    return { id };
  });
  add('PUT', '/api/clients/:id/strategies/:sid', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'planner', 403, '설계사만 수정할 수 있습니다.');
    const s = db.prepare('SELECT * FROM strategy_sets WHERE id = ? AND client_id = ?').get(Number(q.p.sid), cid);
    need(s, 404, '설계안을 찾을 수 없습니다.'); need(s.status === 'draft', 409, '제시한 설계안은 수정할 수 없습니다. 새로 만들어 주세요.');
    const { r } = buildSet(cid, s.base_plan_id, q.body.overrides);
    db.prepare('UPDATE strategy_sets SET overrides = ?, result = ?, note = ? WHERE id = ?').run(JSON.stringify(q.body.overrides || {}), JSON.stringify(r), String(q.body.note || s.note || '').slice(0, 300), s.id);
    return { ok: true };
  });
  add('POST', '/api/clients/:id/strategies/:sid/present', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'planner', 403, '설계사만 제시할 수 있습니다.');
    const s = db.prepare('SELECT * FROM strategy_sets WHERE id = ? AND client_id = ?').get(Number(q.p.sid), cid);
    need(s && s.status === 'draft', 409, '작성 중인 설계안만 제시할 수 있습니다.');
    db.prepare("UPDATE strategy_sets SET status = 'withdrawn' WHERE client_id = ? AND status = 'presented'").run(cid);
    db.prepare("UPDATE strategy_sets SET status = 'presented', presented_at = ? WHERE id = ?").run(now(), s.id);
    db.prepare('INSERT OR IGNORE INTO notifications (client_id, type, dkey, fact, impact, action, created_at, push_state) VALUES (?,?,?,?,?,?,?,?)')
      .run(cid, 'revision', 'strategy:' + s.id, '설계사가 A/B/C 재무설계안을 보냈습니다.', '세 안의 목표일 예상 가용자금과 불리한 상황 결과를 비교할 수 있습니다.', '‘성향·설계안’에서 비교하고 한 가지를 선택해 주세요.', now(), 'pending');
    return { ok: true };
  });
  add('POST', '/api/clients/:id/strategies/:sid/select', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '실행할 안은 고객이 선택합니다.');
    const s = db.prepare('SELECT * FROM strategy_sets WHERE id = ? AND client_id = ?').get(Number(q.p.sid), cid);
    need(s && s.status === 'presented', 409, '제시된 설계안이 아닙니다.');
    const r = JSON.parse(s.result), opt = r.options.find((o) => o.key === q.body.key);
    need(opt, 400, '안을 선택해 주세요.'); need(q.body.confirm === true, 400, '선택 내용을 확인해 주세요.');
    const v = (db.prepare("SELECT MAX(version) AS v FROM plans WHERE client_id = ? AND kind = 'after'").get(cid).v || 0) + 1;
    const pid = Number(db.prepare('INSERT INTO plans (client_id, kind, version, label, note, data, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(cid, 'after', v, '고객 선택 ' + opt.key + '안', opt.title + ' — ' + opt.actions.join(', ').slice(0, 400), JSON.stringify(opt.data), q.user.id, now()).lastInsertRowid);
    db.prepare('INSERT INTO baselines (client_id, plan_id, set_by, set_at, reason) VALUES (?,?,?,?,?)').run(cid, pid, q.user.id, now(), '고객 선택 ' + opt.key + '안 (설계안 #' + s.id + ')');
    db.prepare("UPDATE strategy_sets SET status = 'selected', selected_key = ?, selected_at = ?, selected_plan_id = ? WHERE id = ?").run(opt.key, now(), pid, s.id);
    audit(db, q.user, 'strategy.select', 'client:' + cid + ':' + opt.key); rerun(cid);
    return { ok: true, planId: pid, version: v };
  });

  // 실행 기준 계획 지정(고객 확인)
  add('POST', '/api/clients/:id/baseline', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '실행 기준 계획은 고객이 확인해 정합니다.');
    const pl = db.prepare("SELECT id FROM plans WHERE id = ? AND client_id = ? AND kind = 'after'").get(Number(q.body.planId), cid); need(pl, 404, '설계 후 계획을 찾을 수 없습니다.');
    db.prepare('INSERT INTO baselines (client_id, plan_id, set_by, set_at, reason) VALUES (?,?,?,?,?)').run(cid, pl.id, q.user.id, now(), '고객 확인'); rerun(cid);
    return { ok: true };
  });

  // ---------- 예정 결제·월 확정 ----------
  add('POST', '/api/clients/:id/scheduled', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '고객 본인만 입력합니다.');
    const b = q.body; need(Calc.ymValid(b.month), 400, '월을 확인해 주세요.'); const a = Number(b.amount); need(isFinite(a) && a > 0, 400, '금액을 입력해 주세요.');
    need(['essential', 'optional'].includes(b.category), 400, '항목을 선택해 주세요.'); need(['card', 'fixed'].includes(b.kind), 400, '종류를 선택해 주세요.');
    need(!db.prepare('SELECT 1 FROM month_closures WHERE client_id = ? AND month = ?').get(cid, b.month), 409, '확정된 달에는 예정 결제를 추가할 수 없습니다.');
    db.prepare('INSERT INTO scheduled (client_id, month, label, amount, category, kind, paid, created_at) VALUES (?,?,?,?,?,?,0,?)').run(cid, b.month, String(b.label || (b.kind === 'card' ? '카드대금' : '고정비')).slice(0, 30), a, b.category, b.kind, now());
    return { ok: true };
  });
  add('POST', '/api/clients/:id/scheduled/:sid/paid', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '고객 본인만 할 수 있습니다.');
    const r = db.prepare('UPDATE scheduled SET paid = 1 WHERE id = ? AND client_id = ?').run(Number(q.p.sid), cid); need(r.changes, 404, '항목이 없습니다.');
    return { ok: true };
  });
  add('DELETE', '/api/clients/:id/scheduled/:sid', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '고객 본인만 할 수 있습니다.');
    db.prepare('DELETE FROM scheduled WHERE id = ? AND client_id = ? AND paid = 0').run(Number(q.p.sid), cid); return { ok: true };
  });
  add('POST', '/api/clients/:id/months/:ym/close', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '월 확정은 고객이 합니다.');
    const ym = q.p.ym; need(Calc.ymValid(ym), 400, '월을 확인해 주세요.');
    const pendTx = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE client_id = ? AND substr(date,1,7) = ? AND confirmed_at IS NULL").get(cid, ym).n;
    const pendSch = db.prepare('SELECT COUNT(*) AS n FROM scheduled WHERE client_id = ? AND month = ? AND paid = 0').get(cid, ym).n;
    need(q.body.confirm === true, 400, '확정 전에 내용을 확인해 주세요.');
    need(!pendTx && !pendSch, 409, '아직 확인하지 않은 거래 ' + pendTx + '건, 결제 전 예정 항목 ' + pendSch + '건이 있습니다. 먼저 정리해 주세요.');
    db.prepare('INSERT OR IGNORE INTO month_closures (client_id, month, closed_at, closed_by) VALUES (?,?,?,?)').run(cid, ym, now(), 'client');
    rerun(cid); return { ok: true };
  });

  // ---------- 수정안 ----------
  add('POST', '/api/clients/:id/revisions/:rid/apply', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '수정안은 고객이 확인 후 적용합니다.');
    const rev = db.prepare('SELECT * FROM revisions WHERE id = ? AND client_id = ?').get(Number(q.p.rid), cid);
    need(rev, 404, '수정안이 없습니다.'); need(['pending', 'held'].includes(rev.status) && rev.data, 409, '적용할 수 없는 수정안입니다.');
    const cur = baseline(cid); need(cur && cur.id === rev.base_plan_id, 409, '기준 계획이 그 사이 바뀌어 이 수정안은 더 이상 맞지 않습니다. 다시 점검해 주세요.');
    const s = j(rev.summary, {}); if (s.needsBalanceCheck) need(q.body.balanceConfirmed === true, 400, '통장에 그 금액이 실제로 남아 있는지 확인해 주세요.');
    const out = jobs.applyRevision(db, cid, rev, q.user.id, 'manual'); rerun(cid); return out;
  });
  add('POST', '/api/clients/:id/revisions/:rid/hold', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '고객만 보류할 수 있습니다.');
    const r = db.prepare("UPDATE revisions SET status = 'held', decided_at = ? WHERE id = ? AND client_id = ? AND status = 'pending'").run(now(), Number(q.p.rid), cid);
    need(r.changes, 409, '보류할 수 없는 수정안입니다.'); return { ok: true };
  });

  // ---------- 알림 ----------
  add('POST', '/api/clients/:id/notifications/:nid/read', (q) => {
    const cid = P(q); clientOf(db, q.user, cid);
    db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND client_id = ?').run(now(), Number(q.p.nid), cid); return { ok: true };
  });
  add('POST', '/api/clients/:id/notifications/:nid/ask', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '고객만 문의할 수 있습니다.');
    const m = String(q.body.message || '').trim(); need(m, 400, '문의 내용을 입력해 주세요.');
    db.prepare('INSERT INTO inquiries (client_id, notification_id, message, created_at) VALUES (?,?,?,?)').run(cid, Number(q.p.nid), m.slice(0, 500), now()); return { ok: true };
  });
  add('PUT', '/api/clients/:id/notif-settings', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '알림 설정은 고객이 정합니다.');
    const b = q.body.settings || {}, t = /^([01]\d|2[0-3]):[0-5]\d$/;
    need(!b.quietStart || t.test(b.quietStart), 400, '방해금지 시작 시각(HH:MM)을 확인해 주세요.'); need(!b.quietEnd || t.test(b.quietEnd), 400, '방해금지 끝 시각(HH:MM)을 확인해 주세요.');
    const clean = { types: {}, quietStart: b.quietStart || '', quietEnd: b.quietEnd || '', push: !!b.push, lockDetails: !!b.lockDetails };
    Object.keys(jobs.DEFAULT_NOTIF.types).forEach((k) => { clean.types[k] = !(b.types && b.types[k] === false); });
    db.prepare('INSERT INTO notif_settings (client_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(cid, JSON.stringify(clean), now());
    return { settings: clean };
  });
  add('PUT', '/api/clients/:id/consent', (q) => {
    const cid = P(q); clientOf(db, q.user, cid); need(q.user.role === 'client', 403, '자동 적용 동의는 고객 본인만 할 수 있습니다.');
    const b = q.body.consent || {}; const lim = Number(b.monthlyLimit), fl = Number(b.floor);
    need(isFinite(lim) && lim >= 0 && lim <= 1000000, 400, '월 조정 한도는 0~100만원입니다.'); need(isFinite(fl) && fl >= 0, 400, '필수생활비 하한을 확인해 주세요.');
    const clean = { enabled: !!b.enabled, monthlyLimit: lim, floor: fl, agreedAt: b.enabled ? now() : null };
    db.prepare('INSERT INTO auto_consent (client_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(cid, JSON.stringify(clean), now());
    audit(db, q.user, 'consent.update', 'client:' + cid); return { consent: clean };
  });
  add('POST', '/api/clients/:id/evaluate', (q) => {
    const cid = P(q); clientOf(db, q.user, cid);
    const r = jobs.evaluate(db, cid);
    return { closed: r.closed || [], revisions: (r.revisions || []).length, notifications: (r.notifications || []).length };
  });

  // ---------- Web Push ----------
  add('GET', '/api/push/key', () => ({ publicKey: pushKeys.publicKey }));
  add('POST', '/api/push/subscribe', (q) => {
    need(q.user.role === 'client', 403, '고객 알림만 지원합니다.');
    const s = q.body.subscription || {}; need(/^https:\/\//.test(s.endpoint || '') && s.keys && s.keys.p256dh && s.keys.auth, 400, '구독 정보가 올바르지 않습니다.');
    db.prepare('INSERT INTO push_subs (user_id, client_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, client_id = excluded.client_id, p256dh = excluded.p256dh, auth = excluded.auth')
      .run(q.user.id, q.user.clientId, s.endpoint, s.keys.p256dh, s.keys.auth, now());
    return { ok: true };
  });
  add('POST', '/api/push/unsubscribe', (q) => { db.prepare('DELETE FROM push_subs WHERE user_id = ? AND (endpoint = ? OR ? = 1)').run(q.user.id, String(q.body.endpoint || ''), q.body.all ? 1 : 0); return { ok: true }; });
  add('POST', '/api/push/test', async (q) => {
    need(q.user.role === 'client', 403, '고객만 시험할 수 있습니다.');
    const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(q.user.id); need(subs.length, 409, '이 기기에서 알림 받기를 먼저 켜 주세요.');
    const push = require('./push'); let ok = 0, last = null;
    for (const s of subs) { try { const r = await push.send(pushKeys, { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, { title: '재무플래너', body: '시험 알림입니다.', tag: 'test', url: '/#inbox' }, process.env.FP_VAPID_SUBJECT || 'mailto:planner-demo@example.com'); last = r.status; if (r.ok) ok++; if (r.gone) db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id); } catch (e) { last = e.message; } }
    return { sent: ok, total: subs.length, lastStatus: last };
  });
  void HttpError; void Analysis;
}

module.exports = { extend };
