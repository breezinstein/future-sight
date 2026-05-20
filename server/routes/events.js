import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { requireAuth, requireScenarioRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

const eventSchema = z.object({
  bucketId: z.number().int().nullable().optional(),
  type: z.enum(['deposit', 'withdrawal', 'rate_change', 'contribution_change']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().nullable().optional(),
  newRate: z.number().min(-0.5).max(1).nullable().optional(),
  recurring: z.boolean().default(false),
  cadence: z.enum(['monthly', 'quarterly', 'annual']).nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  escalationRate: z.number().min(-0.5).max(1).nullable().optional(),
  enabled: z.boolean().default(true),
  notes: z.string().max(500).nullable().optional(),
});

// GET /api/scenarios/:scenarioId/events
router.get('/scenarios/:scenarioId/events', requireScenarioRole('viewer'), (req, res) => {
  const rows = db
    .prepare('SELECT * FROM events WHERE scenario_id = ? ORDER BY date')
    .all(req.scenarioId);
  res.json(rows);
});

// POST /api/scenarios/:scenarioId/events
router.post('/scenarios/:scenarioId/events', requireScenarioRole('editor'), (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const d = parsed.data;

  // Validate type-specific required fields.
  if ((d.type === 'deposit' || d.type === 'withdrawal' || d.type === 'contribution_change') && d.amount == null) {
    return res.status(400).json({ error: 'amount is required for this event type' });
  }
  if (d.type === 'rate_change' && d.newRate == null) {
    return res.status(400).json({ error: 'newRate is required for rate_change events' });
  }
  if (d.recurring && !d.cadence) {
    return res.status(400).json({ error: 'cadence is required for recurring events' });
  }

  const info = db
    .prepare(
      `INSERT INTO events (scenario_id, bucket_id, type, date, amount, new_rate, recurring, cadence, end_date, escalation_rate, enabled, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      req.scenarioId,
      d.bucketId ?? null,
      d.type,
      d.date,
      d.amount ?? null,
      d.newRate ?? null,
      d.recurring ? 1 : 0,
      d.cadence ?? null,
      d.endDate ?? null,
      d.escalationRate ?? null,
      d.enabled ? 1 : 0,
      d.notes ?? null,
    );
  logAudit({ planId: req.planId, userId: req.user.id, action: 'event.created', entityType: 'event', entityId: info.lastInsertRowid, details: { type: d.type, date: d.date } });
  res.status(201).json({ id: info.lastInsertRowid });
});

// PATCH /api/events/:id
router.patch('/events/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const ctx = db
    .prepare(
      `SELECT e.scenario_id, s.plan_id, pm.role
       FROM events e
       JOIN scenarios s ON s.id = e.scenario_id
       LEFT JOIN plan_members pm ON pm.plan_id = s.plan_id AND pm.user_id = ?
       WHERE e.id = ?`,
    )
    .get(req.user.id, id);
  if (!ctx) return res.status(404).json({ error: 'Not found' });
  if (!ctx.role || (ctx.role !== 'editor' && ctx.role !== 'owner')) {
    return res.status(403).json({ error: 'Requires editor role' });
  }

  const partial = eventSchema.partial();
  const parsed = partial.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const map = {
    bucketId: 'bucket_id', type: 'type', date: 'date',
    amount: 'amount', newRate: 'new_rate', recurring: 'recurring',
    cadence: 'cadence', endDate: 'end_date', escalationRate: 'escalation_rate',
    enabled: 'enabled', notes: 'notes',
  };
  const updates = [];
  const params = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    updates.push(`${map[k]} = ?`);
    if (k === 'recurring' || k === 'enabled') {
      params.push(v ? 1 : 0);
    } else {
      params.push(v);
    }
  }
  if (!updates.length) return res.json({ ok: true });
  params.push(id);
  db.prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logAudit({ planId: ctx.plan_id, userId: req.user.id, action: 'event.updated', entityType: 'event', entityId: id, details: parsed.data });
  res.json({ ok: true });
});

// DELETE /api/events/:id
router.delete('/events/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const ctx = db
    .prepare(
      `SELECT s.plan_id, pm.role
       FROM events e
       JOIN scenarios s ON s.id = e.scenario_id
       LEFT JOIN plan_members pm ON pm.plan_id = s.plan_id AND pm.user_id = ?
       WHERE e.id = ?`,
    )
    .get(req.user.id, id);
  if (!ctx) return res.status(404).json({ error: 'Not found' });
  if (!ctx.role || (ctx.role !== 'editor' && ctx.role !== 'owner')) {
    return res.status(403).json({ error: 'Requires editor role' });
  }
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  logAudit({ planId: ctx.plan_id, userId: req.user.id, action: 'event.deleted', entityType: 'event', entityId: id });
  res.json({ ok: true });
});

export default router;
