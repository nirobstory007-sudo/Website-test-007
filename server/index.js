import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import keyRoutes, { publicResetRouter } from './routes/keys.js';
import creditRoutes from './routes/credits.js';
import auditRoutes from './routes/audit.js';
import apiKeyRoutes from './routes/apikeys.js';
import verifyRoutes from './routes/verify.js';
import brandingRoutes from './routes/branding.js';
import pricingRoutes from './routes/pricing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));

// JSON body parser
app.use(express.json({ limit: '200kb' }));

// ⭐ URL-encoded (form-data) parser — for external tools that post as form
app.use(express.urlencoded({ extended: true, limit: '200kb' }));

app.use(cookieParser());

/* ---------- Session-based routes ---------- */
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/keys', keyRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api', apiKeyRoutes);
app.use('/api', brandingRoutes);
app.use('/api', pricingRoutes);

/* ---------- External API (API-key based) ---------- */
// Primary path — canonical
app.use('/api/external', verifyRoutes);

// Alias path — many external tools call "/api/reset_hwid" directly
// (the same routes work here too)
app.use('/api', verifyRoutes);

// Public token-based reset (no auth)
app.use('/api', publicResetRouter);

/* ---------- Static + SPA ---------- */
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`▶  http://localhost:${port}`));
