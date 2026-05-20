import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { requireAuth, requirePlanRole, requireScenarioRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

// GET /api/plans/:planId/scenarios
router.get('/plans/:planId/scenarios', requirePlanRole('viewer'), (req, res) => {
  const rows = db
    .prepare('SELECT * FROM scenarios WHERE plan_id = ? ORDER BY is_base DESC, created_at ASC')
    .all(req.planId);
  res.json(rows);
});

// POST /api/plans/:planId/scenarios
router.post('/plans/:planId/scenarios', requirePlanRole('editor'), (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional().nullable(),
    horizonYears: z.number().int().min(1).max(80).default(30),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const info = db
    .prepare(
      `INSERT INTO scenarios (plan_id, name, description, horizon_years, start_date)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      req.planId,
      parsed.data.name,
      parsed.data.description ?? null,
      parsed.data.horizonYears,
      parsed.data.startDate ?? null,
    );

  logAudit({ planId: req.planId, userId: req.user.id, action: 'scenario.created', entityType: 'scenario', entityId: info.lastInsertRowid, details: { name: parsed.data.name } });
  res.status(201).json({ id: info.lastInsertRowid });
});

// GET /api/scenarios/:id
router.get('/scenarios/:id', requireScenarioRole('viewer'), (req, res) => {
  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.scenarioId);
  const buckets = db
    .prepare('SELECT * FROM buckets WHERE scenario_id = ? ORDER BY sort_order, created_at')
    .all(req.scenarioId);
  const events = db
    .prepare('SELECT * FROM events WHERE scenario_id = ? ORDER BY date')
    .all(req.scenarioId);
  res.json({ ...scenario, buckets, events });
});

// PATCH /api/scenarios/:id
router.patch('/scenarios/:id', requireScenarioRole('editor'), (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional().nullable(),
    horizonYears: z.number().int().min(1).max(80).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const updates = [];
  const params = [];
  if (parsed.data.name !== undefined) { updates.push('name = ?'); params.push(parsed.data.name); }
  if (parsed.data.description !== undefined) { updates.push('description = ?'); params.push(parsed.data.description); }
  if (parsed.data.horizonYears !== undefined) { updates.push('horizon_years = ?'); params.push(parsed.data.horizonYears); }
  if (parsed.data.startDate !== undefined) { updates.push('start_date = ?'); params.push(parsed.data.startDate); }
  if (!updates.length) return res.json({ ok: true });
  params.push(req.scenarioId);
  db.prepare(`UPDATE scenarios SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logAudit({ planId: req.planId, userId: req.user.id, action: 'scenario.updated', entityType: 'scenario', entityId: req.scenarioId, details: parsed.data });
  res.json({ ok: true });
});

// DELETE /api/scenarios/:id
router.delete('/scenarios/:id', requireScenarioRole('editor'), (req, res) => {
  const row = db.prepare('SELECT is_base FROM scenarios WHERE id = ?').get(req.scenarioId);
  if (row.is_base) return res.status(400).json({ error: 'Cannot delete the base scenario' });
  db.prepare('DELETE FROM scenarios WHERE id = ?').run(req.scenarioId);
  logAudit({ planId: req.planId, userId: req.user.id, action: 'scenario.deleted', entityType: 'scenario', entityId: req.scenarioId });
  res.json({ ok: true });
});

// POST /api/scenarios/:id/clone
router.post('/scenarios/:id/clone', requireScenarioRole('editor'), (req, res) => {
  const schema = z.object({ name: z.string().min(1).max(120) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const source = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.scenarioId);
  if (!source) return res.status(404).json({ error: 'Source scenario not found' });

  const newId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO scenarios (plan_id, name, description, cloned_from_scenario_id, horizon_years, start_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(source.plan_id, parsed.data.name, source.description, source.id, source.horizon_years, source.start_date);
    const newScenarioId = info.lastInsertRowid;

    const buckets = db.prepare('SELECT * FROM buckets WHERE scenario_id = ?').all(source.id);
    const bucketIdMap = new Map();
    for (const b of buckets) {
      const r = db
        .prepare(
          `INSERT INTO buckets (scenario_id, name, category, currency, starting_balance, expected_return, compounding, target_amount, target_date, icon, color, sort_order, enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newScenarioId, b.name, b.category, b.currency, b.starting_balance, b.expected_return,
          b.compounding, b.target_amount, b.target_date, b.icon, b.color, b.sort_order, b.enabled ?? 1,
        );
      bucketIdMap.set(b.id, r.lastInsertRowid);
    }

    // Copy contribution schedules (best-effort — should be empty after the
    // contributions_to_events migration, but kept for upgrade-in-progress safety).
    const schedules = db
      .prepare(`SELECT cs.* FROM contribution_schedules cs
                JOIN buckets b ON b.id = cs.bucket_id
                WHERE b.scenario_id = ?`)
      .all(source.id);
    for (const s of schedules) {
      const newBucketId = bucketIdMap.get(s.bucket_id);
      db.prepare(
        `INSERT INTO events (scenario_id, bucket_id, type, date, amount, recurring, cadence, end_date, enabled, notes, escalation_rate)
         VALUES (?, ?, 'deposit', ?, ?, 1, ?, ?, 1, 'Migrated from contribution schedule', NULL)`,
      ).run(newScenarioId, newBucketId, s.start_date, s.amount, s.cadence, s.end_date);
    }

    // Copy events.
    const events = db.prepare('SELECT * FROM events WHERE scenario_id = ?').all(source.id);
    for (const e of events) {
      const newBucketId = e.bucket_id ? bucketIdMap.get(e.bucket_id) : null;
      db.prepare(
        `INSERT INTO events (scenario_id, bucket_id, type, date, amount, new_rate, recurring, cadence, end_date, enabled, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newScenarioId, newBucketId, e.type, e.date, e.amount, e.new_rate,
        e.recurring, e.cadence, e.end_date, e.enabled, e.notes,
      );
    }
    return newScenarioId;
  })();

  logAudit({ planId: req.planId, userId: req.user.id, action: 'scenario.cloned', entityType: 'scenario', entityId: newId, details: { from: source.id, name: parsed.data.name } });
  res.status(201).json({ id: newId });
});

// POST /api/scenarios/:id/set-base
// Atomically demote whichever scenario is currently base in this plan,
// then promote the target. The dashboard's default view follows is_base.
router.post('/scenarios/:id/set-base', requireScenarioRole('editor'), (req, res) => {
  const tx = db.transaction(() => {
    db.prepare('UPDATE scenarios SET is_base = 0 WHERE plan_id = ?').run(req.planId);
    db.prepare('UPDATE scenarios SET is_base = 1 WHERE id = ?').run(req.scenarioId);
  });
  tx();
  logAudit({ planId: req.planId, userId: req.user.id, action: 'scenario.set_base', entityType: 'scenario', entityId: req.scenarioId });
  res.json({ ok: true });
});

export default router;
