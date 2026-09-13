import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import 'dotenv/config';

const SECRET = process.env.JWT_SECRET || 'dev-secret';

export const signToken = (user) =>
  jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: '12h' }
  );

export const verifyToken = (token) => {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
};

export const ROLE_RANK = {
  super_hide_owner: 4,
  owner: 3,
  admin: 2,
  reseller: 1,
};

const PEPPER = SECRET;

export function hashApiKey(raw) {
  return crypto.createHmac('sha256', PEPPER).update(raw).digest('hex');
}

export function generateApiKey() {
  const raw = 'api_' + crypto.randomBytes(24).toString('base64url');
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 12) };
}
