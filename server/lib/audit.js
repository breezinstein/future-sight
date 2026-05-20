import { db } from '../db/database.js';

export function logAudit({ planId, userId, action, entityType, entityId, details }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (plan_id, user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      planId ?? null,
      userId ?? null,
      action,
      entityType ?? null,
      entityId ?? null,
      details ? JSON.stringify(details) : null,
    );
  } catch (e) {
    console.error('[audit] failed to write audit entry:', e.message);
  }
}
