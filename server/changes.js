/*
 * 변경 이력과 실시간 전달
 * ------------------------------------------------------------
 * - 저장이 DB에 커밋된 뒤에만 publish → 저장 성공이 확인된 값만 다른 기기로 전달됩니다.
 * - 모든 변경은 changes 표에 남습니다(변경자·역할·시각·항목·데이터 버전). 실시간 연결이 끊긴 동안의
 *   변경은 이 표에서 '마지막으로 받은 번호 이후'를 다시 조회해 복구합니다(SSE Last-Event-ID, 주기 조회 모두 동일).
 * - audience: all(고객·설계사) | planner(설계사만, 예: 설계사 초안) | client(고객만)
 * - 서버 프로세스 1개 기준(EventEmitter). 여러 대로 늘릴 때는 Postgres LISTEN/NOTIFY로 바꿔야 합니다.
 */
'use strict';
const { EventEmitter } = require('events');

function createBus() { const b = new EventEmitter(); b.setMaxListeners(1000); return b; }

async function log(h, c) {
  const at = new Date().toISOString();
  const summary = JSON.stringify({ items: c.items || [], text: c.text || '', audience: c.audience || 'all', ref: c.ref || null });
  const r = await h.run('INSERT INTO changes (client_id, actor_id, actor_role, entity, version, summary, at) VALUES (?,?,?,?,?,?,?)',
    Number(c.clientId), c.user ? c.user.id : null, c.user ? c.user.role : 'system', c.entity, c.version == null ? null : Number(c.version), summary, at);
  return { id: r.id, clientId: Number(c.clientId), entity: c.entity, version: c.version == null ? null : Number(c.version), actorRole: c.user ? c.user.role : 'system', actorName: c.user ? c.user.name : '자동 점검', items: c.items || [], text: c.text || '', audience: c.audience || 'all', ref: c.ref || null, at };
}

function rowToEvent(r, names) {
  let s = {}; try { s = JSON.parse(r.summary || '{}'); } catch (e) { /* 무시 */ }
  return { id: Number(r.id), clientId: Number(r.client_id), entity: r.entity, version: r.version == null ? null : Number(r.version), actorRole: r.actor_role, actorName: (names && names[r.actor_id]) || (r.actor_role === 'system' ? '자동 점검' : ''), items: s.items || [], text: s.text || '', audience: s.audience || 'all', ref: s.ref || null, at: r.at };
}

function visible(ev, user) {
  if (ev.audience === 'planner') return user.role === 'planner';
  if (ev.audience === 'client') return user.role === 'client';
  return true;
}

function publish(db, events) { if (!db.bus) return; (events || []).filter(Boolean).forEach((e) => db.bus.emit('change', e)); }

// since 이후 변경(허용된 고객만)
async function since(db, user, clientIds, sinceId, limit) {
  if (!clientIds.length) return [];
  const rows = await db.all('SELECT c.*, u.name AS actor_name FROM changes c LEFT JOIN users u ON u.id = c.actor_id WHERE c.id > ? AND c.client_id IN (' + clientIds.map(() => '?').join(',') + ') ORDER BY c.id LIMIT ?', Number(sinceId) || 0, ...clientIds, limit || 500);
  return rows.map((r) => Object.assign(rowToEvent(r), { actorName: r.actor_name || (r.actor_role === 'system' ? '자동 점검' : '') })).filter((e) => visible(e, user));
}
async function latestId(db) { const r = await db.get('SELECT MAX(id) AS m FROM changes'); return Number((r && r.m) || 0); }

module.exports = { createBus, log, publish, since, latestId, visible };
