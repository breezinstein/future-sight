import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  status?: 'on_track' | 'drifting' | 'unreachable' | 'neutral';
  className?: string;
}

const STATUS_COLOR: Record<NonNullable<Props['status']>, string> = {
  on_track: 'bg-secondary',
  drifting: 'bg-tertiary',
  unreachable: 'bg-error',
  neutral: 'bg-outline',
};

const STATUS_LABEL: Record<NonNullable<Props['status']>, string> = {
  on_track: 'On track',
  drifting: 'Slight drift',
  unreachable: 'Action required',
  neutral: '',
};

export function StatCard({ label, value, hint, status, className = '' }: Props) {
  return (
    <div className={`fs-card p-4 ${className}`}>
      <div className="fs-label mb-2">{label}</div>
      <div className="text-2xl font-semibold text-on-surface tabular">{value}</div>
      {(status || hint) && (
        <div className="flex items-center gap-2 mt-1">
          {status && status !== 'neutral' && (
            <span className={`fs-status-dot ${STATUS_COLOR[status]}`} aria-hidden />
          )}
          <span
            className={`text-xs ${
              status === 'on_track' ? 'text-secondary' :
              status === 'drifting' ? 'text-tertiary' :
              status === 'unreachable' ? 'text-error' :
              'text-on-surface-variant'
            }`}
          >
            {status ? STATUS_LABEL[status] : null}
            {status && hint ? ' · ' : null}
            {hint}
          </span>
        </div>
      )}
    </div>
  );
}
