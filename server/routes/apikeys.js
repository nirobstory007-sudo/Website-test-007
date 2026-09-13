import express from 'express';
import db from '../db.js';
import { requireAuth, requireRole, audit } from '../middleware.js';
import { generateApiKey, ROLE_RANK } from '../auth.js';

const router = express.Router();

const ALLOWED_SCOPES = new Set(['verify', 'keys:read', 'keys:write', 'credits']);

/* ---------- Get or auto-create current user's primary API key ---------- */
router.get('/apikeys/current', requireAuth, (req, res) => {
  const me = req.user;

  let row = db.prepare(`
    SELECT * FROM api_keys WHERE owner_id=? AND active=1
    ORDER BY id DESC LIMIT 1
  `).get(me.id);

  if (!row) {
    const { raw, hash, prefix } = generateApiKey();
    const scopes = 'verify,keys:read,keys:write,credits';
    const info = db.prepare(`
      INSERT INTO api_keys (name,key_hash,key_prefix,key_full,owner_id,scopes,active)
      VALUES (?,?,?,?,?,?,1)
    `).run('Default Key', hash, prefix, raw, me.id, scopes);

    row = db.prepare('SELECT * FROM api_keys WHERE id=?').get(info.lastInsertRowid);
    audit(req, 'apikey.auto_create', `apikey:${row.id}`, {});
  }

  res.json({
    apiKey: {
      id: row.id,
      name: row.name,
      prefix: row.key_prefix,
      full: row.key_full || null,
      scopes: row.scopes,
      active: !!row.active,
      last_used: row.last_used,
      created_at: row.created_at,
    },
  });
});

/* ---------- Regenerate current API key ---------- */
router.post('/apikeys/regenerate', requireAuth, (req, res) => {
  const me = req.user;

  db.prepare('UPDATE api_keys SET active=0 WHERE owner_id=?').run(me.id);

  const { raw, hash, prefix } = generateApiKey();
  const scopes = 'verify,keys:read,keys:write,credits';
  const info = db.prepare(`
    INSERT INTO api_keys (name,key_hash,key_prefix,key_full,owner_id,scopes,active)
    VALUES (?,?,?,?,?,?,1)
  `).run('Default Key', hash, prefix, raw, me.id, scopes);

  audit(req, 'apikey.regenerate', `apikey:${info.lastInsertRowid}`, {});

  res.json({
    ok: true,
    apiKey: {
      id: info.lastInsertRowid,
      name: 'Default Key',
      prefix,
      full: raw,
      scopes,
      active: true,
      last_used: null,
      created_at: Math.floor(Date.now() / 1000),
    },
  });
});

/* ---------- List (admin page) ---------- */
router.get('/apikeys', requireAuth, requireRole('admin'), (req, res) => {
  const me = req.user;
  const rows = ROLE_RANK[me.role] >= ROLE_RANK.owner
    ? db.prepare(`
        SELECT id,name,key_prefix,key_full,owner_id,scopes,active,last_used,created_at
        FROM api_keys ORDER BY id DESC
      `).all()
    : db.prepare(`
        SELECT id,name,key_prefix,key_full,owner_id,scopes,active,last_used,created_at
        FROM api_keys WHERE owner_id=? ORDER BY id DESC
      `).all(me.id);
  res.json({ apiKeys: rows });
});

/* ---------- Create ---------- */
router.post('/apikeys', requireAuth, requireRole('admin'), (req, res) => {
  const me = req.user;
  const { name, scopes } = req.body || {};
  if (!name || typeof name !== 'string' || name.length > 64)
    return res.status(400).json({ error: 'name required (max 64 chars)' });

  const list = (Array.isArray(scopes) ? scopes : ['verify'])
    .map(s => String(s).trim())
    .filter(s => ALLOWED_SCOPES.has(s));
  if (list.length === 0)
    return res.status(400).json({ error: 'at least one valid scope required' });

  const { raw, hash, prefix } = generateApiKey();
  const info = db.prepare(`
    INSERT INTO api_keys (name,key_hash,key_prefix,key_full,owner_id,scopes,active)
    VALUES (?,?,?,?,?,?,1)
  `).run(name, hash, prefix, raw, me.id, list.join(','));

  audit(req, 'apikey.create', `apikey:${info.lastInsertRowid}`, { name, scopes: list });
  res.json({ id: info.lastInsertRowid, key: raw, prefix, scopes: list });
});

/* ---------- Revoke ---------- */
router.post('/apikeys/:id/revoke', requireAuth, requireRole('admin'), (req, res) => {
  const me = req.user;
  const row = db.prepare('SELECT * FROM api_keys WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (ROLE_RANK[me.role] < ROLE_RANK.owner && row.owner_id !== me.id)
    return res.status(403).json({ error: 'forbidden' });
  db.prepare('UPDATE api_keys SET active=0 WHERE id=?').run(row.id);
  audit(req, 'apikey.revoke', `apikey:${row.id}`, { name: row.name });
  res.json({ ok: true });
});

/* ---------- Delete ---------- */
router.delete('/apikeys/:id', requireAuth, requireRole('admin'), (req, res) => {
  const me = req.user;
  const row = db.prepare('SELECT * FROM api_keys WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (ROLE_RANK[me.role] < ROLE_RANK.owner && row.owner_id !== me.id)
    return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM api_keys WHERE id=?').run(row.id);
  audit(req, 'apikey.delete', `apikey:${row.id}`, { name: row.name });
  res.json({ ok: true });
});

export default router;
