import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { scenarios as scenariosApi } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Spinner } from '@/components/Spinner';

export function ScenarioNew() {
  const navigate = useNavigate();
  const { state } = useAuth();
  const { show } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [horizonYears, setHorizonYears] = useState(30);
  const [submitting, setSubmitting] = useState(false);

  const planId = state.status === 'authenticated' ? state.activePlanId : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!planId) return;
    setSubmitting(true);
    try {
      const { id } = await scenariosApi.create(planId, {
        name,
        description: description || null,
        horizonYears,
      });
      show(`Created "${name}"`, 'success');
      navigate(`/scenarios/${id}`);
    } catch (err) {
      show(err instanceof Error ? err.message : 'Create failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/scenarios" className="inline-flex items-center text-on-surface-variant hover:text-on-surface text-sm mb-4">
        <ChevronLeft size={16} /> Back to scenarios
      </Link>
      <div className="fs-card p-6">
        <h1 className="text-2xl font-semibold text-on-surface mb-1">New scenario</h1>
        <p className="text-sm text-on-surface-variant mb-6">
          A scenario is a named, independent financial timeline. Start fresh or clone the Base case from the scenarios list.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <label className="fs-label" htmlFor="name">Name</label>
            <input id="name" required className="fs-input mt-1" placeholder="e.g. Retire at 50" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="fs-label" htmlFor="description">Description (optional)</label>
            <textarea id="description" className="fs-input mt-1" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="fs-label" htmlFor="horizon">Horizon (years)</label>
            <input id="horizon" type="number" min={1} max={80} className="fs-input mt-1 tabular" value={horizonYears} onChange={(e) => setHorizonYears(Number(e.target.value))} />
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <Link to="/scenarios" className="fs-btn fs-btn-ghost">Cancel</Link>
            <button type="submit" disabled={submitting || !name.trim()} className="fs-btn fs-btn-primary">
              {submitting ? <Spinner /> : 'Create scenario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
