import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import type { ChartRange, ChartRangeValue } from '@/lib/chartRange';
import { useDismissible } from '@/hooks/useDismissible';

interface Props {
  presets: ChartRange[];
  value: ChartRangeValue;
  onChange: (value: ChartRangeValue) => void;
  /** First date available in the series (ISO yyyy-MM-dd). */
  minDate: string;
  /** Last date available in the series (ISO yyyy-MM-dd). */
  maxDate: string;
  className?: string;
  label?: string;
}

/**
 * Segmented control for picking a chart's visible time range. Offers length
 * presets plus a "Custom" option that opens a start/end date picker. Renders
 * nothing when the series is too short to subdivide.
 */
export function ChartRangeControl({
  presets,
  value,
  onChange,
  minDate,
  maxDate,
  className = '',
  label = 'View range',
}: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const onBackdropClick = useDismissible(customOpen, () => setCustomOpen(false));

  if (presets.length <= 1) return null;

  const isCustom = value.kind === 'custom';
  const customStart = isCustom ? value.start : minDate;
  const customEnd = isCustom ? value.end : maxDate;

  function selectPreset(months: number | null) {
    setCustomOpen(false);
    onChange({ kind: 'preset', months });
  }

  function toggleCustom() {
    if (!isCustom) {
      // Seed the custom window with the full series on first open.
      onChange({ kind: 'custom', start: minDate, end: maxDate });
    }
    setCustomOpen((o) => !o);
  }

  function updateCustom(next: { start?: string; end?: string }) {
    let start = next.start ?? customStart;
    let end = next.end ?? customEnd;
    // Keep the window ordered and clamped to the series bounds.
    if (start < minDate) start = minDate;
    if (end > maxDate) end = maxDate;
    if (start > end) {
      if (next.start !== undefined) end = start;
      else start = end;
    }
    onChange({ kind: 'custom', start, end });
  }

  return (
    <div className={`relative inline-flex ${className}`}>
      <div
        className="inline-flex items-center gap-0.5 rounded bg-surface-container p-0.5"
        role="group"
        aria-label={label}
      >
        {presets.map((p) => {
          const active = value.kind === 'preset' && value.months === p.months;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => selectPreset(p.months)}
              aria-pressed={active}
              className={`px-2 py-0.5 rounded text-xs tabular transition-colors ${
                active
                  ? 'bg-surface-container-highest text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={toggleCustom}
          aria-pressed={isCustom}
          aria-haspopup="dialog"
          aria-expanded={customOpen}
          title="Custom date range"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
            isCustom
              ? 'bg-surface-container-highest text-on-surface'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <CalendarRange size={12} />
          Custom
        </button>
      </div>

      {customOpen && (
        <>
          {/* Click-away backdrop. */}
          <div className="fixed inset-0 z-40" onClick={onBackdropClick} />
          <div
            role="dialog"
            aria-label="Custom date range"
            className="absolute right-0 top-full mt-1 z-50 w-64 bg-surface-container border border-surface-container-high rounded-lg shadow-2xl p-3 fs-fade-in"
          >
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="fs-label text-on-surface-variant">From</span>
                <input
                  type="date"
                  className="fs-input"
                  value={customStart}
                  min={minDate}
                  max={customEnd}
                  onChange={(e) => updateCustom({ start: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="fs-label text-on-surface-variant">To</span>
                <input
                  type="date"
                  className="fs-input"
                  value={customEnd}
                  min={customStart}
                  max={maxDate}
                  onChange={(e) => updateCustom({ end: e.target.value })}
                />
              </label>
              <div className="flex justify-between items-center pt-1">
                <button
                  type="button"
                  onClick={() => selectPreset(null)}
                  className="text-xs text-on-surface-variant hover:text-on-surface"
                >
                  Reset to Max
                </button>
                <button
                  type="button"
                  onClick={() => setCustomOpen(false)}
                  className="fs-btn fs-btn-ghost text-xs"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
