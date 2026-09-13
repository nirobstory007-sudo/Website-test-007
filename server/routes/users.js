import express from 'express';
import bcrypt from 'bcrypt';
import db from '../db.js';
import { requireAuth, requireRole, audit } from '../middleware.js';
import { ROLE_RANK } from '../auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const me = req.user;
  let rows;
  if (me.role === 'super_hide_owner' || me.role === 'owner') {
    rows = db.prepare(
      'SELECT id,username,role,balance,created_at FROM users ORDER BY id'
    ).all();
    if (me.role !== 'super_hide_owner')
      rows = rows.filter(r => r.role !== 'super_hide_owner');
  } else if (me.role === 'admin') {
    rows = db.prepare(
      'SELECT id,username,role,balance,created_at FROM users WHERE role=? ORDER BY id'
    ).all('reseller');
  } else {
    rows = [db.prepare(
      'SELECT id,username,role,balance,created_at FROM users WHERE id=?'
    ).get(me.id)];
  }
  res.json({ users: rows });
});

router.post('/', requireRole('admin'), (req, res) => {
  const me = req.user;
  const { username, password, role, balance = 0 } = req.body || {};
  if (!username || !password || !role)
    return res.status(400).json({ error: 'missing fields' });
  if (!ROLE_RANK[role]) return res.status(400).json({ error: 'bad role' });
  if (ROLE_RANK[role] >= ROLE_RANK[me.role])
    return res.status(403).json({ error: 'cannot create user of equal/higher role' });

  const hash = bcrypt.hashSync(password, 12);
  try {
    const info = db.prepare(`
      INSERT INTO users (username,password_hash,role,balance,created_by)
      VALUES (?,?,?,?,?)
    `).run(username, hash, role, balance, me.id);
    audit(req, 'user.create', `user:${info.lastInsertRowid}`, { username, role, balance });
    res.json({ id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: 'username taken' });
  }
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const me = req.user;
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (ROLE_RANK[target.role] >= ROLE_RANK[me.role])
    return res.status(403).json({ error: 'cannot delete peer/superior' });
  db.prepare('DELETE FROM users WHERE id=?').run(target.id);
  audit(req, 'user.delete', `user:${target.id}`, { username: target.username });
  res.json({ ok: true });
});

export default router;
