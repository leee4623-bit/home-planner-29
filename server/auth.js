/*
 * 인증과 접근 권한
 * ------------------------------------------------------------
 * - 비밀번호: scrypt(무작위 salt)로 해시해 저장. 원문은 저장하지 않음.
 * - 세션: 무작위 토큰을 HttpOnly·SameSite=Strict 쿠키로 전달, DB에는 토큰의 SHA-256만 저장. 12시간 만료.
 * - CSRF: 상태를 바꾸는 요청은 X-FP-Request 헤더가 있어야 처리(SameSite=Strict와 함께 이중 방어).
 * - 로그인 시도 제한: 같은 IP+이메일 10분에 5회.
 * - 비활성(disabled) 계정은 로그인·세션 모두 거부.
 * - 역할과 고객 배정은 DB에서만 관리(로그인 화면의 버튼이나 요청 값으로 바뀌지 않음).
 *   고객은 자기 client_id만, 설계사는 assignments에 연결된 고객만. 모든 고객 데이터 API와 실시간 구독이 canAccess를 거칩니다.
 */
'use strict';
const crypto = require('crypto');

const SESSION_HOURS = 12;
const attempts = new Map();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('base64') + '$' + h.toString('base64');
}
function verifyPassword(pw, stored) {
  try {
    const [alg, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const want = Buffer.from(h, 'base64');
    const got = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(want, got);
  } catch (e) { return false; }
}
function sha(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

function rateLimited(key) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const list = (attempts.get(key) || []).filter((t) => now - t < win);
  attempts.set(key, list);
  return list.length >= 5;
}
function noteFail(key) { const l = attempts.get(key) || []; l.push(Date.now()); attempts.set(key, l); }

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)', sha(token), userId, Date.now() + SESSION_HOURS * 3600 * 1000, new Date().toISOString());
  return token;
}
async function sessionUser(db, req) {
  const tok = parseCookies(req).fp_sid;
  if (!tok) return null;
  const row = await db.get('SELECT u.id, u.email, u.name, u.role, u.disabled, u.demo, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', sha(tok));
  if (!row || Number(row.expires_at) < Date.now() || row.disabled) return null;
  const client = row.role === 'client' ? await db.get('SELECT id FROM clients WHERE user_id = ?', row.id) : null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, demo: !!row.demo, clientId: client ? client.id : null };
}
async function destroySession(db, req) { const tok = parseCookies(req).fp_sid; if (tok) await db.run('DELETE FROM sessions WHERE token_hash = ?', sha(tok)); }

function cookie(token, secure, clear) {
  return 'fp_sid=' + (clear ? '' : token) + '; Path=/; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '') + '; Max-Age=' + (clear ? 0 : SESSION_HOURS * 3600);
}

// 서버 측 접근 권한 검사(매 요청·매 실시간 전송마다 DB 기준으로 확인)
async function canAccess(db, user, clientId) {
  if (!user) return false;
  clientId = Number(clientId);
  if (user.role === 'client') return user.clientId === clientId;
  if (user.role === 'planner') return !!(await db.get('SELECT 1 AS ok FROM assignments a JOIN users u ON u.id = a.planner_id WHERE a.planner_id = ? AND a.client_id = ? AND u.disabled = 0', user.id, clientId));
  return false;
}
async function allowedClients(db, user) {
  if (user.role === 'client') return user.clientId ? [user.clientId] : [];
  return (await db.all('SELECT client_id FROM assignments WHERE planner_id = ? ORDER BY client_id', user.id)).map((r) => Number(r.client_id));
}

module.exports = { hashPassword, verifyPassword, createSession, sessionUser, destroySession, cookie, canAccess, allowedClients, rateLimited, noteFail, sha };
