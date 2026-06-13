import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { scenarios as scenariosApi } from '@/api';
import type { CompareResponse } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { FullPageSpinner } from '@/components/Spinner';
import { formatCompactCurrency, formatCurrency, formatDate } from '@/lib/format';

const COLORS = ['#c0c1ff', '#4edea3', '#ffb95f'];
const HORIZONS = [5, 10, 20];

export function ScenarioCompare() {
  const [params] = useSearchParams();
  const { state } = useAuth();
  const planId = state.status === 'authenticated' ? state.activePlanId : null;

  const scenarioIds = useMemo(() => {
    const raw = params.get('ids') ?? '';
    return raw.split(',').map(Number).filter((n) => Number.isFinite(n));
  }, [params]);

  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!planId || scenarioIds.length < 2) return;
    setLoading(true);
    try {
      setData(await scenariosApi.compare(planId, scenarioIds, HORIZONS));
    } finally {
      setLoading(false);
    }
  }, [planId, scenarioIds]);

  // Deferred to a microtask so state updates run in a callback rather than
  // synchronously in the effect body (avoids cascading renders).
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  if (scenarioIds.length < 2) {
    return (
      <div className="fs-card p-8 text-center">
        <p className="text-on-surface-variant mb-4">Select at least 2 scenarios to compare.</p>
        <Link to="/scenarios" className="fs-btn fs-btn-primary">Back to scenarios</Link>
      </div>
    );
  }
  if (loading || !data) return <FullPageSpinner />;

  // Build a combined dataset keyed by date, with one column per scenario.
  const dateMap = new Map<string, Record<string, number | string>>();
  data.scenarios.forEach((sc) => {
    sc.projection.aggregate.forEach((p) => {
      if (!dateMap.has(p.date)) dateMap.set(p.date, { date: p.date });
      const row = dateMap.get(p.date)!;
      row[`s${sc.scenario.id}`] = p.balance;
    });
  });
  const chartData = Array.from(dateMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Diff vs the first scenario at each horizon.
  const baseline = data.scenarios[0];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <Link to="/scenarios" className="p-2 -ml-2 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container">
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">Scenario comparison</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">Side-by-side projection of {data.scenarios.length} scenarios in {data.baseCurrency}.</p>
        </div>
      </header>

      {/* Overlay chart */}
      <div className="fs-card p-4 h-[460px] flex flex-col">
        <h2 className="fs-label mb-2">Net worth overlay</h2>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#2a2a2a" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => new Date(d).getFullYear().toString()} stroke="#908fa0" fontSize={11} minTickGap={50} />
              <YAxis tickFormatter={(v) => formatCompactCurrency(v, data.baseCurrency)} stroke="#908fa0" fontSize={11} width={60} />
              <Tooltip
                contentStyle={{ background: '#201f1f', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 12 }}
                labelFormatter={(l) => formatDate(l as string)}
                formatter={(v, name) => {
                  const sid = Number(String(name).replace('s', ''));
                  const sc = data.scenarios.find((x) => x.scenario.id === sid);
                  return [formatCurrency(Number(v) || 0, data.baseCurrency, { maximumFractionDigits: 0 }), sc?.scenario.name ?? name];
                }}
              />
              <Legend
                formatter={(value) => {
                  const sid = Number(String(value).replace('s', ''));
                  const sc = data.scenarios.find((x) => x.scenario.id === sid);
                  return sc?.scenario.name ?? value;
                }}
                iconType="plainline"
                wrapperStyle={{ paddingTop: 8 }}
              />
              {data.scenarios.map((sc, idx) => (
                <Line
                  key={sc.scenario.id}
                  type="monotone"
                  dataKey={`s${sc.scenario.id}`}
                  stroke={COLORS[idx % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Diff table */}
      <div className="fs-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-on-surface-variant border-b border-surface-container-high">
              <th className="px-4 py-3 fs-label">Scenario</th>
              {data.horizonYears.map((y) => (
                <th key={y} className="px-4 py-3 fs-label text-right">At {y}y</th>
              ))}
              <th className="px-4 py-3 fs-label text-right">Milestones</th>
            </tr>
          </thead>
          <tbody>
            {data.scenarios.map((sc, idx) => (
              <tr key={sc.scenario.id} className="border-b border-surface-container/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: COLORS[idx % COLORS.length] }} />
                    <Link to={`/scenarios/${sc.scenario.id}`} className="text-on-surface font-medium hover:text-primary">
                      {sc.scenario.name}
                    </Link>
                    {sc.scenario.is_base ? <span className="fs-label bg-primary-container/30 text-primary px-1.5 py-0.5 rounded">Base</span> : null}
                  </div>
                </td>
                {sc.checkpoints.map((c) => {
                  const baseAt = baseline.checkpoints.find((x) => x.years === c.years)?.balance ?? c.balance;
                  const delta = c.balance - baseAt;
                  const pct = baseAt ? delta / baseAt : 0;
                  return (
                    <td key={c.years} className="px-4 py-3 text-right">
                      <div className="text-on-surface tabular">{formatCurrency(c.balance, data.baseCurrency, { maximumFractionDigits: 0 })}</div>
                      {idx > 0 && (
                        <div className={`text-xs tabular ${delta >= 0 ? 'text-secondary' : 'text-error'}`}>
                          {delta >= 0 ? '+' : ''}{formatCompactCurrency(delta, data.baseCurrency)} ({(pct * 100).toFixed(1)}%)
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right text-on-surface-variant text-xs">
                  {sc.milestones.filter((m) => m.status === 'on_track').length}/{sc.milestones.length} on track
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
