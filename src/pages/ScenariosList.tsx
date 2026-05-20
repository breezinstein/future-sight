import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Copy, Trash2, GitCompareArrows, Star } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { scenarios as scenariosApi } from '@/api';
import type { Scenario, ProjectionResponse } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { FullPageSpinner } from '@/components/Spinner';
import { formatCompactCurrency, formatDate } from '@/lib/format';
import { Modal } from '@/components/Modal';

export function ScenariosList() {
  const { state } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();
  const planId = state.status === 'authenticated' ? state.activePlanId : null;
  const baseCurrency = state.status === 'authenticated' ? state.plans.find((p) => p.id === planId)?.base_currency ?? 'USD' : 'USD';

  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [projections, setProjections] = useState<Record<number, ProjectionResponse>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [cloneOpen, setCloneOpen] = useState<Scenario | null>(null);
  const [cloneName, setCloneName] = useState('');

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    (async () => {
      const list = await scenariosApi.list(planId);
      if (cancelled) return;
      setScenarios(list);
      const entries = await Promise.all(
        list.map(async (s) => [s.id, await scenariosApi.projection(s.id)] as const),
      );
      if (cancelled) return;
      setProjections(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [planId]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  }

  async function onDelete(s: Scenario) {
    if (s.is_base) { show('Cannot delete the base scenario', 'warning'); return; }
    if (!confirm(`Delete scenario "${s.name}"?`)) return;
    await scenariosApi.remove(s.id);
    setScenarios((xs) => (xs ?? []).filter((x) => x.id !== s.id));
    show(`Deleted "${s.name}"`, 'success');
  }

  async function onClone() {
    if (!cloneOpen || !cloneName.trim()) return;
    const { id } = await scenariosApi.clone(cloneOpen.id, cloneName.trim());
    setCloneOpen(null);
    setCloneName('');
    navigate(`/scenarios/${id}`);
  }

  const compareUrl = useMemo(() => {
    if (selected.size < 2) return null;
    return `/scenarios/compare?ids=${[...selected].join(',')}`;
  }, [selected]);

  if (scenarios === null) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">Scenarios</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">Model multiple futures and compare them side by side.</p>
        </div>
        <div className="flex items-center gap-2">
          {compareUrl && (
            <Link to={compareUrl} className="fs-btn fs-btn-secondary">
              <GitCompareArrows size={14} /> Compare ({selected.size})
            </Link>
          )}
          <Link to="/scenarios/new" className="fs-btn fs-btn-primary">
            <Plus size={14} /> New scenario
          </Link>
        </div>
      </header>

      {scenarios.length === 0 ? (
        <div className="fs-card p-12 text-center">
          <p className="text-on-surface-variant mb-4">No scenarios yet.</p>
          <Link to="/scenarios/new" className="fs-btn fs-btn-primary">
            <Plus size={14} /> Create your first scenario
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-3 gap-4">
          {scenarios.map((s) => {
            const proj = projections[s.id];
            const isSel = selected.has(s.id);
            const sparkData = proj?.projection.aggregate.filter((_, i) => i % 12 === 0) ?? [];
            const final = proj?.projection.aggregate.at(-1)?.balance ?? 0;
            return (
              <div key={s.id} className={`fs-card p-4 flex flex-col gap-3 transition-colors ${isSel ? 'border-primary' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/scenarios/${s.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-on-surface truncate">{s.name}</h3>
                      {s.is_base ? (
                        <span className="inline-flex items-center gap-1 fs-label bg-primary-container/30 text-primary px-1.5 py-0.5 rounded">
                          <Star size={10} /> Base
                        </span>
                      ) : null}
                    </div>
                    {s.description && <p className="text-xs text-on-surface-variant line-clamp-2">{s.description}</p>}
                  </Link>
                  <label className="inline-flex items-center gap-1 cursor-pointer text-on-surface-variant hover:text-on-surface">
                    <input
                      type="checkbox"
                      className="accent-inverse-primary"
                      checked={isSel}
                      onChange={() => toggleSelect(s.id)}
                      disabled={!isSel && selected.size >= 3}
                    />
                  </label>
                </div>

                {/* Sparkline */}
                <div className="h-14 -mx-1">
                  {sparkData.length > 1 && (
                    <ResponsiveContainer>
                      <LineChart data={sparkData}>
                        <Line type="monotone" dataKey="balance" stroke="#c0c1ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="flex items-baseline justify-between text-xs text-on-surface-variant">
                  <span className="tabular">{formatCompactCurrency(final, baseCurrency)} at {s.horizon_years}y</span>
                  <span>Updated {formatDate(s.updated_at)}</span>
                </div>

                <div className="flex items-center gap-1 mt-1 pt-2 border-t border-surface-container">
                  <Link to={`/scenarios/${s.id}`} className="fs-btn fs-btn-ghost flex-1 justify-center text-xs">Open</Link>
                  <button type="button" onClick={() => { setCloneOpen(s); setCloneName(`${s.name} (copy)`); }} className="fs-btn fs-btn-ghost text-xs" aria-label="Clone">
                    <Copy size={14} />
                  </button>
                  {!s.is_base && (
                    <button type="button" onClick={() => onDelete(s)} className="fs-btn fs-btn-ghost text-error/80 hover:text-error text-xs" aria-label="Delete">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!cloneOpen}
        onClose={() => setCloneOpen(null)}
        title={`Clone "${cloneOpen?.name ?? ''}"`}
        footer={
          <>
            <button type="button" onClick={() => setCloneOpen(null)} className="fs-btn fs-btn-ghost">Cancel</button>
            <button type="button" onClick={onClone} disabled={!cloneName.trim()} className="fs-btn fs-btn-primary">Create clone</button>
          </>
        }
      >
        <label className="fs-label" htmlFor="cname">New scenario name</label>
        <input id="cname" className="fs-input mt-1" value={cloneName} onChange={(e) => setCloneName(e.target.value)} autoFocus />
      </Modal>
    </div>
  );
}
