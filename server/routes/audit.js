import express from 'express';
import db from '../db.js';
import { requireAuth, requireRole } from '../middleware.js';

const router = express.Router();
router.use(requireAuth, requireRole('owner'));

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const rows = db.prepare(
    'SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?'
  ).all(limit);
  res.json({ logs: rows });
});

export default router;
