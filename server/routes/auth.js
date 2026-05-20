import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { hashPassword, verifyPassword, requireAuth } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

const signupSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

router.post('/signup', async (req, res) => {
  if (process.env.ALLOW_REGISTRATION === 'false') {
    // Allow the very first user (bootstrap) even when locked down.
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (count > 0) return res.status(403).json({ error: 'Registration is disabled' });
  }

  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const { email, name, password } = parsed.data;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = await hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
    .run(email, name, hash);

  const userId = info.lastInsertRowid;

  // First-time onboarding: create a default plan + base scenario for them.
  const planInfo = db
    .prepare('INSERT INTO plans (name, base_currency, created_by) VALUES (?, ?, ?)')
    .run(`${name}'s Household`, 'USD', userId);
  const planId = planInfo.lastInsertRowid;
  db.prepare('INSERT INTO plan_members (plan_id, user_id, role) VALUES (?, ?, ?)')
    .run(planId, userId, 'owner');
  db.prepare(
    `INSERT INTO scenarios (plan_id, name, description, is_base, horizon_years)
     VALUES (?, 'Base Case', 'Your default long-term financial plan.', 1, 30)`,
  ).run(planId);

  logAudit({ planId, userId, action: 'user.signup', entityType: 'user', entityId: userId });

  req.session.userId = userId;
  req.session.save(() => {
    res.status(201).json({ id: userId, email, name });
  });
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const { email, password } = parsed.data;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.userId = user.id;
  req.session.save(() => {
    res.json({ id: user.id, email: user.email, name: user.name });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('fs.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

router.post('/password', requireAuth, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const ok = await verifyPassword(parsed.data.currentPassword, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = await hashPassword(parsed.data.newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);
  logAudit({ userId: req.user.id, action: 'user.password_changed', entityType: 'user', entityId: req.user.id });
  res.json({ ok: true });
});

export default router;
