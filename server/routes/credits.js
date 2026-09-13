import express from 'express';
import db from '../db.js';
import { requireAuth, audit } from '../middleware.js';
import { ROLE_RANK } from '../auth.js';

const router = express.Router();
router.use(requireAuth);

router.post('/transfer', (req, res) => {
  const me = req.user;
  if (ROLE_RANK[me.role] < ROLE_RANK.admin)
    return res.status(403).json({ error: 'forbidden' });

  const { to_user_id, amount } = req.body || {};
  const amt = parseInt(amount, 10);
  if (!to_user_id || !Number.isInteger(amt) || amt <= 0)
    return res.status(400).json({ error: 'invalid input' });

  const target = db.prepare('SELECT id,username,role FROM users WHERE id=?').get(to_user_id);
  if (!target) return res.status(404).json({ error: 'recipient not found' });
  if (ROLE_RANK[target.role] >= ROLE_RANK[me.role])
    return res.status(403).json({ error: 'cannot transfer to peer or superior' });

  const tx = db.transaction(() => {
    const sender = db.prepare('SELECT balance FROM users WHERE id=?').get(me.id);
    if (sender.balance < amt) throw new Error('insufficient funds');
    db.prepare('UPDATE users SET balance = balance - ? WHERE id=?').run(amt, me.id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id=?').run(amt, target.id);
  });

  try { tx(); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  audit(req, 'credits.transfer', `user:${target.id}`, { amount: amt, to: target.username });
  res.json({ ok: true });
});

export default router;
