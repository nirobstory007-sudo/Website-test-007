import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import db from '../db.js';
import { requireApiKey } from '../middleware.js';
import { ROLE_RANK } from '../auth.js';

const router = express.Router();
const limiter = rateLimit({ windowMs: 60_000, max: 120 });

/* ---------- /verify (APK login flow) ---------- */
router.post('/verify', limiter, requireApiKey('verify'), (req, res) => {
  const { key, device_id } = req.body || {};
  const now = Math.floor(Date.now() / 1000);

  const log = (result, keyId = null) => db.prepare(`
    INSERT INTO verifications (key_id, api_key_id, device_id, result, ip)
    VALUES (?,?,?,?,?)
  `).run(keyId, req.apiKey.id, device_id || null, result, req.ip || null);

  if (!key || !device_id) {
    log('invalid');
    return res.status(400).json({ valid: false, reason: 'missing_input' });
  }

  const row = db.prepare('SELECT * FROM keys WHERE key_value = ?').get(key.trim());
  if (!row) {
    log('invalid');
    return res.json({ valid: false, reason: 'not_found', message: 'License key not found' });
  }

  if (row.banned) {
    log('banned', row.id);
    return res.json({ valid: false, reason: 'banned', message: 'This license has been banned.' });
  }

  if (row.status === 'revoked') {
    log('revoked', row.id);
    return res.json({ valid: false, reason: 'revoked', message: 'License revoked' });
  }

  // === CASE 1: Never activated ===
  if (!row.used_at) {
    // First activation! Check device limit
    const tier = row.device_tier || '1';
    const maxDevices = tier === 'unlimited' ? Infinity : parseInt(tier, 10);
    const count = db.prepare('SELECT COUNT(*) AS c FROM key_devices WHERE key_id=?').get(row.id).c;

    if (count >= maxDevices) {
      // Shouldn't happen because we delete devices on reset, but defensive
      log('device_limit', row.id);
      return res.json({ valid: false, reason: 'device_limit', message: 'Device limit reached' });
    }

    // Activate! Set used_at and status='used'
    db.prepare(`UPDATE keys SET device_id=?, status='used', used_at=? WHERE id=?`)
      .run(device_id, now, row.id);
    db.prepare('INSERT INTO key_devices (key_id, device_id) VALUES (?,?)').run(row.id, device_id);

    const expiresAt = now + row.duration_days * 86400;
    log('activated', row.id);

    return res.json({
      valid: true,
      activated: true,
      duration_days: row.duration_days,
      expires_at: expiresAt,
      message: 'License activated successfully',
    });
  }

  // === CASE 2: Already activated — check expiry ===
  const expiresAt = row.used_at + row.duration_days * 86400;
  if (expiresAt < now) {
    log('expired', row.id);
    return res.json({
      valid: false,
      reason: 'expired',
      expires_at: expiresAt,
      message: 'License has expired',
    });
  }

  // === CASE 3: Check device binding ===
  const tier = row.device_tier || '1';
  const maxDevices = tier === 'unlimited' ? Infinity : parseInt(tier, 10);
  const existing = db.prepare('SELECT 1 FROM key_devices WHERE key_id=? AND device_id=?').get(row.id, device_id);

  if (existing) {
    // Known device — update last_seen
    db.prepare(`UPDATE key_devices SET last_seen=strftime('%s','now') WHERE key_id=? AND device_id=?`)
      .run(row.id, device_id);
  } else {
    // New device — check limit
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM key_devices WHERE key_id=?').get(row.id).c;
    if (cnt >= maxDevices) {
      log('device_limit', row.id);
      return res.json({
        valid: false,
        reason: 'device_limit',
        message: `Maximum of ${maxDevices} device(s) reached. Please reset your HWID.`
      });
    }
    db.prepare('INSERT INTO key_devices (key_id, device_id) VALUES (?,?)').run(row.id, device_id);
  }

  log('ok', row.id);
  res.json({
    valid: true,
    duration_days: row.duration_days,
    expires_at: expiresAt,
    seconds_remaining: expiresAt - now,
  });
});

