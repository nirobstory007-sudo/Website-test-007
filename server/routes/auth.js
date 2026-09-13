import express from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { signToken, verifyToken } from '../auth.js';

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing fields' });

  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'invalid credentials' });

  const token = signToken(user);
  res.cookie('auth', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      balance: user.balance,
    },
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies?.auth;
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'unauthenticated' });
  const u = db.prepare('SELECT id,username,role,balance FROM users WHERE id=?').get(payload.id);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  res.json({ user: u });
});

export default router;
