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

/* ---------- LIST ---------- */
router.get('/', (req, res) => {
  const me = req.user;
  const rank = ROLE_RANK[me.role];
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(req.query.per_page, 10) || 20, 1), 100);
  const q = (req.query.q || '').trim();
  const status = (req.query.status || 'all').trim();

  const where = [];
  const params = [];

  if (rank >= ROLE_RANK.owner) {
    // all
  } else if (rank === ROLE_RANK.admin) {
    where.push('(k.created_by = ? OR k.owner_id = ?)');
    params.push(me.id, me.id);
  } else {
    where.push('k.owner_id = ?');
    params.push(me.id);
  }

  if (status === 'active')      where.push("k.status='active' AND k.banned=0");
  else if (status === 'used')   where.push("k.status='used'   AND k.banned=0");
  else if (status === 'banned') where.push("k.banned=1");
  else if (status === 'expired') where.push(
    "(k.used_at IS NOT NULL AND (k.used_at + k.duration_days*86400) < strftime('%s','now'))"
  );

  if (q) {
    where.push(`(k.key_value LIKE ? OR u.username LIKE ? OR k.device_id LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM keys k
    LEFT JOIN users u ON u.id = k.owner_id
    ${whereSQL}
  `).get(...params).c;

  const rows = db.prepare(`
    SELECT k.*, u.username AS owner_name,
      (SELECT COUNT(*) FROM key_devices kd WHERE kd.key_id = k.id) AS device_count
    FROM keys k
    LEFT JOIN users u ON u.id = k.owner_id
    ${whereSQL}
    ORDER BY k.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, perPage, (page - 1) * perPage);

  res.json({
    keys: rows,
    prefix: getPrefix(),
    pagination: {
      page, per_page: perPage, total,
      total_pages: Math.max(Math.ceil(total / perPage), 1),
    },
  });
});

/* ---------- DETAILS ---------- */
router.get('/:id/details',
  requireRole('reseller'),
  requireOwnershipOr('owner', req =>
    db.prepare('SELECT id,owner_id,created_by FROM keys WHERE id=?').get(req.params.id)),
  (req, res) => {
    const k = db.prepare(`
      SELECT k.*, 
        u.username AS owner_name,
        c.username AS creator_name
      FROM keys k
      LEFT JOIN users u ON u.id = k.owner_id
      LEFT JOIN users c ON c.id = k.created_by
      WHERE k.id=?
    `).get(req.resource.id);
    const devices = db.prepare('SELECT device_id, first_seen, last_seen FROM key_devices WHERE key_id=? ORDER BY first_seen DESC').all(k.id);
    res.json({ key: k, devices });
  });

/* ---------- GENERATE ---------- */
router.post('/generate', requireRole('reseller'), (req, res) => {
  const me = req.user;
  const isReseller = me.role === 'reseller';
  const { count = 1, duration_days, device_tier } = req.body || {};

  const days = parseInt(duration_days, 10);
  const tier = String(device_tier || '1');
  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), isReseller ? 50 : 200);

  if (!Number.isInteger(days) || days < 1)
    return res.status(400).json({ error: 'invalid duration_days' });
  if (!['1','2','unlimited'].includes(tier))
    return res.status(400).json({ error: 'invalid device_tier' });

  const price = db.prepare(`
    SELECT credit_cost FROM pricing WHERE duration_days=? AND device_tier=? AND active=1
  `).get(days, tier);
  if (!price) return res.status(400).json({ error: 'No pricing rule for that duration + tier' });

  const unitCost = price.credit_cost;
  const totalCost = unitCost * n;

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
            INSERT INTO keys (key_value, prefix, duration_days, device_tier, created_by, owner_id)
            VALUES (?,?,?,?,?,?)
          `).run(kv, getPrefix(), days, tier, me.id, me.id);
          created.push({ id: info.lastInsertRowid, key_value: kv });
          break;
        } catch {}
      }
    }
  });

  try { tx(); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  audit(req, 'key.generate', null, {
    count: created.length, days, tier, unitCost, totalCost,
  });
  const newBalance = db.prepare('SELECT balance FROM users WHERE id=?').get(me.id).balance;
  res.json({ keys: created, balance: newBalance, unit_cost: unitCost, total_cost: totalCost });
});

