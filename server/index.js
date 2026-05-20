import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import './db/database.js'; // initialises schema
import authRoutes from './routes/auth.js';
import plansRoutes from './routes/plans.js';
import scenariosRoutes from './routes/scenarios.js';
import bucketsRoutes from './routes/buckets.js';
import eventsRoutes from './routes/events.js';
import projectionRoutes from './routes/projection.js';
import actualsRoutes from './routes/actuals.js';
import householdRoutes from './routes/household.js';
import fxRoutes from './routes/fx.js';
import csvRoutes from './routes/csv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_DIR = process.env.DATA_DIR || resolve(__dirname, '..', 'data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const app = express();

app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Sessions stored in their own SQLite file so a corrupted session store
// can't take the app DB down with it.
const SQLiteStore = connectSqlite3(session);
app.use(
  session({
    name: 'fs.sid',
    secret: process.env.SESSION_SECRET || 'change-me-in-production-please',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: NODE_ENV === 'production' && process.env.TRUST_PROXY === 'true',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: DATA_DIR,
      table: 'sessions',
    }),
  }),
);

if (NODE_ENV === 'development') {
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    }),
  );
}

// ============================================================
// API routes
// ============================================================
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api/plans', plansRoutes);
app.use('/api', scenariosRoutes);
app.use('/api', bucketsRoutes);
app.use('/api', eventsRoutes);
app.use('/api', projectionRoutes);
app.use('/api', actualsRoutes);
app.use('/api', householdRoutes);
app.use('/api/fx', fxRoutes);
app.use('/api', csvRoutes);

// ============================================================
// Static frontend (production)
// ============================================================
if (NODE_ENV === 'production') {
  const distDir = resolve(__dirname, '..', 'dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: '7d', etag: true }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(join(distDir, 'index.html'));
    });
  } else {
    console.warn(`[server] dist/ not found at ${distDir} — built frontend will not be served.`);
  }
}

// ============================================================
// Error handler
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`[server] Future Sight listening on http://localhost:${PORT} (${NODE_ENV})`);
});

// Graceful shutdown
function shutdown() {
  console.log('[server] Shutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
