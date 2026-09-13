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

  if (!row.device_id) {
    db.prepare(`
      UPDATE keys SET device_id=?, status='used', used_at=? WHERE id=?
    `).run(device_id, now, row.id);
  } else if (row.device_id !== device_id) {
    log('device_mismatch', row.id);
    return res.json({ valid: false, reason: 'device_mismatch' });
  }

  log('ok', row.id);
  res.json({
    valid: true,
    duration_days: row.duration_days,
    expires_at: expiresAt,
  });
});

router.get('/check', requireApiKey('verify'), (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'key required' });
  const row = db.prepare(`
    SELECT status, device_id, duration_days, created_at, used_at
    FROM keys WHERE key_value=?
  `).get(key);
  if (!row) return res.json({ valid: false, reason: 'not_found' });
  if (row.status === 'revoked') return res.json({ valid: false, reason: 'revoked' });
  const start = row.used_at || row.created_at;
  const expiresAt = start + row.duration_days * 86400;
  if (expiresAt < Math.floor(Date.now() / 1000))
    return res.json({ valid: false, reason: 'expired' });
  res.json({ valid: true, bound: !!row.device_id, expires_at: expiresAt });
});

export default router;