/* ---------- RESET (all roles) ---------- */
router.post('/:id/reset',
  requireRole('reseller'),
  requireOwnershipOr('owner', req =>
    db.prepare('SELECT id,owner_id,created_by,key_value FROM keys WHERE id=?').get(req.params.id)),
  (req, res) => {
    db.prepare(`UPDATE keys SET device_id=NULL, status='active', used_at=NULL WHERE id=?`)
      .run(req.resource.id);
    db.prepare(`DELETE FROM key_devices WHERE key_id=?`).run(req.resource.id);
    audit(req, 'key.reset', `key:${req.resource.id}`, { key_value: req.resource.key_value });
    res.json({ ok: true });
  });

/* ---------- BAN / UNBAN (reseller+ too, but only own keys) ---------- */
router.post('/:id/ban',
  requireRole('reseller'),
  requireOwnershipOr('owner', req =>
    db.prepare('SELECT id,owner_id,created_by,key_value FROM keys WHERE id=?').get(req.params.id)),
  (req, res) => {
    db.prepare(`UPDATE keys SET banned=1, banned_at=strftime('%s','now'), banned_by=? WHERE id=?`)
      .run(req.user.id, req.resource.id);
    audit(req, 'key.ban', `key:${req.resource.id}`, { key_value: req.resource.key_value });
    res.json({ ok: true });
  });

router.post('/:id/unban',
  requireRole('reseller'),
  requireOwnershipOr('owner', req =>
    db.prepare('SELECT id,owner_id,created_by,key_value FROM keys WHERE id=?').get(req.params.id)),
  (req, res) => {
    db.prepare(`UPDATE keys SET banned=0, banned_at=NULL, banned_by=NULL WHERE id=?`)
      .run(req.resource.id);
    audit(req, 'key.unban', `key:${req.resource.id}`, { key_value: req.resource.key_value });
    res.json({ ok: true });
  });

/* ---------- DELETE (reseller+ too, but only own keys) ---------- */
router.delete('/:id',
  requireRole('reseller'),
  requireOwnershipOr('owner', req =>
    db.prepare('SELECT id,owner_id,created_by,key_value FROM keys WHERE id=?').get(req.params.id)),
  (req, res) => {
    db.prepare('DELETE FROM key_devices WHERE key_id=?').run(req.resource.id);
    db.prepare('DELETE FROM keys WHERE id=?').run(req.resource.id);
    audit(req, 'key.delete', `key:${req.resource.id}`, { key_value: req.resource.key_value });
    res.json({ ok: true });
  });

/* ---------- MASTER (Owner+) ---------- */
router.post('/master/reset-all', requireRole('owner'), (req, res) => {
  const info = db.prepare(`UPDATE keys SET device_id=NULL, status='active', used_at=NULL`).run();
  db.prepare('DELETE FROM key_devices').run();
  audit(req, 'key.master_reset', null, { affected: info.changes });
  res.json({ affected: info.changes });
});

router.post('/master/delete-all', requireRole('owner'), (req, res) => {
  db.prepare('DELETE FROM key_devices').run();
  const info = db.prepare('DELETE FROM keys').run();
  audit(req, 'key.master_delete', null, { affected: info.changes });
  res.json({ affected: info.changes });
});

/* ---------- PREFIX (Owner+) ---------- */
router.post('/prefix', requireRole('owner'), (req, res) => {
  const { prefix } = req.body || {};
  if (!prefix || !/^[A-Z0-9]{2,10}$/.test(prefix))
    return res.status(400).json({ error: 'prefix must be 2-10 uppercase alnum' });
  db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run('global_prefix', prefix);
  audit(req, 'settings.prefix', null, { prefix });
  res.json({ ok: true, prefix });
});

