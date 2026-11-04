/*
 * 데이터베이스 계층 — SQLite(내 PC·시험) / Postgres(배포) 공통 비동기 인터페이스
 * ------------------------------------------------------------
 * 사용: const db = await open({ url: process.env.DATABASE_URL, file: 'data/planner.db' })
 *   await db.get(sql, ...params)   → 첫 행 또는 undefined
 *   await db.all(sql, ...params)   → 행 배열
 *   await db.run(sql, ...params)   → { changes, id }  (INSERT는 id 반환)
 *   await db.tx(async (t) => {...}) → 한 트랜잭션(다른 요청과 섞이지 않게 직렬 처리)
 * SQL은 SQLite 문법 기준(? 자리표시자, INSERT OR IGNORE)으로 쓰고, Postgres에서는 자동 변환합니다.
 *
 * 저장 원칙
 *  - 계획(plans)은 새 버전을 추가만 합니다. 고객 정보(client_data)는 버전 번호와 항목별 버전으로 충돌을 막습니다.
 *  - 모든 변경은 changes(변경 이력)에 남고, 실시간 전송과 연결 복구 시 재조회에 쓰입니다.
 */
'use strict';
const path = require('path');
const fs = require('fs');

const WITH_ID = new Set(['users', 'clients', 'plans', 'records', 'accounts', 'transactions', 'audit', 'risk_profiles', 'strategy_sets', 'baselines', 'scheduled', 'revisions', 'notifications', 'push_subs', 'inquiries', 'changes', 'plan_offers', 'products', 'product_requests']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('planner','client')), pw_hash TEXT NOT NULL, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id), profile TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assignments (planner_id INTEGER NOT NULL REFERENCES users(id), client_id INTEGER NOT NULL REFERENCES clients(id), granted_at TEXT NOT NULL, PRIMARY KEY (planner_id, client_id));
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), kind TEXT NOT NULL CHECK (kind IN ('before','after')), version INTEGER NOT NULL,
  label TEXT, note TEXT, data TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, data_version INTEGER, UNIQUE (client_id, kind, version)
);
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), month TEXT NOT NULL, category TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL, tx_id INTEGER, note TEXT, voided_at TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), label TEXT NOT NULL, masked TEXT NOT NULL, purpose TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), date TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, description TEXT, from_masked TEXT, to_masked TEXT,
  source TEXT NOT NULL, suggested TEXT, classification TEXT, confirmed_at TEXT, record_id INTEGER, import_key TEXT, created_at TEXT NOT NULL, UNIQUE (client_id, import_key)
);
CREATE TABLE IF NOT EXISTS settings (client_id INTEGER PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_status (client_id INTEGER PRIMARY KEY REFERENCES clients(id), provider TEXT, last_sync TEXT, last_error TEXT);
CREATE TABLE IF NOT EXISTS risk_profiles (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), kind TEXT NOT NULL CHECK (kind IN ('official','app')), type TEXT, type_id INTEGER,
  diagnosed_at TEXT NOT NULL, source TEXT NOT NULL, purpose TEXT, answers TEXT, result TEXT, version TEXT, snapshot TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_sets (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), base_plan_id INTEGER NOT NULL REFERENCES plans(id), risk_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft','presented','selected','withdrawn')), overrides TEXT, result TEXT NOT NULL, note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, presented_at TEXT, selected_key TEXT, selected_at TEXT, selected_plan_id INTEGER
);
CREATE TABLE IF NOT EXISTS baselines (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), plan_id INTEGER NOT NULL REFERENCES plans(id), set_by INTEGER NOT NULL REFERENCES users(id), set_at TEXT NOT NULL, reason TEXT);
CREATE TABLE IF NOT EXISTS scheduled (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), month TEXT NOT NULL, label TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, category TEXT NOT NULL, kind TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS month_closures (client_id INTEGER NOT NULL REFERENCES clients(id), month TEXT NOT NULL, closed_at TEXT NOT NULL, closed_by TEXT NOT NULL, PRIMARY KEY (client_id, month));
CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), base_plan_id INTEGER NOT NULL REFERENCES plans(id), kind TEXT NOT NULL, month TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','applied','held','auto','info','stale')), data TEXT, summary TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, applied_plan_id INTEGER,
  UNIQUE (client_id, kind, month, base_plan_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), type TEXT NOT NULL, dkey TEXT NOT NULL, fact TEXT NOT NULL, impact TEXT, action TEXT,
  revision_id INTEGER, amounts TEXT, created_at TEXT NOT NULL, read_at TEXT, push_state TEXT NOT NULL DEFAULT 'none', UNIQUE (client_id, dkey)
);
CREATE TABLE IF NOT EXISTS notif_settings (client_id INTEGER PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auto_consent (client_id INTEGER PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), client_id INTEGER, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS eval_state (client_id INTEGER PRIMARY KEY REFERENCES clients(id), status TEXT, gap DOUBLE PRECISION, at TEXT);
CREATE TABLE IF NOT EXISTS inquiries (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), notification_id INTEGER, message TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, target TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS client_data (client_id INTEGER PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, version INTEGER NOT NULL, field_versions TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by INTEGER);
CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL, actor_id INTEGER, actor_role TEXT, entity TEXT NOT NULL, version INTEGER, summary TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idem (user_id INTEGER NOT NULL, ikey TEXT NOT NULL, status INTEGER, response TEXT, at TEXT NOT NULL, PRIMARY KEY (user_id, ikey));
CREATE TABLE IF NOT EXISTS plan_offers (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), plan_id INTEGER NOT NULL REFERENCES plans(id), status TEXT NOT NULL CHECK (status IN ('presented','accepted','declined','withdrawn')), note TEXT, created_by INTEGER NOT NULL, created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, source TEXT NOT NULL, category TEXT NOT NULL, ukey TEXT NOT NULL, company TEXT, name TEXT, data TEXT NOT NULL, fetched_at TEXT NOT NULL, UNIQUE (source, ukey));
CREATE TABLE IF NOT EXISTS product_meta (source TEXT PRIMARY KEY, fetched_at TEXT, ok INTEGER, error TEXT, count INTEGER, attempted_at TEXT);
CREATE TABLE IF NOT EXISTS product_requests (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), product TEXT NOT NULL, simulation TEXT NOT NULL, status TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS changes_client ON changes (client_id, id);
`;
// 이전 버전 DB(내 PC)에 없는 열 추가
const MIGRATIONS = [
  ['users', 'disabled', 'INTEGER NOT NULL DEFAULT 0'], ['users', 'demo', 'INTEGER NOT NULL DEFAULT 0'], ['plans', 'data_version', 'INTEGER']
];

function toPg(sql) {
  let s = sql, n = 0;
  const ignore = /INSERT OR IGNORE INTO/i.test(s);
  s = s.replace(/INSERT OR IGNORE INTO/ig, 'INSERT INTO');
  s = s.replace(/\?/g, () => '$' + (++n));
  if (ignore) s = s.replace(/(\)\s*)$/, '$1 ON CONFLICT DO NOTHING');
  return s;
}
function insertTable(sql) { const m = sql.match(/^\s*INSERT(?: OR IGNORE)? INTO\s+(\w+)/i); return m ? m[1] : null; }

async function openSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON;' + (file === ':memory:' ? '' : ' PRAGMA journal_mode = WAL;'));
  raw.exec(SCHEMA);
  MIGRATIONS.forEach(([t, c, def]) => { const cols = raw.prepare('PRAGMA table_info(' + t + ')').all().map((x) => x.name); if (!cols.includes(c)) raw.exec('ALTER TABLE ' + t + ' ADD COLUMN ' + c + ' ' + def); });
  const exec = {
    get: async (sql, ...p) => raw.prepare(sql).get(...p),
    all: async (sql, ...p) => raw.prepare(sql).all(...p),
    run: async (sql, ...p) => { const r = raw.prepare(sql).run(...p); return { changes: Number(r.changes), id: insertTable(sql) && WITH_ID.has(insertTable(sql)) ? Number(r.lastInsertRowid) : undefined }; }
  };
  return wrap(exec, { kind: 'sqlite', begin: () => raw.exec('BEGIN IMMEDIATE'), commit: () => raw.exec('COMMIT'), rollback: () => raw.exec('ROLLBACK'), close: () => raw.close() });
}

// Postgres 스키마 = migrations/*.sql (순서대로, 적용 기록은 schema_migrations)
const MIG_DIR = path.join(__dirname, '..', 'migrations');
function pgSchemaSql() {
  return SCHEMA.split(';').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/INTEGER PRIMARY KEY/g, 'BIGSERIAL PRIMARY KEY') + ';')
    .concat(MIGRATIONS.map(([t, c, def]) => 'ALTER TABLE ' + t + ' ADD COLUMN IF NOT EXISTS ' + c + ' ' + def + ';')).join('\n');
}
async function migratePg(client, log) {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(MIG_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8').replace(/--.*$/gm, '');
    await client.query('BEGIN');
    try {
      for (const stmt of sql.split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await client.query(stmt);
      await client.query('INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)', [f, new Date().toISOString()]);
      await client.query('COMMIT'); applied.push(f); if (log) log('적용: ' + f);
    } catch (e) { await client.query('ROLLBACK'); e.message = f + ': ' + e.message; throw e; }
  }
  return { applied, total: files.length };
}

async function openPg(url, opts) {
  const client = require('./pg').createClient(url);
  await migratePg(client, opts && opts.log);
  const exec = {
    get: async (sql, ...p) => (await client.query(toPg(sql), p)).rows[0],
    all: async (sql, ...p) => (await client.query(toPg(sql), p)).rows,
    run: async (sql, ...p) => {
      const t = insertTable(sql), withId = t && WITH_ID.has(t);
      const r = await client.query(toPg(sql) + (withId ? ' RETURNING id' : ''), p);
      return { changes: r.changes, id: withId && r.rows[0] ? Number(r.rows[0].id) : undefined };
    }
  };
  return wrap(exec, { kind: 'postgres', begin: () => client.query('BEGIN'), commit: () => client.query('COMMIT'), rollback: () => client.query('ROLLBACK'), close: () => client.end() });
}

// 트랜잭션 중에는 다른 요청의 쿼리가 끼어들지 않도록 전체 직렬화
function wrap(exec, ctl) {
  let lock = Promise.resolve();
  const guarded = (fn) => { const r = lock.then(fn); lock = r.catch(() => {}); return r; };
  const db = {
    kind: ctl.kind,
    get: (sql, ...p) => guarded(() => exec.get(sql, ...p)),
    all: (sql, ...p) => guarded(() => exec.all(sql, ...p)),
    run: (sql, ...p) => guarded(() => exec.run(sql, ...p)),
    tx: (fn) => guarded(async () => {
      await ctl.begin();
      try { const out = await fn(exec); await ctl.commit(); return out; }
      catch (e) { try { await ctl.rollback(); } catch (x) { /* 무시 */ } throw e; }
    }),
    close: () => ctl.close()
  };
  return db;
}

async function open(opts) {
  opts = opts || {};
  if (opts.url) return openPg(opts.url, opts);
  return openSqlite(opts.file || ':memory:');
}

function tableNames() { return [...SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]); }
module.exports = { open, toPg, pgSchemaSql, migratePg, tableNames, WITH_ID };
