/*
 * 데이터 백업·복구(JSON 파일) — 표 전체를 파일 하나로 내보내고, 빈 DB에만 되살립니다.
 *   npm run backup  -- export  backup-2026-11-04.json
 *   npm run backup  -- restore backup-2026-11-04.json      (사용자가 한 명이라도 있는 DB에는 복구하지 않음)
 * DATABASE_URL이 있으면 Postgres, 없으면 FP_DB(내 PC 파일)를 사용합니다.
 * 백업 파일에는 고객 금융정보와 비밀번호 해시가 들어 있으니 GitHub 등에 올리지 말고 안전한 곳에 보관하세요.
 * 세션·중복요청 기록(sessions, idem)은 백업하지 않습니다(복구 후 다시 로그인).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { open, tableNames, WITH_ID } = require('./db');
const SKIP = new Set(['sessions', 'idem']);

(async () => {
  const [cmd, file] = process.argv.slice(2);
  if (!['export', 'restore'].includes(cmd) || !file) { console.log('사용법: npm run backup -- export|restore <파일.json>'); process.exit(1); }
  const db = await open(process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : { file: process.env.FP_DB || path.join(__dirname, '..', 'data', 'planner.db') });
  const tables = tableNames().filter((t) => !SKIP.has(t));
  if (cmd === 'export') {
    const out = { format: 'fp-backup-1', createdAt: new Date().toISOString(), db: db.kind, tables: {} };
    for (const t of tables) out.tables[t] = await db.all('SELECT * FROM ' + t);
    fs.writeFileSync(file, JSON.stringify(out), { mode: 0o600 });
    console.log('백업 완료: ' + file + ' (' + tables.map((t) => t + ' ' + out.tables[t].length).filter((x) => !/ 0$/.test(x)).join(', ') + ')');
  } else {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.format !== 'fp-backup-1') throw new Error('재무플래너 백업 파일이 아닙니다.');
    const n = Number((await db.get('SELECT COUNT(*) AS n FROM users')).n);
    if (n > 0) throw new Error('이 DB에는 이미 계정 ' + n + '개가 있습니다. 기존 데이터를 지우지 않도록, 새로 만든 빈 DB에만 복구합니다.');
    await db.tx(async (t) => {
      for (const tb of tables) {
        for (const row of data.tables[tb] || []) {
          const cols = Object.keys(row);
          await t.run('INSERT INTO ' + tb + ' (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(',') + ')', ...cols.map((c) => row[c]));
        }
      }
      if (db.kind === 'postgres') for (const tb of tables.filter((x) => WITH_ID.has(x))) {
        await t.get("SELECT setval(pg_get_serial_sequence(?, 'id'), COALESCE((SELECT MAX(id) FROM " + tb + "), 0) + 1, false) AS v", tb);
      }
    });
    console.log('복구 완료: ' + tables.map((t) => t + ' ' + (data.tables[t] || []).length).filter((x) => !/ 0$/.test(x)).join(', '));
  }
  await db.close(); process.exit(0);
})().catch((e) => { console.error('오류:', e.message); process.exit(1); });