/* ---------- /check (lightweight) ---------- */
router.get('/check', requireApiKey('verify'), (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'key required' });
  const row = db.prepare(`
    SELECT id, banned, status, device_tier, duration_days, created_at, used_at
    FROM keys WHERE key_value=?
  `).get(key);

  if (!row) return res.json({ valid: false, reason: 'not_found' });
  if (row.banned) return res.json({ valid: false, reason: 'banned' });
  if (row.status === 'revoked') return res.json({ valid: false, reason: 'revoked' });

  if (!row.used_at) {
    return res.json({
      valid: true,
      activated: false,
      reason: 'unused',
      device_tier: row.device_tier,
      duration_days: row.duration_days,
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = row.used_at + row.duration_days * 86400;
  if (expiresAt < now) return res.json({ valid: false, reason: 'expired', expires_at: expiresAt });

  const devices = db.prepare('SELECT COUNT(*) AS c FROM key_devices WHERE key_id=?').get(row.id).c;
  res.json({
    valid: true,
    activated: true,
    device_tier: row.device_tier,
    devices_bound: devices,
    expires_at: expiresAt,
    seconds_remaining: expiresAt - now,
  });
});

/* ---------- /reset_hwid ---------- */
router.post('/reset_hwid', limiter, requireApiKey('keys:write'), (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ status: 'error', message: 'key is required' });
  const row = db.prepare('SELECT * FROM keys WHERE key_value = ?').get(key);
  if (!row) return res.status(404).json({ status: 'error', message: 'Key not found' });
  if (ROLE_RANK[req.user.role] < ROLE_RANK.owner && row.owner_id !== req.user.id && row.created_by !== req.user.id)
    return res.status(403).json({ status: 'error', message: 'Not your key' });

  db.prepare(`UPDATE keys SET device_id=NULL, status='active', used_at=NULL WHERE id=?`).run(row.id);
  db.prepare('DELETE FROM key_devices WHERE key_id=?').run(row.id);
  db.prepare(`INSERT INTO audit_logs (actor_id,actor_username,actor_role,action,target,meta,ip) VALUES (?,?,?,?,?,?,?)`)
    .run(req.user.id, req.user.username, req.user.role, 'api.reset_hwid', `key:${row.id}`, '{}', req.ip || null);
  res.json({ status: 'success', message: 'Hardware identifier has been reset successfully.', key });
});

