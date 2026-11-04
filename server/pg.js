/*
 * 최소 Postgres 클라이언트 (외부 패키지 없이 Node net/tls/crypto만 사용)
 * ------------------------------------------------------------
 * - 연결 문자열: postgres://user:pass@host:5432/db?sslmode=require
 * - TLS: sslmode=require|verify-full → TLS 필수(인증서 검증), disable → 평문, 없으면 prefer(가능하면 TLS)
 * - 인증: SCRAM-SHA-256(Neon·Supabase·Render 기본), MD5, 평문
 * - 쿼리: 확장 프로토콜(Parse/Bind/Execute)로 매개변수를 따로 보냄(SQL 주입 방지)
 * - 연결 1개 + 대기열(작은 서비스용). 끊기면 다음 쿼리 때 다시 연결.
 */
'use strict';
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const NUM_TYPES = new Set([20, 21, 23, 26, 700, 701, 1700]);

function parseUrl(u) {
  const x = new URL(u);
  return { host: x.hostname, port: Number(x.port || 5432), user: decodeURIComponent(x.username), password: decodeURIComponent(x.password), database: decodeURIComponent(x.pathname.slice(1) || x.username), sslmode: x.searchParams.get('sslmode') || 'prefer', options: x.searchParams.get('options') };
}

class Conn {
  constructor(cfg) { this.cfg = cfg; this.buf = Buffer.alloc(0); this.waiters = []; this.sock = null; this.closed = true; }

