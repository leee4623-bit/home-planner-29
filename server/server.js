/*
 * 재무플래너 서버
 * 실행: node server/server.js
 * 환경변수
 *   PORT                포트(기본 8080)
 *   DATABASE_URL        공용 Postgres 연결 문자열(배포 시 필수: Neon 등). 없으면 내 PC 파일 DB(SQLite) 사용
 *   FP_DB               SQLite 파일 경로(기본 data/planner.db)
 *   FP_DEMO             1(기본)=비어 있는 DB에 시연 데이터 생성·로그인 화면 시연 버튼 표시, 0=끔(실제 운영)
 *   FP_DEMO_PASSWORD    시연 계정 비밀번호(기본 1234)
 *   FP_ADMIN_TOKEN      관리자 API 토큰(없으면 /api/admin 사용 안 함)
 *   FSS_API_KEY         금융감독원 「금융상품 한눈에」 인증키(없으면 공시 상품을 표시하지 않음)
 *   FP_VAPID_SUBJECT    Web Push 연락처(mailto:)
 * - public/ 의 PWA 파일과 /api/* 요청을 같은 주소에서 제공합니다(쿠키 인증·SSE가 같은 출처에서 동작).
 * - 실시간: GET /api/events (Server-Sent Events). 끊기면 Last-Event-ID로 놓친 변경을 다시 보냅니다.
 * - 외부 패키지 없이 Node 22+ 기본 기능만 사용합니다.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { open } = require('./db');
const { seed } = require('./seed');
const auth = require('./auth');
const { routes, HttpError } = require('./api');
const push = require('./push');
const jobs = require('./jobs');
const changes = require('./changes');
const products = require('./products');
const admin = require('./admin');

const PUBLIC = path.join(__dirname, '..', 'public');
const VERSION = '3.0.0';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

async function createServer(opts) {
  opts = opts || {};
  const dbFile = opts.dbFile || process.env.FP_DB || path.join(__dirname, '..', 'data', 'planner.db');
  const dbUrl = opts.dbUrl !== undefined ? opts.dbUrl : process.env.DATABASE_URL;
  if (process.env.NODE_ENV === 'production' && !opts.db) {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('운영 환경에는 SESSION_SECRET(32자 이상) 환경변수가 필요합니다. Render → Environment에서 설정하세요.');
    if (!dbUrl) console.warn('[주의] DATABASE_URL이 없어 서버 디스크(SQLite)에 저장합니다. Render 무료 서버는 재시작 때 디스크가 지워집니다.');
  }
  const db = opts.db || await open(dbUrl ? { url: dbUrl } : { file: dbFile });
  db.bus = db.bus || changes.createBus();
  const demoMode = opts.demo !== undefined ? !!opts.demo : process.env.FP_DEMO !== '0';
  const seeded = await seed(db, { password: opts.password, demo: demoMode });
  if (!demoMode) await db.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE demo = 1)'); // 운영 모드: 남은 시연 세션 정리
  // 푸시 서명 키: DB(app_meta)에 보관 → 서버를 다시 시작·재배포해도 기존 푸시 구독이 유지됨
  let pushKeys = null;
  const pk = await db.get("SELECT value FROM app_meta WHERE key = 'vapid'");
  if (pk) { try { pushKeys = JSON.parse(pk.value); } catch (e) { pushKeys = null; } }
  if (!pushKeys) {
    pushKeys = push.loadKeys(opts.db || dbUrl ? null : path.join(path.dirname(dbFile), 'vapid.json'));
    await db.run('INSERT OR IGNORE INTO app_meta (key, value, updated_at) VALUES (?,?,?)', 'vapid', JSON.stringify(pushKeys), new Date().toISOString());
    const saved = await db.get("SELECT value FROM app_meta WHERE key = 'vapid'"); pushKeys = JSON.parse(saved.value);
  }
  const table = routes(db, { pushKeys, demoMode });
  const adminApi = admin.adminRoute(db);
  const timers = [];
  if (opts.scheduler !== false) {
    // 서버 정기 점검: 시작 직후 1회 + 1시간마다. 상품 자료: 시작 후 1회 + 하루마다(고객 재무정보 동기화와 별개)
    const tick = () => jobs.runAll(db, pushKeys).then(() => db.run('DELETE FROM idem WHERE at < ?', new Date(Date.now() - 864e5).toISOString())).catch((e) => console.error('정기 점검 오류:', e.message));
    const prod = () => products.refresh(db).catch((e) => console.error('상품 자료 갱신 오류:', e.message));
    timers.push(setTimeout(tick, 2000), setInterval(tick, Number(process.env.FP_CHECK_MINUTES || 60) * 60 * 1000), setTimeout(prod, 5000), setInterval(prod, 24 * 3600 * 1000));
    timers.forEach((t) => t.unref());
  }
  const secureCookie = opts.secureCookie !== undefined ? opts.secureCookie : process.env.NODE_ENV === 'production';
  const streams = new Set();

  function send(res, status, obj, headers) {
    const body = JSON.stringify(obj);
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
    res.end(body);
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, '요청이 너무 큽니다.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, 'JSON 형식이 아닙니다.')); } });
      req.on('error', reject);
    });
  }

  // ---------- 실시간(SSE) ----------
  async function events(req, res, url, user) {
    let allowed = new Set(await auth.allowedClients(db, user));
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    let lastSent = Number(req.headers['last-event-id'] || url.searchParams.get('since') || 0) || 0;
    let ready = false; const buffer = []; let closed = false;
    const write = (event, data, id) => { if (closed) return; res.write((id ? 'id: ' + id + '\n' : '') + 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); };
    const deliver = async (ev) => {
      if (ev.id <= lastSent || !allowed.has(ev.clientId) || !changes.visible(ev, user)) return;
      // 보낼 때마다 DB 기준으로 권한 재확인(배정 해제 즉시 차단)
      if (!(await auth.canAccess(db, user, ev.clientId))) { allowed.delete(ev.clientId); write('revoked', { clientId: ev.clientId }); return; }
      lastSent = Math.max(lastSent, ev.id); write('change', ev, ev.id);
    };
    const onChange = (ev) => { if (!ready) buffer.push(ev); else deliver(ev).catch(() => {}); };
    const recheck = async () => {
      const u = await auth.sessionUser(db, req);
      if (!u) { write('revoked', { all: true, reason: 'session' }); return end(); }
      const now = new Set(await auth.allowedClients(db, user));
      allowed.forEach((cid) => { if (!now.has(cid)) write('revoked', { clientId: cid }); });
      const added = [...now].filter((c) => !allowed.has(c));
      allowed = now; if (added.length) write('assigned', { clientIds: added });
    };
    const onAccess = () => { recheck().catch(() => {}); };
    db.bus.on('change', onChange); db.bus.on('access', onAccess);
    const hb = setInterval(() => { if (!closed) res.write(': ping ' + Date.now() + '\n\n'); }, 25000);
    const rc = setInterval(onAccess, 30000);
    const entry = { res, user };
    streams.add(entry);
    function end() { if (closed) return; closed = true; clearInterval(hb); clearInterval(rc); db.bus.off('change', onChange); db.bus.off('access', onAccess); streams.delete(entry); try { res.end(); } catch (e) { /* 무시 */ } }
    req.on('close', end);
    // 놓친 변경 다시 보내기 → 준비 완료
    try {
      const missed = await changes.since(db, user, [...allowed], lastSent, 500);
      for (const ev of missed) await deliver(ev);
      ready = true; for (const ev of buffer.splice(0)) await deliver(ev);
      write('ready', { latest: Math.max(lastSent, await changes.latestId(db)), serverTime: new Date().toISOString(), replayed: missed.length });
    } catch (e) { end(); }
  }

  async function handleApi(req, res, url) {
    const method = req.method;
    if (url.pathname === '/api/config' && method === 'GET') return send(res, 200, { demo: demoMode, realtime: 'sse', version: VERSION, db: db.kind === 'postgres' ? 'postgres' : 'sqlite' });
    if (url.pathname === '/api/health' && method === 'GET') { await db.get('SELECT 1 AS ok'); return send(res, 200, { ok: true, db: db.kind, version: VERSION }); }
    if (url.pathname.startsWith('/api/admin/')) { const body = method === 'GET' ? {} : await readBody(req, 20000); const r = await adminApi(req, url, body); return send(res, r.status, r.body); }
    // CSRF 방어: 상태 변경 요청에는 사용자 정의 헤더 필요
    if (method !== 'GET' && req.headers['x-fp-request'] !== '1') return send(res, 403, { error: '허용되지 않은 요청입니다.' });
    if (url.pathname === '/api/login' && method === 'POST') {
      const b = await readBody(req, 10_000);
      const email = String(b.email || '').trim().toLowerCase();
      const key = (req.socket.remoteAddress || '') + '|' + email;
      if (auth.rateLimited(key)) return send(res, 429, { error: '로그인 시도가 많습니다. 10분 뒤에 다시 시도해 주세요.' });
      const u = await db.get('SELECT id, pw_hash, disabled, demo FROM users WHERE email = ?', email);
      // 시연 계정(공용 비밀번호)은 시연 모드에서만 로그인 가능 — 실제 운영(FP_DEMO=0)에서는 차단
      if (u && Number(u.demo) && !demoMode) { auth.noteFail(key); return send(res, 401, { error: '시연 계정은 시연 모드에서만 사용할 수 있습니다.' }); }
      if (!u || Number(u.disabled) || !auth.verifyPassword(b.password, u.pw_hash)) { auth.noteFail(key); return send(res, 401, { error: u && Number(u.disabled) ? '사용이 중지된 계정입니다.' : '이메일 또는 비밀번호가 맞지 않습니다.' }); }
      const token = await auth.createSession(db, u.id);
      return send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie(token, secureCookie) });
    }
    if (url.pathname === '/api/logout' && method === 'POST') { await auth.destroySession(db, req); return send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie('', secureCookie, true) }); }

    const user = await auth.sessionUser(db, req);
    if (!user) return send(res, 401, { error: '로그인이 필요합니다.' });
    if (url.pathname === '/api/events' && method === 'GET') return events(req, res, url, user);
    for (const rt of table) {
      if (rt.method !== method) continue;
      const m = url.pathname.match(rt.re); if (!m) continue;
      const body = method === 'GET' ? {} : await readBody(req, rt.opts.bodyLimit || 300_000);
      const q = { user, p: m.groups || {}, body, query: url.searchParams };
      // 재시도 안전: 같은 Idempotency-Key 요청은 한 번만 처리하고 같은 응답을 돌려줌
      const ik = method !== 'GET' ? String(req.headers['idempotency-key'] || '') : '';
      if (ik) {
        if (ik.length > 100) return send(res, 400, { error: 'Idempotency-Key가 너무 깁니다.' });
        const k = method + ' ' + url.pathname + ' ' + ik;
        const ins = await db.run('INSERT OR IGNORE INTO idem (user_id, ikey, status, response, at) VALUES (?,?,?,?,?)', user.id, k, null, null, new Date().toISOString());
        if (!ins.changes) {
          const prev = await db.get('SELECT status, response FROM idem WHERE user_id = ? AND ikey = ?', user.id, k);
          if (!prev || prev.status == null) return send(res, 409, { error: '같은 요청을 처리하고 있습니다. 잠시 후 확인해 주세요.', code: 'inProgress' });
          return send(res, Number(prev.status), JSON.parse(prev.response), { 'Idempotent-Replay': 'true' });
        }
        try {
          const out = await rt.fn(q);
          await db.run('UPDATE idem SET status = ?, response = ? WHERE user_id = ? AND ikey = ?', 200, JSON.stringify(out), user.id, k);
          return send(res, 200, out);
        } catch (e) {
          if (e.status && e.status < 500 && e.status !== 409 && e.status !== 429) await db.run('UPDATE idem SET status = ?, response = ? WHERE user_id = ? AND ikey = ?', e.status, JSON.stringify({ error: e.message, code: e.code }), user.id, k);
          else await db.run('DELETE FROM idem WHERE user_id = ? AND ikey = ?', user.id, k); // 서버 오류·충돌은 다시 시도 가능
          throw e;
        }
      }
      return send(res, 200, await rt.fn(q));
    }
    return send(res, 404, { error: '없는 요청입니다.' });
  }

  function serveStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(400); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 파일입니다.'); }
      const ext = path.extname(file);
      res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (res.headersSent) { try { res.end(); } catch (x) { /* 무시 */ } return; }
      const extra = {}; ['code', 'conflicts', 'items', 'version'].forEach((k) => { if (e[k] !== undefined) extra[k] = e[k]; });
      send(res, status, Object.assign({ error: status === 500 ? '서버 오류가 발생했습니다.' : e.message }, extra));
    }
  });
  server.on('close', () => { streams.forEach((s) => { try { s.res.end(); } catch (e) { /* 무시 */ } }); });
  return { server, db, seeded, pushKeys, demoMode, streams, stop: () => { timers.forEach((t) => clearInterval(t)); streams.forEach((s) => { try { s.res.end(); } catch (e) { /* 무시 */ } }); } };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createServer().then(({ server, seeded, db, demoMode }) => {
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error('\n[안내] ' + port + '번 포트를 이미 다른 프로그램이 쓰고 있습니다.');
        console.error('       앞서 켜 둔 서버 창(검은 창·PowerShell)을 모두 닫고 다시 실행하세요.\n');
      } else console.error(e);
      process.exit(1);
    });
    server.listen(port, () => {
      console.log('재무플래너 서버: http://localhost:' + port + ' (DB: ' + (db.kind === 'postgres' ? '공용 Postgres' : '내 PC 파일') + (demoMode ? ', 시연 모드' : '') + ')');
      if (seeded) console.log('시연 계정이 생성되었습니다 → 설계사 ' + seeded.planner + ' / 고객 ' + seeded.client + ' / 비밀번호 ' + seeded.password);
    });
  }).catch((e) => { console.error('서버를 시작하지 못했습니다:', e.message); process.exit(1); });
}

module.exports = { createServer };
