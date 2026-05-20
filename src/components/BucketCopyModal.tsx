import { useEffect, useState, type FormEvent } from 'react';
import { plans as plansApi, buckets as bucketsApi } from '@/api';
import type { Bucket, Scenario } from '@/types';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { useToast } from '@/context/ToastContext';

interface Props {
  bucket: Bucket;
  currentScenarioId: number;
  planId: number;
  onClose: () => void;
  onCopied: (newBucketId: number, targetScenarioId: number) => void;
}

export function BucketCopyModal({ bucket, currentScenarioId, planId, onClose, onCopied }: Props) {
  const { show } = useToast();
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [targetScenarioId, setTargetScenarioId] = useState<number | ''>('');
  const [name, setName] = useState(bucket.name);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    plansApi.get(planId).then((p) => {
      setScenarios(p.scenarios);
      // Default to first scenario other than the current one, or current if it's the only one.
      const other = p.scenarios.find((s) => s.id !== currentScenarioId);
      setTargetScenarioId((other ?? p.scenarios[0])?.id ?? '');
    });
  }, [planId, currentScenarioId]);

  // If the user picks the same scenario, suggest a "(copy)" suffix to avoid
  // identical sibling names — they're technically allowed but visually confusing.
  const sameScenario = targetScenarioId === currentScenarioId;
  useEffect(() => {
    if (sameScenario && name === bucket.name) {
      setName(`${bucket.name} (copy)`);
    } else if (!sameScenario && name === `${bucket.name} (copy)`) {
      setName(bucket.name);
    }
  }, [sameScenario, bucket.name]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (targetScenarioId === '') return;
    setSubmitting(true);
    try {
      const { id } = await bucketsApi.copy(bucket.id, Number(targetScenarioId), name.trim() || undefined);
      const targetName = scenarios?.find((s) => s.id === Number(targetScenarioId))?.name ?? 'scenario';
      show(`Copied "${bucket.name}" to ${targetName}`, 'success');
      onCopied(id, Number(targetScenarioId));
    } catch (err) {
      show(err instanceof Error ? err.message : 'Copy failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Copy "${bucket.name}"`}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className="fs-btn fs-btn-ghost">Cancel</button>
          <button type="submit" form="bucket-copy-form" disabled={submitting || targetScenarioId === ''} className="fs-btn fs-btn-primary">
            {submitting ? <Spinner /> : 'Copy bucket'}
          </button>
        </>
      }
    >
      {!scenarios ? <Spinner /> : (
        <form id="bucket-copy-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-on-surface-variant">
            Creates an independent copy of this bucket — including its contribution schedules,
            recorded actuals, and bucket-scoped events — in the scenario you pick.
          </p>
          <div>
            <label className="fs-label" htmlFor="bc-scenario">Target scenario</label>
            <select
              id="bc-scenario"
              className="fs-input mt-1"
              value={targetScenarioId}
              onChange={(e) => setTargetScenarioId(e.target.value === '' ? '' : Number(e.target.value))}
              required
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.is_base ? ' (base)' : ''}{s.id === currentScenarioId ? ' — same scenario' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="fs-label" htmlFor="bc-name">New bucket name</label>
            <input
              id="bc-name"
              className="fs-input mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
        </form>
      )}
    </Modal>
  );
}
