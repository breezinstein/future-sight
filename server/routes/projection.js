import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { requireAuth, requireScenarioRole } from '../lib/auth.js';
import { projectScenario, computeMilestones } from '../lib/projection.js';
import { getFxMap } from '../lib/fx.js';

const router = Router();
router.use(requireAuth);

async function loadAndProject(scenarioId, baseCurrency) {
  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  // Only enabled buckets contribute to the projection. Disabled buckets are
  // returned to the client via the scenario detail endpoint so the user can
  // still see and re-enable them.
  const buckets = db.prepare('SELECT * FROM buckets WHERE scenario_id = ? AND enabled = 1').all(scenarioId);
  const events = db.prepare('SELECT * FROM events WHERE scenario_id = ?').all(scenarioId);

  const contributionsByBucket = {};
  for (const b of buckets) {
    contributionsByBucket[b.id] = db
      .prepare('SELECT * FROM contribution_schedules WHERE bucket_id = ?')
      .all(b.id);
  }

  const currencies = buckets.map((b) => b.currency);
  const fxRates = await getFxMap(baseCurrency, currencies);

  // Honour the scenario's stored start_date if set; otherwise project from today.
  const startDate = scenario.start_date ? new Date(scenario.start_date) : new Date();

  const projection = projectScenario({
    scenario,
    buckets,
    contributionsByBucket,
    events,
    baseCurrency,
    fxRates,
    startDate,
  });
  return { scenario, projection };
}

// GET /api/scenarios/:scenarioId/projection
router.get('/scenarios/:scenarioId/projection', requireScenarioRole('viewer'), async (req, res) => {
  try {
    const plan = db.prepare('SELECT base_currency FROM plans WHERE id = ?').get(req.planId);
    const { scenario, projection } = await loadAndProject(req.scenarioId, plan.base_currency);
    const milestones = computeMilestones(projection);
    res.json({ scenario, projection, milestones });
  } catch (e) {
    console.error('[projection] error:', e);
    res.status(500).json({ error: 'Projection failed', detail: e.message });
  }
});

// POST /api/plans/:planId/compare  — compare multiple scenarios
router.post('/plans/:planId/compare', requireAuth, async (req, res) => {
  const planId = Number(req.params.planId);
  const member = db.prepare('SELECT role FROM plan_members WHERE plan_id = ? AND user_id = ?').get(planId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member of this plan' });

  const schema = z.object({
    scenarioIds: z.array(z.number().int()).min(1).max(3),
    horizonYears: z.array(z.number().int()).optional().default([5, 10, 20]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const plan = db.prepare('SELECT base_currency FROM plans WHERE id = ?').get(planId);

  const results = await Promise.all(
    parsed.data.scenarioIds.map(async (sid) => {
      const row = db.prepare('SELECT plan_id FROM scenarios WHERE id = ?').get(sid);
      if (!row || row.plan_id !== planId) return null;
      const { scenario, projection } = await loadAndProject(sid, plan.base_currency);
      const milestones = computeMilestones(projection);

      // Pluck balances at the requested horizons.
      const checkpoints = parsed.data.horizonYears.map((y) => {
        const monthIdx = Math.min(y * 12, projection.aggregate.length - 1);
        return {
          years: y,
          balance: projection.aggregate[monthIdx]?.balance ?? 0,
          date: projection.aggregate[monthIdx]?.date ?? '',
        };
      });

      return { scenario, projection, milestones, checkpoints };
    }),
  );

  res.json({
    baseCurrency: plan.base_currency,
    horizonYears: parsed.data.horizonYears,
    scenarios: results.filter(Boolean),
  });
});

export default router;
