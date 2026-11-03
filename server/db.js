/*
 * 데이터베이스 (Node 내장 SQLite — 별도 설치 없음)
 * ------------------------------------------------------------
 * 원칙
 *  - 계획(plans)은 수정하지 않고 새 버전을 추가합니다(UPDATE 없음). 설계 전(before)·설계 후(after) 구분.
 *  - 실제 실행 기록(records)은 계획과 다른 표에 저장합니다. 정정은 기존 행을 '취소' 표시하고 새 행 추가.
 *  - 거래내역(transactions)은 원본을 보관하고, 고객이 목적을 확인한 경우에만 실행 기록으로 연결합니다.
 */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('planner','client')), pw_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id), profile TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assignments (
      planner_id INTEGER NOT NULL REFERENCES users(id), client_id INTEGER NOT NULL REFERENCES clients(id),
      granted_at TEXT NOT NULL, PRIMARY KEY (planner_id, client_id)
    );
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
      kind TEXT NOT NULL CHECK (kind IN ('before','after')), version INTEGER NOT NULL,
      label TEXT, note TEXT, data TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
      UNIQUE (client_id, kind, version)
    );
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), month TEXT NOT NULL,
      category TEXT NOT NULL, amount REAL NOT NULL, source TEXT NOT NULL, tx_id INTEGER, note TEXT,
      voided_at TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), label TEXT NOT NULL,
      masked TEXT NOT NULL, purpose TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), date TEXT NOT NULL, amount REAL NOT NULL,
      description TEXT, from_masked TEXT, to_masked TEXT, source TEXT NOT NULL, suggested TEXT, classification TEXT,
      confirmed_at TEXT, record_id INTEGER, import_key TEXT, created_at TEXT NOT NULL, UNIQUE (client_id, import_key)
    );
    CREATE TABLE IF NOT EXISTS settings (
      client_id INTEGER PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_status (
      client_id INTEGER PRIMARY KEY REFERENCES clients(id), provider TEXT, last_sync TEXT, last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS risk_profiles (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), kind TEXT NOT NULL CHECK (kind IN ('official','app')),
      type TEXT, type_id INTEGER, diagnosed_at TEXT NOT NULL, source TEXT NOT NULL, purpose TEXT, answers TEXT, result TEXT, version TEXT,
      snapshot TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS strategy_sets (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), base_plan_id INTEGER NOT NULL REFERENCES plans(id), risk_id INTEGER,
      status TEXT NOT NULL CHECK (status IN ('draft','presented','selected','withdrawn')), overrides TEXT, result TEXT NOT NULL, note TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, presented_at TEXT, selected_key TEXT, selected_at TEXT, selected_plan_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS baselines (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), plan_id INTEGER NOT NULL REFERENCES plans(id),
      set_by INTEGER NOT NULL REFERENCES users(id), set_at TEXT NOT NULL, reason TEXT
    );
    CREATE TABLE IF NOT EXISTS scheduled (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), month TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL,
      category TEXT NOT NULL, kind TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS month_closures (
      client_id INTEGER NOT NULL REFERENCES clients(id), month TEXT NOT NULL, closed_at TEXT NOT NULL, closed_by TEXT NOT NULL, PRIMARY KEY (client_id, month)
    );
    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), base_plan_id INTEGER NOT NULL REFERENCES plans(id), kind TEXT NOT NULL,
      month TEXT, status TEXT NOT NULL CHECK (status IN ('pending','applied','held','auto','info','stale')), data TEXT, summary TEXT NOT NULL,
      created_at TEXT NOT NULL, decided_at TEXT, applied_plan_id INTEGER, UNIQUE (client_id, kind, month, base_plan_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), type TEXT NOT NULL, dkey TEXT NOT NULL, fact TEXT NOT NULL,
      impact TEXT, action TEXT, revision_id INTEGER, amounts TEXT, created_at TEXT NOT NULL, read_at TEXT, push_state TEXT NOT NULL DEFAULT 'none',
      UNIQUE (client_id, dkey)
    );
    CREATE TABLE IF NOT EXISTS notif_settings (client_id INTEGER PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auto_consent (client_id INTEGER PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subs (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), client_id INTEGER, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS eval_state (client_id INTEGER PRIMARY KEY REFERENCES clients(id), status TEXT, gap REAL, at TEXT);
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), notification_id INTEGER, message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, target TEXT, at TEXT NOT NULL
    );
  `);
  return db;
}

module.exports = { open };
