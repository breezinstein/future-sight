import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { requireAuth, requireScenarioRole, requireBucketRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

const bucketSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(60).optional().nullable(),
  currency: z.string().length(3).default('USD'),
  startingBalance: z.number().min(0).default(0),
  expectedReturn: z.number().min(-0.5).max(1).default(0.05),
  compounding: z.enum(['monthly', 'annual']).default('monthly'),
  targetAmount: z.number().nullable().optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  icon: z.string().max(40).default('wallet'),
  color: z.string().max(40).default('primary'),
  sortOrder: z.number().int().default(0),
  enabled: z.boolean().optional(),
});

// POST /api/scenarios/:scenarioId/buckets
router.post('/scenarios/:scenarioId/buckets', requireScenarioRole('editor'), (req, res) => {
  const parsed = bucketSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const d = parsed.data;
  const info = db
    .prepare(
      `INSERT INTO buckets (scenario_id, name, category, currency, starting_balance, expected_return, compounding, target_amount, target_date, icon, color, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      req.scenarioId,
      d.name,
      d.category ?? null,
      d.currency.toUpperCase(),
      d.startingBalance,
      d.expectedReturn,
      d.compounding,
      d.targetAmount ?? null,
      d.targetDate ?? null,
      d.icon,
      d.color,
      d.sortOrder,
    );
  logAudit({ planId: req.planId, userId: req.user.id, action: 'bucket.created', entityType: 'bucket', entityId: info.lastInsertRowid, details: { name: d.name } });
  res.status(201).json({ id: info.lastInsertRowid });
});

// PATCH /api/buckets/:id
router.patch('/buckets/:id', requireBucketRole('editor'), (req, res) => {
  const partial = bucketSchema.partial();
  const parsed = partial.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const d = parsed.data;
  const map = {
    name: 'name', category: 'category', currency: 'currency',
    startingBalance: 'starting_balance', expectedReturn: 'expected_return',
    compounding: 'compounding', targetAmount: 'target_amount', targetDate: 'target_date',
    icon: 'icon', color: 'color', sortOrder: 'sort_order', enabled: 'enabled',
  };
  const updates = [];
  const params = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    updates.push(`${map[k]} = ?`);
    if (k === 'enabled') {
      params.push(v ? 1 : 0);
    } else if (typeof v === 'string' && k === 'currency') {
      params.push(v.toUpperCase());
    } else {
      params.push(v);
    }
  }
  if (!updates.length) return res.json({ ok: true });
  params.push(req.bucketId);
  db.prepare(`UPDATE buckets SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logAudit({ planId: req.planId, userId: req.user.id, action: 'bucket.updated', entityType: 'bucket', entityId: req.bucketId, details: d });
  res.json({ ok: true });
});

// DELETE /api/buckets/:id
router.delete('/buckets/:id', requireBucketRole('editor'), (req, res) => {
  db.prepare('DELETE FROM buckets WHERE id = ?').run(req.bucketId);
  logAudit({ planId: req.planId, userId: req.user.id, action: 'bucket.deleted', entityType: 'bucket', entityId: req.bucketId });
  res.json({ ok: true });
});

// GET /api/buckets/:id
router.get('/buckets/:id', requireBucketRole('viewer'), (req, res) => {
  const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(req.bucketId);
  const schedules = db
    .prepare('SELECT * FROM contribution_schedules WHERE bucket_id = ? ORDER BY start_date')
    .all(req.bucketId);
  const actuals = db
    .prepare('SELECT * FROM actuals WHERE bucket_id = ? ORDER BY date')
    .all(req.bucketId);
  res.json({ ...bucket, contribution_schedules: schedules, actuals });
});

// POST /api/buckets/:id/copy
// Deep-copy this bucket (including its contribution schedules, bucket-scoped
// events, and recorded actuals) into another scenario within the same plan.
// The target scenario can be the same one (effectively duplicates the bucket).
router.post('/buckets/:id/copy', requireBucketRole('viewer'), (req, res) => {
  const schema = z.object({
    scenarioId: z.number().int(),
    name: z.string().min(1).max(120).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  // Target scenario must be in the same plan and user must be able to edit it.
  const target = db
    .prepare(
      `SELECT s.id, s.plan_id, pm.role
       FROM scenarios s
       LEFT JOIN plan_members pm ON pm.plan_id = s.plan_id AND pm.user_id = ?
       WHERE s.id = ?`,
    )
    .get(req.user.id, parsed.data.scenarioId);
  if (!target) return res.status(404).json({ error: 'Target scenario not found' });
  if (target.plan_id !== req.planId) return res.status(400).json({ error: 'Cannot copy buckets across plans' });
  if (target.role !== 'editor' && target.role !== 'owner') return res.status(403).json({ error: 'Requires editor role on target scenario' });

  const source = db.prepare('SELECT * FROM buckets WHERE id = ?').get(req.bucketId);

  const newBucketId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO buckets (scenario_id, name, category, currency, starting_balance, expected_return, compounding, target_amount, target_date, icon, color, sort_order, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.data.scenarioId,
        parsed.data.name ?? source.name,
        source.category, source.currency, source.starting_balance, source.expected_return,
        source.compounding, source.target_amount, source.target_date, source.icon,
        source.color, source.sort_order, source.enabled ?? 1,
      );
    const newId = info.lastInsertRowid;

    const schedules = db.prepare('SELECT * FROM contribution_schedules WHERE bucket_id = ?').all(req.bucketId);
    for (const s of schedules) {
      db.prepare(
        `INSERT INTO contribution_schedules (bucket_id, amount, cadence, start_date, end_date)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(newId, s.amount, s.cadence, s.start_date, s.end_date);
    }

    // Only copy events that are SCOPED to this bucket (events with bucket_id IS NULL
    // are scenario-wide and not tied to the bucket). Place them in the TARGET scenario.
    const events = db.prepare('SELECT * FROM events WHERE bucket_id = ?').all(req.bucketId);
    for (const e of events) {
      db.prepare(
        `INSERT INTO events (scenario_id, bucket_id, type, date, amount, new_rate, recurring, cadence, end_date, escalation_rate, enabled, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        parsed.data.scenarioId, newId, e.type, e.date, e.amount, e.new_rate,
        e.recurring, e.cadence, e.end_date, e.escalation_rate ?? null, e.enabled, e.notes,
      );
    }

    const actuals = db.prepare('SELECT * FROM actuals WHERE bucket_id = ?').all(req.bucketId);
    for (const a of actuals) {
      db.prepare(
        `INSERT INTO actuals (bucket_id, date, balance, notes, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(newId, a.date, a.balance, a.notes, a.created_by);
    }

    return newId;
  })();

  logAudit({
    planId: req.planId, userId: req.user.id, action: 'bucket.copied',
    entityType: 'bucket', entityId: newBucketId,
    details: { source_bucket_id: req.bucketId, target_scenario_id: parsed.data.scenarioId, name: parsed.data.name ?? source.name },
  });
  res.status(201).json({ id: newBucketId });
});

// ============================================================
// Contribution schedules — nested under buckets
// ============================================================
const scheduleSchema = z.object({
  amount: z.number(),
  cadence: z.enum(['monthly','quarterly','annual']).default('monthly'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

router.post('/buckets/:id/contributions', requireBucketRole('editor'), (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const info = db
    .prepare(
      `INSERT INTO contribution_schedules (bucket_id, amount, cadence, start_date, end_date)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(req.bucketId, parsed.data.amount, parsed.data.cadence, parsed.data.startDate, parsed.data.endDate ?? null);
  logAudit({ planId: req.planId, userId: req.user.id, action: 'contribution.created', entityType: 'contribution_schedule', entityId: info.lastInsertRowid });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/contributions/:id', requireAuth, (req, res) => {
  // Resolve bucket/plan via the schedule to enforce role.
  const id = Number(req.params.id);
  const ctx = db
    .prepare(
      `SELECT cs.id, b.id AS bucket_id, s.plan_id, pm.role
       FROM contribution_schedules cs
       JOIN buckets b ON b.id = cs.bucket_id
       JOIN scenarios s ON s.id = b.scenario_id
       LEFT JOIN plan_members pm ON pm.plan_id = s.plan_id AND pm.user_id = ?
       WHERE cs.id = ?`,
    )
    .get(req.user.id, id);
  if (!ctx) return res.status(404).json({ error: 'Not found' });
  if (!ctx.role || (ctx.role !== 'editor' && ctx.role !== 'owner')) {
    return res.status(403).json({ error: 'Requires editor role' });
  }
  const partial = scheduleSchema.partial();
  const parsed = partial.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const map = { amount: 'amount', cadence: 'cadence', startDate: 'start_date', endDate: 'end_date' };
  const updates = [];
  const params = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    updates.push(`${map[k]} = ?`);
    params.push(v);
  }
  if (!updates.length) return res.json({ ok: true });
  params.push(id);
  db.prepare(`UPDATE contribution_schedules SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logAudit({ planId: ctx.plan_id, userId: req.user.id, action: 'contribution.updated', entityType: 'contribution_schedule', entityId: id });
  res.json({ ok: true });
});

router.delete('/contributions/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const ctx = db
    .prepare(
      `SELECT s.plan_id, pm.role
       FROM contribution_schedules cs
       JOIN buckets b ON b.id = cs.bucket_id
       JOIN scenarios s ON s.id = b.scenario_id
       LEFT JOIN plan_members pm ON pm.plan_id = s.plan_id AND pm.user_id = ?
       WHERE cs.id = ?`,
    )
    .get(req.user.id, id);
  if (!ctx) return res.status(404).json({ error: 'Not found' });
  if (!ctx.role || (ctx.role !== 'editor' && ctx.role !== 'owner')) {
    return res.status(403).json({ error: 'Requires editor role' });
  }
  db.prepare('DELETE FROM contribution_schedules WHERE id = ?').run(id);
  logAudit({ planId: ctx.plan_id, userId: req.user.id, action: 'contribution.deleted', entityType: 'contribution_schedule', entityId: id });
  res.json({ ok: true });
});

export default router;