  async connect() {
    const c = this.cfg;
    let sock = await new Promise((res, rej) => { const s = net.connect(c.port, c.host, () => res(s)); s.once('error', rej); });
    if (c.sslmode !== 'disable') {
      const req = Buffer.alloc(8); req.writeInt32BE(8, 0); req.writeInt32BE(80877103, 4);
      sock.write(req);
      const ans = await new Promise((res, rej) => { sock.once('data', (d) => res(d.toString('latin1', 0, 1))); sock.once('error', rej); });
      if (ans === 'S') {
        sock = await new Promise((res, rej) => { const t = tls.connect({ socket: sock, servername: c.host, rejectUnauthorized: ['require', 'verify-full', 'verify-ca'].includes(c.sslmode) && !process.env.FP_PG_INSECURE }, () => res(t)); t.once('error', rej); });
      } else if (c.sslmode === 'require' || c.sslmode === 'verify-full' || c.sslmode === 'verify-ca') {
        sock.destroy(); throw new Error('DB 서버가 TLS 연결을 지원하지 않습니다(sslmode=' + c.sslmode + ').');
      }
    }
    this.sock = sock; this.closed = false; this.buf = Buffer.alloc(0);
    try { sock.setNoDelay(true); } catch (e) { /* 무시 */ }
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this._pump(); });
    sock.on('close', () => { this.closed = true; this._failAll(new Error('DB 연결이 끊겼습니다.')); });
    sock.on('error', () => { this.closed = true; });
    // StartupMessage
    const params = ['user', c.user, 'database', c.database, 'client_encoding', 'UTF8'];
    if (c.options) params.push('options', c.options);
    const body = Buffer.concat([...params.map((p) => Buffer.from(p + '\0')), Buffer.from('\0')]);
    const head = Buffer.alloc(8); head.writeInt32BE(8 + body.length, 0); head.writeInt32BE(196608, 4);
    sock.write(Buffer.concat([head, body]));
    await this._auth();
  }

  _failAll(e) { const w = this.waiters; this.waiters = []; w.forEach((x) => x.reject(e)); }
  _pump() {
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + len) return;
      const type = String.fromCharCode(this.buf[0]), payload = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      const w = this.waiters[0];
      if (type === 'N' || type === 'S' || type === 'K' || type === 'A') continue; // 안내·파라미터·키·알림 무시
      if (w) w.onMsg(type, payload);
    }
  }
  _next(handler) { return new Promise((resolve, reject) => { this.waiters.push({ onMsg: (t, p) => handler(t, p, resolve, reject), reject }); }); }
  _done() { this.waiters.shift(); }
  _msg(type, payload) { const h = Buffer.alloc(5); h.write(type, 0, 'latin1'); h.writeInt32BE(4 + payload.length, 1); return Buffer.concat([h, payload]); }
  _send(type, payload) { this.sock.write(this._msg(type, payload)); }

  _auth() {
    const c = this.cfg; let scram = null;
    return this._next((t, p, resolve, reject) => {
      if (t === 'E') { this._done(); return reject(pgError(p)); }
      if (t === 'R') {
        const code = p.readInt32BE(0);
        if (code === 0) return; // 인증 완료, ReadyForQuery 대기
        if (code === 3) return this._send('p', Buffer.from(c.password + '\0'));
        if (code === 5) { const salt = p.subarray(4, 8); const inner = md5(c.password + c.user); return this._send('p', Buffer.from('md5' + md5(Buffer.concat([Buffer.from(inner), salt])) + '\0')); }
        if (code === 10) {
          const mechs = p.subarray(4).toString().split('\0');
          if (!mechs.includes('SCRAM-SHA-256')) { this._done(); return reject(new Error('지원하지 않는 인증 방식: ' + mechs.join(','))); }
          const nonce = crypto.randomBytes(18).toString('base64');
          scram = { nonce, first: 'n=*,r=' + nonce };
          const data = Buffer.from('n,,' + scram.first);
          const lenb = Buffer.alloc(4); lenb.writeInt32BE(data.length);
          return this._send('p', Buffer.concat([Buffer.from('SCRAM-SHA-256\0'), lenb, data]));
        }
        if (code === 11) {
          const sf = p.subarray(4).toString(); const a = Object.fromEntries(sf.split(',').map((kv) => [kv[0], kv.slice(2)]));
          if (!a.r.startsWith(scram.nonce)) { this._done(); return reject(new Error('SCRAM 응답이 올바르지 않습니다.')); }
          const salted = crypto.pbkdf2Sync(c.password, Buffer.from(a.s, 'base64'), Number(a.i), 32, 'sha256');
          const clientKey = hmac(salted, 'Client Key'), storedKey = crypto.createHash('sha256').update(clientKey).digest();
          const without = 'c=biws,r=' + a.r, authMsg = scram.first + ',' + sf + ',' + without;
          const sig = hmac(storedKey, authMsg), proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
          scram.serverSig = hmac(hmac(salted, 'Server Key'), authMsg).toString('base64');
          return this._send('p', Buffer.from(without + ',p=' + proof.toString('base64')));
        }
        if (code === 12) { const v = p.subarray(4).toString().split(',').find((x) => x.startsWith('v=')); if (!v || v.slice(2) !== scram.serverSig) { this._done(); return reject(new Error('DB 서버 서명 확인 실패')); } return; }
        this._done(); return reject(new Error('지원하지 않는 인증 코드: ' + code));
      }
      if (t === 'Z') { this._done(); resolve(); }
    });
  }

  query(sql, params) {
    params = params || [];
    const parse = Buffer.concat([Buffer.from('\0' + sql + '\0'), int16(0)]);
    const parts = [Buffer.from('\0\0'), int16(0), int16(params.length)];
    params.forEach((v) => {
      if (v === null || v === undefined) { const b = Buffer.alloc(4); b.writeInt32BE(-1); parts.push(b); }
      else { const s = Buffer.from(typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v)); const b = Buffer.alloc(4); b.writeInt32BE(s.length); parts.push(b, s); }
    });
    parts.push(int16(0));
    const p = this._next((t, payload, resolve, reject) => {
      const st = p._st || (p._st = { fields: null, rows: [], tag: '', err: null });
      if (t === 'T') { const n = payload.readInt16BE(0); let o = 2; st.fields = []; for (let i = 0; i < n; i++) { const e = payload.indexOf(0, o); const name = payload.toString('utf8', o, e); o = e + 1; const oid = payload.readInt32BE(o + 6); o += 18; st.fields.push({ name, oid }); } }
      else if (t === 'D') { const n = payload.readInt16BE(0); let o = 2; const row = {}; for (let i = 0; i < n; i++) { const l = payload.readInt32BE(o); o += 4; let v = null; if (l >= 0) { v = payload.toString('utf8', o, o + l); o += l; const f = st.fields[i]; if (NUM_TYPES.has(f.oid)) v = Number(v); else if (f.oid === 16) v = v === 't'; } row[st.fields[i].name] = v; } st.rows.push(row); }
      else if (t === 'C') { st.tag = payload.toString('utf8', 0, payload.length - 1); }
      else if (t === 'E') { st.err = pgError(payload); }
      else if (t === 'Z') { this._done(); if (st.err) reject(st.err); else { const m = st.tag.match(/(\d+)$/); resolve({ rows: st.rows, changes: m ? Number(m[1]) : 0 }); } }
    });
    // 다섯 메시지를 한 번에 보냄(작은 패킷 여러 개로 인한 지연 방지)
    this.sock.write(Buffer.concat([this._msg('P', parse), this._msg('B', Buffer.concat(parts)), this._msg('D', Buffer.from('P\0')), this._msg('E', Buffer.concat([Buffer.from('\0'), int32(0)])), this._msg('S', Buffer.alloc(0))]));
    return p;
  }
  end() { try { this._send('X', Buffer.alloc(0)); this.sock.end(); } catch (e) { /* 무시 */ } }
}

function int16(n) { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; }
function int32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; }
function md5(x) { return crypto.createHash('md5').update(x).digest('hex'); }
function hmac(k, d) { return crypto.createHmac('sha256', k).update(d).digest(); }
function pgError(p) { const f = {}; let o = 0; while (o < p.length && p[o] !== 0) { const code = String.fromCharCode(p[o]); const e = p.indexOf(0, o + 1); f[code] = p.toString('utf8', o + 1, e); o = e + 1; } const err = new Error(f.M || 'DB 오류'); err.code = f.C; err.pg = f; return err; }

// 연결 1개 + 직렬 대기열
function createClient(url) {
  const cfg = parseUrl(url); let conn = null, chain = Promise.resolve();
  async function ensure() { if (!conn || conn.closed) { conn = new Conn(cfg); await conn.connect(); } return conn; }
  function query(sql, params) {
    const run = chain.then(async () => { const c = await ensure(); try { return await c.query(sql, params); } catch (e) { if (c.closed) conn = null; throw e; } });
    chain = run.catch(() => {});
    return run;
  }
  return { query, end: () => conn && conn.end(), cfg };
}

module.exports = { createClient, parseUrl };
