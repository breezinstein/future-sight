/**
 * Shared helpers for the chart view-range control. Projections are monthly
 * series ordered from a start point forward, so a preset "range" is the first N
 * months (index 0 is the start, index 12 is +1 year, etc.). A custom range is
 * an explicit start/end date window (inclusive). `months === null` means show
 * the full series.
 */

export interface ChartRange {
  label: string;
  months: number | null; // null = entire series
}

/**
 * The selected view range. Either a preset length from the series start, or an
 * explicit custom [start, end] date window (ISO yyyy-MM-dd, inclusive).
 */
export type ChartRangeValue =
  | { kind: 'preset'; months: number | null }
  | { kind: 'custom'; start: string; end: string };

/** Default selection: the entire series. */
export const FULL_RANGE: ChartRangeValue = { kind: 'preset', months: null };

const RANGE_PRESETS: ChartRange[] = [
  { label: '1Y', months: 12 },
  { label: '3Y', months: 36 },
  { label: '5Y', months: 60 },
  { label: '10Y', months: 120 },
  { label: '20Y', months: 240 },
];

const MAX_RANGE: ChartRange = { label: 'Max', months: null };

/**
 * Build the set of range presets applicable to a series of `totalMonths`.
 * Only presets shorter than the full series are offered (a preset equal to or
 * longer than the series would be identical to "Max"), with "Max" always last.
 */
export function rangePresetsFor(totalMonths: number): ChartRange[] {
  const applicable = RANGE_PRESETS.filter(
    (r) => r.months !== null && r.months < totalMonths,
  );
  return [...applicable, MAX_RANGE];
}

/**
 * Slice a date-ordered series to the first `months` from its start. Returns the
 * original array when `months` is null or covers the whole series. Includes the
 * boundary point (e.g. 12 months -> 13 points: the start plus 12 steps).
 */
export function sliceByRange<T>(data: T[], months: number | null): T[] {
  if (months === null || months + 1 >= data.length) return data;
  return data.slice(0, months + 1);
}

/**
 * Apply a {@link ChartRangeValue} to a date-ordered series. Presets slice the
 * first N months from the start; custom windows filter to the inclusive
 * [start, end] date range.
 */
export function applyRange<T extends { date: string }>(
  data: T[],
  value: ChartRangeValue,
): T[] {
  if (value.kind === 'custom') {
    return data.filter((d) => d.date >= value.start && d.date <= value.end);
  }
  return sliceByRange(data, value.months);
}
