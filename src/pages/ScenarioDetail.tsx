import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Copy, Plus, Trash2, Edit3, Settings as SettingsIcon, Star } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot, Legend,
} from 'recharts';
import { scenarios as scenariosApi, buckets as bucketsApi, events as eventsApi } from '@/api';
import type { Actual, Bucket, PlanEvent, ProjectionResponse, Scenario } from '@/types';
import { FullPageSpinner } from '@/components/Spinner';
import { BucketIcon } from '@/components/BucketIcon';
import { InfoTip } from '@/components/InfoTip';
import { formatCompactCurrency, formatCurrency, formatDate, formatYearMonth, formatPercent } from '@/lib/format';
import { BucketEditor } from '@/components/BucketEditor';
import { EventEditor } from '@/components/EventEditor';
import { ScenarioSettings } from '@/components/ScenarioSettings';
import { Modal } from '@/components/Modal';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';

export function ScenarioDetail() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const id = Number(scenarioId);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { show } = useToast();
  const { state } = useAuth();

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [events, setEvents] = useState<PlanEvent[]>([]);
  const [proj, setProj] = useState<ProjectionResponse | null>(null);
  const [actualsByBucket, setActualsByBucket] = useState<Record<number, Actual[]>>({});
  const [showActuals, setShowActuals] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [bucketEditorOpen, setBucketEditorOpen] = useState(false);
  const [editingBucket, setEditingBucket] = useState<Bucket | null>(null);

  const [eventEditorOpen, setEventEditorOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PlanEvent | null>(null);

  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const baseCurrency = state.status === 'authenticated'
    ? state.plans.find((p) => p.id === scenario?.plan_id)?.base_currency ?? 'USD'
    : 'USD';

  const reload = useCallback(async () => {
    const detail = await scenariosApi.get(id);
    setScenario(detail);
    setBuckets(detail.buckets);
    setEvents(detail.events);
    const p = await scenariosApi.projection(id);
    setProj(p);
    const entries = await Promise.all(
      p.projection.buckets.map(async (b) =>
        [b.bucketId, await bucketsApi.actuals.list(b.bucketId)] as const,
      ),
    );
    setActualsByBucket(Object.fromEntries(entries));
    setHasLoaded(true);
  }, [id]);

  useEffect(() => {
    // Deferred to a microtask so state updates run in a callback rather than
    // synchronously in the effect body (avoids cascading renders).
    Promise.resolve().then(reload);
  }, [reload]);

  // Open bucket editor when ?bucket=ID arrives from an external link (e.g.
  // Dashboard bucket cards). We clear the param immediately so back-navigation
  // doesn't re-open the editor (the prior URL is no longer in history).
  useEffect(() => {
    const bid = Number(params.get('bucket'));
    if (!bid || !buckets.length) return;
    const b = buckets.find((x) => x.id === bid);
    if (!b) return;
    // Defer the modal-open state updates to a microtask so they run in a
    // callback rather than synchronously in the effect body.
    queueMicrotask(() => {
      setEditingBucket(b);
      setBucketEditorOpen(true);
    });
    setParams({}, { replace: true });
  }, [params, buckets, setParams]);

  // Aggregate per-bucket actuals into a single base-currency series matching
  // the projection's monthly cadence. Latest-balance-at-or-before each month
  // per bucket is summed across all enabled buckets (using projection FX rates
  // for currency conversion). Returns a sparse map: date -> aggregated actual.
  const actualsSeries = useMemo(() => {
    if (!proj) return new Map<string, number>();
    const fxRates = proj.projection.fxRates ?? {};
    const planBase = proj.projection.baseCurrency ?? baseCurrency;
    const dates = proj.projection.aggregate.map((p) => p.date);
    const today = new Date().toISOString().slice(0, 10);
    const out = new Map<string, number>();
    const enabledBuckets = proj.projection.buckets;
    // Precompute sorted lists per bucket
    const sorted: Record<number, Actual[]> = {};
    for (const b of enabledBuckets) {
      sorted[b.bucketId] = [...(actualsByBucket[b.bucketId] ?? [])].sort(
        (a, c) => a.date.localeCompare(c.date),
      );
    }
    for (const date of dates) {
      if (date > today) break;
      let anyActual = false;
      let sum = 0;
      for (const b of enabledBuckets) {
        const fx = b.currency === planBase ? 1 : (fxRates[b.currency] ?? 1);
        const list = sorted[b.bucketId];
        let latest: Actual | null = null;
        for (const a of list) {
          if (a.date <= date) latest = a;
          else break;
        }
        if (latest) {
          anyActual = true;
          sum += latest.balance * fx;
        } else {
          // No actual yet: fall back to bucket's first projected balance
          // (i.e. starting balance in base currency) so the line begins at
          // the same point as the projection.
          sum += (b.series[0]?.balance ?? 0) * fx;
        }
      }
      if (anyActual) out.set(date, sum);
    }
    return out;
  }, [proj, actualsByBucket, baseCurrency]);

  const chartData = useMemo(() => {
    if (!proj) return [];
    return proj.projection.aggregate.map((p) => ({
      ...p,
      actual: actualsSeries.get(p.date) ?? null,
    }));
  }, [proj, actualsSeries]);

  const hasActuals = actualsSeries.size > 0;

  // Projected vs actual drift. Anchored on the most recent projection month
  // that has observed actual data, this compares where the plan said we'd be
  // against where we actually are — both in aggregate (base currency) and
  // per bucket (each in its own currency). Drift = actual − projected, so a
  // positive value means we are ahead of plan.
  const drift = useMemo(() => {
    if (!proj) return null;
    // Latest projection-month date that carries aggregated actual data.
    let asOf: string | null = null;
    for (const p of proj.projection.aggregate) {
      if (actualsSeries.has(p.date)) asOf = p.date;
    }
    if (!asOf) return null;

    const projected = proj.projection.aggregate.find((p) => p.date === asOf)?.balance ?? 0;
    const actual = actualsSeries.get(asOf) ?? 0;
    const delta = actual - projected;
    const pct = projected !== 0 ? delta / projected : 0;

    const perBucket = proj.projection.buckets.map((b) => {
      const projBal = b.series.find((s) => s.date === asOf)?.balance ?? 0;
      const list = [...(actualsByBucket[b.bucketId] ?? [])].sort(
        (a, c) => a.date.localeCompare(c.date),
      );
      let latest: Actual | null = null;
      for (const a of list) {
        if (a.date <= asOf!) latest = a;
        else break;
      }
      const actualBal = latest ? latest.balance : null;
      const bucketDelta = actualBal !== null ? actualBal - projBal : null;
      const bucketPct = actualBal !== null && projBal !== 0 ? bucketDelta! / projBal : null;
      return {
        bucketId: b.bucketId,
        name: b.name,
        icon: b.icon,
        currency: b.currency,
        projected: projBal,
        actual: actualBal,
        delta: bucketDelta,
        pct: bucketPct,
        asOf: latest?.date ?? null,
      };
    });

    return { asOf, projected, actual, delta, pct, perBucket };
  }, [proj, actualsSeries, actualsByBucket]);

  if (!hasLoaded || !scenario || !proj) return <FullPageSpinner />;

  async function onDeleteBucket(b: Bucket) {
    if (!confirm(`Delete bucket "${b.name}"? This removes its contributions, events, and actuals too.`)) return;
    await bucketsApi.remove(b.id);
    show(`Bucket "${b.name}" deleted`, 'success');
    reload();
  }

  async function onDeleteEvent(e: PlanEvent) {
    if (!confirm('Delete this event?')) return;
    await eventsApi.remove(e.id);
    show('Event deleted', 'success');
    reload();
  }

  async function onToggleEvent(e: PlanEvent) {
    await eventsApi.update(e.id, { enabled: !e.enabled });
    reload();
  }

  async function onToggleBucket(b: Bucket) {
    await bucketsApi.update(b.id, { enabled: (b.enabled ? 0 : 1) as 0 | 1 });
    show(b.enabled ? `"${b.name}" excluded from projection` : `"${b.name}" included`, 'info');
    reload();
  }

  async function onSetBase() {
    if (!scenario || scenario.is_base) return;
    try {
      await scenariosApi.setBase(scenario.id);
      show(`"${scenario.name}" is now the base scenario`, 'success');
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to set base', 'error');
    }
  }

  async function onClone() {
    if (!cloneName.trim()) return;
    const { id: newId } = await scenariosApi.clone(scenario!.id, cloneName.trim());
    show(`Cloned to "${cloneName}"`, 'success');
    setCloneOpen(false);
    setCloneName('');
    navigate(`/scenarios/${newId}`);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors shrink-0"
            aria-label="Back"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-on-surface truncate">{scenario.name}</h1>
              {scenario.is_base ? (
                <span className="fs-label bg-primary-container/30 text-primary px-2 py-0.5 rounded">Base</span>
              ) : (
                <span className="fs-label bg-surface-container text-on-surface-variant px-2 py-0.5 rounded">Clone</span>
              )}
            </div>
            {scenario.description && (
              <p className="text-sm text-on-surface-variant mt-0.5">{scenario.description}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <button type="button" onClick={() => setSettingsOpen(true)} className="fs-btn fs-btn-ghost" title="Edit scenario name, start date, horizon">
            <SettingsIcon size={14} /> <span className="hidden sm:inline">Settings</span>
          </button>
          <button type="button" onClick={() => setCloneOpen(true)} className="fs-btn fs-btn-ghost">
            <Copy size={14} /> <span className="hidden sm:inline">Clone</span>
          </button>
          {!scenario.is_base && (
            <button type="button" onClick={onSetBase} className="fs-btn fs-btn-secondary" title="Use this scenario as the household's default plan">
              <Star size={14} /> <span className="hidden sm:inline">Set as base</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => { setEditingBucket(null); setBucketEditorOpen(true); }}
            className="fs-btn fs-btn-secondary"
          >
            <Plus size={14} /> Bucket
          </button>
          <button
            type="button"
            onClick={() => { setEditingEvent(null); setEventEditorOpen(true); }}
            className="fs-btn fs-btn-primary"
          >
            <Plus size={14} /> Event
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 @4xl:grid-cols-12 gap-4">
        {/* Projection chart */}
        <div className="fs-card p-4 @4xl:col-span-8 h-[400px] flex flex-col">
          <div className="flex justify-between items-start mb-3 gap-3 flex-wrap">
            <div>
              <h2 className="fs-label inline-flex items-center">
                Net worth projection
                <InfoTip label="net worth projection">
                  Sum of all enabled buckets in this scenario, projected forward month-by-month
                  using each bucket's expected return and any timeline events. Currencies are
                  converted to the plan's base currency.
                </InfoTip>
              </h2>
              <p className="text-xs text-on-surface-variant mt-1 tabular">
                Starts {formatYearMonth(proj.projection.startDate)}
                {' → ends '}
                {formatYearMonth(proj.projection.aggregate.at(-1)?.date ?? null)}
                {' · '}
                {scenario.horizon_years}y horizon
              </p>
            </div>
            <div className="flex items-start gap-3 flex-wrap">
              {hasActuals && (
                <label className="inline-flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showActuals}
                    onChange={(e) => setShowActuals(e.target.checked)}
                    className="accent-inverse-primary"
                  />
                  <span>Show actuals</span>
                </label>
              )}
              <div className="text-xs text-on-surface-variant tabular text-right">
                Final aggregate<br/>
                <span className="text-on-surface text-base">
                  {formatCompactCurrency(proj.projection.aggregate.at(-1)?.balance ?? 0, baseCurrency)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="scenFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c0c1ff" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#c0c1ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#2a2a2a" strokeDasharray="0" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => new Date(d).getFullYear().toString()} stroke="#908fa0" fontSize={11} minTickGap={50} />
                <YAxis tickFormatter={(v) => formatCompactCurrency(v, baseCurrency)} stroke="#908fa0" fontSize={11} width={60} />
                <Tooltip
                  contentStyle={{ background: '#201f1f', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 12 }}
                  labelFormatter={(l) => formatDate(l as string)}
                  formatter={(v, name) => [
                    formatCurrency(Number(v) || 0, baseCurrency, { maximumFractionDigits: 0 }),
                    name === 'actual' ? 'Actual' : 'Projected',
                  ]}
                />
                {hasActuals && (
                  <Legend
                    iconType="plainline"
                    wrapperStyle={{ paddingTop: 4, fontSize: 11 }}
                    formatter={(v) => (v === 'actual' ? 'Actual (observed)' : 'Projected')}
                  />
                )}
                <Area type="monotone" dataKey="balance" name="balance" stroke="#c0c1ff" strokeWidth={2} fill="url(#scenFill)" isAnimationActive={false} />
                {showActuals && hasActuals && (
                  <Line type="monotone" dataKey="actual" name="actual" stroke="#4edea3" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls isAnimationActive={false} />
                )}
                {events.filter((e) => e.enabled).map((e) => {
                  const point = proj.projection.aggregate.find((p) => p.date >= e.date);
                  if (!point) return null;
                  const color = e.type === 'rate_change' ? '#ffb95f' :
                                e.type === 'withdrawal' ? '#ffb4ab' :
                                '#c0c1ff';
                  return <ReferenceDot key={e.id} x={point.date} y={point.balance} r={5} fill={color} stroke="#131313" strokeWidth={2} />;
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bucket list */}
        <aside className="@4xl:col-span-4 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-1">
            <h2 className="fs-label">Buckets ({buckets.filter((b) => b.enabled).length}/{buckets.length})</h2>
            <span className="fs-label text-on-surface-variant">{buckets.filter((b) => !b.enabled).length > 0 ? `${buckets.filter((b) => !b.enabled).length} excluded` : ''}</span>
          </div>
          {buckets.length === 0 ? (
            <div className="fs-card p-6 text-center text-sm text-on-surface-variant border-dashed">
              No buckets yet. Use the <span className="text-on-surface font-medium">+ Bucket</span> button above to add one.
            </div>
          ) : buckets.map((b) => (
            <div
              key={b.id}
              className={`fs-card p-3 flex items-center gap-3 transition-opacity ${b.enabled ? '' : 'opacity-50'}`}
            >
              <div className="w-9 h-9 rounded bg-surface-container flex items-center justify-center text-primary shrink-0">
                <BucketIcon name={b.icon} />
              </div>
              <button
                type="button"
                onClick={() => { setEditingBucket(b); setBucketEditorOpen(true); }}
                className="flex-1 min-w-0 text-left"
              >
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-sm font-medium text-on-surface truncate">{b.name}</span>
                  <span className="text-xs text-on-surface-variant tabular shrink-0">{formatPercent(b.expected_return)}</span>
                </div>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className="text-xs text-on-surface-variant truncate">{b.currency} · {b.category || 'uncategorised'}</span>
                  <span className="text-xs text-on-surface tabular">{formatCompactCurrency(b.starting_balance, b.currency)}</span>
                </div>
              </button>
              <label
                className="inline-flex items-center cursor-pointer shrink-0"
                title={b.enabled ? 'Click to exclude from projection' : 'Click to include in projection'}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={!!b.enabled}
                  onChange={() => onToggleBucket(b)}
                />
                <div className="w-9 h-5 bg-surface-container-highest rounded-full peer peer-checked:bg-inverse-primary relative transition-colors after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-on-surface after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
              </label>
            </div>
          ))}
        </aside>

        {/* Projected vs actual drift */}
        {drift && (
          <div className="fs-card p-4 @4xl:col-span-12 mt-4">
            <div className="flex justify-between items-start mb-4 gap-3 flex-wrap">
              <div>
                <h2 className="fs-label inline-flex items-center">
                  Projected vs actual
                  <InfoTip label="projected vs actual">
                    Compares the plan's projected balance against your recorded actuals as of the
                    most recent observation. Drift is actual minus projected, so a positive figure
                    means you are ahead of plan. Per-bucket rows are shown in each bucket's own
                    currency; the headline is in the plan's base currency.
                  </InfoTip>
                </h2>
                <p className="text-xs text-on-surface-variant mt-1 tabular">
                  As of {formatDate(drift.asOf)}
                </p>
              </div>
              <DriftBadge delta={drift.delta} pct={drift.pct} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="rounded bg-surface-container/60 p-3">
                <div className="fs-label text-on-surface-variant">Projected</div>
                <div className="text-lg text-on-surface tabular mt-0.5">
                  {formatCurrency(drift.projected, baseCurrency, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="rounded bg-surface-container/60 p-3">
                <div className="fs-label text-on-surface-variant">Actual</div>
                <div className="text-lg text-on-surface tabular mt-0.5">
                  {formatCurrency(drift.actual, baseCurrency, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="rounded bg-surface-container/60 p-3">
                <div className="fs-label text-on-surface-variant">Drift</div>
                <div className={`text-lg tabular mt-0.5 ${drift.delta >= 0 ? 'text-secondary' : 'text-error'}`}>
                  {drift.delta >= 0 ? '+' : '−'}
                  {formatCurrency(Math.abs(drift.delta), baseCurrency, { maximumFractionDigits: 0 })}
                  <span className="text-xs ml-1">({drift.delta >= 0 ? '+' : '−'}{formatPercent(Math.abs(drift.pct))})</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-on-surface-variant border-b border-surface-container-high">
                    <th className="py-2 pr-3 fs-label">Bucket</th>
                    <th className="py-2 pr-3 fs-label text-right">Projected</th>
                    <th className="py-2 pr-3 fs-label text-right">Actual</th>
                    <th className="py-2 pr-3 fs-label text-right">Drift</th>
                    <th className="py-2 fs-label text-right">Drift %</th>
                  </tr>
                </thead>
                <tbody>
                  {drift.perBucket.map((b) => (
                    <tr key={b.bucketId} className="border-b border-surface-container/50">
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-2 text-on-surface">
                          <span className="text-primary"><BucketIcon name={b.icon} /></span>
                          <span className="truncate">{b.name}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular text-on-surface-variant text-right">
                        {formatCurrency(b.projected, b.currency, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-2 pr-3 tabular text-on-surface text-right">
                        {b.actual !== null
                          ? formatCurrency(b.actual, b.currency, { maximumFractionDigits: 0 })
                          : <span className="text-on-surface-variant">No actual</span>}
                      </td>
                      <td className={`py-2 pr-3 tabular text-right ${b.delta === null ? 'text-on-surface-variant' : b.delta >= 0 ? 'text-secondary' : 'text-error'}`}>
                        {b.delta === null
                          ? '—'
                          : `${b.delta >= 0 ? '+' : '−'}${formatCurrency(Math.abs(b.delta), b.currency, { maximumFractionDigits: 0 })}`}
                      </td>
                      <td className={`py-2 tabular text-right ${b.pct === null ? 'text-on-surface-variant' : b.pct >= 0 ? 'text-secondary' : 'text-error'}`}>
                        {b.pct === null
                          ? '—'
                          : `${b.pct >= 0 ? '+' : '−'}${formatPercent(Math.abs(b.pct))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Events timeline */}
        <div className="fs-card p-4 @4xl:col-span-12 mt-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="fs-label">Timeline events</h2>
            <span className="text-xs text-on-surface-variant">{events.filter((e) => e.enabled).length} active · {events.length} total</span>
          </div>
          {events.length === 0 ? (
            <div className="text-center py-8 text-sm text-on-surface-variant">
              No events yet. Add cash-flow events (deposits, withdrawals) or rate-change events to model what-if scenarios.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-on-surface-variant border-b border-surface-container-high">
                    <th className="py-2 pr-3 fs-label">Date</th>
                    <th className="py-2 pr-3 fs-label">Type</th>
                    <th className="py-2 pr-3 fs-label">Bucket</th>
                    <th className="py-2 pr-3 fs-label">Amount / rate</th>
                    <th className="py-2 pr-3 fs-label">Recurrence</th>
                    <th className="py-2 pr-3 fs-label">Enabled</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const bucket = buckets.find((b) => b.id === e.bucket_id);
                    return (
                      <tr key={e.id} className={`border-b border-surface-container/50 ${e.enabled ? '' : 'opacity-50'}`}>
                        <td className="py-2 pr-3 tabular text-on-surface">{formatDate(e.date)}</td>
                        <td className="py-2 pr-3">
                          <EventBadge type={e.type} />
                        </td>
                        <td className="py-2 pr-3 text-on-surface-variant">{bucket?.name ?? '—'}</td>
                        <td className="py-2 pr-3 tabular text-on-surface">
                          {e.type === 'rate_change' ? formatPercent(e.new_rate ?? 0) :
                           e.amount != null ? formatCurrency(e.amount, bucket?.currency ?? baseCurrency, { maximumFractionDigits: 0 }) :
                           '—'}
                        </td>
                        <td className="py-2 pr-3 text-on-surface-variant text-xs">
                          {e.recurring ? (
                            <>
                              Every {e.cadence}
                              {e.end_date ? ` · until ${formatDate(e.end_date)}` : ' · ongoing'}
                              {e.escalation_rate ? ` · +${(e.escalation_rate * 100).toFixed(1)}%/yr` : ''}
                            </>
                          ) : 'One-off'}
                        </td>
                        <td className="py-2 pr-3">
                          <label className="inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={!!e.enabled}
                              onChange={() => onToggleEvent(e)}
                            />
                            <div className="w-9 h-5 bg-surface-container-highest rounded-full peer peer-checked:bg-inverse-primary relative transition-colors after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-on-surface after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
                          </label>
                        </td>
                        <td className="py-2 text-right">
                          <button type="button" onClick={() => { setEditingEvent(e); setEventEditorOpen(true); }} className="p-1.5 text-on-surface-variant hover:text-primary" aria-label="Edit event">
                            <Edit3 size={14} />
                          </button>
                          <button type="button" onClick={() => onDeleteEvent(e)} className="p-1.5 text-on-surface-variant hover:text-error" aria-label="Delete event">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {bucketEditorOpen && (
        <BucketEditor
          scenarioId={scenario.id}
          bucket={editingBucket}
          onClose={() => { setBucketEditorOpen(false); setEditingBucket(null); }}
          onSaved={() => { setBucketEditorOpen(false); setEditingBucket(null); reload(); }}
          onDelete={editingBucket ? () => { onDeleteBucket(editingBucket); setBucketEditorOpen(false); setEditingBucket(null); } : undefined}
        />
      )}

      {eventEditorOpen && (
        <EventEditor
          scenarioId={scenario.id}
          buckets={buckets}
          event={editingEvent}
          onClose={() => { setEventEditorOpen(false); setEditingEvent(null); }}
          onSaved={() => { setEventEditorOpen(false); setEditingEvent(null); reload(); }}
        />
      )}

      {settingsOpen && (
        <ScenarioSettings
          scenario={scenario}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { setSettingsOpen(false); reload(); }}
        />
      )}

      <Modal
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        title="Clone scenario"
        footer={
          <>
            <button type="button" onClick={() => setCloneOpen(false)} className="fs-btn fs-btn-ghost">Cancel</button>
            <button type="button" onClick={onClone} disabled={!cloneName.trim()} className="fs-btn fs-btn-primary">Create clone</button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant mb-3">
          Creates an independent copy of <span className="text-on-surface">{scenario.name}</span> with all its buckets, contributions, and events.
        </p>
        <label className="fs-label" htmlFor="cloneName">New scenario name</label>
        <input
          id="cloneName"
          className="fs-input mt-1"
          placeholder="e.g. Retire at 50"
          value={cloneName}
          onChange={(e) => setCloneName(e.target.value)}
        />
      </Modal>
    </div>
  );
}

function DriftBadge({ delta, pct }: { delta: number; pct: number }) {
  // Within ±1% of plan reads as "on track"; beyond that we surface the
  // direction so a user can tell at a glance whether to adjust contributions.
  const onTrack = Math.abs(pct) <= 0.01;
  const ahead = delta >= 0;
  const cls = onTrack
    ? 'bg-surface-container-high text-on-surface-variant'
    : ahead
      ? 'bg-secondary/15 text-secondary'
      : 'bg-error/15 text-error';
  const label = onTrack ? 'On track' : ahead ? 'Ahead of plan' : 'Behind plan';
  return <span className={`text-xs px-2 py-1 rounded font-medium ${cls}`}>{label}</span>;
}

function EventBadge({ type }: { type: PlanEvent['type'] | string }) {
  const map: Record<string, { label: string; cls: string }> = {    deposit: { label: 'Deposit', cls: 'bg-secondary/15 text-secondary' },
    withdrawal: { label: 'Withdrawal', cls: 'bg-error/15 text-error' },
    rate_change: { label: 'Rate change', cls: 'bg-tertiary/15 text-tertiary' },
    // Deprecated — kept for read-only display of any straggler legacy rows.
    contribution_change: { label: 'Contrib. change (deprecated)', cls: 'bg-surface-container-high text-on-surface-variant' },
  };
  const entry = map[type] ?? { label: String(type), cls: 'bg-surface-container-high text-on-surface-variant' };
  return <span className={`text-xs px-2 py-0.5 rounded ${entry.cls}`}>{entry.label}</span>;
}
