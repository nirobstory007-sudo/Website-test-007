import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { requireAuth, requireRole, requireOwnershipOr, audit } from '../middleware.js';
import { ROLE_RANK } from '../auth.js';

const router = express.Router();
router.use(requireAuth);

function getPrefix() {
  return db.prepare('SELECT value FROM settings WHERE key=?').get('global_prefix')?.value || 'KEY';
}
function buildKey() {
  const a = crypto.randomBytes(3).toString('hex').toUpperCase();
  const b = crypto.randomBytes(3).toString('hex').toUpperCase();
  const c = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${getPrefix()}-${a}-${b}-${c}`;
}

router.get('/', (req, res) => {
  const me = req.user;
  const rank = ROLE_RANK[me.role];
  let rows;
  if (rank >= ROLE_RANK.owner) {
    rows = db.prepare(`
      SELECT k.*, u.username AS owner_name FROM keys k
      LEFT JOIN users u ON u.id = k.owner_id
      ORDER BY k.id DESC LIMIT 500
    `).all();
  } else if (rank === ROLE_RANK.admin) {
    rows = db.prepare(`
      SELECT k.*, u.username AS owner_name FROM keys k
      LEFT JOIN users u ON u.id = k.owner_id
      WHERE k.created_by = ? OR k.owner_id = ?
      ORDER BY k.id DESC LIMIT 500
    `).all(me.id, me.id);
  } else {
    rows = db.prepare(`
      SELECT k.*, u.username AS owner_name FROM keys k
      LEFT JOIN users u ON u.id = k.owner_id
      WHERE k.owner_id = ?
      ORDER BY k.id DESC LIMIT 200
    `).all(me.id);
  }
  res.json({ keys: rows, prefix: getPrefix() });
});

router.post('/generate', requireRole('reseller'), (req, res) => {
  const me = req.user;
  const isReseller = me.role === 'reseller';
  const { count = 1, duration_days = 30, cost = 1, owner_id } = req.body || {};

  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), isReseller ? 50 : 200);
  const days = Math.min(Math.max(parseInt(duration_days, 10) || 30, 1), 3650);
  const unitCost = Math.max(parseInt(cost, 10) || 0, 0);
  const totalCost = unitCost * n;

  let targetOwnerId = me.id;
  if (owner_id && owner_id !== me.id) {
    if (isReseller)
      return res.status(403).json({ error: 'resellers cannot assign keys to others' });
    const target = db.prepare('SELECT id, role FROM users WHERE id=?').get(owner_id);
    if (!target) return res.status(404).json({ error: 'target user not found' });
    if (ROLE_RANK[target.role] >= ROLE_RANK[me.role])
      return res.status(403).json({ error: 'cannot assign to peer or superior' });
    targetOwnerId = target.id;
  }

  const created = [];
  const tx = db.transaction(() => {
    if (totalCost > 0) {
      const u = db.prepare('SELECT balance FROM users WHERE id=?').get(me.id);
      if (u.balance < totalCost) throw new Error('insufficient credits');
      db.prepare('UPDATE users SET balance = balance - ? WHERE id=?').run(totalCost, me.id);
    }
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 5; a++) {
        const kv = buildKey();
        try {
          const info = db.prepare(`
            INSERT INTO keys (key_value, prefix, duration_days, created_by, owner_id)
            VALUES (?,?,?,?,?)
          `).run(kv, getPrefix(), days, me.id, targetOwnerId);
          created.push({ id: info.lastInsertRowid, key_value: kv });
          break;
        } catch {}
      }
    }
  });

  try { tx(); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  audit(req, 'key.generate', null, {
    count: created.length, days, totalCost, owner_id: targetOwnerId,
  });
  const newBalance = db.prepare('SELECT balance FROM users WHERE id=?').get(me.id).balance;
  res.json({ keys: created, balance: newBalance });
});

router.post('/:id/reset',
  requireRole('reseller'),
  requireOwnershipOr('owner', req =>
    db.prepare('SELECT id, owner_id, created_by, key_value FROM keys WHERE id=?')
      .get(req.params.id)),
  (req, res) => {
    db.prepare(`
      UPDATE keys SET device_id=NULL, status='active', used_at=NULL WHERE id=?
    `).run(req.resource.id);
    audit(req, 'key.reset', `key:${req.resource.id}`, { key_value: req.resource.key_value });
    res.json({ ok: true });
  });

router.delete('/:id',
  requireRole('admin'),
  requireOwnershipOr('owner', req =>
    db.prepare('SELECT id, owner_id, created_by, key_value FROM keys WHERE id=?')
      .get(req.params.id)),
  (req, res) => {
    db.prepare('DELETE FROM keys WHERE id=?').run(req.resource.id);
    audit(req, 'key.delete', `key:${req.resource.id}`, { key_value: req.resource.key_value });
    res.json({ ok: true });
  });

router.post('/:id/reset-link',
  requireRole('admin'),
  requireOwnershipOr('owner', req =>
    db.prepare('SELECT id, owner_id, created_by FROM keys WHERE id=?')
      .get(req.params.id)),
  (req, res) => {
    const token = crypto.randomBytes(24).toString('base64url');
    const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    db.prepare('UPDATE keys SET reset_token=?, reset_expires=? WHERE id=?')
      .run(token, expires, req.resource.id);
    audit(req, 'key.reset_link', `key:${req.resource.id}`, {});
    res.json({ url: `/reset.html?token=${token}` });
  });

router.post('/master/reset-all', requireRole('owner'), (req, res) => {
  const info = db.prepare(`
    UPDATE keys SET device_id=NULL, status='active', used_at=NULL
  `).run();
  audit(req, 'key.master_reset', null, { affected: info.changes });
  res.json({ affected: info.changes });
});

router.post('/master/delete-all', requireRole('owner'), (req, res) => {
  const info = db.prepare('DELETE FROM keys').run();
  audit(req, 'key.master_delete', null, { affected: info.changes });
  res.json({ affected: info.changes });
});

router.post('/prefix', requireRole('owner'), (req, res) => {
  const { prefix } = req.body || {};
  if (!prefix || !/^[A-Z0-9]{2,10}$/.test(prefix))
    return res.status(400).json({ error: 'prefix must be 2-10 uppercase alnum' });
  db.prepare(`
    INSERT INTO settings (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run('global_prefix', prefix);
  audit(req, 'settings.prefix', null, { prefix });
  res.json({ ok: true, prefix });
});

export const publicResetRouter = express.Router();

publicResetRouter.post('/reset/:token', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const key = db.prepare(
    'SELECT * FROM keys WHERE reset_token=? AND reset_expires > ?'
  ).get(req.params.token, now);
  if (!key) return res.status(404).json({ error: 'invalid or expired link' });
  db.prepare(`
    UPDATE keys SET device_id=NULL, status='active', used_at=NULL,
                    reset_token=NULL, reset_expires=NULL WHERE id=?
  `).run(key.id);
  res.json({ ok: true });
});

export default router;
