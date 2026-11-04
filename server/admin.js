/*
 * 관리자 기능 — 계정·역할·고객 배정은 여기(서버)에서만 바꿉니다. 로그인 화면이나 일반 API로는 바꿀 수 없습니다.
 * ------------------------------------------------------------
 * 1) 명령줄(서버 컴퓨터 또는 Render Shell):
 *      node server/admin.js list
 *      node server/admin.js add-planner  <이메일> <이름> <비밀번호>
 *      node server/admin.js add-client   <이메일> <이름> <비밀번호>
 *      node server/admin.js assign       <설계사 이메일> <고객 이메일>
 *      node server/admin.js unassign     <설계사 이메일> <고객 이메일>
 *      node server/admin.js disable|enable <이메일>
 *      node server/admin.js password     <이메일> <새 비밀번호>
 *    DATABASE_URL(배포 DB) 또는 FP_DB(내 PC 파일)를 그대로 사용합니다.
 * 2) HTTP: FP_ADMIN_TOKEN 환경변수가 설정된 경우에만 /api/admin/* 사용 가능(Authorization: Bearer <토큰>).
 * 배정 해제·비활성화는 즉시 실시간 구독에서도 차단되도록 'access' 신호를 보냅니다(다른 프로세스면 30초 안에 재검사로 차단).
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('./auth');

const now = () => new Date().toISOString();
function fail(msg) { const e = new Error(msg); e.status = 400; throw e; }
const emailOk = (e) => /^[^@\s]{1,64}@[^@\s]{1,120}$/.test(e || '');

async function userBy(db, email) { const u = await db.get('SELECT id, email, name, role, disabled FROM users WHERE email = ?', String(email || '').trim().toLowerCase()); if (!u) fail('계정이 없습니다: ' + email); return u; }

async function addUser(db, { email, name, role, password }) {
  email = String(email || '').trim().toLowerCase();
  if (!emailOk(email)) fail('이메일 형식을 확인해 주세요.');
  if (!['planner', 'client'].includes(role)) fail('역할은 planner 또는 client만 가능합니다.');
  if (String(password || '').length < 8) fail('비밀번호는 8자 이상이어야 합니다.');
  if (await db.get('SELECT 1 AS ok FROM users WHERE email = ?', email)) fail('이미 있는 이메일입니다.');
  return db.tx(async (t) => {
    const id = (await t.run('INSERT INTO users (email, name, role, pw_hash, created_at, demo) VALUES (?,?,?,?,?,0)', email, String(name || email).slice(0, 40), role, hashPassword(password), now())).id;
    let clientId = null;
    if (role === 'client') clientId = (await t.run('INSERT INTO clients (user_id, profile, created_at) VALUES (?,?,?)', id, JSON.stringify({ name: String(name || '').slice(0, 40) }), now())).id;
    await t.run('INSERT INTO audit (user_id, action, target, at) VALUES (?,?,?,?)', null, 'admin.addUser', role + ':' + email, now());
    return { id, clientId };
  });
}
async function clientIdOf(db, emailOrId) {
  if (/^\d+$/.test(String(emailOrId))) return Number(emailOrId);
  const u = await userBy(db, emailOrId); if (u.role !== 'client') fail(emailOrId + '은(는) 고객 계정이 아닙니다.');
  return Number((await db.get('SELECT id FROM clients WHERE user_id = ?', u.id)).id);
}
async function assign(db, plannerEmail, client) {
  const p = await userBy(db, plannerEmail); if (p.role !== 'planner') fail('설계사 계정이 아닙니다.');
  const cid = await clientIdOf(db, client);
  await db.run('INSERT OR IGNORE INTO assignments (planner_id, client_id, granted_at) VALUES (?,?,?)', p.id, cid, now());
  await db.run('INSERT INTO audit (user_id, action, target, at) VALUES (?,?,?,?)', null, 'admin.assign', p.email + '→client:' + cid, now());
  if (db.bus) db.bus.emit('access', { plannerId: Number(p.id), clientId: cid });
  return { plannerId: Number(p.id), clientId: cid };
}
async function unassign(db, plannerEmail, client) {
  const p = await userBy(db, plannerEmail); const cid = await clientIdOf(db, client);
  const r = await db.run('DELETE FROM assignments WHERE planner_id = ? AND client_id = ?', p.id, cid);
  await db.run('INSERT INTO audit (user_id, action, target, at) VALUES (?,?,?,?)', null, 'admin.unassign', p.email + '→client:' + cid, now());
  if (db.bus) db.bus.emit('access', { plannerId: Number(p.id), clientId: cid });
  return { removed: r.changes };
}
async function setDisabled(db, email, disabled) {
  const u = await userBy(db, email);
  await db.run('UPDATE users SET disabled = ? WHERE id = ?', disabled ? 1 : 0, u.id);
  if (disabled) await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  if (db.bus) db.bus.emit('access', { userId: Number(u.id) });
  return { ok: true };
}
async function setPassword(db, email, pw) {
  if (String(pw || '').length < 8) fail('비밀번호는 8자 이상이어야 합니다.');
  const u = await userBy(db, email); await db.run('UPDATE users SET pw_hash = ? WHERE id = ?', hashPassword(pw), u.id); await db.run('DELETE FROM sessions WHERE user_id = ?', u.id); return { ok: true };
}
async function listAll(db) {
  const users = await db.all('SELECT u.id, u.email, u.name, u.role, u.disabled, u.demo, c.id AS client_id FROM users u LEFT JOIN clients c ON c.user_id = u.id ORDER BY u.id');
  const asg = await db.all('SELECT a.planner_id, a.client_id, u.email FROM assignments a JOIN users u ON u.id = a.planner_id');
  return { users: users.map((u) => ({ id: Number(u.id), email: u.email, name: u.name, role: u.role, disabled: !!Number(u.disabled), demo: !!Number(u.demo), clientId: u.client_id == null ? null : Number(u.client_id) })), assignments: asg.map((a) => ({ planner: a.email, clientId: Number(a.client_id) })) };
}

// HTTP 관리자 경로(토큰이 설정된 경우에만)
function adminRoute(db) {
  const token = process.env.FP_ADMIN_TOKEN || '';
  return async (req, url, body) => {
    if (!token) return { status: 404, body: { error: '없는 요청입니다.' } };
    const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(crypto.createHash('sha256').update(got).digest('hex')), b = Buffer.from(crypto.createHash('sha256').update(token).digest('hex'));
    if (!got || !crypto.timingSafeEqual(a, b)) return { status: 401, body: { error: '관리자 토큰이 맞지 않습니다.' } };
    const op = url.pathname.replace('/api/admin/', '');
    try {
      if (req.method === 'GET' && op === 'list') return { status: 200, body: await listAll(db) };
      if (req.method !== 'POST') return { status: 404, body: { error: '없는 요청입니다.' } };
      if (op === 'users') return { status: 200, body: await addUser(db, body) };
      if (op === 'assign') return { status: 200, body: await assign(db, body.planner, body.client) };
      if (op === 'unassign') return { status: 200, body: await unassign(db, body.planner, body.client) };
      if (op === 'disable') return { status: 200, body: await setDisabled(db, body.email, body.disabled !== false) };
      if (op === 'password') return { status: 200, body: await setPassword(db, body.email, body.password) };
      return { status: 404, body: { error: '없는 요청입니다.' } };
    } catch (e) { return { status: e.status || 500, body: { error: e.status ? e.message : '서버 오류' } }; }
  };
}

module.exports = { addUser, assign, unassign, setDisabled, setPassword, listAll, adminRoute };

if (require.main === module) {
  (async () => {
    const { open } = require('./db');
    const db = await open({ url: process.env.DATABASE_URL, file: process.env.FP_DB || path.join(__dirname, '..', 'data', 'planner.db') });
    const [cmd, a, b, c] = process.argv.slice(2);
    let out;
    if (cmd === 'list') out = await listAll(db);
    else if (cmd === 'add-planner' || cmd === 'add-client') out = await addUser(db, { email: a, name: b, password: c, role: cmd === 'add-planner' ? 'planner' : 'client' });
    else if (cmd === 'assign') out = await assign(db, a, b);
    else if (cmd === 'unassign') out = await unassign(db, a, b);
    else if (cmd === 'disable' || cmd === 'enable') out = await setDisabled(db, a, cmd === 'disable');
    else if (cmd === 'password') out = await setPassword(db, a, b);
    else { console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(1); }
    console.log(JSON.stringify(out, null, 2));
    await db.close(); process.exit(0);
  })().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
