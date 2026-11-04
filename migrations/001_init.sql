-- 재무플래너 Postgres 초기 스키마 (Neon 등)
-- 적용: npm run migrate  (DATABASE_URL 환경변수 필요) — 서버 시작 때도 아직 적용 안 된 파일을 자동 적용합니다.
-- 표 관계: users 1─1 clients(고객 계정), users(설계사) N─N clients = assignments, clients 1─N plans·records·client_data·changes·notifications ...
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('planner','client')), pw_hash TEXT NOT NULL, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (id BIGSERIAL PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id), profile TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assignments (planner_id INTEGER NOT NULL REFERENCES users(id), client_id INTEGER NOT NULL REFERENCES clients(id), granted_at TEXT NOT NULL, PRIMARY KEY (planner_id, client_id));
CREATE TABLE IF NOT EXISTS plans (
  id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), kind TEXT NOT NULL CHECK (kind IN ('before','after')), version INTEGER NOT NULL,
  label TEXT, note TEXT, data TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, data_version INTEGER, UNIQUE (client_id, kind, version)
);
CREATE TABLE IF NOT EXISTS records (
  id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), month TEXT NOT NULL, category TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL, tx_id INTEGER, note TEXT, voided_at TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), label TEXT NOT NULL, masked TEXT NOT NULL, purpose TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), date TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, description TEXT, from_masked TEXT, to_masked TEXT,
  source TEXT NOT NULL, suggested TEXT, classification TEXT, confirmed_at TEXT, record_id INTEGER, import_key TEXT, created_at TEXT NOT NULL, UNIQUE (client_id, import_key)
);
CREATE TABLE IF NOT EXISTS settings (client_id BIGSERIAL PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_status (client_id BIGSERIAL PRIMARY KEY REFERENCES clients(id), provider TEXT, last_sync TEXT, last_error TEXT);
CREATE TABLE IF NOT EXISTS risk_profiles (
  id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), kind TEXT NOT NULL CHECK (kind IN ('official','app')), type TEXT, type_id INTEGER,
  diagnosed_at TEXT NOT NULL, source TEXT NOT NULL, purpose TEXT, answers TEXT, result TEXT, version TEXT, snapshot TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_sets (
  id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), base_plan_id INTEGER NOT NULL REFERENCES plans(id), risk_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft','presented','selected','withdrawn')), overrides TEXT, result TEXT NOT NULL, note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, presented_at TEXT, selected_key TEXT, selected_at TEXT, selected_plan_id INTEGER
);
CREATE TABLE IF NOT EXISTS baselines (id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), plan_id INTEGER NOT NULL REFERENCES plans(id), set_by INTEGER NOT NULL REFERENCES users(id), set_at TEXT NOT NULL, reason TEXT);
CREATE TABLE IF NOT EXISTS scheduled (id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), month TEXT NOT NULL, label TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, category TEXT NOT NULL, kind TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS month_closures (client_id INTEGER NOT NULL REFERENCES clients(id), month TEXT NOT NULL, closed_at TEXT NOT NULL, closed_by TEXT NOT NULL, PRIMARY KEY (client_id, month));
CREATE TABLE IF NOT EXISTS revisions (
  id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), base_plan_id INTEGER NOT NULL REFERENCES plans(id), kind TEXT NOT NULL, month TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','applied','held','auto','info','stale')), data TEXT, summary TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, applied_plan_id INTEGER,
  UNIQUE (client_id, kind, month, base_plan_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), type TEXT NOT NULL, dkey TEXT NOT NULL, fact TEXT NOT NULL, impact TEXT, action TEXT,
  revision_id INTEGER, amounts TEXT, created_at TEXT NOT NULL, read_at TEXT, push_state TEXT NOT NULL DEFAULT 'none', UNIQUE (client_id, dkey)
);
CREATE TABLE IF NOT EXISTS notif_settings (client_id BIGSERIAL PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auto_consent (client_id BIGSERIAL PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), client_id INTEGER, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS eval_state (client_id BIGSERIAL PRIMARY KEY REFERENCES clients(id), status TEXT, gap DOUBLE PRECISION, at TEXT);
CREATE TABLE IF NOT EXISTS inquiries (id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), notification_id INTEGER, message TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id BIGSERIAL PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, target TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS client_data (client_id BIGSERIAL PRIMARY KEY REFERENCES clients(id), data TEXT NOT NULL, version INTEGER NOT NULL, field_versions TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by INTEGER);
CREATE TABLE IF NOT EXISTS changes (id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL, actor_id INTEGER, actor_role TEXT, entity TEXT NOT NULL, version INTEGER, summary TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idem (user_id INTEGER NOT NULL, ikey TEXT NOT NULL, status INTEGER, response TEXT, at TEXT NOT NULL, PRIMARY KEY (user_id, ikey));
CREATE TABLE IF NOT EXISTS plan_offers (id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), plan_id INTEGER NOT NULL REFERENCES plans(id), status TEXT NOT NULL CHECK (status IN ('presented','accepted','declined','withdrawn')), note TEXT, created_by INTEGER NOT NULL, created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS products (id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, category TEXT NOT NULL, ukey TEXT NOT NULL, company TEXT, name TEXT, data TEXT NOT NULL, fetched_at TEXT NOT NULL, UNIQUE (source, ukey));
CREATE TABLE IF NOT EXISTS product_meta (source TEXT PRIMARY KEY, fetched_at TEXT, ok INTEGER, error TEXT, count INTEGER, attempted_at TEXT);
CREATE TABLE IF NOT EXISTS product_requests (id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), product TEXT NOT NULL, simulation TEXT NOT NULL, status TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS changes_client ON changes (client_id, id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS data_version INTEGER;
