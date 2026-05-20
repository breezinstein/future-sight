/**
 * Number / currency / date formatting helpers.
 */

export function formatCurrency(amount: number, currency = 'USD', opts: Intl.NumberFormatOptions = {}) {
  const isInt = Math.abs(amount - Math.round(amount)) < 0.005;
  const merged: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: 2,
    ...opts,
  };
  // Intl.NumberFormat throws if minimumFractionDigits > maximumFractionDigits,
  // which happens whenever a caller passes maximumFractionDigits: 0 (common for
  // compact display) while the default minimumFractionDigits is 2 for a non-int
  // amount. Clamp min down to match max.
  if (
    merged.minimumFractionDigits != null &&
    merged.maximumFractionDigits != null &&
    merged.minimumFractionDigits > merged.maximumFractionDigits
  ) {
    merged.minimumFractionDigits = merged.maximumFractionDigits;
  }
  try {
    return new Intl.NumberFormat(undefined, merged).format(amount);
  } catch {
    // Last-resort fallback if the currency code is unknown to the Intl runtime.
    return `${currency} ${amount.toFixed(merged.maximumFractionDigits ?? 2)}`;
  }
}

export function formatCompactCurrency(amount: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

export function formatPercent(value: number, fractionDigits = 1) {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatYearMonth(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

export function formatRelativeFromNow(iso: string) {
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  return formatDate(iso);
}

// Priority currencies surface first; everything else is alphabetical.
// Tweak this list to your audience.
const PRIORITY_CURRENCIES = ['NGN', 'USD', 'GBP'];

/**
 * Sort a list of ISO currency codes so that priority codes appear first
 * (in priority order), followed by the rest alphabetically. The original
 * list is not mutated.
 */
export function sortCurrencies(currencies: string[]): string[] {
  const set = new Set(currencies);
  const priority = PRIORITY_CURRENCIES.filter((c) => set.has(c));
  const rest = currencies
    .filter((c) => !PRIORITY_CURRENCIES.includes(c))
    .sort((a, b) => a.localeCompare(b));
  return [...priority, ...rest];
}

export function todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
