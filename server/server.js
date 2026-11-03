/*
 * 재무플래너 서버
 * 실행: node server/server.js   (PORT, FP_DB, FP_DEMO_PASSWORD 환경변수 사용 가능)
 * - public/ 의 PWA 파일을 제공하고 /api/* 요청을 처리합니다.
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

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function createServer(opts) {
  opts = opts || {};
  const dbFile = opts.dbFile || process.env.FP_DB || path.join(__dirname, '..', 'data', 'planner.db');
  const db = opts.db || open(dbFile);
  const seeded = seed(db, { password: opts.password });
  const pushKeys = push.loadKeys(opts.db ? null : path.join(path.dirname(dbFile), 'vapid.json'));
  const table = routes(db, { pushKeys });
  let timer = null;
  if (opts.scheduler !== false) {
    // 서버 정기 점검: 시작 직후 1회 + 1시간마다
    const tick = () => jobs.runAll(db, pushKeys).catch((e) => console.error('정기 점검 오류:', e.message));
    setTimeout(tick, 2000).unref();
    timer = setInterval(tick, Number(process.env.FP_CHECK_MINUTES || 60) * 60 * 1000); timer.unref();
  }
  const secureCookie = opts.secureCookie !== undefined ? opts.secureCookie : process.env.NODE_ENV === 'production';

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

  async function handleApi(req, res, url) {
    const method = req.method;
    // CSRF 방어: 상태 변경 요청에는 사용자 정의 헤더 필요
    if (method !== 'GET' && req.headers['x-fp-request'] !== '1') return send(res, 403, { error: '허용되지 않은 요청입니다.' });
    if (url.pathname === '/api/login' && method === 'POST') {
      const b = await readBody(req, 10_000);
      const email = String(b.email || '').trim().toLowerCase();
      const key = (req.socket.remoteAddress || '') + '|' + email;
      if (auth.rateLimited(key)) return send(res, 429, { error: '로그인 시도가 많습니다. 10분 뒤에 다시 시도해 주세요.' });
      const u = db.prepare('SELECT id, pw_hash FROM users WHERE email = ?').get(email);
      if (!u || !auth.verifyPassword(b.password, u.pw_hash)) { auth.noteFail(key); return send(res, 401, { error: '이메일 또는 비밀번호가 맞지 않습니다.' }); }
      const token = auth.createSession(db, u.id);
      return send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie(token, secureCookie) });
    }
    if (url.pathname === '/api/logout' && method === 'POST') { auth.destroySession(db, req); return send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie('', secureCookie, true) }); }

    const user = auth.sessionUser(db, req);
    if (!user) return send(res, 401, { error: '로그인이 필요합니다.' });
    delete user.token;
    for (const rt of table) {
      if (rt.method !== method) continue;
      const m = url.pathname.match(rt.re); if (!m) continue;
      const body = method === 'GET' ? {} : await readBody(req, rt.opts.bodyLimit || 300_000);
      const out = await rt.fn({ user, p: m.groups || {}, body, query: url.searchParams });
      return send(res, 200, out);
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
      send(res, status, { error: status === 500 ? '서버 오류가 발생했습니다.' : e.message, code: e.code });
    }
  });
  return { server, db, seeded, pushKeys, stop: () => timer && clearInterval(timer) };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  const { server, seeded } = createServer();
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error('\n[안내] ' + port + '번 포트를 이미 다른 프로그램이 쓰고 있습니다.');
      console.error('       앞서 켜 둔 서버 창(검은 창·PowerShell)을 모두 닫고 다시 실행하세요.\n');
    } else console.error(e);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log('재무플래너 서버: http://localhost:' + port);
    if (seeded) console.log('시연 계정이 생성되었습니다 → 설계사 ' + seeded.planner + ' / 고객 ' + seeded.client + ' / 비밀번호 ' + seeded.password);
  });
}

module.exports = { createServer };
