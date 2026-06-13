import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Wallet, Star, GitCompareArrows, Plus, Eye, EyeOff } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { plans as plansApi, scenarios as scenariosApi, buckets as bucketsApi } from '@/api';
import type { ProjectionResponse, Scenario, Actual, PlanMember } from '@/types';
import { FullPageSpinner } from '@/components/Spinner';
import { StatCard } from '@/components/StatCard';
import { BucketIcon } from '@/components/BucketIcon';
import { InfoTip } from '@/components/InfoTip';
import { formatCompactCurrency, formatCurrency, formatDate, formatYearMonth } from '@/lib/format';
import { ChartRangeControl } from '@/components/ChartRangeControl';
import { applyRange, rangePresetsFor, FULL_RANGE, type ChartRangeValue } from '@/lib/chartRange';

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
  const [enabledIds, setEnabledIds] = useState<Set<number> | null>(null);
  const [range, setRange] = useState<ChartRangeValue>(FULL_RANGE);

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
      setEnabledIds((prev) => prev ?? new Set(result.map((b) => b.scenario.id)));
    })();
    return () => { cancelled = true; };
  }, [planId]);

  const enabledBundles = useMemo(
    () => (bundles ?? []).filter((b) => !enabledIds || enabledIds.has(b.scenario.id)),
    [bundles, enabledIds],
  );

  function toggleScenario(id: number) {
    setEnabledIds((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Per-scenario current value (today): use latest actual-at-or-before-today
  // per bucket, falling back to projected starting balance.
  const currentByScenario = useMemo(() => {
    const map = new Map<number, number>();
    if (!bundles) return map;
    const today = new Date().toISOString().slice(0, 10);
    for (const b of bundles) {
      let sum = 0;
      for (const bucket of b.projection.projection.buckets) {
        const fx = bucket.currency === baseCurrency
          ? 1
          : (b.projection.projection.fxRates?.[bucket.currency] ?? 1);
        const list = [...(b.actuals[bucket.bucketId] ?? [])].sort((x, y) => x.date.localeCompare(y.date));
        let latest: Actual | null = null;
        for (const a of list) {
          if (a.date <= today) latest = a;
          else break;
        }
        sum += (latest ? latest.balance : (bucket.series[0]?.balance ?? 0)) * fx;
      }
      map.set(b.scenario.id, sum);
    }
    return map;
  }, [bundles, baseCurrency]);

  // Build the multi-scenario overlay chart data + a cumulative "all enabled"
  // line. Each row holds one date, a column per scenario id, and `total`.
  const overlayData = useMemo(() => {
    if (!enabledBundles.length) return [];
    const dateSet = new Set<string>();
    for (const b of enabledBundles) {
      for (const p of b.projection.projection.aggregate) dateSet.add(p.date);
    }
    const dates = [...dateSet].sort();
    const byScenario: Record<number, Map<string, number>> = {};
    for (const b of enabledBundles) {
      byScenario[b.scenario.id] = new Map(b.projection.projection.aggregate.map((p) => [p.date, p.balance]));
    }
    return dates.map((date) => {
      const row: Record<string, string | number | null> = { date };
      let total = 0;
      let anyValue = false;
      for (const b of enabledBundles) {
        const v = byScenario[b.scenario.id].get(date) ?? null;
        row[`s${b.scenario.id}`] = v;
        if (v != null) { total += v; anyValue = true; }
      }
      row.total = anyValue ? total : null;
      return row;
    });
  }, [enabledBundles]);

  // Cumulative current net worth across all enabled scenarios.
  const heroValue = useMemo(() => {
    let sum = 0;
    for (const b of enabledBundles) sum += currentByScenario.get(b.scenario.id) ?? 0;
    return sum;
  }, [enabledBundles, currentByScenario]);

  // 1-year projected change as a percentage of today's enabled total.
  const heroDelta = useMemo(() => {
    if (!enabledBundles.length || heroValue <= 0) return null;
    let oneYearTotal = 0;
    let anyOneYear = false;
    for (const b of enabledBundles) {
      const agg = b.projection.projection.aggregate;
      if (agg.length >= 13) { oneYearTotal += agg[12].balance; anyOneYear = true; }
    }
    if (!anyOneYear) return null;
    return (oneYearTotal - heroValue) / heroValue;
  }, [enabledBundles, heroValue]);

  // Forward-looking 12-month inflow: sum of monthly contributions over the
  // next 12 projection months across all enabled scenarios, in base currency.
  const forwardInflow12mo = useMemo(() => {
    let total = 0;
    const today = new Date().toISOString().slice(0, 7);
    for (const b of enabledBundles) {
      const fxRates = b.projection.projection.fxRates ?? {};
      for (const bucket of b.projection.projection.buckets) {
        const fx = bucket.currency === baseCurrency ? 1 : (fxRates[bucket.currency] ?? 1);
        const futurePoints = bucket.series
          .filter((p) => p.date.slice(0, 7) >= today)
          .slice(0, 12);
        for (const p of futurePoints) total += (p.contribution ?? 0) * fx;
      }
    }
    return total;
  }, [enabledBundles, baseCurrency]);

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

  // X-axis tick that shows the current year as a vertical reference.
  const today = new Date().toISOString().slice(0, 10);
  const rangePresets = rangePresetsFor(overlayData.length);
  const rangeMin = String(overlayData[0]?.date ?? '');
  const rangeMax = String(overlayData.at(-1)?.date ?? '');
  const visibleData = applyRange(overlayData as Array<{ date: string } & Record<string, string | number | null>>, range);
  const todayInRange = visibleData.find((p) => String(p.date) >= today);
  const enabledCount = enabledBundles.length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="fs-label mb-1 inline-flex items-center">
            Household net worth
            <InfoTip label="household net worth">
              Sum of today's balance across <em>enabled</em> scenarios (toggle them below). For
              each bucket we use the most recent observed actual; if no actual exists, the
              projected starting balance. All amounts converted to {baseCurrency}.
            </InfoTip>
          </h1>
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
            {enabledCount} of {bundles.length} scenario{bundles.length === 1 ? '' : 's'} included. Toggle individual scenarios below to recompute.
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

      {/* Scenario toggle chips */}
      <section className="flex flex-wrap gap-2">
        {bundles.map((b, idx) => {
          const on = !enabledIds || enabledIds.has(b.scenario.id);
          return (
            <button
              key={b.scenario.id}
              type="button"
              onClick={() => toggleScenario(b.scenario.id)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                on
                  ? 'bg-surface-container-high border-surface-container-highest text-on-surface'
                  : 'bg-transparent border-surface-container text-on-surface-variant hover:text-on-surface'
              }`}
              title={on ? 'Click to exclude from totals' : 'Click to include in totals'}
            >
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: on ? SCENARIO_COLORS[idx % SCENARIO_COLORS.length] : '#3a3a3a' }} />
              {b.scenario.is_base ? <Star size={10} className="text-primary" /> : null}
              <span>{b.scenario.name}</span>
              <span className="tabular text-on-surface-variant">
                {formatCompactCurrency(currentByScenario.get(b.scenario.id) ?? 0, baseCurrency)}
              </span>
              {on ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
          );
        })}
      </section>

      {/* Overlay chart: all enabled scenarios + cumulative total */}
      <section className="fs-card p-4 h-[440px] flex flex-col">
        <div className="flex justify-between items-baseline gap-3 flex-wrap mb-3">
          <div>
            <h2 className="fs-label inline-flex items-center">
              Net worth across {enabledCount} scenario{enabledCount === 1 ? '' : 's'}
              <InfoTip label="projection">
                A <em>projection</em> is the modelled future balance of a bucket or scenario,
                computed month-by-month from its starting balance, expected return rate,
                compounding frequency, and any timeline events. The bold line is the
                cumulative sum across all enabled scenarios.
              </InfoTip>
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5 tabular">
              All projections in {baseCurrency}; today marked with a vertical line.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ChartRangeControl presets={rangePresets} value={range} onChange={setRange} minDate={rangeMin} maxDate={rangeMax} />
            {bundles.length >= 2 && (
              <Link to={`/scenarios/compare?ids=${bundles.slice(0, 3).map((b) => b.scenario.id).join(',')}`} className="fs-btn fs-btn-ghost text-xs">
                <GitCompareArrows size={14} /> Side-by-side
              </Link>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {enabledCount === 0 ? (
            <div className="h-full flex items-center justify-center text-on-surface-variant text-sm">
              No scenarios selected. Toggle one above to see the chart.
            </div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={visibleData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#2a2a2a" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => new Date(d as string).getFullYear().toString()} stroke="#908fa0" fontSize={11} minTickGap={50} />
                <YAxis tickFormatter={(v) => formatCompactCurrency(v as number, baseCurrency)} stroke="#908fa0" fontSize={11} width={60} />
                <Tooltip
                  contentStyle={{ background: '#201f1f', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 12 }}
                  labelFormatter={(l) => formatDate(l as string)}
                  formatter={(value, name) => {
                    if (name === 'total') return [formatCurrency(value as number, baseCurrency, { maximumFractionDigits: 0 }), 'Cumulative'];
                    const sid = Number(String(name).replace('s', ''));
                    const b = bundles.find((x) => x.scenario.id === sid);
                    return [formatCurrency(value as number, baseCurrency, { maximumFractionDigits: 0 }), b?.scenario.name ?? name];
                  }}
                />
                <Legend
                  formatter={(v) => {
                    if (v === 'total') return 'Cumulative (enabled)';
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
                {enabledBundles.map((b) => {
                  const idx = bundles.findIndex((x) => x.scenario.id === b.scenario.id);
                  return (
                    <Line
                      key={b.scenario.id}
                      type="monotone"
                      dataKey={`s${b.scenario.id}`}
                      stroke={SCENARIO_COLORS[idx % SCENARIO_COLORS.length]}
                      strokeWidth={b.scenario.is_base ? 2 : 1.5}
                      strokeOpacity={0.7}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  );
                })}
                {enabledCount >= 2 && (
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#ffffff"
                    strokeWidth={3}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Quick stats across enabled scenarios */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Next 12 mo inflow"
          value={formatCurrency(forwardInflow12mo, baseCurrency, { maximumFractionDigits: 0 })}
          status="on_track"
          hint={`Sum of projected contributions across ${enabledCount} enabled scenario${enabledCount === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Scenarios enabled"
          value={`${enabledCount} / ${bundles.length}`}
          hint={`${bundles.filter((b) => !b.scenario.is_base).length} non-base total`}
        />
        <StatCard
          label="Milestones on track"
          value={(() => {
            const all = enabledBundles.flatMap((b) => b.projection.milestones);
            const onTrack = all.filter((m) => m.status === 'on_track').length;
            return `${onTrack} / ${all.length}`;
          })()}
          hint="across enabled scenarios"
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

      {/* Milestones across enabled scenarios */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="fs-label inline-flex items-center">
            Active milestones
            <InfoTip label="milestones">
              Bucket goals (target amount + target date) across all enabled scenarios.
              Status reflects whether the projected balance hits the target on time.
            </InfoTip>
          </h2>
          <span className="text-xs text-on-surface-variant">{enabledCount} scenario{enabledCount === 1 ? '' : 's'}</span>
        </div>
        {(() => {
          const all = enabledBundles.flatMap((b) =>
            b.projection.milestones.map((m) => ({ ...m, scenarioId: b.scenario.id, scenarioName: b.scenario.name })),
          );
          const top = all.slice(0, 8);
          return top.length === 0 ? (
            <div className="fs-card p-8 text-center text-on-surface-variant text-sm">
              No milestones yet. Add a target amount and date to a bucket to track progress here.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-4 gap-3">
              {top.map((m) => (
                <MilestoneCard key={`${m.scenarioId}-${m.bucketId}`} m={m} scenarioName={m.scenarioName} currency={baseCurrency} />
              ))}
            </div>
          );
        })()}
      </section>

      {/* Buckets across enabled scenarios */}
      {enabledBundles.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="fs-label">Buckets across enabled scenarios</h2>
            <Link to="/buckets" className="text-xs text-primary hover:underline uppercase tracking-wide">Manage buckets</Link>
          </div>
          {enabledBundles.every((b) => b.projection.projection.buckets.length === 0) ? (
            <div className="fs-card p-6 text-center text-on-surface-variant text-sm border-dashed">
              <Wallet size={20} className="mx-auto mb-2" /> No buckets in any enabled scenario yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-3 gap-3">
              {enabledBundles.flatMap((b) =>
                b.projection.projection.buckets.map((bucket) => {
                  const current = bucket.series[0]?.balance ?? 0;
                  const final = bucket.series.at(-1)?.balance ?? 0;
                  return (
                    <Link
                      key={`${b.scenario.id}-${bucket.bucketId}`}
                      to={`/scenarios/${b.scenario.id}?bucket=${bucket.bucketId}`}
                      className="fs-card p-4 hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-9 h-9 rounded bg-surface-container flex items-center justify-center text-primary">
                          <BucketIcon name={bucket.icon} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-on-surface truncate">{bucket.name}</div>
                          <div className="text-xs text-on-surface-variant truncate">
                            {b.scenario.name}{b.scenario.is_base ? ' ★' : ''} · {bucket.category || bucket.currency}
                          </div>
                        </div>
                      </div>
                      <div className="tabular text-lg text-on-surface">{formatCurrency(current, bucket.currency, { maximumFractionDigits: 0 })}</div>
                      <div className="text-xs text-on-surface-variant mt-1">
                        Projected to {formatCompactCurrency(final, bucket.currency)} by {formatYearMonth(bucket.series.at(-1)?.date)}
                      </div>
                    </Link>
                  );
                }),
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function MilestoneCard({ m, currency, scenarioName }: { m: ProjectionResponse['milestones'][number]; currency: string; scenarioName?: string }) {
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
        {scenarioName && (
          <div className="text-[11px] text-on-surface-variant truncate">{scenarioName}</div>
        )}
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
