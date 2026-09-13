import express from 'express';
import db from '../db.js';
import { requireAuth, requireRole, audit } from '../middleware.js';

const router = express.Router();
router.use(requireAuth);

const VALID_TIERS = new Set(['1','2','unlimited']);

router.get('/pricing', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM pricing WHERE active=1
    ORDER BY duration_days ASC,
      CASE device_tier WHEN '1' THEN 1 WHEN '2' THEN 2 ELSE 3 END ASC
  `).all();
  res.json({ pricing: rows });
});

router.post('/pricing', requireRole('owner'), (req, res) => {
  const { duration_days, device_tier, credit_cost } = req.body || {};
  const days = parseInt(duration_days, 10);
  const cost = parseInt(credit_cost, 10);

  if (!Number.isInteger(days) || days < 1 || days > 3650)
    return res.status(400).json({ error: 'duration_days must be 1..3650' });
  if (!VALID_TIERS.has(String(device_tier)))
    return res.status(400).json({ error: 'device_tier must be 1, 2, or unlimited' });
  if (!Number.isInteger(cost) || cost < 0)
    return res.status(400).json({ error: 'credit_cost must be >= 0' });

  try {
    const info = db.prepare(`
      INSERT INTO pricing (duration_days,device_tier,credit_cost) VALUES (?,?,?)
    `).run(days, String(device_tier), cost);
    audit(req, 'pricing.create', `pricing:${info.lastInsertRowid}`, { days, device_tier, cost });
    res.json({ id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: 'Rule for this duration + tier already exists' });
  }
});

router.patch('/pricing/:id', requireRole('owner'), (req, res) => {
  const { credit_cost, active } = req.body || {};
  const row = db.prepare('SELECT * FROM pricing WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const updates = []; const values = [];
  if (credit_cost !== undefined) {
    const c = parseInt(credit_cost, 10);
    if (!Number.isInteger(c) || c < 0) return res.status(400).json({ error: 'bad cost' });
    updates.push('credit_cost=?'); values.push(c);
  }
  if (active !== undefined) { updates.push('active=?'); values.push(active ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });

  updates.push("updated_at=strftime('%s','now')");
  values.push(row.id);
  db.prepare(`UPDATE pricing SET ${updates.join(', ')} WHERE id=?`).run(...values);
  audit(req, 'pricing.update', `pricing:${row.id}`, { credit_cost, active });
  res.json({ ok: true });
});

router.delete('/pricing/:id', requireRole('owner'), (req, res) => {
  const row = db.prepare('SELECT * FROM pricing WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM pricing WHERE id=?').run(row.id);
  audit(req, 'pricing.delete', `pricing:${row.id}`, row);
  res.json({ ok: true });
});

export default router;
