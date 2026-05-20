import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { requireAuth, requireBucketRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

const actualSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  balance: z.number(),
  notes: z.string().max(500).nullable().optional(),
});

// GET /api/buckets/:id/actuals
router.get('/buckets/:id/actuals', requireBucketRole('viewer'), (req, res) => {
  const rows = db
    .prepare('SELECT * FROM actuals WHERE bucket_id = ? ORDER BY date')
    .all(req.bucketId);
  res.json(rows);
});

// POST /api/buckets/:id/actuals
router.post('/buckets/:id/actuals', requireBucketRole('editor'), (req, res) => {
  const parsed = actualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const info = db
    .prepare(
      `INSERT INTO actuals (bucket_id, date, balance, notes, created_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(bucket_id, date) DO UPDATE
         SET balance = excluded.balance, notes = excluded.notes, created_by = excluded.created_by`,
    )
    .run(req.bucketId, parsed.data.date, parsed.data.balance, parsed.data.notes ?? null, req.user.id);
  logAudit({ planId: req.planId, userId: req.user.id, action: 'actual.recorded', entityType: 'actual', entityId: info.lastInsertRowid ?? null, details: parsed.data });
  res.status(201).json({ ok: true });
});

// DELETE /api/actuals/:id
router.delete('/actuals/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const ctx = db
    .prepare(
      `SELECT a.id, s.plan_id, pm.role
       FROM actuals a
       JOIN buckets b ON b.id = a.bucket_id
       JOIN scenarios s ON s.id = b.scenario_id
       LEFT JOIN plan_members pm ON pm.plan_id = s.plan_id AND pm.user_id = ?
       WHERE a.id = ?`,
    )
    .get(req.user.id, id);
  if (!ctx) return res.status(404).json({ error: 'Not found' });
  if (!ctx.role || (ctx.role !== 'editor' && ctx.role !== 'owner')) {
    return res.status(403).json({ error: 'Requires editor role' });
  }
  db.prepare('DELETE FROM actuals WHERE id = ?').run(id);
  logAudit({ planId: ctx.plan_id, userId: req.user.id, action: 'actual.deleted', entityType: 'actual', entityId: id });
  res.json({ ok: true });
});

export default router;