/* ============================================================
   PUBLIC ROUTER (no auth)
   ============================================================ */
export const publicResetRouter = express.Router();

publicResetRouter.post('/reset/:token', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const key = db.prepare('SELECT * FROM keys WHERE reset_token=? AND reset_expires > ?')
    .get(req.params.token, now);
  if (!key) return res.status(404).json({ error: 'invalid or expired link' });
  db.prepare(`UPDATE keys SET device_id=NULL, status='active', used_at=NULL,
                              reset_token=NULL, reset_expires=NULL WHERE id=?`).run(key.id);
  db.prepare('DELETE FROM key_devices WHERE key_id=?').run(key.id);
  res.json({ ok: true });
});

publicResetRouter.post('/public/reset', (req, res) => {
  const { key } = req.body || {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ status: 'error', message: 'License key is required' });
  }

  const row = db.prepare('SELECT * FROM keys WHERE key_value = ?').get(key.trim());
  if (!row) {
    return res.status(404).json({ status: 'error', message: 'License key not found' });
  }
  if (row.banned) {
    return res.status(403).json({ status: 'error', message: 'This license has been banned' });
  }

  db.prepare(`UPDATE keys SET device_id=NULL, status='active', used_at=NULL WHERE id=?`).run(row.id);
  db.prepare('DELETE FROM key_devices WHERE key_id=?').run(row.id);

  res.json({
    status: 'success',
    message: 'Device reset successful',
    key: row.key_value
  });
});

/* ============================================================
   RESET LINKS MANAGEMENT (Owner/Admin) — mounted at /api
   ============================================================ */
export const resetLinksRouter = express.Router();
resetLinksRouter.use(requireAuth, requireRole('admin'));

resetLinksRouter.get('/reset-links', (req, res) => {
  const me = req.user;
  const rank = ROLE_RANK[me.role];
  const rows = rank >= ROLE_RANK.owner
    ? db.prepare(`
        SELECT r.*, u.username AS owner_name
        FROM reset_links r LEFT JOIN users u ON u.id = r.owner_id
        ORDER BY r.id DESC
      `).all()
    : db.prepare(`
        SELECT r.*, u.username AS owner_name
        FROM reset_links r LEFT JOIN users u ON u.id = r.owner_id
        WHERE r.owner_id = ?
        ORDER BY r.id DESC
      `).all(me.id);
  res.json({ links: rows });
});

resetLinksRouter.post('/reset-links', (req, res) => {
  const me = req.user;
  const { note, max_uses } = req.body || {};
  const token = crypto.randomBytes(18).toString('base64url');
  const uses = (max_uses === '' || max_uses === null || max_uses === undefined) ? null : Math.max(parseInt(max_uses,10) || 0, 0) || null;

  const info = db.prepare(`
    INSERT INTO reset_links (token, owner_id, note, max_uses)
    VALUES (?,?,?,?)
  `).run(token, me.id, note || null, uses);

  audit(req, 'reset_link.create', `reset_link:${info.lastInsertRowid}`, { note, max_uses: uses });

  res.json({
    id: info.lastInsertRowid,
    token,
    url: '/reset.html?token=' + token,
    note: note || null,
    max_uses: uses,
  });
});

resetLinksRouter.delete('/reset-links/:id', (req, res) => {
  const me = req.user;
  const row = db.prepare('SELECT * FROM reset_links WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (ROLE_RANK[me.role] < ROLE_RANK.owner && row.owner_id !== me.id)
    return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM reset_links WHERE id=?').run(row.id);
  audit(req, 'reset_link.delete', `reset_link:${row.id}`, {});
  res.json({ ok: true });
});

export default router;
