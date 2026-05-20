/**
 * FX rates with two-provider fallback chain:
 *   1. frankfurter.app — ECB-backed, supports ~30 major currencies, has history.
 *   2. open.er-api.com  — broader coverage (incl. NGN, KES, GHS, etc.) for the
 *      "latest" date; no historical rates.
 *
 * Both are free, no API key. We cache results in fx_cache regardless of source.
 *
 * Endpoints:
 *   https://api.frankfurter.app/latest?from=USD&to=EUR
 *   https://api.frankfurter.app/2024-01-15?from=USD&to=EUR
 *   https://open.er-api.com/v6/latest/USD
 */

import { db } from '../db/database.js';

const TTL_LATEST_MS = 6 * 60 * 60 * 1000;   // 6h for "latest" rates
const FRANKFURTER = 'https://api.frankfurter.app';
const OPEN_ER_API = 'https://open.er-api.com/v6';

// Frankfurter's full supported list (from https://www.frankfurter.app/docs/).
const FRANKFURTER_SUPPORTED = new Set([
  'AUD','BGN','BRL','CAD','CHF','CNY','CZK','DKK','EUR','GBP','HKD','HUF',
  'IDR','ILS','INR','ISK','JPY','KRW','MXN','MYR','NOK','NZD','PHP','PLN',
  'RON','SEK','SGD','THB','TRY','USD','ZAR',
]);

async function fetchFromFrankfurter(base, quote, date) {
  if (!FRANKFURTER_SUPPORTED.has(base) || !FRANKFURTER_SUPPORTED.has(quote)) return null;
  const url = `${FRANKFURTER}/${date}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.[quote];
  if (typeof rate !== 'number') throw new Error('Bad frankfurter response');
  return rate;
}

async function fetchFromOpenErApi(base, quote, date) {
  // open.er-api.com only supports latest; historical requires a paid plan.
  if (date !== 'latest') return null;
  const url = `${OPEN_ER_API}/latest/${encodeURIComponent(base)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`open.er-api HTTP ${res.status}`);
  const data = await res.json();
  if (data?.result !== 'success') throw new Error(`open.er-api: ${data?.['error-type'] ?? 'unknown error'}`);
  const rate = data?.rates?.[quote];
  if (typeof rate !== 'number') throw new Error(`open.er-api: no rate for ${quote}`);
  return rate;
}

/**
 * Get FX rate (1 base = X quote). Returns 1 when base === quote.
 */
export async function getFxRate(base, quote, date = 'latest') {
  if (!base || !quote) return 1;
  if (base === quote) return 1;

  const cached = db
    .prepare('SELECT rate, fetched_at FROM fx_cache WHERE base = ? AND quote = ? AND date = ?')
    .get(base, quote, date);

  if (cached) {
    if (date !== 'latest') return cached.rate; // historical never expires
    const age = Date.now() - new Date(cached.fetched_at + 'Z').getTime();
    if (age < TTL_LATEST_MS) return cached.rate;
  }

  // Provider fallback chain. Each call may return null (skip) or throw (try next).
  const providers = [fetchFromFrankfurter, fetchFromOpenErApi];
  let rate = null;
  for (const fn of providers) {
    try {
      const r = await fn(base, quote, date);
      if (r != null) { rate = r; break; }
    } catch (e) {
      console.warn(`[fx] ${fn.name} failed for ${base}->${quote}:`, e.message);
    }
  }

  if (rate == null) {
    if (cached) return cached.rate; // stale-but-better-than-nothing fallback
    console.warn(`[fx] no provider returned a rate for ${base}->${quote}; defaulting to 1`);
    return 1;
  }

  db.prepare(
    `INSERT INTO fx_cache (base, quote, date, rate, fetched_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(base, quote, date) DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at`,
  ).run(base, quote, date, rate);

  return rate;
}

/**
 * Get a map of { currency: rateToBase } for a set of currencies.
 */
export async function getFxMap(base, currencies, date = 'latest') {
  const unique = Array.from(new Set(currencies)).filter(Boolean);
  const out = {};
  await Promise.all(
    unique.map(async (c) => {
      out[c] = await getFxRate(c, base, date);
    }),
  );
  return out;
}

// Union of currencies we expose in the UI. Frankfurter handles the first chunk;
// open.er-api.com covers the rest. We've kept the list to the most commonly
// used currencies — open.er-api.com supports far more if needed.
const SUPPORTED = [
  // G10 + major
  'USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD',
  // Europe
  'SEK','NOK','DKK','PLN','CZK','HUF','RON','BGN','ISK','TRY','RUB','UAH',
  // Asia
  'CNY','HKD','SGD','KRW','INR','IDR','THB','MYR','PHP','VND','PKR','BDT','LKR','TWD',
  // Middle East
  'AED','SAR','QAR','ILS','EGP',
  // Africa
  'NGN','KES','GHS','ZAR','MAD','TND','UGX','TZS','RWF','XOF','XAF',
  // Americas
  'MXN','BRL','ARS','CLP','COP','PEN','UYU',
];

export function supportedCurrencies() {
  return SUPPORTED;
}
