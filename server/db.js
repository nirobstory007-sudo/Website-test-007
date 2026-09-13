import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import 'dotenv/config';

const db = new Database(process.env.DB_PATH || './data.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super_hide_owner','owner','admin','reseller')),
  balance INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_value TEXT UNIQUE NOT NULL,
  prefix TEXT NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 30,
  device_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','used','revoked')),
  created_by INTEGER NOT NULL,
  owner_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  used_at INTEGER,
  reset_token TEXT,
  reset_expires INTEGER,
  FOREIGN KEY(created_by) REFERENCES users(id),
  FOREIGN KEY(owner_id)   REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_username TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target TEXT,
  meta TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'verify',
  active INTEGER NOT NULL DEFAULT 1,
  last_used INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id INTEGER,
  api_key_id INTEGER,
  device_id TEXT,
  result TEXT NOT NULL,
  ip TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_keys_owner ON keys(owner_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_verif_key ON verifications(key_id, created_at DESC);
`);

const seed = () => {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get('super_hide_owner');
  if (row.c === 0) {
    const hash = bcrypt.hashSync('changeme!', 12);
    db.prepare(`INSERT INTO users (username,password_hash,role,balance) VALUES (?,?,?,?)`)
      .run('root', hash, 'super_hide_owner', 999999);
    console.log('[seed] Created Super Hide Owner: root / changeme!');
  }
  const prefix = db.prepare('SELECT value FROM settings WHERE key = ?').get('global_prefix');
  if (!prefix) {
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('global_prefix','DEMO');
  }
};
seed();

export default db;
