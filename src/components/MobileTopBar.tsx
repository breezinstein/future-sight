import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X, Eye, LayoutDashboard, LineChart, Wallet, CalendarClock, History, Settings, LogOut, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/scenarios', icon: LineChart, label: 'Scenarios' },
  { to: '/buckets', icon: Wallet, label: 'Buckets' },
  { to: '/events', icon: CalendarClock, label: 'Events' },
  { to: '/actuals', icon: History, label: 'Actuals' },
  { to: '/activity', icon: History, label: 'Activity' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function MobileTopBar() {
  const { state, signOut, setActivePlan } = useAuth();
  const [open, setOpen] = useState(false);

  const plans = state.status === 'authenticated' ? state.plans : [];
  const activePlanId = state.status === 'authenticated' ? state.activePlanId : null;
  const activePlan = plans.find((p) => p.id === activePlanId);

  return (
    <>
      <header className="md:hidden flex justify-between items-center w-full px-4 h-14 bg-surface border-b border-surface-container-high fixed top-0 left-0 z-40">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-primary-container flex items-center justify-center">
            <Eye size={16} className="text-on-primary-container" strokeWidth={2.4} />
          </div>
          <span className="font-bold text-on-surface">Future Sight</span>
        </Link>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="text-on-surface-variant p-2 hover:text-on-surface"
        >
          <Menu size={22} />
        </button>
      </header>

      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm fs-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="absolute right-0 top-0 h-full w-72 bg-surface-container-lowest border-l border-surface-container-high p-4 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <span className="font-bold text-on-surface">Menu</span>
              <button type="button" onClick={() => setOpen(false)} className="text-on-surface-variant hover:text-on-surface">
                <X size={20} />
              </button>
            </div>
            {plans.length > 0 && (
              <div className="mb-4">
                <div className="fs-label text-on-surface-variant mb-1.5">Active plan</div>
                <div className="flex flex-col gap-1">
                  {plans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setActivePlan(p.id); setOpen(false); }}
                      className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between transition-colors ${
                        p.id === activePlanId
                          ? 'bg-surface-container text-primary'
                          : 'text-on-surface hover:bg-surface-container'
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="fs-label text-on-surface-variant ml-2 shrink-0">{p.my_role}</span>
                    </button>
                  ))}
                  <Link
                    to="/settings/plans/new"
                    onClick={() => setOpen(false)}
                    className="w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                  >
                    <Plus size={14} /> New plan
                  </Link>
                </div>
                {activePlan && (
                  <div className="border-t border-surface-container-high mt-3" />
                )}
              </div>
            )}
            <ul className="flex flex-col gap-1 flex-1">
              {NAV.map(({ to, icon: Icon, label, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded text-sm uppercase tracking-wide ${
                        isActive ? 'bg-surface-container text-primary' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`
                    }
                  >
                    <Icon size={18} />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => { setOpen(false); signOut(); }}
              className="fs-btn fs-btn-secondary w-full"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
