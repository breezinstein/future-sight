import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Upload, History as HistoryIcon } from 'lucide-react';
import { plans as plansApi, scenarios as scenariosApi, buckets as bucketsApi } from '@/api';
import type { Actual, Bucket, Scenario } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { FullPageSpinner } from '@/components/Spinner';
import { formatCurrency, formatDate } from '@/lib/format';
import { Modal } from '@/components/Modal';

interface Row { scenario: Scenario; buckets: Bucket[]; actualsByBucket: Record<number, Actual[]> }

export function ActualsPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const planId = state.status === 'authenticated' ? state.activePlanId : null;
  const [rows, setRows] = useState<Row[] | null>(null);

  const [importingFor, setImportingFor] = useState<{ scenario: Scenario; bucket: Bucket } | null>(null);
  const [csvText, setCsvText] = useState('');

  const load = useCallback(async () => {
    if (!planId) return;
    const plan = await plansApi.get(planId);
    const result = await Promise.all(
      plan.scenarios.map(async (s) => {
        const detail = await scenariosApi.get(s.id);
        const entries = await Promise.all(
          detail.buckets.map(async (b) => [b.id, await bucketsApi.actuals.list(b.id)] as const),
        );
        return { scenario: s, buckets: detail.buckets, actualsByBucket: Object.fromEntries(entries) };
      }),
    );
    setRows(result);
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  async function doImport() {
    if (!importingFor || !csvText.trim()) return;
    const { imported, errors } = await bucketsApi.actuals.importCsv(importingFor.bucket.id, csvText);
    show(`Imported ${imported} row${imported === 1 ? '' : 's'}${errors.length ? ` (${errors.length} skipped)` : ''}`, errors.length ? 'warning' : 'success');
    setImportingFor(null);
    setCsvText('');
    load();
  }

  if (rows === null) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">Actuals</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">Recorded balances over time. Import via CSV or record manually in a bucket.</p>
        </div>
      </header>

      {rows.every((r) => Object.values(r.actualsByBucket).every((l) => l.length === 0)) && (
        <div className="fs-card p-12 text-center text-on-surface-variant">
          <HistoryIcon size={24} className="mx-auto mb-3" />
          No actuals recorded yet. Open a bucket to add one, or import a CSV.
        </div>
      )}

      {rows.map(({ scenario, buckets, actualsByBucket }) =>
        buckets.map((b) => {
          const list = actualsByBucket[b.id] ?? [];
          return (
            <section key={`${scenario.id}-${b.id}`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-on-surface">
                  <Link to={`/scenarios/${scenario.id}?bucket=${b.id}`} className="hover:text-primary">{b.name}</Link>
                  <span className="text-on-surface-variant"> · {scenario.name}</span>
                </h2>
                <div className="flex gap-2">
                  <a className="fs-btn fs-btn-ghost text-xs" href={scenariosApi.export(scenario.id, 'actuals')} target="_blank" rel="noreferrer">
                    <Download size={12} /> Export CSV
                  </a>
                  <button type="button" onClick={() => setImportingFor({ scenario, bucket: b })} className="fs-btn fs-btn-ghost text-xs">
                    <Upload size={12} /> Import CSV
                  </button>
                </div>
              </div>
              {list.length === 0 ? (
                <div className="text-xs text-on-surface-variant px-2 py-3">No actuals.</div>
              ) : (
                <div className="fs-card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-on-surface-variant border-b border-surface-container-high">
                        <th className="px-4 py-3 fs-label">Date</th>
                        <th className="px-4 py-3 fs-label">Balance</th>
                        <th className="px-4 py-3 fs-label">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((a) => (
                        <tr key={a.id} className="border-b border-surface-container/50">
                          <td className="px-4 py-3 tabular text-on-surface">{formatDate(a.date)}</td>
                          <td className="px-4 py-3 tabular text-on-surface">{formatCurrency(a.balance, b.currency, { maximumFractionDigits: 0 })}</td>
                          <td className="px-4 py-3 text-on-surface-variant text-xs">{a.notes ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        }),
      )}

      <Modal
        open={!!importingFor}
        onClose={() => setImportingFor(null)}
        title={`Import actuals — ${importingFor?.bucket.name ?? ''}`}
        size="lg"
        footer={
          <>
            <button type="button" onClick={() => setImportingFor(null)} className="fs-btn fs-btn-ghost">Cancel</button>
            <button type="button" onClick={doImport} disabled={!csvText.trim()} className="fs-btn fs-btn-primary">Import</button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant mb-3">
          CSV must include columns: <code className="text-primary">date</code>, <code className="text-primary">balance</code>, optionally <code className="text-primary">notes</code>.
        </p>
        <textarea
          className="fs-input font-mono text-xs h-56"
          placeholder={'date,balance,notes\n2024-01-01,10000,Initial deposit\n2024-04-01,10550,'}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
        />
      </Modal>
    </div>
  );
}
