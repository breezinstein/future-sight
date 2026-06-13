import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Plus } from 'lucide-react';
import { plans as plansApi, scenarios as scenariosApi } from '@/api';
import type { Bucket, Scenario } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { FullPageSpinner } from '@/components/Spinner';
import { BucketIcon } from '@/components/BucketIcon';
import { BucketEditor } from '@/components/BucketEditor';
import { useToast } from '@/context/ToastContext';
import { buckets as bucketsApi } from '@/api';
import { formatCurrency, formatPercent } from '@/lib/format';

interface ScenarioBuckets { scenario: Scenario; buckets: Bucket[] }

export function BucketsPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const planId = state.status === 'authenticated' ? state.activePlanId : null;
  const [byScenario, setByScenario] = useState<ScenarioBuckets[] | null>(null);
  const [editing, setEditing] = useState<{ scenario: Scenario; bucket: Bucket | null } | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    const plan = await plansApi.get(planId);
    const result = await Promise.all(
      plan.scenarios.map(async (s) => {
        const detail = await scenariosApi.get(s.id);
        return { scenario: s, buckets: detail.buckets };
      }),
    );
    setByScenario(result);
  }, [planId]);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function onDelete() {
    if (!editing?.bucket) return;
    if (!confirm(`Delete bucket "${editing.bucket.name}"? This removes its contributions, events, and actuals too.`)) return;
    await bucketsApi.remove(editing.bucket.id);
    show(`Bucket "${editing.bucket.name}" deleted`, 'success');
    setEditing(null);
    load();
  }

  // Only show full-page spinner on the very first load. Once we have data,
  // subsequent reloads keep the existing content (and any open modal) mounted.
  if (byScenario === null) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-on-surface">Buckets</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">All your savings & investment pots, grouped by scenario.</p>
      </header>
      {byScenario.map(({ scenario, buckets }) => (
        <section key={scenario.id} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-on-surface">
              <Link to={`/scenarios/${scenario.id}`} className="hover:text-primary">{scenario.name}</Link>
              {scenario.is_base ? <span className="ml-2 fs-label bg-primary-container/30 text-primary px-1.5 py-0.5 rounded">Base</span> : null}
            </h2>
            <div className="flex items-center gap-2">
              <span className="fs-label text-on-surface-variant">{buckets.length} buckets</span>
              <button
                type="button"
                onClick={() => setEditing({ scenario, bucket: null })}
                className="fs-btn fs-btn-ghost text-xs"
              >
                <Plus size={12} /> Add bucket
              </button>
            </div>
          </div>
          {buckets.length === 0 ? (
            <div className="fs-card p-6 text-center text-on-surface-variant text-sm">
              <Wallet size={20} className="mx-auto mb-2" /> No buckets in this scenario yet.
              <div className="mt-3">
                <button type="button" onClick={() => setEditing({ scenario, bucket: null })} className="fs-btn fs-btn-secondary">
                  <Plus size={14} /> Add a bucket
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-3 gap-3">
              {buckets.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setEditing({ scenario, bucket: b })}
                  className="fs-card p-4 flex items-start gap-3 hover:border-primary/40 transition-colors text-left w-full"
                >
                  <div className="w-9 h-9 rounded bg-surface-container flex items-center justify-center text-primary shrink-0">
                    <BucketIcon name={b.icon} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-on-surface truncate">{b.name}</span>
                      <span className="text-xs text-on-surface-variant tabular">{formatPercent(b.expected_return)}</span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs text-on-surface-variant truncate">{b.category || b.currency}</span>
                      <span className="text-sm text-on-surface tabular">{formatCurrency(b.starting_balance, b.currency, { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}

      {editing && (
        <BucketEditor
          scenarioId={editing.scenario.id}
          bucket={editing.bucket}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onDelete={editing.bucket ? onDelete : undefined}
        />
      )}
    </div>
  );
}
