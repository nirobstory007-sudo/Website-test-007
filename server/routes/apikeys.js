import express from 'express';
import db from '../db.js';
import { requireAuth, requireRole, audit } from '../middleware.js';
import { generateApiKey, ROLE_RANK } from '../auth.js';

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const ALLOWED_SCOPES = new Set(['verify', 'keys:read', 'keys:write', 'credits']);

router.get('/', (req, res) => {
  const me = req.user;
  const rows = ROLE_RANK[me.role] >= ROLE_RANK.owner
    ? db.prepare(`
        SELECT id,name,key_prefix,owner_id,scopes,active,last_used,created_at
        FROM api_keys ORDER BY id DESC
      `).all()
    : db.prepare(`
        SELECT id,name,key_prefix,owner_id,scopes,active,last_used,created_at
        FROM api_keys WHERE owner_id=? ORDER BY id DESC
      `).all(me.id);
  res.json({ apiKeys: rows });
});

router.post('/', (req, res) => {
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
    INSERT INTO api_keys (name,key_hash,key_prefix,owner_id,scopes)
    VALUES (?,?,?,?,?)
  `).run(name, hash, prefix, me.id, list.join(','));

  audit(req, 'apikey.create', `apikey:${info.lastInsertRowid}`, { name, scopes: list });
  res.json({ id: info.lastInsertRowid, key: raw, prefix, scopes: list });
});

router.post('/:id/revoke', (req, res) => {
  const me = req.user;
  const row = db.prepare('SELECT * FROM api_keys WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (ROLE_RANK[me.role] < ROLE_RANK.owner && row.owner_id !== me.id)
    return res.status(403).json({ error: 'forbidden' });
  db.prepare('UPDATE api_keys SET active=0 WHERE id=?').run(row.id);
  audit(req, 'apikey.revoke', `apikey:${row.id}`, { name: row.name });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
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
