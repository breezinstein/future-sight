import bcrypt from 'bcryptjs';
import { db } from '../db/database.js';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Express middleware — require an authenticated session.
 * Populates req.user with { id, email, name }.
 */
export function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = db
    .prepare('SELECT id, email, name FROM users WHERE id = ?')
    .get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'User no longer exists' });
  }
  req.user = user;
  next();
}

/**
 * Express middleware factory — require that req.user has a given role
 * (or higher) on a plan referenced by req.params.planId.
 *
 * Role hierarchy: owner > editor > viewer.
 */
const ROLE_LEVEL = { viewer: 1, editor: 2, owner: 3 };

export function requirePlanRole(minRole = 'viewer') {
  return (req, res, next) => {
    const planId = Number(req.params.planId || req.body.planId || req.query.planId);
    if (!planId) return res.status(400).json({ error: 'Missing plan id' });

    const row = db
      .prepare('SELECT role FROM plan_members WHERE plan_id = ? AND user_id = ?')
      .get(planId, req.user.id);
    if (!row) return res.status(403).json({ error: 'You are not a member of this plan' });

    if (ROLE_LEVEL[row.role] < ROLE_LEVEL[minRole]) {
      return res.status(403).json({ error: `Requires ${minRole} role` });
    }
    req.planId = planId;
    req.planRole = row.role;
    next();
  };
}

/**
 * Resolve a plan id from a scenario id, then check role.
 */
export function requireScenarioRole(minRole = 'viewer') {
  return (req, res, next) => {
    const scenarioId = Number(req.params.scenarioId || req.params.id);
    if (!scenarioId) return res.status(400).json({ error: 'Missing scenario id' });
    const row = db
      .prepare(
        `SELECT s.plan_id, pm.role
         FROM scenarios s
         LEFT JOIN plan_members pm ON pm.plan_id = s.plan_id AND pm.user_id = ?
         WHERE s.id = ?`,
      )
      .get(req.user.id, scenarioId);
    if (!row) return res.status(404).json({ error: 'Scenario not found' });
    if (!row.role) return res.status(403).json({ error: 'Not a member of this plan' });
    if (ROLE_LEVEL[row.role] < ROLE_LEVEL[minRole]) {
      return res.status(403).json({ error: `Requires ${minRole} role` });
    }
    req.scenarioId = scenarioId;
    req.planId = row.plan_id;
    req.planRole = row.role;
    next();
  };
}

/**
 * Resolve a plan id from a bucket id, then check role.
 */
export function requireBucketRole(minRole = 'viewer') {
  return (req, res, next) => {
    const bucketId = Number(req.params.bucketId || req.params.id);
    if (!bucketId) return res.status(400).json({ error: 'Missing bucket id' });
    const row = db
      .prepare(
        `SELECT s.plan_id, s.id AS scenario_id, pm.role
         FROM buckets b
         JOIN scenarios s ON s.id = b.scenario_id
         LEFT JOIN plan_members pm ON pm.plan_id = s.plan_id AND pm.user_id = ?
         WHERE b.id = ?`,
      )
      .get(req.user.id, bucketId);
    if (!row) return res.status(404).json({ error: 'Bucket not found' });
    if (!row.role) return res.status(403).json({ error: 'Not a member of this plan' });
    if (ROLE_LEVEL[row.role] < ROLE_LEVEL[minRole]) {
      return res.status(403).json({ error: `Requires ${minRole} role` });
    }
    req.bucketId = bucketId;
    req.scenarioId = row.scenario_id;
    req.planId = row.plan_id;
    req.planRole = row.role;
    next();
  };
}
