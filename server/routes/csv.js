import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { requireAuth, requireBucketRole, requireScenarioRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';
import { parseCsv, toCsv } from '../lib/csv.js';

const router = Router();
router.use(requireAuth);

// POST /api/buckets/:id/actuals/import (text/csv)
router.post('/buckets/:id/actuals/import', requireBucketRole('editor'), (req, res) => {
  const schema = z.object({ csv: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const { header, records } = parseCsv(parsed.data.csv);
  if (!header.includes('date') || !header.includes('balance')) {
    return res.status(400).json({ error: 'CSV must have "date" and "balance" columns' });
  }

  let imported = 0;
  const errors = [];
  const stmt = db.prepare(
    `INSERT INTO actuals (bucket_id, date, balance, notes, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(bucket_id, date) DO UPDATE
       SET balance = excluded.balance, notes = excluded.notes, created_by = excluded.created_by`,
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const date = r.date?.trim();
      const balance = Number(r.balance);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(balance)) {
        errors.push({ row: i + 2, reason: 'Invalid date or balance' });
        continue;
      }
      stmt.run(req.bucketId, date, balance, r.notes ?? null, req.user.id);
      imported++;
    }
  });
  tx();

  logAudit({ planId: req.planId, userId: req.user.id, action: 'actuals.imported', entityType: 'bucket', entityId: req.bucketId, details: { imported, errors: errors.length } });
  res.json({ imported, errors });
});

// GET /api/scenarios/:scenarioId/export?type=actuals|events|contributions
router.get('/scenarios/:scenarioId/export', requireScenarioRole('viewer'), (req, res) => {
  const type = String(req.query.type || 'actuals');
  let csv;
  if (type === 'actuals') {
    const rows = db.prepare(
      `SELECT b.name AS bucket, a.date, a.balance, b.currency, a.notes
       FROM actuals a JOIN buckets b ON b.id = a.bucket_id
       WHERE b.scenario_id = ? ORDER BY b.name, a.date`,
    ).all(req.scenarioId);
    csv = toCsv(rows, ['bucket', 'date', 'balance', 'currency', 'notes']);
  } else if (type === 'events') {
    const rows = db.prepare(
      `SELECT e.date, e.type, COALESCE(b.name, '') AS bucket, e.amount, e.new_rate,
              e.recurring, e.cadence, e.end_date, e.enabled, e.notes
       FROM events e LEFT JOIN buckets b ON b.id = e.bucket_id
       WHERE e.scenario_id = ? ORDER BY e.date`,
    ).all(req.scenarioId);
    csv = toCsv(rows, ['date', 'type', 'bucket', 'amount', 'new_rate', 'recurring', 'cadence', 'end_date', 'enabled', 'notes']);
  } else if (type === 'contributions') {
    const rows = db.prepare(
      `SELECT b.name AS bucket, cs.amount, cs.cadence, cs.start_date, cs.end_date
       FROM contribution_schedules cs JOIN buckets b ON b.id = cs.bucket_id
       WHERE b.scenario_id = ? ORDER BY b.name, cs.start_date`,
    ).all(req.scenarioId);
    csv = toCsv(rows, ['bucket', 'amount', 'cadence', 'start_date', 'end_date']);
  } else {
    return res.status(400).json({ error: 'Unknown export type' });
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="future-sight-${type}.csv"`);
  res.send(csv);
});

export default router;
