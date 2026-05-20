import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { requireAuth, requirePlanRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

// GET /api/plans/:planId/members
router.get('/plans/:planId/members', requirePlanRole('viewer'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, pm.role, pm.created_at AS joined_at
       FROM plan_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.plan_id = ?
       ORDER BY pm.created_at ASC`,
    )
    .all(req.planId);
  res.json(rows);
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'editor', 'viewer']).default('viewer'),
});

// POST /api/plans/:planId/members  — add an existing user to a plan
router.post('/plans/:planId/members', requirePlanRole('owner'), (req, res) => {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(parsed.data.email);
  if (!user) return res.status(404).json({ error: 'No registered user with that email. Ask them to sign up first.' });

  try {
    db.prepare('INSERT INTO plan_members (plan_id, user_id, role) VALUES (?, ?, ?)')
      .run(req.planId, user.id, parsed.data.role);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'User is already a member' });
    }
    throw e;
  }
  logAudit({ planId: req.planId, userId: req.user.id, action: 'member.added', entityType: 'plan_member', entityId: user.id, details: { email: user.email, role: parsed.data.role } });
  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: parsed.data.role });
});

// PATCH /api/plans/:planId/members/:userId — change a member's role
router.patch('/plans/:planId/members/:userId', requirePlanRole('owner'), (req, res) => {
  const schema = z.object({ role: z.enum(['owner', 'editor', 'viewer']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const userId = Number(req.params.userId);

  // Don't allow the last owner to demote themselves.
  if (parsed.data.role !== 'owner') {
    const owners = db
      .prepare("SELECT COUNT(*) AS c FROM plan_members WHERE plan_id = ? AND role = 'owner'")
      .get(req.planId).c;
    const target = db.prepare('SELECT role FROM plan_members WHERE plan_id = ? AND user_id = ?').get(req.planId, userId);
    if (target?.role === 'owner' && owners <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last owner' });
    }
  }

  db.prepare('UPDATE plan_members SET role = ? WHERE plan_id = ? AND user_id = ?')
    .run(parsed.data.role, req.planId, userId);
  logAudit({ planId: req.planId, userId: req.user.id, action: 'member.role_changed', entityType: 'plan_member', entityId: userId, details: parsed.data });
  res.json({ ok: true });
});

// DELETE /api/plans/:planId/members/:userId — remove a member
router.delete('/plans/:planId/members/:userId', requirePlanRole('owner'), (req, res) => {
  const userId = Number(req.params.userId);
  const owners = db
    .prepare("SELECT COUNT(*) AS c FROM plan_members WHERE plan_id = ? AND role = 'owner'")
    .get(req.planId).c;
  const target = db.prepare('SELECT role FROM plan_members WHERE plan_id = ? AND user_id = ?').get(req.planId, userId);
  if (target?.role === 'owner' && owners <= 1) {
    return res.status(400).json({ error: 'Cannot remove the last owner' });
  }
  db.prepare('DELETE FROM plan_members WHERE plan_id = ? AND user_id = ?').run(req.planId, userId);
  logAudit({ planId: req.planId, userId: req.user.id, action: 'member.removed', entityType: 'plan_member', entityId: userId });
  res.json({ ok: true });
});

// GET /api/plans/:planId/activity
router.get('/plans/:planId/activity', requirePlanRole('viewer'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db
    .prepare(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
              u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.plan_id = ?
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .all(req.planId, limit);
  res.json(
    rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
  );
});

export default router;
