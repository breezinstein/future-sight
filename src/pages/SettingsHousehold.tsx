import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { plans as plansApi } from '@/api';
import type { PlanMember, Role } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { FullPageSpinner, Spinner } from '@/components/Spinner';

export function SettingsHousehold() {
  const { state } = useAuth();
  const { show } = useToast();
  const planId = state.status === 'authenticated' ? state.activePlanId : null;
  const myRole = state.status === 'authenticated' ? state.plans.find((p) => p.id === planId)?.my_role : null;
  const canManage = myRole === 'owner';

  const [members, setMembers] = useState<PlanMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    const rows = await plansApi.members.list(planId);
    setMembers(rows);
    setLoading(false);
  }, [planId]);
  useEffect(() => { load(); }, [load]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!planId) return;
    setAdding(true);
    try {
      await plansApi.members.add(planId, email, role);
      show(`Added ${email}`, 'success');
      setEmail('');
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to add member', 'error');
    } finally {
      setAdding(false);
    }
  }
  async function onChangeRole(userId: number, newRole: Role) {
    if (!planId) return;
    try {
      await plansApi.members.setRole(planId, userId, newRole);
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Role change failed', 'error');
    }
  }
  async function onRemove(userId: number) {
    if (!planId) return;
    if (!confirm('Remove this member from the plan?')) return;
    try {
      await plansApi.members.remove(planId, userId);
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Remove failed', 'error');
    }
  }

  if (loading) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <section className="fs-card p-6">
        <h2 className="text-base font-semibold text-on-surface mb-1">Members</h2>
        <p className="text-sm text-on-surface-variant mb-4">
          People in this household. Owners can edit settings & manage members; editors can edit data; viewers can only read.
        </p>
        <div className="divide-y divide-surface-container-high">
          {members.map((m) => (
            <div key={m.id} className="py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-sm font-medium text-on-surface shrink-0">
                {m.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-on-surface truncate">{m.name}</div>
                <div className="text-xs text-on-surface-variant truncate">{m.email}</div>
              </div>
              {canManage ? (
                <select
                  className="fs-input w-32"
                  value={m.role}
                  onChange={(e) => onChangeRole(m.id, e.target.value as Role)}
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className="fs-label capitalize">{m.role}</span>
              )}
              {canManage && (
                <button type="button" onClick={() => onRemove(m.id)} className="p-2 text-on-surface-variant hover:text-error" aria-label="Remove">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {canManage && (
        <section className="fs-card p-6">
          <h2 className="text-base font-semibold text-on-surface mb-1">Add member</h2>
          <p className="text-sm text-on-surface-variant mb-4">
            The user must already have a Future Sight account. Ask them to sign up first, then add their email here.
          </p>
          <form onSubmit={onAdd} className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-6">
              <label className="fs-label">Email</label>
              <input type="email" required className="fs-input mt-1" placeholder="partner@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="col-span-3">
              <label className="fs-label">Role</label>
              <select className="fs-input mt-1" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <div className="col-span-3">
              <button type="submit" disabled={adding || !email} className="fs-btn fs-btn-primary w-full">
                {adding ? <Spinner /> : <><UserPlus size={14} /> Invite</>}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
