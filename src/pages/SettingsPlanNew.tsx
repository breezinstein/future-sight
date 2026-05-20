import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { plans as plansApi, fx as fxApi } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Spinner } from '@/components/Spinner';

export function SettingsPlanNew() {
  const { refreshPlans, setActivePlan } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fxApi.currencies().then(setCurrencies).catch(() => setCurrencies(['USD','EUR','GBP']));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { id } = await plansApi.create({ name, baseCurrency });
      await refreshPlans();
      setActivePlan(id);
      show(`Created plan "${name}"`, 'success');
      navigate('/');
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to create plan', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <div className="fs-card p-6">
        <h2 className="text-lg font-semibold text-on-surface mb-1">New household plan</h2>
        <p className="text-sm text-on-surface-variant mb-6">A plan is a separate household budget with its own scenarios and members. You'll be its owner.</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <label className="fs-label" htmlFor="newPlanName">Name</label>
            <input id="newPlanName" required className="fs-input mt-1" placeholder="e.g. The Doe Household" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="fs-label" htmlFor="newPlanCur">Base currency</label>
            <select id="newPlanCur" className="fs-input mt-1" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" onClick={() => navigate(-1)} className="fs-btn fs-btn-ghost">Cancel</button>
            <button type="submit" disabled={submitting || !name.trim()} className="fs-btn fs-btn-primary">
              {submitting ? <Spinner /> : 'Create plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
