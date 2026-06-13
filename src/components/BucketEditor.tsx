import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Trash2, Copy, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buckets as bucketsApi, fx as fxApi } from '@/api';
import type { Bucket, Actual } from '@/types';
import { SlideOver } from './Modal';
import { BucketIcon, ICON_NAMES } from './BucketIcon';
import { Spinner } from './Spinner';
import { BucketCopyModal } from './BucketCopyModal';
import { CurrencyInput } from './CurrencyInput';
import { InfoTip } from './InfoTip';
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

// Contributions used to be a separate tab here. After unifying contributions
// into recurring deposit events, the only sub-section is "actuals".
type Tab = 'details' | 'actuals';

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
  const [actuals, setActuals] = useState<Actual[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [currencies, setCurrencies] = useState<string[]>(sortCurrencies(FALLBACK_CURRENCIES));

  useEffect(() => {
    fxApi.currencies()
      .then((list) => { if (list.length) setCurrencies(sortCurrencies(list)); })
      .catch(() => { /* keep fallback */ });
  }, []);

  const loadDetail = useCallback(async () => {
    if (!bucket) return;
    setLoadingDetail(true);
    try {
      const b = await bucketsApi.get(bucket.id);
      setActuals(b.actuals);
    } finally {
      setLoadingDetail(false);
    }
  }, [bucket]);

  // Deferred to a microtask so state updates run in a callback rather than
  // synchronously in the effect body (avoids cascading renders).
  useEffect(() => { Promise.resolve().then(loadDetail); }, [loadDetail]);

  async function save() {
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await save();
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
          <button type="button" onClick={save} disabled={submitting || !name} className="fs-btn fs-btn-primary">
            {submitting ? <Spinner /> : bucket ? 'Save changes' : 'Create bucket'}
          </button>
        </>
      }
    >
      {/* Tabs */}
      <div className="flex border-b border-surface-container-high mb-4 -mx-6 px-6">
        {(['details', 'actuals'] as Tab[]).map((t) => (
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
              <label className="fs-label inline-flex items-center" htmlFor="return">
                Expected return % (APR)
                <InfoTip label="APR">
                  Annual Percentage Rate — the yearly nominal interest rate. With monthly
                  compounding the effective yield is slightly higher than APR; with annual
                  compounding it equals APR exactly.
                </InfoTip>
              </label>
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
              <label className="fs-label inline-flex items-center" htmlFor="compounding">
                Compounding
                <InfoTip label="compounding">
                  How often returns are added to the balance. Monthly applies APR/12 each
                  month (smooth growth). Annual applies the full APR once per year (stepped
                  growth) — best for fixed-term deposits or savings bonds.
                </InfoTip>
              </label>
              <select id="compounding" className="fs-input mt-1" value={compounding} onChange={(e) => setCompounding(e.target.value as 'monthly' | 'annual')}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="fs-label inline-flex items-center" htmlFor="targetAmount">
                Target amount (optional)
                <InfoTip label="target">
                  Set a goal amount and date to track this bucket as a milestone on the
                  Dashboard. Status (on track / drifting / behind) is derived by comparing
                  the projection against the target.
                </InfoTip>
              </label>
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


      {tab === 'actuals' && bucket && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-on-surface-variant inline-flex items-center">
            Record observed balances over time.
            <InfoTip label="actuals">
              Actuals are your real-world bucket balances at specific dates. We use them
              to overlay reality on the projection, so you can see drift. Add them
              manually here or import a CSV from the Actuals page.
            </InfoTip>
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
