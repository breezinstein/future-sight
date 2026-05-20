import { useEffect, useState, type FormEvent } from 'react';
import { auth as authApi, plans as plansApi, fx as fxApi } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Spinner } from '@/components/Spinner';

export function SettingsGeneral() {
  const { state, refreshPlans } = useAuth();
  const { show } = useToast();
  const planId = state.status === 'authenticated' ? state.activePlanId : null;
  const plan = state.status === 'authenticated' ? state.plans.find((p) => p.id === planId) : null;

  const [planName, setPlanName] = useState(plan?.name ?? '');
  const [baseCurrency, setBaseCurrency] = useState(plan?.base_currency ?? 'USD');
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [savingPlan, setSavingPlan] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    fxApi.currencies().then(setCurrencies).catch(() => setCurrencies(['USD','EUR','GBP']));
  }, []);

  useEffect(() => {
    setPlanName(plan?.name ?? '');
    setBaseCurrency(plan?.base_currency ?? 'USD');
  }, [plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function savePlan(e: FormEvent) {
    e.preventDefault();
    if (!planId) return;
    setSavingPlan(true);
    try {
      await plansApi.update(planId, { name: planName, baseCurrency });
      await refreshPlans();
      show('Plan updated', 'success');
    } catch (err) {
      show(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setSavingPlan(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setSavingPwd(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      show('Password changed', 'success');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      show(err instanceof Error ? err.message : 'Change failed', 'error');
    } finally {
      setSavingPwd(false);
    }
  }

  if (state.status !== 'authenticated') return null;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <section className="fs-card p-6">
        <h2 className="text-base font-semibold text-on-surface mb-4">Plan</h2>
        <form onSubmit={savePlan} className="flex flex-col gap-4">
          <div>
            <label className="fs-label" htmlFor="planName">Plan name</label>
            <input id="planName" className="fs-input mt-1" value={planName} onChange={(e) => setPlanName(e.target.value)} />
          </div>
          <div>
            <label className="fs-label" htmlFor="baseCurrency">Base currency</label>
            <select id="baseCurrency" className="fs-input mt-1" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-xs text-on-surface-variant mt-1">Bucket values in other currencies are converted to this currency for aggregation.</p>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={savingPlan} className="fs-btn fs-btn-primary">
              {savingPlan ? <Spinner /> : 'Save plan'}
            </button>
          </div>
        </form>
      </section>

      <section className="fs-card p-6">
        <h2 className="text-base font-semibold text-on-surface mb-4">Profile</h2>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-on-surface-variant">Name</span>
            <span className="text-on-surface">{state.user.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-on-surface-variant">Email</span>
            <span className="text-on-surface">{state.user.email}</span>
          </div>
        </div>
      </section>

      <section className="fs-card p-6">
        <h2 className="text-base font-semibold text-on-surface mb-4">Change password</h2>
        <form onSubmit={changePassword} className="flex flex-col gap-4">
          <div>
            <label className="fs-label" htmlFor="cp">Current password</label>
            <input id="cp" type="password" required autoComplete="current-password" className="fs-input mt-1" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <label className="fs-label" htmlFor="np">New password</label>
            <input id="np" type="password" required autoComplete="new-password" minLength={8} className="fs-input mt-1" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={savingPwd || !currentPassword || newPassword.length < 8} className="fs-btn fs-btn-primary">
              {savingPwd ? <Spinner /> : 'Update password'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