/* ---------- /generate_key ---------- */
router.post('/generate_key', limiter, requireApiKey('keys:write'), (req, res) => {
  const me = req.user;
  if (ROLE_RANK[me.role] < ROLE_RANK.reseller) return res.status(403).json({ status: 'error', message: 'Forbidden' });
  const { days, count = 1, device = '1' } = req.body || {};
  const daysInt = parseInt(days, 10);
  const countInt = Math.min(Math.max(parseInt(count, 10) || 1, 1), 10);
  const tier = String(device);
  if (!Number.isInteger(daysInt) || daysInt < 1) return res.status(400).json({ status: 'error', message: 'invalid days' });
  if (!['1','2','unlimited'].includes(tier)) return res.status(400).json({ status: 'error', message: 'invalid device tier' });

  const price = db.prepare('SELECT credit_cost FROM pricing WHERE duration_days=? AND device_tier=? AND active=1').get(daysInt, tier);
  if (!price) return res.status(400).json({ status: 'error', message: 'No pricing rule for that duration + tier' });

  const totalCost = price.credit_cost * countInt;
  const prefix = db.prepare('SELECT value FROM settings WHERE key=?').get('global_prefix')?.value || 'KEY';
  const created = [];
  try {
    db.transaction(() => {
      const u = db.prepare('SELECT balance FROM users WHERE id=?').get(me.id);
      if (u.balance < totalCost) throw new Error('Insufficient credits');
      db.prepare('UPDATE users SET balance = balance - ? WHERE id=?').run(totalCost, me.id);
      for (let i = 0; i < countInt; i++) {
        for (let a = 0; a < 5; a++) {
          const kv = `${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          try {
            const info = db.prepare(`INSERT INTO keys (key_value,prefix,duration_days,device_tier,status,created_by,owner_id,used_at) VALUES (?,?,?,?,'active',?,?,NULL)`).run(kv, prefix, daysInt, tier, me.id, me.id);
            created.push(kv);
            break;
          } catch {}
        }
      }
    })();
  } catch (e) {
    return res.status(400).json({ status: 'error', message: e.message });
  }
  const nb = db.prepare('SELECT balance FROM users WHERE id=?').get(me.id).balance;
  db.prepare(`INSERT INTO audit_logs (actor_id,actor_username,actor_role,action,target,meta,ip) VALUES (?,?,?,?,?,?,?)`)
    .run(me.id, me.username, me.role, 'api.generate_key', null, JSON.stringify({ count: created.length, days: daysInt, tier, totalCost }), req.ip || null);
  res.json({ status: 'success', keys: created, count: created.length, total_cost: totalCost, new_balance: nb });
});

/* ---------- /delete_key ---------- */
router.post('/delete_key', limiter, requireApiKey('keys:write'), (req, res) => {
  const me = req.user;
  const { key, keys: bulk } = req.body || {};
  const list = Array.isArray(bulk) ? bulk.slice(0, 100) : (key ? [key] : []);
  if (!list.length) return res.status(400).json({ status: 'error', message: 'key or keys[] required' });

  const deleted = [], notFound = [], skipped = [];
  for (const kv of list) {
    const row = db.prepare('SELECT * FROM keys WHERE key_value=?').get(kv);
    if (!row) { notFound.push(kv); continue; }
    if (ROLE_RANK[me.role] < ROLE_RANK.owner && row.owner_id !== me.id && row.created_by !== me.id) { skipped.push(kv); continue; }
    db.prepare('DELETE FROM key_devices WHERE key_id=?').run(row.id);
    db.prepare('DELETE FROM keys WHERE id=?').run(row.id);
    deleted.push(kv);
  }
  db.prepare(`INSERT INTO audit_logs (actor_id,actor_username,actor_role,action,target,meta,ip) VALUES (?,?,?,?,?,?,?)`)
    .run(me.id, me.username, me.role, 'api.delete_key', null, JSON.stringify({ deleted: deleted.length }), req.ip || null);
  res.json({ status: 'success', message: `${deleted.length} key(s) deleted successfully.`, deleted: deleted.length, deleted_keys: deleted, not_found: notFound, skipped });
});

/* ---------- /register_device ---------- */
router.post('/register_device', limiter, requireApiKey('verify'), (req, res) => {
  const { key, hwid } = req.body || {};
  if (!key || !hwid) return res.status(400).json({ status: 'error', message: 'key and hwid required' });
  const row = db.prepare('SELECT * FROM keys WHERE key_value=?').get(key);
  if (!row) return res.status(404).json({ status: 'error', message: 'Key not found' });
  if (row.banned) return res.status(403).json({ status: 'error', message: 'Key is banned' });

  const existing = db.prepare('SELECT 1 FROM key_devices WHERE key_id=? AND device_id=?').get(row.id, hwid);
  if (existing) {
    db.prepare(`UPDATE key_devices SET last_seen=strftime('%s','now') WHERE key_id=? AND device_id=?`).run(row.id, hwid);
  } else {
    const tier = row.device_tier || '1';
    const max = tier === 'unlimited' ? Infinity : parseInt(tier, 10);
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM key_devices WHERE key_id=?').get(row.id).c;
    if (cnt >= max) return res.status(403).json({ status: 'error', message: 'Device limit reached' });
    db.prepare('INSERT INTO key_devices (key_id, device_id) VALUES (?,?)').run(row.id, hwid);
  }
  const total = db.prepare('SELECT COUNT(*) AS c FROM key_devices WHERE key_id=?').get(row.id).c;
  res.json({ status: 'ok', message: 'device registered', total_devices: total });
});

/* ---------- /check_balance ---------- */
router.post('/check_balance', limiter, requireApiKey('verify'), (req, res) => {
  res.json({ status: 'success', username: req.user.username, credits: req.user.balance, role: req.user.role });
});

export default router;
