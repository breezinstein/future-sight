import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/settings', label: 'General', end: true },
  { to: '/settings/household', label: 'Household & sharing', end: false },
];

export function SettingsLayout() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-on-surface">Settings</h1>
      </header>
      <div className="border-b border-surface-container-high flex gap-1">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
                isActive ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
