import { useState, type FormEvent } from 'react';
import { scenarios as scenariosApi } from '@/api';
import type { Scenario } from '@/types';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { useToast } from '@/context/ToastContext';

interface Props {
  scenario: Scenario;
  onClose: () => void;
  onSaved: () => void;
}

export function ScenarioSettings({ scenario, onClose, onSaved }: Props) {
  const { show } = useToast();
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description ?? '');
  const [startDate, setStartDate] = useState(scenario.start_date ?? '');
  const [horizonYears, setHorizonYears] = useState(scenario.horizon_years);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await scenariosApi.update(scenario.id, {
        name,
        description: description || null,
        startDate: startDate || null,
        horizonYears,
      });
      show('Scenario updated', 'success');
      onSaved();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Scenario settings"
      footer={
        <>
          <button type="button" onClick={onClose} className="fs-btn fs-btn-ghost">Cancel</button>
          <button type="submit" form="scenario-settings-form" disabled={submitting} className="fs-btn fs-btn-primary">
            {submitting ? <Spinner /> : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="scenario-settings-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <label className="fs-label" htmlFor="ss-name">Name</label>
          <input id="ss-name" className="fs-input mt-1" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="fs-label" htmlFor="ss-desc">Description</label>
          <textarea id="ss-desc" className="fs-input mt-1" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="fs-label" htmlFor="ss-start">Start date</label>
            <input id="ss-start" type="date" className="fs-input mt-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <p className="text-xs text-on-surface-variant mt-1">
              Leave blank to project from today.
            </p>
          </div>
          <div>
            <label className="fs-label" htmlFor="ss-horizon">Horizon (years)</label>
            <input id="ss-horizon" type="number" min={1} max={80} className="fs-input mt-1 tabular" value={horizonYears} onChange={(e) => setHorizonYears(Number(e.target.value))} />
            <p className="text-xs text-on-surface-variant mt-1">
              Projection length from start date.
            </p>
          </div>
        </div>
      </form>
    </Modal>
  );
}
