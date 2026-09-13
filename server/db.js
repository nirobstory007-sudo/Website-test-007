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

CREATE TABLE IF NOT EXISTS pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duration_days INTEGER NOT NULL,
  device_tier TEXT NOT NULL,
  credit_cost INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(duration_days, device_tier)
);

CREATE TABLE IF NOT EXISTS key_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  first_seen INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  last_seen INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(key_id, device_id),
  FOREIGN KEY(key_id) REFERENCES keys(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_keys_owner ON keys(owner_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_verif_key ON verifications(key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing ON pricing(duration_days, device_tier);
CREATE INDEX IF NOT EXISTS idx_key_devices ON key_devices(key_id);
`);

function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumnIfMissing('keys', 'device_tier', "TEXT NOT NULL DEFAULT '1'");
addColumnIfMissing('keys', 'banned',      'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('keys', 'banned_at',   'INTEGER');
addColumnIfMissing('keys', 'banned_by',   'INTEGER');
addColumnIfMissing('api_keys', 'key_full', 'TEXT');

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

  const branding = {
    brand_name: 'YOUR BRAND NAME',
    brand_logo: '👑',
    brand_tagline: 'License Management System',
    brand_footer: 'SECURITY v2.0',
    brand_color: '#7c3aed',
  };
  for (const [k, v] of Object.entries(branding)) {
    const exists = db.prepare('SELECT 1 FROM settings WHERE key=?').get(k);
    if (!exists) db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(k, v);
  }

  const pc = db.prepare('SELECT COUNT(*) AS c FROM pricing').get().c;
  if (pc === 0) {
    const rows = [
      [1,'1',1],[1,'2',2],[1,'unlimited',5],
      [3,'1',2],[3,'2',4],[3,'unlimited',8],
      [7,'1',3],[7,'2',6],[7,'unlimited',12],
      [15,'1',4],[15,'2',8],[15,'unlimited',18],
      [30,'1',5],[30,'2',10],[30,'unlimited',25],
    ];
    const stmt = db.prepare('INSERT INTO pricing (duration_days,device_tier,credit_cost) VALUES (?,?,?)');
    for (const r of rows) stmt.run(...r);
    console.log('[seed] Created default pricing rules');
  }
};
seed();

export default db;
