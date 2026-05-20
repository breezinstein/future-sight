import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Copy, Plus, Trash2, Edit3, Settings as SettingsIcon, Star } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot,
} from 'recharts';
import { scenarios as scenariosApi, buckets as bucketsApi, events as eventsApi } from '@/api';
import type { Bucket, PlanEvent, ProjectionResponse, Scenario } from '@/types';
import { FullPageSpinner } from '@/components/Spinner';
import { BucketIcon } from '@/components/BucketIcon';
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
    setHasLoaded(true);
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  // Open bucket editor if ?bucket=ID query param is present.
  useEffect(() => {
    const bid = Number(params.get('bucket'));
    if (bid && buckets.length) {
      const b = buckets.find((x) => x.id === bid);
      if (b) { setEditingBucket(b); setBucketEditorOpen(true); }
    }
  }, [params, buckets]);

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
              <h2 className="fs-label">Net worth projection</h2>
              <p className="text-xs text-on-surface-variant mt-1 tabular">
                Starts {formatYearMonth(proj.projection.startDate)}
                {' → ends '}
                {formatYearMonth(proj.projection.aggregate.at(-1)?.date ?? null)}
                {' · '}
                {scenario.horizon_years}y horizon
              </p>
            </div>
            <div className="text-xs text-on-surface-variant tabular text-right">
              Final aggregate<br/>
              <span className="text-on-surface text-base">
                {formatCompactCurrency(proj.projection.aggregate.at(-1)?.balance ?? 0, baseCurrency)}
              </span>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer>
              <AreaChart data={proj.projection.aggregate} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
                  formatter={(v: number) => formatCurrency(v, baseCurrency, { maximumFractionDigits: 0 })}
                />
                <Area type="monotone" dataKey="balance" stroke="#c0c1ff" strokeWidth={2} fill="url(#scenFill)" isAnimationActive={false} />
                {events.filter((e) => e.enabled).map((e) => {
                  const point = proj.projection.aggregate.find((p) => p.date >= e.date);
                  if (!point) return null;
                  const color = e.type === 'rate_change' ? '#ffb95f' :
                                e.type === 'withdrawal' ? '#ffb4ab' :
                                e.type === 'contribution_change' ? '#4edea3' :
                                '#c0c1ff';
                  return <ReferenceDot key={e.id} x={point.date} y={point.balance} r={5} fill={color} stroke="#131313" strokeWidth={2} />;
                })}
              </AreaChart>
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
                onClick={() => { setEditingBucket(b); setBucketEditorOpen(true); setParams({ bucket: String(b.id) }); }}
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
                        <td className="py-2 pr-3 text-on-surface-variant">{bucket?.name ?? 'All'}</td>
                        <td className="py-2 pr-3 tabular text-on-surface">
                          {e.type === 'rate_change' ? formatPercent(e.new_rate ?? 0) :
                           e.amount != null ? formatCurrency(e.amount, bucket?.currency ?? baseCurrency, { maximumFractionDigits: 0 }) :
                           '—'}
                        </td>
                        <td className="py-2 pr-3 text-on-surface-variant text-xs">
                          {e.recurring ? (
                            <>
                              Every {e.cadence}
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
          onClose={() => { setBucketEditorOpen(false); setEditingBucket(null); setParams({}); }}
          onSaved={() => { setBucketEditorOpen(false); setEditingBucket(null); setParams({}); reload(); }}
          onDelete={editingBucket ? () => { onDeleteBucket(editingBucket); setBucketEditorOpen(false); setEditingBucket(null); setParams({}); } : undefined}
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

function EventBadge({ type }: { type: PlanEvent['type'] }) {
  const map: Record<PlanEvent['type'], { label: string; cls: string }> = {
    deposit: { label: 'Deposit', cls: 'bg-secondary/15 text-secondary' },
    withdrawal: { label: 'Withdrawal', cls: 'bg-error/15 text-error' },
    rate_change: { label: 'Rate change', cls: 'bg-tertiary/15 text-tertiary' },
    contribution_change: { label: 'Contrib. change', cls: 'bg-primary/15 text-primary' },
  };
  const { label, cls } = map[type];
  return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}
