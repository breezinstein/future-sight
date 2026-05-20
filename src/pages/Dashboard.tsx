import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Wallet, Star } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceDot,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { plans as plansApi, scenarios as scenariosApi, buckets as bucketsApi } from '@/api';
import type { ProjectionResponse, Scenario, Actual, PlanMember } from '@/types';
import { FullPageSpinner } from '@/components/Spinner';
import { StatCard } from '@/components/StatCard';
import { BucketIcon } from '@/components/BucketIcon';
import { formatCompactCurrency, formatCurrency, formatDate, formatYearMonth } from '@/lib/format';

type ChartPoint = { date: string; ts: number; actual: number | null; projected: number | null };

const dashboardScenarioStorageKey = (planId: number) => `fs.dashboardScenarioId.${planId}`;

export function Dashboard() {
  const { state } = useAuth();
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<number | null>(null);
  const [proj, setProj] = useState<ProjectionResponse | null>(null);
  const [actuals, setActuals] = useState<Record<number, Actual[]>>({});
  const [loading, setLoading] = useState(true);

  if (state.status !== 'authenticated') throw new Error('unreachable');
  const planId = state.activePlanId;

  // Load plan + scenarios. Choose active scenario via the saved preference
  // (per-plan in localStorage) and fall back to the base scenario.
  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const plan = await plansApi.get(planId);
      if (cancelled) return;
      setMembers(plan.members);
      setScenarios(plan.scenarios);
      const stored = Number(localStorage.getItem(dashboardScenarioStorageKey(planId)));
      const chosen =
        plan.scenarios.find((s) => s.id === stored)
        ?? plan.scenarios.find((s) => s.is_base)
        ?? plan.scenarios[0];
      setActiveScenarioId(chosen?.id ?? null);
      if (!chosen) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [planId]);

  // Load projection + actuals whenever the active scenario changes.
  useEffect(() => {
    if (!activeScenarioId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const p = await scenariosApi.projection(activeScenarioId);
        if (cancelled) return;
        setProj(p);
        const entries = await Promise.all(
          p.projection.buckets.map(async (b) =>
            [b.bucketId, await bucketsApi.actuals.list(b.bucketId)] as const,
          ),
        );
        if (cancelled) return;
        setActuals(Object.fromEntries(entries));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeScenarioId]);

  const onPickScenario = useCallback((id: number) => {
    if (!planId) return;
    localStorage.setItem(dashboardScenarioStorageKey(planId), String(id));
    setActiveScenarioId(id);
  }, [planId]);

  const activeScenario = scenarios.find((s) => s.id === activeScenarioId) ?? null;

  // Build aggregated actual line by combining all bucket actuals on a
  // unified timeline that includes both projection dates and recorded
  // actual dates. The "actual" value at any date is the running sum of
  // each bucket's most recent actual at-or-before that date.
  const chartData = useMemo<ChartPoint[]>(() => {
    if (!proj) return [];
    const projection = proj.projection;

    // 1. Pre-sort actuals per bucket so we can scan forward quickly.
    const actualsByBucket: Record<number, Actual[]> = {};
    for (const [k, v] of Object.entries(actuals)) {
      actualsByBucket[Number(k)] = [...v].sort((a, b) => a.date.localeCompare(b.date));
    }

    // 2. Find the latest actual date overall — the actual line stops here.
    let latestActualDate: string | null = null;
    for (const list of Object.values(actualsByBucket)) {
      const last = list.at(-1);
      if (last && (!latestActualDate || last.date > latestActualDate)) {
        latestActualDate = last.date;
      }
    }

    // 3. Helper: aggregated actual at a given date (sum of latest per bucket).
    function actualAt(date: string): number | null {
      if (!latestActualDate || date > latestActualDate) return null;
      let sum = 0;
      let any = false;
      for (const bucket of projection.buckets) {
        const list = actualsByBucket[bucket.bucketId] || [];
        let latest: Actual | null = null;
        for (const a of list) {
          if (a.date <= date) latest = a;
          else break; // list is sorted
        }
        if (latest) {
          sum += latest.balance;
          any = true;
        }
      }
      return any ? sum : null;
    }

    // 4. Union of projection dates + actual dates so the X-axis can extend
    //    left of the projection start when historical actuals exist.
    const dateSet = new Set<string>();
    for (const p of projection.aggregate) dateSet.add(p.date);
    for (const list of Object.values(actualsByBucket)) {
      for (const a of list) dateSet.add(a.date);
    }
    const sortedDates = [...dateSet].sort();

    const projByDate = new Map(projection.aggregate.map((p) => [p.date, p.balance]));

    return sortedDates.map((date) => ({
      date,
      ts: new Date(date).getTime(),
      projected: projByDate.get(date) ?? null,
      actual: actualAt(date),
    }));
  }, [proj, actuals]);

  const heroValue = useMemo(() => {
    if (!proj) return 0;
    // "Now" = first projection point (which uses starting_balance for each bucket
    // unless we override with the latest actual sum).
    const today = new Date().toISOString().slice(0, 10);
    const latestPastIdx = proj.projection.aggregate.findIndex((p) => p.date >= today);
    const idx = latestPastIdx === -1 ? 0 : Math.max(0, latestPastIdx);
    return proj.projection.aggregate[idx]?.balance ?? 0;
  }, [proj]);

  const heroDelta = useMemo(() => {
    if (!proj) return null;
    const agg = proj.projection.aggregate;
    if (agg.length < 13) return null;
    // Projected growth over the next 12 months from the projection start.
    const start = agg[0];
    const oneYear = agg[12];
    if (!start || !oneYear || start.balance <= 0) return null;
    return (oneYear.balance - start.balance) / start.balance;
  }, [proj]);

  const ytdContributions = useMemo(() => {
    if (!proj) return 0;
    const year = new Date().getFullYear();
    let total = 0;
    for (const b of proj.projection.buckets) {
      for (const p of b.series) {
        if (Number(p.date.slice(0, 4)) === year) total += p.contribution ?? 0;
      }
    }
    return total;
  }, [proj]);

  const drift = useMemo(() => {
    if (!proj || !chartData.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    // Find the latest point at-or-before today where BOTH actual and
    // projected are present, then compare them. Without this guard the
    // chart can have dates from actuals that fall outside the projection
    // window (projected = null), making the diff meaningless.
    let best: ChartPoint | null = null;
    for (const pt of chartData) {
      if (pt.date > today) break;
      if (pt.actual != null && pt.projected != null) best = pt;
    }
    if (!best) return null;
    return (best.actual ?? 0) - (best.projected ?? 0);
  }, [proj, chartData]);

  if (loading || !proj || !activeScenario) {
    return <FullPageSpinner />;
  }

  const baseCurrency = state.plans.find((p) => p.id === planId)?.base_currency ?? 'USD';
  const topMilestones = [...proj.milestones].slice(0, 4);

  // Find the index of "today" for the reference line
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayPoint = chartData.find((p) => p.date >= todayIso);

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
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

      {/* Grid */}
      <div className="grid grid-cols-1 @4xl:grid-cols-12 gap-4">
        {/* Net Worth chart */}
        <div className="fs-card p-4 @4xl:col-span-8 flex flex-col h-[400px]">
          <div className="flex justify-between items-center mb-4">
            <h2 className="fs-label">Net worth trajectory</h2>
            <div className="flex items-center gap-4 text-xs text-on-surface-variant">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-primary" />
                Actuals
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 border-t border-dashed border-primary" />
                Projected
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c0c1ff" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#c0c1ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#2a2a2a" strokeDasharray="0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => new Date(d).getFullYear().toString()}
                  stroke="#908fa0"
                  fontSize={11}
                  interval="preserveStartEnd"
                  minTickGap={50}
                />
                <YAxis
                  tickFormatter={(v) => formatCompactCurrency(v, baseCurrency)}
                  stroke="#908fa0"
                  fontSize={11}
                  width={60}
                />
                <Tooltip content={<NetWorthTooltip currency={baseCurrency} />} />
                <Area
                  type="monotone"
                  dataKey="actual"
                  stroke="#c0c1ff"
                  strokeWidth={2}
                  fill="url(#netWorthFill)"
                  connectNulls
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="projected"
                  stroke="#c0c1ff"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  fillOpacity={0}
                  connectNulls
                  isAnimationActive={false}
                />
                {todayPoint && (
                  <ReferenceLine x={todayPoint.date} stroke="#464554" strokeDasharray="2 2" />
                )}
                {todayPoint && todayPoint.projected != null && (
                  <ReferenceDot x={todayPoint.date} y={todayPoint.projected} r={4} fill="#c0c1ff" stroke="none" />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-1 @4xl:col-span-4 gap-4 content-start">
          <StatCard
            label="YTD Contributions"
            value={formatCurrency(ytdContributions, baseCurrency, { maximumFractionDigits: 0 })}
            status="on_track"
          />
          <StatCard
            label="Drift vs Plan"
            value={drift == null ? '—' : formatCurrency(drift, baseCurrency, { maximumFractionDigits: 0 })}
            status={
              drift == null ? 'neutral' :
              Math.abs(drift) < heroValue * 0.02 ? 'on_track' :
              Math.abs(drift) < heroValue * 0.05 ? 'drifting' :
              'unreachable'
            }
          />
          <div className="fs-card p-4 sm:col-span-2 @4xl:col-span-1">
            <div className="fs-label mb-2">Active scenario</div>
            <div className="flex flex-col gap-2">
              <div className="relative">
                <select
                  className="fs-input pr-9 appearance-none cursor-pointer"
                  value={activeScenarioId ?? ''}
                  onChange={(e) => onPickScenario(Number(e.target.value))}
                >
                  {scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.is_base ? ' (base)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">
                  {activeScenario?.is_base ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <Star size={11} /> This is the household's base plan
                    </span>
                  ) : (
                    <span>Viewing a non-base scenario</span>
                  )}
                </span>
                <Link to={`/scenarios/${activeScenarioId}`} className="text-primary hover:underline tracking-wide uppercase">
                  Edit
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Milestones */}
        <div className="@4xl:col-span-12 flex justify-between items-end mt-2">
          <h2 className="fs-label">Active milestones</h2>
          <Link to="/scenarios" className="text-xs text-primary hover:underline uppercase tracking-wide">View all</Link>
        </div>

        {topMilestones.length === 0 ? (
          <div className="@4xl:col-span-12 fs-card p-8 text-center text-on-surface-variant text-sm">
            No milestones yet. Add a target amount and date to a bucket to track progress here.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-4 gap-4 @4xl:col-span-12">
            {topMilestones.map((m) => (
              <MilestoneCard key={m.bucketId} m={m} currency={baseCurrency} />
            ))}
          </div>
        )}

        {/* Buckets glance */}
        <div className="@4xl:col-span-12 mt-2 flex justify-between items-end">
          <h2 className="fs-label">Buckets</h2>
          <Link to={`/scenarios/${activeScenario.id}`} className="text-xs text-primary hover:underline uppercase tracking-wide">Open scenario</Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-3 gap-4 @4xl:col-span-12">
          {proj.projection.buckets.length === 0 ? (
            <div className="fs-card p-6 col-span-full text-center text-on-surface-variant text-sm">
              <Wallet size={20} className="mx-auto mb-2 text-on-surface-variant" />
              No buckets yet. Open the base scenario to add one.
            </div>
          ) : proj.projection.buckets.map((b) => {
            const current = b.series[0]?.balance ?? 0;
            const final = b.series[b.series.length - 1]?.balance ?? 0;
            return (
              <Link key={b.bucketId} to={`/scenarios/${activeScenario.id}?bucket=${b.bucketId}`} className="fs-card p-4 block hover:border-primary/40 transition-colors">
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
                  Projected to {formatCompactCurrency(final, b.currency)} by {formatYearMonth(b.series[b.series.length - 1]?.date)}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface TooltipPayloadEntry {
  dataKey?: string | number;
  value?: number | null;
}

interface NetWorthTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  currency: string;
}

function NetWorthTooltip({ active, payload, label, currency }: NetWorthTooltipProps) {
  if (!active || !payload?.length) return null;
  const actual = payload.find((p) => p.dataKey === 'actual')?.value;
  const projected = payload.find((p) => p.dataKey === 'projected')?.value;
  return (
    <div className="bg-surface-container border border-surface-container-high rounded px-3 py-2 text-xs shadow-lg">
      <div className="text-on-surface-variant mb-1">{label ? formatDate(label) : ''}</div>
      {actual != null && (
        <div className="text-on-surface tabular">
          <span className="text-on-surface-variant">Actual: </span>
          {formatCurrency(actual, currency, { maximumFractionDigits: 0 })}
        </div>
      )}
      {projected != null && (
        <div className="text-on-surface tabular">
          <span className="text-on-surface-variant">Projected: </span>
          {formatCurrency(projected, currency, { maximumFractionDigits: 0 })}
        </div>
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
