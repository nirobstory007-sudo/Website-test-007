import express from 'express';
import db from '../db.js';
import { requireAuth, requireRole, audit } from '../middleware.js';

const router = express.Router();
const KEYS = ['brand_name','brand_logo','brand_tagline','brand_footer','brand_color'];

/* PUBLIC */
router.get('/branding', (req, res) => {
  const rows = db.prepare(
    `SELECT key, value FROM settings WHERE key IN (${KEYS.map(()=>'?').join(',')})`
  ).all(...KEYS);
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json({
    brand_name:    out.brand_name    || 'YOUR BRAND NAME',
    brand_logo:    out.brand_logo    || '👑',
    brand_tagline: out.brand_tagline || 'License Management System',
    brand_footer:  out.brand_footer  || 'SECURITY v2.0',
    brand_color:   out.brand_color   || '#7c3aed',
  });
});

/* OWNER update */
router.post('/branding', requireAuth, requireRole('owner'), (req, res) => {
  const { brand_name, brand_logo, brand_tagline, brand_footer, brand_color } = req.body || {};
  const updates = {};
  if (typeof brand_name === 'string'    && brand_name.trim())    updates.brand_name    = brand_name.trim().slice(0,64);
  if (typeof brand_logo === 'string'    && brand_logo.trim())    updates.brand_logo    = brand_logo.trim().slice(0,8);
  if (typeof brand_tagline === 'string' && brand_tagline.trim()) updates.brand_tagline = brand_tagline.trim().slice(0,96);
  if (typeof brand_footer === 'string'  && brand_footer.trim())  updates.brand_footer  = brand_footer.trim().slice(0,96);
  if (typeof brand_color === 'string'   && /^#[0-9a-fA-F]{6}$/.test(brand_color)) updates.brand_color = brand_color;

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ error: 'no valid fields' });

  const stmt = db.prepare(`
    INSERT INTO settings (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);
  for (const [k,v] of Object.entries(updates)) stmt.run(k, v);

  audit(req, 'branding.update', null, updates);
  res.json({ ok: true, updated: Object.keys(updates) });
});

export default router;
