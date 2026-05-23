import { useEffect, useState, type FormEvent } from 'react';
import { events as eventsApi } from '@/api';
import type { Bucket, PlanEvent, EventType, Cadence } from '@/types';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { CurrencyInput } from './CurrencyInput';
import { useToast } from '@/context/ToastContext';
import { todayIso } from '@/lib/format';

interface Props {
  scenarioId: number;
  buckets: Bucket[];
  event: PlanEvent | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPE_LABEL: Record<EventType, string> = {
  deposit: 'Lump-sum deposit',
  withdrawal: 'Withdrawal',
  rate_change: 'Rate change',
};

const TYPE_HINT: Record<EventType, string> = {
  deposit: 'A deposit to the chosen bucket (e.g. salary contribution, bonus, inheritance). Mark as recurring with a cadence to model regular savings.',
  withdrawal: 'A removal from the chosen bucket (e.g. retirement income, house deposit, large purchase). Can recur too.',
  rate_change: 'Override the expected return for this bucket from this date onward.',
};

export function EventEditor({ scenarioId, buckets, event, onClose, onSaved }: Props) {
  const { show } = useToast();
  const [type, setType] = useState<EventType>(event?.type ?? 'deposit');
  const [bucketId, setBucketId] = useState<number | ''>(event?.bucket_id ?? (buckets[0]?.id ?? ''));
  const [date, setDate] = useState(event?.date ?? todayIso());
  const [amount, setAmount] = useState<number | ''>(event?.amount ?? '');
  const [newRate, setNewRate] = useState<number | ''>(event?.new_rate != null ? event.new_rate * 100 : '');
  const [recurring, setRecurring] = useState<boolean>(!!event?.recurring);
  const [cadence, setCadence] = useState<Cadence>((event?.cadence as Cadence) ?? 'monthly');
  const [endDate, setEndDate] = useState(event?.end_date ?? '');
  const [escalationRate, setEscalationRate] = useState<number | ''>(event?.escalation_rate != null ? event.escalation_rate * 100 : '');
  const [enabled, setEnabled] = useState<boolean>(event?.enabled !== 0);
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recurring is only meaningful for deposit/withdrawal. Clear it when the
  // user switches type so a stale checkbox state can't slip into the payload.
  useEffect(() => {
    if (type !== 'deposit' && type !== 'withdrawal') {
      setRecurring(false);
      setEscalationRate('');
    }
  }, [type]);

  // Show the selected bucket's currency on the amount input so it's obvious
  // that the value is in that currency, not the plan's base.
  const selectedBucketCurrency = bucketId === ''
    ? undefined
    : buckets.find((b) => b.id === Number(bucketId))?.currency;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const isAmountEvent = type === 'deposit' || type === 'withdrawal';
      const payload: Record<string, unknown> = {
        type, date,
        bucketId: bucketId === '' ? null : Number(bucketId),
        amount: type === 'rate_change' ? null : amount === '' ? null : Number(amount),
        newRate: type === 'rate_change' ? (newRate === '' ? null : Number(newRate) / 100) : null,
        recurring: isAmountEvent ? recurring : false,
        cadence: isAmountEvent && recurring ? cadence : null,
        endDate: isAmountEvent && recurring && endDate ? endDate : null,
        escalationRate: isAmountEvent && recurring && escalationRate !== ''
          ? Number(escalationRate) / 100
          : null,
        enabled,
        notes: notes || null,
      };
      if (event) {
        await eventsApi.update(event.id, payload);
        show('Event updated', 'success');
      } else {
        await eventsApi.create(scenarioId, payload);
        show('Event created', 'success');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={event ? 'Edit event' : 'New event'}
      footer={
        <>
          <button type="button" onClick={onClose} className="fs-btn fs-btn-ghost">Cancel</button>
          <button type="submit" form="event-form" disabled={submitting} className="fs-btn fs-btn-primary">
            {submitting ? <Spinner /> : event ? 'Save changes' : 'Create event'}
          </button>
        </>
      }
    >
      <form id="event-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {/* Type tabs */}
        <div>
          <label className="fs-label">Event type</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {(['deposit', 'withdrawal', 'rate_change'] as EventType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`px-3 py-2 rounded text-sm border text-left transition-colors ${
                  type === t
                    ? 'bg-primary-container/20 border-primary text-primary'
                    : 'bg-surface-container-lowest border-surface-container-high text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <p className="text-xs text-on-surface-variant mt-2">{TYPE_HINT[type]}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="fs-label" htmlFor="event-date">Date</label>
            <input id="event-date" type="date" className="fs-input mt-1" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="fs-label" htmlFor="event-bucket">Bucket</label>
            <select id="event-bucket" className="fs-input mt-1" value={bucketId} onChange={(e) => setBucketId(e.target.value === '' ? '' : Number(e.target.value))} required>
              {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {(type === 'deposit' || type === 'withdrawal') && buckets.length > 1 && (
              <p className="text-xs text-on-surface-variant mt-1">
                One event = one bucket. Add a separate event per bucket if you want a
                multi-bucket {type}.
              </p>
            )}
          </div>

          {type === 'rate_change' ? (
            <div className="col-span-2">
              <label className="fs-label" htmlFor="event-rate">New expected return %</label>
              <input id="event-rate" type="number" step="0.1" className="fs-input mt-1 tabular" placeholder="e.g. 5.5" value={newRate} onChange={(e) => setNewRate(e.target.value === '' ? '' : Number(e.target.value))} required />
            </div>
          ) : (
            <div className="col-span-2">
              <label className="fs-label" htmlFor="event-amount">
                Amount {type === 'withdrawal' ? '(deducted)' : ''}
              </label>
              <CurrencyInput
                id="event-amount"
                className="fs-input mt-1"
                value={amount}
                onChange={setAmount}
                placeholder="e.g. 5,000"
                currencyHint={selectedBucketCurrency}
                required
              />
            </div>
          )}

          {/* Recurring is only meaningful for amount-based events (deposit/withdrawal).
              rate_change is "from this date forward" — it doesn't repeat. */}
          {(type === 'deposit' || type === 'withdrawal') && (
            <div className="col-span-2 flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <label className="inline-flex items-center gap-2 cursor-pointer sm:pb-2">
                  <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-inverse-primary" />
                  <span className="text-sm text-on-surface">Recurring</span>
                </label>
                {recurring && (
                  <>
                    <div className="flex-1">
                      <label className="fs-label" htmlFor="event-cadence">Frequency</label>
                      <select id="event-cadence" className="fs-input mt-1" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly (every 3 months)</option>
                        <option value="semi_annual">Semi-annually (every 6 months)</option>
                        <option value="annual">Annually</option>
                        <option value="biennial">Biennially (every 2 years)</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="fs-label" htmlFor="event-end">
                        End date <span className="text-on-surface-variant normal-case tracking-normal">(optional — leave blank for ongoing)</span>
                      </label>
                      <input id="event-end" type="date" className="fs-input mt-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </div>
                  </>
                )}
              </div>

              {recurring && (
                <div>
                  <label className="fs-label" htmlFor="escalation">
                    Annual escalation % <span className="text-on-surface-variant normal-case tracking-normal">(optional)</span>
                  </label>
                  <input
                    id="escalation"
                    type="number"
                    step="0.1"
                    className="fs-input mt-1 tabular"
                    placeholder="e.g. 3 to index withdrawals to inflation"
                    value={escalationRate}
                    onChange={(e) => setEscalationRate(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                  <p className="text-xs text-on-surface-variant mt-1">
                    Each occurrence's amount grows by this annual rate. 3% means a $1,000 withdrawal becomes
                    $1,030 after a year, $1,061 after two, etc. Works with any cadence (we interpolate fractionally
                    for monthly/quarterly).
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="col-span-2">
            <label className="fs-label" htmlFor="event-notes">Notes (optional)</label>
            <textarea id="event-notes" className="fs-input mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <input id="event-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-inverse-primary" />
            <label htmlFor="event-enabled" className="text-sm text-on-surface">Active in projection</label>
          </div>
        </div>

        {error && (
          <div className="px-3 py-2 rounded bg-error-container/30 border border-error/40 text-error text-sm">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
