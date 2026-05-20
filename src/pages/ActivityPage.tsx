import { useEffect, useState } from 'react';
import { plans as plansApi } from '@/api';
import type { ActivityEntry } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { FullPageSpinner } from '@/components/Spinner';
import { formatRelativeFromNow } from '@/lib/format';

export function ActivityPage() {
  const { state } = useAuth();
  const planId = state.status === 'authenticated' ? state.activePlanId : null;
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!planId) return;
    setLoading(true);
    plansApi.activity(planId, 100).then((rows) => {
      setItems(rows);
      setLoading(false);
    });
  }, [planId]);

  if (loading) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-on-surface">Activity</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">Recent edits across your household plan.</p>
      </header>
      {items.length === 0 ? (
        <div className="fs-card p-12 text-center text-on-surface-variant">No activity recorded yet.</div>
      ) : (
        <ol className="fs-card divide-y divide-surface-container-high">
          {items.map((it) => (
            <li key={it.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-medium text-on-surface shrink-0" title={it.user_name ?? 'system'}>
                {(it.user_name ?? '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-on-surface">
                  <span className="font-medium">{it.user_name ?? 'System'}</span>
                  <span className="text-on-surface-variant"> · {it.action}</span>
                  {it.entity_type ? <span className="text-on-surface-variant"> · {it.entity_type}</span> : null}
                </div>
                {it.details ? (
                  <div className="text-xs text-on-surface-variant truncate">
                    {summariseDetails(it.details)}
                  </div>
                ) : null}
              </div>
              <div className="text-xs text-on-surface-variant tabular shrink-0">{formatRelativeFromNow(it.created_at)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function summariseDetails(d: unknown): string {
  if (typeof d !== 'object' || d === null) return '';
  const entries = Object.entries(d as Record<string, unknown>);
  return entries.slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
}
