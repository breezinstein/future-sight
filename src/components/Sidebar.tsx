import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, LineChart, Wallet, CalendarClock, History, Settings,
  HelpCircle, LogOut, Eye, Plus, ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useState } from 'react';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/scenarios', icon: LineChart, label: 'Scenarios' },
  { to: '/buckets', icon: Wallet, label: 'Buckets' },
  { to: '/events', icon: CalendarClock, label: 'Events' },
  { to: '/actuals', icon: History, label: 'Actuals' },
  { to: '/activity', icon: History, label: 'Activity' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const { state, signOut, setActivePlan } = useAuth();
  const navigate = useNavigate();
  const [planMenuOpen, setPlanMenuOpen] = useState(false);

  if (state.status !== 'authenticated') return null;

  const activePlan = state.plans.find((p) => p.id === state.activePlanId);

  return (
    <nav className="hidden md:flex flex-col bg-surface-container-lowest border-r border-surface-container-high h-full w-[260px] py-4 shrink-0">
      {/* Brand */}
      <div className="px-6 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-primary-container flex items-center justify-center shrink-0">
            <Eye size={20} className="text-on-primary-container" strokeWidth={2.4} />
          </div>
          <div>
            <div className="text-lg font-bold text-on-surface leading-tight">Future Sight</div>
            <div className="fs-label text-on-surface-variant text-[10px] mt-0.5">Household Wealth</div>
          </div>
        </div>
      </div>

      {/* Active plan switcher */}
      {state.plans.length > 0 && (
        <div className="px-3 mb-3 relative">
          <button
            type="button"
            onClick={() => setPlanMenuOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded bg-surface-container hover:bg-surface-container-high border border-surface-container-high text-left transition-colors"
          >
            <div className="min-w-0">
              <div className="fs-label text-on-surface-variant">Active plan</div>
              <div className="text-sm text-on-surface truncate">{activePlan?.name ?? 'No plan'}</div>
            </div>
            <ChevronDown size={16} className="text-on-surface-variant shrink-0" />
          </button>
          {planMenuOpen && (
            <div className="absolute left-3 right-3 mt-1 z-50 bg-surface-container border border-surface-container-high rounded-lg shadow-2xl py-1 fs-fade-in">
              {state.plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setActivePlan(p.id); setPlanMenuOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-container-high transition-colors flex items-center justify-between ${p.id === state.activePlanId ? 'text-primary' : 'text-on-surface'}`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="fs-label text-on-surface-variant ml-2">{p.my_role}</span>
                </button>
              ))}
              <div className="border-t border-surface-container-high my-1" />
              <button
                type="button"
                onClick={() => { setPlanMenuOpen(false); navigate('/settings/plans/new'); }}
                className="w-full text-left px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors flex items-center gap-2"
              >
                <Plus size={14} /> New plan
              </button>
            </div>
          )}
        </div>
      )}

      {/* CTA */}
      <div className="px-3 mb-4">
        <button
          type="button"
          onClick={() => navigate('/scenarios/new')}
          className="fs-btn fs-btn-primary w-full"
        >
          <Plus size={16} /> New scenario
        </button>
      </div>

      {/* Main nav */}
      <div className="flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-0.5 px-3">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded border-l-2 transition-colors group ${
                    isActive
                      ? 'bg-surface-container text-primary border-primary'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface border-transparent'
                  }`
                }
              >
                <Icon size={18} strokeWidth={2} />
                <span className="text-sm font-medium tracking-wide uppercase">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer */}
      <div className="px-3 pt-4 border-t border-surface-container-high mt-auto">
        <div className="px-3 py-2 mb-2">
          <div className="text-sm text-on-surface truncate">{state.user.name}</div>
          <div className="text-xs text-on-surface-variant truncate">{state.user.email}</div>
        </div>
        <ul className="flex flex-col gap-0.5">
          <li>
            <a className="flex items-center gap-3 px-3 py-2 rounded text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors text-sm uppercase tracking-wide" href="https://github.com/" target="_blank" rel="noreferrer">
              <HelpCircle size={18} /> Help
            </a>
          </li>
          <li>
            <button
              type="button"
              onClick={signOut}
              className="w-full flex items-center gap-3 px-3 py-2 rounded text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors text-sm uppercase tracking-wide"
            >
              <LogOut size={18} /> Sign out
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}
