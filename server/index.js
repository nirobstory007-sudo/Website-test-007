import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import keyRoutes, { publicResetRouter, resetLinksRouter } from './routes/keys.js';
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

/* ---------- Body parsers ---------- */
app.use(express.json({ limit: '200kb' }));
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
app.use('/api', resetLinksRouter);

/* ---------- External API (API-key based) ---------- */
app.use('/api/external', verifyRoutes);
app.use('/api', verifyRoutes);
app.use('/api', publicResetRouter);

/* ---------- Static + SPA ---------- */
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
);

/* ---------- DEBUG ---------- */
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err && err.stack ? err.stack : err);
  res.status(500).json({
    error: 'server error',
    message: err && err.message ? err.message : String(err),
    name: err && err.name ? err.name : 'Error',
    path: req.path,
    method: req.method,
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`▶  http://localhost:${port}`));
