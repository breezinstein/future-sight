import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { plans as plansApi, scenarios as scenariosApi } from '@/api';
import type { Bucket, PlanEvent, Scenario } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { FullPageSpinner } from '@/components/Spinner';
import { formatCurrency, formatDate, formatPercent } from '@/lib/format';

interface ScenarioEvents { scenario: Scenario; events: PlanEvent[]; buckets: Bucket[] }

export function EventsPage() {
  const { state } = useAuth();
  const planId = state.status === 'authenticated' ? state.activePlanId : null;
  const [data, setData] = useState<ScenarioEvents[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!planId) return;
    (async () => {
      setLoading(true);
      const plan = await plansApi.get(planId);
      const out = await Promise.all(
        plan.scenarios.map(async (s) => {
          const detail = await scenariosApi.get(s.id);
          return { scenario: s, events: detail.events, buckets: detail.buckets };
        }),
      );
      setData(out);
      setLoading(false);
    })();
  }, [planId]);

  if (loading) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-on-surface">Events</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">Timeline events across all scenarios. Open a scenario to edit.</p>
      </header>

      {data.every((d) => d.events.length === 0) && (
        <div className="fs-card p-12 text-center text-on-surface-variant">
          <CalendarClock size={24} className="mx-auto mb-3" />
          No events yet. Open a scenario to add deposits, withdrawals, contribution changes, or rate-change events.
        </div>
      )}

      {data.map(({ scenario, events, buckets }) => {
        if (events.length === 0) return null;
        return (
          <section key={scenario.id} className="flex flex-col gap-2">
            <Link to={`/scenarios/${scenario.id}`} className="text-sm font-semibold text-on-surface hover:text-primary">
              {scenario.name}
            </Link>
            <div className="fs-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-on-surface-variant border-b border-surface-container-high">
                    <th className="px-4 py-3 fs-label">Date</th>
                    <th className="px-4 py-3 fs-label">Type</th>
                    <th className="px-4 py-3 fs-label">Bucket</th>
                    <th className="px-4 py-3 fs-label">Value</th>
                    <th className="px-4 py-3 fs-label">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const b = buckets.find((x) => x.id === e.bucket_id);
                    return (
                      <tr key={e.id} className={`border-b border-surface-container/50 ${e.enabled ? '' : 'opacity-50'}`}>
                        <td className="px-4 py-3 tabular text-on-surface">{formatDate(e.date)}</td>
                        <td className="px-4 py-3 text-on-surface-variant capitalize">{e.type.replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{b?.name ?? 'All'}</td>
                        <td className="px-4 py-3 tabular text-on-surface">
                          {e.type === 'rate_change' ? formatPercent(e.new_rate ?? 0) :
                           e.amount != null ? formatCurrency(e.amount, b?.currency ?? 'USD', { maximumFractionDigits: 0 }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`fs-label ${e.enabled ? 'text-secondary' : 'text-on-surface-variant'}`}>
                            {e.enabled ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
