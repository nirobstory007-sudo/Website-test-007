import express from 'express';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { requireApiKey } from '../middleware.js';

const router = express.Router();
const verifyLimiter = rateLimit({ windowMs: 60_000, max: 120 });

router.post('/verify', verifyLimiter, requireApiKey('verify'), (req, res) => {
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

  const row = db.prepare('SELECT * FROM keys WHERE key_value = ?').get(key);
  if (!row) { log('invalid'); return res.json({ valid: false, reason: 'not_found' }); }

  if (row.banned) {
    log('banned', row.id);
    return res.json({ valid: false, reason: 'banned', message: 'This license has been banned.' });
  }
  if (row.status === 'revoked') {
    log('revoked', row.id);
    return res.json({ valid: false, reason: 'revoked' });
  }

  const start = row.used_at || row.created_at;
  const expiresAt = start + row.duration_days * 86400;
  if (expiresAt < now) {
    log('expired', row.id);
    return res.json({ valid: false, reason: 'expired', expires_at: expiresAt });
  }

  const tier = row.device_tier || '1';
  const maxDevices = tier === 'unlimited' ? Infinity : parseInt(tier, 10);
  const existing = db.prepare('SELECT 1 FROM key_devices WHERE key_id=? AND device_id=?')
    .get(row.id, device_id);

  if (!existing) {
    const count = db.prepare('SELECT COUNT(*) AS c FROM key_devices WHERE key_id=?').get(row.id).c;
    if (count >= maxDevices) {
      log('device_limit', row.id);
      return res.json({ valid: false, reason: 'device_limit',
        message: `Maximum of ${maxDevices} device(s) reached.` });
    }
    db.prepare('INSERT INTO key_devices (key_id, device_id) VALUES (?,?)').run(row.id, device_id);
  } else {
    db.prepare(`UPDATE key_devices SET last_seen=strftime('%s','now')
                WHERE key_id=? AND device_id=?`).run(row.id, device_id);
  }

  if (!row.used_at) {
    db.prepare(`UPDATE keys SET device_id=?, status='used', used_at=? WHERE id=?`)
      .run(device_id, now, row.id);
  }

  log('ok', row.id);
  res.json({ valid: true, duration_days: row.duration_days, expires_at: expiresAt });
});

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
  const start = row.used_at || row.created_at;
  const expiresAt = start + row.duration_days * 86400;
  if (expiresAt < Math.floor(Date.now() / 1000))
    return res.json({ valid: false, reason: 'expired' });
  const devices = db.prepare('SELECT COUNT(*) AS c FROM key_devices WHERE key_id=?').get(row.id).c;
  res.json({ valid: true, device_tier: row.device_tier, devices_bound: devices, expires_at: expiresAt });
});

export default router;
