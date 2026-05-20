import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { requireAuth, requirePlanRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

// GET /api/plans  — all plans the user is a member of
router.get('/', (req, res) => {
  const plans = db
    .prepare(
      `SELECT p.*, pm.role AS my_role
       FROM plans p
       JOIN plan_members pm ON pm.plan_id = p.id
       WHERE pm.user_id = ?
       ORDER BY p.created_at ASC`,
    )
    .all(req.user.id);
  res.json(plans);
});

// POST /api/plans  — create a new plan
router.post('/', (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(120),
    baseCurrency: z.string().length(3).default('USD'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO plans (name, base_currency, created_by) VALUES (?, ?, ?)')
      .run(parsed.data.name, parsed.data.baseCurrency.toUpperCase(), req.user.id);
    const planId = info.lastInsertRowid;
    db.prepare('INSERT INTO plan_members (plan_id, user_id, role) VALUES (?, ?, ?)')
      .run(planId, req.user.id, 'owner');
    db.prepare(
      `INSERT INTO scenarios (plan_id, name, description, is_base, horizon_years)
       VALUES (?, 'Base Case', 'Your default long-term financial plan.', 1, 30)`,
    ).run(planId);
    return planId;
  });
  const planId = tx();
  logAudit({ planId, userId: req.user.id, action: 'plan.created', entityType: 'plan', entityId: planId });
  res.status(201).json({ id: planId });
});

// GET /api/plans/:planId
router.get('/:planId', requirePlanRole('viewer'), (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.planId);
  const members = db
    .prepare(
      `SELECT u.id, u.email, u.name, pm.role, pm.created_at AS joined_at
       FROM plan_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.plan_id = ?
       ORDER BY pm.created_at ASC`,
    )
    .all(req.planId);
  const scenarios = db
    .prepare('SELECT * FROM scenarios WHERE plan_id = ? ORDER BY is_base DESC, created_at ASC')
    .all(req.planId);
  res.json({ ...plan, my_role: req.planRole, members, scenarios });
});

// PATCH /api/plans/:planId
router.patch('/:planId', requirePlanRole('editor'), (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(120).optional(),
    baseCurrency: z.string().length(3).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const updates = [];
  const params = [];
  if (parsed.data.name !== undefined) { updates.push('name = ?'); params.push(parsed.data.name); }
  if (parsed.data.baseCurrency !== undefined) { updates.push('base_currency = ?'); params.push(parsed.data.baseCurrency.toUpperCase()); }
  if (!updates.length) return res.json({ ok: true });

  params.push(req.planId);
  db.prepare(`UPDATE plans SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logAudit({ planId: req.planId, userId: req.user.id, action: 'plan.updated', entityType: 'plan', entityId: req.planId, details: parsed.data });
  res.json({ ok: true });
});

// DELETE /api/plans/:planId
router.delete('/:planId', requirePlanRole('owner'), (req, res) => {
  db.prepare('DELETE FROM plans WHERE id = ?').run(req.planId);
  logAudit({ userId: req.user.id, action: 'plan.deleted', entityType: 'plan', entityId: req.planId });
  res.json({ ok: true });
});

// GET /api/plans/:planId/check  — homedash-style sync poll
router.get('/:planId/check', requirePlanRole('viewer'), (req, res) => {
  const row = db.prepare('SELECT version, updated_at FROM plans WHERE id = ?').get(req.planId);
  res.json(row);
});

export default router;
