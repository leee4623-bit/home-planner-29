/*
 * Web Push 발송 (외부 패키지 없이 Node 내장 crypto 사용)
 * ------------------------------------------------------------
 * - VAPID(RFC 8292): ES256 서명 JWT. 키는 data/vapid.json에 처음 실행 때 생성·보관.
 * - 메시지 암호화(RFC 8291, aes128gcm / RFC 8188).
 * - 잠금 화면 보호: 기본 페이로드에는 금액·잔액·거래내역을 넣지 않습니다.
 * - 실제 전달은 브라우저 제조사의 푸시 서버(FCM, Mozilla, Apple 등)를 거칩니다. 인터넷 연결 필요.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

function loadKeys(file) {
  try { const k = JSON.parse(fs.readFileSync(file, 'utf8')); if (k.publicKey && k.privateJwk) return k; } catch (e) { /* 새로 만듦 */ }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]);
  const keys = { publicKey: b64u(raw), privateJwk: jwk, createdAt: new Date().toISOString() };
  if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 }); }
  void publicKey;
  return keys;
}

function vapidHeader(keys, endpoint, subject, nowSec) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: (nowSec || Math.floor(Date.now() / 1000)) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(header + '.' + payload), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + header + '.' + payload + '.' + b64u(sig) + ', k=' + keys.publicKey;
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// RFC 8291 암호화 → 요청 본문
function encrypt(plaintext, sub, opts) {
  opts = opts || {};
  const uaPublic = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.asPrivate) ecdh.setPrivateKey(opts.asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt || crypto.randomBytes(16);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// 수신자 측 복호화(검증용)
function decrypt(body, uaPrivate, uaPublic, authSecret) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return pt.subarray(0, pt.lastIndexOf(2)).toString();
}

async function send(keys, sub, payload, subject) {
  const body = encrypt(JSON.stringify(payload), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Authorization: vapidHeader(keys, sub.endpoint, subject) },
    body
  });
  return { status: res.status, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410 };
}

module.exports = { loadKeys, vapidHeader, encrypt, decrypt, send, b64u, unb64u };
