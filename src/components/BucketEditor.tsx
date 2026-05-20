import { useEffect, useState, type FormEvent } from 'react';
import { Trash2, Copy, Pencil, Check, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buckets as bucketsApi, fx as fxApi } from '@/api';
import type { Bucket, ContributionSchedule, Actual } from '@/types';
import { SlideOver } from './Modal';
import { BucketIcon, ICON_NAMES } from './BucketIcon';
import { Spinner } from './Spinner';
import { BucketCopyModal } from './BucketCopyModal';
import { CurrencyInput } from './CurrencyInput';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { todayIso, formatCurrency, formatDate, formatPercent, sortCurrencies } from '@/lib/format';

const FALLBACK_CURRENCIES = ['NGN','USD','GBP','EUR','JPY','CHF','CAD','AUD'];

interface Props {
  scenarioId: number;
  bucket: Bucket | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}

type Tab = 'details' | 'contributions' | 'actuals';

export function BucketEditor({ scenarioId, bucket, onClose, onSaved, onDelete }: Props) {
  const { show } = useToast();
  const { state } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('details');
  const [copyOpen, setCopyOpen] = useState(false);

  // Default currency for a new bucket: plan's base currency, not hardcoded USD.
  const planBaseCurrency = state.status === 'authenticated'
    ? state.plans.find((p) => p.id === state.activePlanId)?.base_currency ?? 'USD'
    : 'USD';

  const [name, setName] = useState(bucket?.name ?? '');
  const [category, setCategory] = useState(bucket?.category ?? '');
  const [currency, setCurrency] = useState(bucket?.currency ?? planBaseCurrency);
  const [startingBalance, setStartingBalance] = useState<number | ''>(bucket?.starting_balance ?? '');
  const [expectedReturn, setExpectedReturn] = useState((bucket?.expected_return ?? 0.05) * 100);
  const [compounding, setCompounding] = useState<'monthly' | 'annual'>(bucket?.compounding ?? 'monthly');
  const [targetAmount, setTargetAmount] = useState<number | ''>(bucket?.target_amount ?? '');
  const [targetDate, setTargetDate] = useState<string>(bucket?.target_date ?? '');
  const [icon, setIcon] = useState(bucket?.icon ?? 'wallet');

  const [submitting, setSubmitting] = useState(false);
  const [contribs, setContribs] = useState<ContributionSchedule[]>([]);
  const [actuals, setActuals] = useState<Actual[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [currencies, setCurrencies] = useState<string[]>(sortCurrencies(FALLBACK_CURRENCIES));

  useEffect(() => {
    fxApi.currencies()
      .then((list) => { if (list.length) setCurrencies(sortCurrencies(list)); })
      .catch(() => { /* keep fallback */ });
  }, []);

  useEffect(() => {
    if (!bucket) return;
    setLoadingDetail(true);
    bucketsApi.get(bucket.id)
      .then((b) => {
        setContribs(b.contribution_schedules);
        setActuals(b.actuals);
      })
      .finally(() => setLoadingDetail(false));
  }, [bucket]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        name,
        category: category || null,
        currency: currency.toUpperCase(),
        starting_balance: startingBalance === '' ? 0 : Number(startingBalance),
        expected_return: Number(expectedReturn) / 100,
        compounding,
        target_amount: targetAmount === '' ? null : Number(targetAmount),
        target_date: targetDate || null,
        icon,
      } as Partial<Bucket>;
      if (bucket) {
        await bucketsApi.update(bucket.id, payload);
        show(`Saved "${name}"`, 'success');
      } else {
        await bucketsApi.create(scenarioId, payload as Partial<Bucket> & { name: string });
        show(`Created "${name}"`, 'success');
      }
      onSaved();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // Contribution add form
  const [cAmount, setCAmount] = useState<number | ''>('');
  const [cCadence, setCCadence] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const [cStart, setCStart] = useState(todayIso());
  const [cEnd, setCEnd] = useState('');

  async function onAddContribution() {
    if (!bucket || cAmount === '' || !cStart) return;
    await bucketsApi.contributions.add(bucket.id, {
      amount: Number(cAmount),
      cadence: cCadence,
      startDate: cStart,
      endDate: cEnd || null,
    });
    const fresh = await bucketsApi.get(bucket.id);
    setContribs(fresh.contribution_schedules);
    setCAmount('');
    setCEnd('');
    show('Contribution added', 'success');
  }
  async function onRemoveContribution(id: number) {
    await bucketsApi.contributions.remove(id);
    setContribs((cs) => cs.filter((c) => c.id !== id));
    show('Contribution removed', 'success');
  }

  // Inline edit state for an existing contribution.
  const [editingContribId, setEditingContribId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState<number | ''>('');
  const [editCadence, setEditCadence] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  function startEditContrib(c: ContributionSchedule) {
    setEditingContribId(c.id);
    setEditAmount(c.amount);
    setEditCadence(c.cadence);
    setEditStart(c.start_date);
    setEditEnd(c.end_date ?? '');
  }
  function cancelEditContrib() {
    setEditingContribId(null);
  }
  async function saveEditContrib() {
    if (editingContribId == null || editAmount === '' || !editStart) return;
    await bucketsApi.contributions.update(editingContribId, {
      amount: Number(editAmount),
      cadence: editCadence,
      startDate: editStart,
      endDate: editEnd || null,
    });
    const fresh = await bucketsApi.get(bucket!.id);
    setContribs(fresh.contribution_schedules);
    setEditingContribId(null);
    show('Contribution updated', 'success');
  }

  // Actual add form
  const [aDate, setADate] = useState(todayIso());
  const [aBalance, setABalance] = useState<number | ''>('');
  async function onAddActual() {
    if (!bucket || aBalance === '' || !aDate) return;
    await bucketsApi.actuals.add(bucket.id, { date: aDate, balance: Number(aBalance) });
    const list = await bucketsApi.actuals.list(bucket.id);
    setActuals(list);
    setABalance('');
    show('Actual recorded', 'success');
  }
  async function onRemoveActual(id: number) {
    await bucketsApi.actuals.remove(id);
    setActuals((as) => as.filter((a) => a.id !== id));
  }

  return (
    <SlideOver
      open={true}
      onClose={onClose}
      title={bucket ? bucket.name : 'New bucket'}
      footer={
        <>
          {bucket && onDelete && (
            <button type="button" onClick={onDelete} className="fs-btn fs-btn-danger mr-auto">
              <Trash2 size={14} /> Delete
            </button>
          )}
          {bucket && (
            <button type="button" onClick={() => setCopyOpen(true)} className="fs-btn fs-btn-secondary">
              <Copy size={14} /> Copy to scenario…
            </button>
          )}
          <button type="button" onClick={onClose} className="fs-btn fs-btn-ghost">Cancel</button>
          <button type="submit" form="bucket-form" disabled={submitting} className="fs-btn fs-btn-primary">
            {submitting ? <Spinner /> : bucket ? 'Save changes' : 'Create bucket'}
          </button>
        </>
      }
    >
      {/* Tabs */}
      <div className="flex border-b border-surface-container-high mb-4 -mx-6 px-6">
        {(['details', 'contributions', 'actuals'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            disabled={!bucket && t !== 'details'}
            className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <form id="bucket-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="fs-label" htmlFor="name">Bucket name</label>
              <input id="name" className="fs-input mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="fs-label" htmlFor="category">Category</label>
              <input id="category" className="fs-input mt-1" placeholder="e.g. Retirement" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div>
              <label className="fs-label" htmlFor="currency">Currency</label>
              <select id="currency" className="fs-input mt-1" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="fs-label" htmlFor="starting">Starting balance</label>
              <CurrencyInput
                id="starting"
                className="fs-input mt-1"
                value={startingBalance}
                onChange={setStartingBalance}
                placeholder="0"
                currencyHint={currency}
              />
            </div>
            <div>
              <label className="fs-label" htmlFor="return">Expected return % (APR)</label>
              <input id="return" type="number" step="0.1" className="fs-input mt-1 tabular" value={expectedReturn} onChange={(e) => setExpectedReturn(Number(e.target.value))} />
              {compounding === 'monthly' && expectedReturn > 0 && (
                <p className="text-xs text-on-surface-variant mt-1">
                  At {expectedReturn}% APR compounded monthly, effective annual yield ≈ {((Math.pow(1 + expectedReturn / 100 / 12, 12) - 1) * 100).toFixed(2)}%
                </p>
              )}
              {compounding === 'annual' && expectedReturn > 0 && (
                <p className="text-xs text-on-surface-variant mt-1">
                  At {expectedReturn}% APR compounded annually, balance grows by exactly {expectedReturn}% at each year boundary.
                </p>
              )}
            </div>
            <div>
              <label className="fs-label" htmlFor="compounding">Compounding</label>
              <select id="compounding" className="fs-input mt-1" value={compounding} onChange={(e) => setCompounding(e.target.value as 'monthly' | 'annual')}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="fs-label" htmlFor="targetAmount">Target amount (optional)</label>
              <CurrencyInput
                id="targetAmount"
                className="fs-input mt-1"
                value={targetAmount}
                onChange={setTargetAmount}
                placeholder="None"
                currencyHint={currency}
              />
            </div>
            <div>
              <label className="fs-label" htmlFor="targetDate">Target date (optional)</label>
              <input id="targetDate" type="date" className="fs-input mt-1" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="fs-label">Icon</label>
              <div className="grid grid-cols-8 gap-2 mt-1">
                {ICON_NAMES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setIcon(n)}
                    className={`aspect-square rounded border flex items-center justify-center transition-colors ${
                      icon === n
                        ? 'bg-primary-container/30 border-primary text-primary'
                        : 'bg-surface-container-lowest border-surface-container-high text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <BucketIcon name={n} size={16} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </form>
      )}

      {tab === 'contributions' && bucket && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-on-surface-variant">
            Recurring contributions to this bucket. Add multiple to model step-ups
            (e.g. £500/mo until 2027, then £800/mo). Contributions stop on the
            <span className="text-on-surface"> End date</span>, so leaving it blank
            keeps them running indefinitely — that changes the long-term projection materially.
          </p>

          {/* Add-contribution panel — visually distinct so it's obvious the
              fields here are a separate "add" form, not bucket-wide settings.
              Save changes on the slide-over does NOT save these; the explicit
              "Add contribution" button does. */}
          <div className="fs-card p-4 bg-surface-container/40 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="fs-label">Add a new contribution</span>
            </div>
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                <label className="fs-label">Amount</label>
                <CurrencyInput
                  className="fs-input mt-1"
                  value={cAmount}
                  onChange={setCAmount}
                  placeholder="e.g. 500"
                  currencyHint={currency}
                />
              </div>
              <div className="col-span-3">
                <label className="fs-label">Cadence</label>
                <select className="fs-input mt-1" value={cCadence} onChange={(e) => setCCadence(e.target.value as 'monthly' | 'quarterly' | 'annual')}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div className="col-span-3">
                <label className="fs-label">Start</label>
                <input type="date" className="fs-input mt-1" value={cStart} onChange={(e) => setCStart(e.target.value)} />
              </div>
              <div className="col-span-3">
                <label className="fs-label">End (optional)</label>
                <input type="date" className="fs-input mt-1" value={cEnd} onChange={(e) => setCEnd(e.target.value)} />
              </div>
            </div>
            <button
              type="button"
              onClick={onAddContribution}
              disabled={cAmount === '' || !cStart}
              className="fs-btn fs-btn-primary self-end"
            >
              <Check size={14} /> Add contribution
            </button>
          </div>

          {loadingDetail ? <Spinner /> : contribs.length === 0 ? (
            <div className="text-sm text-on-surface-variant py-4">No contribution schedules yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-on-surface-variant border-b border-surface-container-high">
                  <th className="py-2 fs-label">Amount</th>
                  <th className="py-2 fs-label">Cadence</th>
                  <th className="py-2 fs-label">Start</th>
                  <th className="py-2 fs-label">End</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contribs.map((c) => editingContribId === c.id ? (
                  <tr key={c.id} className="border-b border-surface-container/50 bg-surface-container/30">
                    <td className="py-2 pr-2">
                      <CurrencyInput className="fs-input" value={editAmount} onChange={setEditAmount} currencyHint={currency} />
                    </td>
                    <td className="py-2 pr-2">
                      <select className="fs-input" value={editCadence} onChange={(e) => setEditCadence(e.target.value as 'monthly' | 'quarterly' | 'annual')}>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annual">Annual</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input type="date" className="fs-input" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                    </td>
                    <td className="py-2 pr-2">
                      <input type="date" className="fs-input" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} placeholder="Open-ended" />
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" onClick={saveEditContrib} className="p-1 text-secondary hover:text-secondary-fixed-dim" aria-label="Save">
                        <Check size={14} />
                      </button>
                      <button type="button" onClick={cancelEditContrib} className="p-1 text-on-surface-variant hover:text-on-surface" aria-label="Cancel">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className="border-b border-surface-container/50">
                    <td className="py-2 tabular text-on-surface">{formatCurrency(c.amount, currency, { maximumFractionDigits: 0 })}</td>
                    <td className="py-2 text-on-surface-variant capitalize">{c.cadence}</td>
                    <td className="py-2 text-on-surface-variant tabular">{formatDate(c.start_date)}</td>
                    <td className="py-2 text-on-surface-variant tabular">{c.end_date ? formatDate(c.end_date) : 'Open-ended'}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" onClick={() => startEditContrib(c)} className="text-on-surface-variant hover:text-primary p-1" aria-label="Edit">
                        <Pencil size={14} />
                      </button>
                      <button type="button" onClick={() => onRemoveContribution(c.id)} className="text-on-surface-variant hover:text-error p-1" aria-label="Remove">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'actuals' && bucket && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-on-surface-variant">
            Record observed balances over time. We compare these against the projection to track drift.
          </p>
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-4">
              <label className="fs-label">Date</label>
              <input type="date" className="fs-input mt-1" value={aDate} onChange={(e) => setADate(e.target.value)} />
            </div>
            <div className="col-span-5">
              <label className="fs-label">Balance</label>
              <CurrencyInput
                className="fs-input mt-1"
                value={aBalance}
                onChange={setABalance}
                placeholder="e.g. 12,500"
                currencyHint={currency}
              />
            </div>
            <div className="col-span-3">
              <button type="button" onClick={onAddActual} disabled={aBalance === ''} className="fs-btn fs-btn-primary w-full">
                <Check size={14} /> Record
              </button>
            </div>
          </div>
          {loadingDetail ? <Spinner /> : actuals.length === 0 ? (
            <div className="text-sm text-on-surface-variant py-4">No actuals recorded yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-on-surface-variant border-b border-surface-container-high">
                  <th className="py-2 fs-label">Date</th>
                  <th className="py-2 fs-label">Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {actuals.map((a) => (
                  <tr key={a.id} className="border-b border-surface-container/50">
                    <td className="py-2 tabular text-on-surface">{formatDate(a.date)}</td>
                    <td className="py-2 tabular text-on-surface">{formatCurrency(a.balance, currency, { maximumFractionDigits: 0 })}</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => onRemoveActual(a.id)} className="text-on-surface-variant hover:text-error p-1" aria-label="Remove">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="text-xs text-on-surface-variant pt-2 border-t border-surface-container">
            Current return assumption: <span className="text-on-surface tabular">{formatPercent(expectedReturn / 100)} {compounding}</span>
          </div>
        </div>
      )}

      {bucket && copyOpen && state.status === 'authenticated' && state.activePlanId && (
        <BucketCopyModal
          bucket={bucket}
          currentScenarioId={scenarioId}
          planId={state.activePlanId}
          onClose={() => setCopyOpen(false)}
          onCopied={(newBucketId, targetScenarioId) => {
            setCopyOpen(false);
            if (targetScenarioId === scenarioId) {
              // Copy landed in the same scenario - just reload to show it in the list.
              onSaved();
            } else {
              // Navigate to the target scenario with the new bucket selected.
              onClose();
              navigate(`/scenarios/${targetScenarioId}?bucket=${newBucketId}`);
            }
          }}
        />
      )}
    </SlideOver>
  );
}
