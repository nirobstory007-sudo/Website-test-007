import { verifyToken, ROLE_RANK, hashApiKey } from './auth.js';
import db from './db.js';

/* ---------- Session auth ---------- */
export function requireAuth(req, res, next) {
  const token = req.cookies?.auth;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'invalid token' });

  const user = db.prepare('SELECT id,username,role,balance FROM users WHERE id=?').get(payload.id);
  if (!user) return res.status(401).json({ error: 'user gone' });

  req.user = user;
  req.authKind = 'session';
  next();
}

/* ---------- API-key auth (for bots/sites) ---------- */
export function requireApiKey(requiredScope) {
  return (req, res, next) => {
    // Accept key from X-API-Key header OR api_key in body
    const raw = req.get('x-api-key') || (req.body && req.body.api_key);
    if (!raw) return res.status(401).json({ error: 'missing api key' });

    const hash = hashApiKey(raw);
    const row = db.prepare(`
      SELECT k.*, u.id AS uid, u.username, u.role, u.balance
      FROM api_keys k JOIN users u ON u.id = k.owner_id
      WHERE k.key_hash = ? AND k.active = 1
    `).get(hash);
    if (!row) return res.status(401).json({ error: 'invalid api key' });

    if (requiredScope &&
        !row.scopes.split(',').map(s => s.trim()).includes(requiredScope)) {
      return res.status(403).json({ error: 'scope not permitted' });
    }

    db.prepare('UPDATE api_keys SET last_used=? WHERE id=?')
      .run(Math.floor(Date.now() / 1000), row.id);

    req.user = { id: row.uid, username: row.username, role: row.role, balance: row.balance };
    req.apiKey = { id: row.id, scopes: row.scopes };
    req.authKind = 'api_key';
    next();
  };
}

/* ---------- Role guard ---------- */
export function requireRole(minRole) {
  const min = ROLE_RANK[minRole];
  return (req, res, next) => {
    if (ROLE_RANK[req.user.role] < min)
      return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

/* ---------- Ownership OR rank guard ---------- */
export function requireOwnershipOr(minRole, getResource) {
  const min = ROLE_RANK[minRole];
  return (req, res, next) => {
    const row = getResource(req);
    if (!row) return res.status(404).json({ error: 'not found' });
    const me = req.user;
    const isHighRank = ROLE_RANK[me.role] >= min;
    const ownsIt = row.owner_id === me.id || row.created_by === me.id;
    if (!isHighRank && !ownsIt) return res.status(403).json({ error: 'forbidden' });
    req.resource = row;
    next();
  };
}

/* ---------- Audit (Super Hide Owner actions invisible) ---------- */
export function audit(req, action, target, meta = {}) {
  const u = req.user;
  if (!u || u.role === 'super_hide_owner') return;
  db.prepare(`
    INSERT INTO audit_logs
      (actor_id, actor_username, actor_role, action, target, meta, ip)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    u.id, u.username, u.role, action,
    target || null, JSON.stringify(meta), req.ip || null
  );
}
