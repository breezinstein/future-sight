import { describe, it, expect } from 'vitest';
import { formatCurrency, formatCompactCurrency } from '../src/lib/format';

describe('formatCurrency', () => {
  it('formats integer amounts without decimals', () => {
    expect(formatCurrency(1234, 'USD')).toMatch(/1,234/);
    expect(formatCurrency(1234, 'USD')).not.toMatch(/\.00/);
  });

  it('formats non-integer amounts with 2 decimals', () => {
    expect(formatCurrency(1234.5, 'USD')).toMatch(/1,234\.50/);
  });

  // Regression for "RangeError: maximumFractionDigits value is out of range"
  // — caller passes max=0 to a non-integer amount, default min=2 -> invalid.
  it('handles maximumFractionDigits: 0 on a non-integer amount', () => {
    expect(() => formatCurrency(1234.56, 'USD', { maximumFractionDigits: 0 }))
      .not.toThrow();
    expect(formatCurrency(1234.56, 'USD', { maximumFractionDigits: 0 }))
      .toMatch(/1,235/);
  });

  it('handles minimumFractionDigits: 4 (rare but legal)', () => {
    expect(() => formatCurrency(1234, 'USD', { minimumFractionDigits: 4, maximumFractionDigits: 4 }))
      .not.toThrow();
  });

  it('falls back gracefully on unknown currency codes', () => {
    // Some Intl runtimes reject obscure codes; ensure we don't crash.
    expect(() => formatCurrency(100, 'ZZZ')).not.toThrow();
  });

  it('formats Nigerian Naira (NGN)', () => {
    const out = formatCurrency(50000, 'NGN');
    expect(out).toMatch(/50,000/);
  });
});

describe('formatCompactCurrency', () => {
  it('produces compact notation', () => {
    expect(formatCompactCurrency(1_500_000, 'USD')).toMatch(/M/);
  });

  it('handles NGN without throwing', () => {
    expect(() => formatCompactCurrency(2_500_000, 'NGN')).not.toThrow();
  });
});
