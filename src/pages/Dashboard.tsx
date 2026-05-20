import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Wallet, Star, GitCompareArrows, Plus } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { plans as plansApi, scenarios as scenariosApi, buckets as bucketsApi } from '@/api';
import type { ProjectionResponse, Scenario, Actual, PlanMember } from '@/types';
import { FullPageSpinner } from '@/components/Spinner';
import { StatCard } from '@/components/StatCard';
import { BucketIcon } from '@/components/BucketIcon';
import { formatCompactCurrency, formatCurrency, formatDate, formatYearMonth } from '@/lib/format';

// Distinct colours for up to 8 scenarios. After that we cycle.
const SCENARIO_COLORS = ['#c0c1ff', '#4edea3', '#ffb95f', '#ff8fa3', '#5eead4', '#fda4af', '#bef264', '#fbbf24'];

interface ScenarioBundle {
  scenario: Scenario;
  projection: ProjectionResponse;
  actuals: Record<number, Actual[]>;
}

export function Dashboard() {
  const { state } = useAuth();
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [bundles, setBundles] = useState<ScenarioBundle[] | null>(null);

  if (state.status !== 'authenticated') throw new Error('unreachable');
  const planId = state.activePlanId;
  const baseCurrency = state.plans.find((p) => p.id === planId)?.base_currency ?? 'USD';

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    (async () => {
      const plan = await plansApi.get(planId);
      if (cancelled) return;
      setMembers(plan.members);

      const result: ScenarioBundle[] = await Promise.all(
        plan.scenarios.map(async (s) => {
          const projection = await scenariosApi.projection(s.id);
          const actualsEntries = await Promise.all(
            projection.projection.buckets.map(async (b) =>
              [b.bucketId, await bucketsApi.actuals.list(b.bucketId)] as const,
            ),
          );
          return {
            scenario: s,
            projection,
            actuals: Object.fromEntries(actualsEntries),
          };
        }),
      );
      if (cancelled) return;
      setBundles(result);
    })();
    return () => { cancelled = true; };
  }, [planId]);

  // Build the multi-scenario overlay chart data. Each row holds one date and
  // a column per scenario id.
  const overlayData = useMemo(() => {
    if (!bundles?.length) return [];
    const dateSet = new Set<string>();
    for (const b of bundles) {
      for (const p of b.projection.projection.aggregate) dateSet.add(p.date);
    }
    const dates = [...dateSet].sort();
    const byScenario: Record<number, Map<string, number>> = {};
    for (const b of bundles) {
      byScenario[b.scenario.id] = new Map(b.projection.projection.aggregate.map((p) => [p.date, p.balance]));
    }
    return dates.map((date) => {
      const row: Record<string, string | number | null> = { date };
      for (const b of bundles) {
        row[`s${b.scenario.id}`] = byScenario[b.scenario.id].get(date) ?? null;
      }
      return row;
    });
  }, [bundles]);

  // Aggregated current net worth from the base scenario, using actuals where
  // available (same logic as before, but only on the base scenario).
  const heroBundle = useMemo(
    () => bundles?.find((b) => b.scenario.is_base) ?? bundles?.[0] ?? null,
    [bundles],
  );

  const heroValue = useMemo(() => {
    if (!heroBundle) return 0;
    const today = new Date().toISOString().slice(0, 10);
    // Latest actual-at-or-before-today across all enabled buckets in base
    let sum = 0;
    let anyActual = false;
    for (const bucket of heroBundle.projection.projection.buckets) {
      const fx = bucket.currency === baseCurrency
        ? 1
        : (heroBundle.projection.projection.fxRates?.[bucket.currency] ?? 1);
      const list = heroBundle.actuals[bucket.bucketId] || [];
      let latest = null;
      for (const a of [...list].sort((x, y) => x.date.localeCompare(y.date))) {
        if (a.date <= today) latest = a;
        else break;
      }
      if (latest) { sum += latest.balance * fx; anyActual = true; }
      else { sum += (bucket.series[0]?.balance ?? 0) * fx; }
    }
    if (anyActual) return sum;
    return heroBundle.projection.projection.aggregate[0]?.balance ?? 0;
  }, [heroBundle, baseCurrency]);

  const heroDelta = useMemo(() => {
    if (!heroBundle) return null;
    const agg = heroBundle.projection.projection.aggregate;
    if (agg.length < 13) return null;
    const start = agg[0];
    const oneYear = agg[12];
    if (start.balance <= 0) return null;
    return (oneYear.balance - start.balance) / start.balance;
  }, [heroBundle]);

  const ytdContributions = useMemo(() => {
    if (!heroBundle) return 0;
    const year = new Date().getFullYear();
    let total = 0;
    for (const b of heroBundle.projection.projection.buckets) {
      const fx = b.currency === baseCurrency ? 1 : (heroBundle.projection.projection.fxRates?.[b.currency] ?? 1);
      for (const p of b.series) {
        if (Number(p.date.slice(0, 4)) === year) total += (p.contribution ?? 0) * fx;
      }
    }
    return total;
  }, [heroBundle, baseCurrency]);

  if (!bundles) return <FullPageSpinner />;

  if (bundles.length === 0) {
    return (
      <div className="fs-card p-12 text-center">
        <p className="text-on-surface-variant mb-4">This household has no scenarios yet.</p>
        <Link to="/scenarios/new" className="fs-btn fs-btn-primary">
          <Plus size={14} /> Create your first scenario
        </Link>
      </div>
    );
  }

  const baseScenario = heroBundle?.scenario;
  const topMilestones = heroBundle?.projection.milestones.slice(0, 4) ?? [];

  // X-axis tick that shows the current year as a vertical reference.
  const today = new Date().toISOString().slice(0, 10);
  const todayInRange = overlayData.find((p) => String(p.date) >= today);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="fs-label mb-1">Household overview</h1>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-4xl md:text-5xl font-bold text-on-surface tabular tracking-tight">
              {formatCurrency(heroValue, baseCurrency, { maximumFractionDigits: 0 })}
            </span>
            {heroDelta !== null && (
              <span className={`inline-flex items-center text-sm font-medium px-2 py-1 rounded ${
                heroDelta >= 0 ? 'text-secondary bg-secondary/10' : 'text-error bg-error/10'
              }`}>
                {heroDelta >= 0 ? <TrendingUp size={14} className="mr-1" /> : <TrendingDown size={14} className="mr-1" />}
                {(heroDelta * 100).toFixed(1)}% projected 1y
              </span>
            )}
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Net worth uses observed actuals from the base scenario ({baseScenario?.name ?? '—'}); other figures below
            cover all {bundles.length} scenario{bundles.length === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {members.slice(0, 4).map((m, idx) => (
              <div key={m.id} className="w-8 h-8 rounded-full bg-surface-container-high border-2 border-background flex items-center justify-center text-xs font-medium text-on-surface" title={m.name} style={{ zIndex: 10 - idx }}>
                {m.name.slice(0, 1).toUpperCase()}
              </div>
            ))}
          </div>
          <span className="fs-label">{members.length} {members.length === 1 ? 'member' : 'members'}</span>
        </div>
      </header>

      {/* Overlay chart: all scenarios in one view */}
      <section className="fs-card p-4 h-[440px] flex flex-col">
        <div className="flex justify-between items-baseline gap-3 flex-wrap mb-3">
          <div>
            <h2 className="fs-label">Net worth across {bundles.length} scenario{bundles.length === 1 ? '' : 's'}</h2>
            <p className="text-xs text-on-surface-variant mt-0.5 tabular">
              All projections in {baseCurrency}; today marked with a vertical line.
            </p>
          </div>
          <div className="flex gap-2">
            {bundles.length >= 2 && (
              <Link to={`/scenarios/compare?ids=${bundles.slice(0, 3).map((b) => b.scenario.id).join(',')}`} className="fs-btn fs-btn-ghost text-xs">
                <GitCompareArrows size={14} /> Side-by-side
              </Link>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer>
            <LineChart data={overlayData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#2a2a2a" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => new Date(d as string).getFullYear().toString()} stroke="#908fa0" fontSize={11} minTickGap={50} />
              <YAxis tickFormatter={(v) => formatCompactCurrency(v as number, baseCurrency)} stroke="#908fa0" fontSize={11} width={60} />
              <Tooltip
                contentStyle={{ background: '#201f1f', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 12 }}
                labelFormatter={(l) => formatDate(l as string)}
                formatter={(value, name) => {
                  const sid = Number(String(name).replace('s', ''));
                  const b = bundles.find((x) => x.scenario.id === sid);
                  return [formatCurrency(value as number, baseCurrency, { maximumFractionDigits: 0 }), b?.scenario.name ?? name];
                }}
              />
              <Legend
                formatter={(v) => {
                  const sid = Number(String(v).replace('s', ''));
                  const b = bundles.find((x) => x.scenario.id === sid);
                  return (b?.scenario.is_base ? '★ ' : '') + (b?.scenario.name ?? v);
                }}
                iconType="plainline"
                wrapperStyle={{ paddingTop: 8, fontSize: 12 }}
              />
              {todayInRange && (
                <ReferenceLine x={todayInRange.date as string} stroke="#464554" strokeDasharray="3 3" label={{ value: 'today', position: 'top', fill: '#908fa0', fontSize: 10 }} />
              )}
              {bundles.map((b, idx) => (
                <Line
                  key={b.scenario.id}
                  type="monotone"
                  dataKey={`s${b.scenario.id}`}
                  stroke={SCENARIO_COLORS[idx % SCENARIO_COLORS.length]}
                  strokeWidth={b.scenario.is_base ? 2.5 : 2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Quick stats from the base scenario */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="YTD Contributions (base)"
          value={formatCurrency(ytdContributions, baseCurrency, { maximumFractionDigits: 0 })}
          status="on_track"
        />
        <StatCard
          label="Scenarios tracked"
          value={String(bundles.length)}
          hint={`${bundles.filter((b) => !b.scenario.is_base).length} non-base`}
        />
        <StatCard
          label="Milestones on track"
          value={(() => {
            const all = bundles.flatMap((b) => b.projection.milestones);
            const onTrack = all.filter((m) => m.status === 'on_track').length;
            return `${onTrack} / ${all.length}`;
          })()}
          hint="across all scenarios"
        />
      </div>

      {/* Per-scenario summary cards */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="fs-label">Scenario summaries</h2>
          <Link to="/scenarios" className="text-xs text-primary hover:underline uppercase tracking-wide">Manage scenarios</Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-3 gap-3">
          {bundles.map((b, idx) => {
            const start = b.projection.projection.aggregate[0];
            const end = b.projection.projection.aggregate.at(-1);
            const finalRatio = start && start.balance > 0 ? (end!.balance / start.balance) : 0;
            return (
              <Link key={b.scenario.id} to={`/scenarios/${b.scenario.id}`} className="fs-card p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: SCENARIO_COLORS[idx % SCENARIO_COLORS.length] }} />
                    <span className="text-sm font-semibold text-on-surface truncate">{b.scenario.name}</span>
                    {b.scenario.is_base ? <Star size={12} className="text-primary shrink-0" /> : null}
                  </div>
                  <span className="fs-label text-on-surface-variant shrink-0">{b.scenario.horizon_years}y</span>
                </div>
                <div className="flex items-baseline justify-between text-xs text-on-surface-variant">
                  <span>Final ({b.scenario.horizon_years}y)</span>
                  <span className="text-on-surface tabular text-base font-semibold">
                    {formatCompactCurrency(end?.balance ?? 0, baseCurrency)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-xs text-on-surface-variant">
                  <span>Growth multiple</span>
                  <span className="text-on-surface tabular">{finalRatio ? `${finalRatio.toFixed(1)}×` : '—'}</span>
                </div>
                <div className="flex items-baseline justify-between text-xs text-on-surface-variant">
                  <span>Buckets · events</span>
                  <span className="text-on-surface tabular">{b.projection.projection.buckets.length} · {b.projection.milestones.length}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Milestones from the base scenario */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="fs-label">Active milestones ({baseScenario?.name ?? 'base'})</h2>
          <Link to={`/scenarios/${baseScenario?.id ?? ''}`} className="text-xs text-primary hover:underline uppercase tracking-wide">Open base</Link>
        </div>
        {topMilestones.length === 0 ? (
          <div className="fs-card p-8 text-center text-on-surface-variant text-sm">
            No milestones yet. Add a target amount and date to a bucket to track progress here.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-4 gap-3">
            {topMilestones.map((m) => (
              <MilestoneCard key={m.bucketId} m={m} currency={baseCurrency} />
            ))}
          </div>
        )}
      </section>

      {/* Bucket glance — base scenario only */}
      {heroBundle && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="fs-label">Buckets in {baseScenario?.name ?? 'base'}</h2>
            <Link to={`/scenarios/${baseScenario?.id ?? ''}`} className="text-xs text-primary hover:underline uppercase tracking-wide">Open scenario</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-3 gap-3">
            {heroBundle.projection.projection.buckets.length === 0 ? (
              <div className="fs-card p-6 col-span-full text-center text-on-surface-variant text-sm border-dashed">
                <Wallet size={20} className="mx-auto mb-2" /> No buckets in this scenario yet.
              </div>
            ) : heroBundle.projection.projection.buckets.map((b) => {
              const current = b.series[0]?.balance ?? 0;
              const final = b.series.at(-1)?.balance ?? 0;
              return (
                <Link key={b.bucketId} to={`/scenarios/${baseScenario?.id ?? ''}?bucket=${b.bucketId}`} className="fs-card p-4 hover:border-primary/40 transition-colors">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded bg-surface-container flex items-center justify-center text-primary">
                      <BucketIcon name={b.icon} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-on-surface truncate">{b.name}</div>
                      <div className="text-xs text-on-surface-variant truncate">{b.category || b.currency}</div>
                    </div>
                  </div>
                  <div className="tabular text-lg text-on-surface">{formatCurrency(current, b.currency, { maximumFractionDigits: 0 })}</div>
                  <div className="text-xs text-on-surface-variant mt-1">
                    Projected to {formatCompactCurrency(final, b.currency)} by {formatYearMonth(b.series.at(-1)?.date)}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function MilestoneCard({ m, currency }: { m: ProjectionResponse['milestones'][number]; currency: string }) {
  const pct = m.targetAmount > 0 ? Math.min(100, (m.currentBalance / m.targetAmount) * 100) : 0;
  const statusColor =
    m.status === 'on_track' ? 'bg-secondary' :
    m.status === 'drifting' ? 'bg-tertiary' :
    'bg-error';
  return (
    <div className="fs-card p-4 flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-start mb-3">
          <div className="w-8 h-8 rounded bg-surface-container flex items-center justify-center text-on-surface">
            <BucketIcon name={m.icon} size={16} />
          </div>
          <div className={`fs-status-dot ${statusColor}`} title={m.status} />
        </div>
        <div className="fs-label">{m.name}</div>
        <div className="text-lg font-semibold text-on-surface mt-1 tabular">
          {m.targetDate ? formatYearMonth(m.targetDate) : 'No deadline'}
        </div>
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-xs text-on-surface-variant mb-1 tabular">
          <span>{formatCompactCurrency(m.currentBalance, currency)}</span>
          <span>{formatCompactCurrency(m.targetAmount, currency)}</span>
        </div>
        <div className="w-full h-1 bg-surface-container rounded-full overflow-hidden">
          <div className={`h-full ${statusColor}`} style={{ width: `${pct}%` }} />
        </div>
        {m.projectedHitDate && (
          <div className="text-[11px] text-on-surface-variant mt-2">
            Projected hit: {formatYearMonth(m.projectedHitDate)}
          </div>
        )}
      </div>
    </div>
  );
}
