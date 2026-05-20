/**
 * Future Sight projection engine.
 *
 * Simulates the growth of one or more buckets over a horizon, applying
 * contribution schedules and timeline events (deposits, withdrawals,
 * contribution changes, rate overrides).
 *
 * Steps are monthly internally; we expose monthly-granularity time series
 * which the frontend can downsample for display.
 *
 * All amounts are in the bucket's native currency. Currency conversion
 * happens at the aggregation layer using FX rates.
 */

import { addMonths, parseISO, format, differenceInMonths, isBefore, isEqual } from 'date-fns';

const CADENCE_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

/**
 * Apply interest for one monthly step.
 *
 * - **Monthly compounding:** balance multiplies by (1 + r/12) every month.
 *   Effective annual return = (1 + r/12)^12 - 1, which is slightly above r.
 * - **Annual compounding:** balance is unchanged for 11 months, then multiplies
 *   by (1 + r) once per year — at month 12, 24, 36, ... relative to the
 *   bucket's start. This matches how users intuitively model GICs, fixed-rate
 *   savings bonds, and back-of-the-envelope FV calculations. Effective annual
 *   return = r exactly. Contributions and cash-flow events that happen during
 *   the year sit in the balance and DO earn the year-end interest credit when
 *   it's applied.
 */
function applyGrowth(balance, annualRate, compounding, stepIndex) {
  if (compounding === 'annual') {
    // Year boundaries: step 12, 24, 36, ... (relative to the start of the projection).
    if (stepIndex > 0 && stepIndex % 12 === 0) {
      return balance * (1 + annualRate);
    }
    return balance;
  }
  // Monthly compounding: every step earns r/12.
  return balance * (1 + annualRate / 12);
}

/**
 * Compute the contribution for a given month-end date based on schedules.
 * Multiple active schedules are summed.
 */
function contributionForMonth(schedules, monthDate) {
  let total = 0;
  for (const s of schedules) {
    const start = parseISO(s.start_date);
    if (isBefore(monthDate, start)) continue;
    if (s.end_date) {
      const end = parseISO(s.end_date);
      if (isBefore(end, monthDate)) continue;
    }
    const months = differenceInMonths(monthDate, start);
    if (months < 0) continue;
    const step = CADENCE_MONTHS[s.cadence] || 1;
    if (months % step === 0) {
      total += s.amount;
    }
  }
  return total;
}

/**
 * Apply enabled events that fall in the given calendar month to a bucket.
 * Returns { delta, newRate } where:
 *   - delta is added to the bucket balance for this step
 *   - newRate (nullable) overrides the bucket's expected_return from this
 *     month onwards
 *
 * Recurring events are expanded — we treat them as repeating on their
 * cadence from `date` until `end_date` (or horizon end).
 *
 * Escalation: events may carry an `escalation_rate` (decimal, annual).
 * When set, the amount on the Nth occurrence is multiplied by
 *   (1 + escalation_rate)^(monthsSinceStart / 12)
 * so 3% annual escalation on a $5,000/mo withdrawal becomes $5,150/mo after
 * 12 months, $5,304/mo after 24 months, etc.
 */
function applyMonthEvents(events, bucketId, monthDate) {
  let delta = 0;
  let newRate = null;
  let contributionAdjustment = 0;

  for (const e of events) {
    if (!e.enabled) continue;
    if (e.bucket_id !== null && e.bucket_id !== bucketId) continue;

    const start = parseISO(e.date);
    if (isBefore(monthDate, start)) continue;
    if (e.end_date && isBefore(parseISO(e.end_date), monthDate)) continue;

    let triggers = false;
    if (e.recurring && e.cadence) {
      const months = differenceInMonths(monthDate, start);
      const step = CADENCE_MONTHS[e.cadence] || 1;
      triggers = months >= 0 && months % step === 0;
    } else {
      triggers = isSameYearMonth(monthDate, start);
    }

    if (!triggers && e.type !== 'rate_change' && e.type !== 'contribution_change') {
      continue;
    }

    // Escalation multiplier — only meaningful for amount-bearing event types.
    let escalationMultiplier = 1;
    if (e.escalation_rate && triggers) {
      const monthsSinceStart = differenceInMonths(monthDate, start);
      escalationMultiplier = Math.pow(1 + e.escalation_rate, monthsSinceStart / 12);
    }

    switch (e.type) {
      case 'deposit':
        if (triggers) delta += (e.amount || 0) * escalationMultiplier;
        break;
      case 'withdrawal':
        if (triggers) delta -= Math.abs((e.amount || 0) * escalationMultiplier);
        break;
      case 'rate_change':
        // Rate changes apply from the event date forward (sticky).
        if (!isBefore(monthDate, start)) {
          newRate = e.new_rate;
        }
        break;
      case 'contribution_change':
        // Permanent override of scheduled contribution from event date forward.
        if (!isBefore(monthDate, start)) {
          contributionAdjustment = e.amount || 0;
        }
        break;
      default:
        break;
    }
  }

  return { delta, newRate, contributionAdjustment };
}

function isSameYearMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Project a single bucket forward over `months` months.
 *
 * @param {object} bucket           - bucket row
 * @param {object[]} schedules      - contribution_schedules rows for this bucket
 * @param {object[]} events         - events rows relevant to this scenario
 * @param {Date} startDate          - first month of projection
 * @param {number} horizonMonths    - number of monthly steps
 * @returns {{date: string, balance: number, contribution: number, rate: number}[]}
 */
export function projectBucket(bucket, schedules, events, startDate, horizonMonths) {
  const series = [];
  let balance = bucket.starting_balance;
  let currentRate = bucket.expected_return;
  let contributionOverride = null;

  // Record the starting point.
  series.push({
    date: format(startDate, 'yyyy-MM-dd'),
    balance: roundCurrency(balance),
    contribution: 0,
    rate: currentRate,
  });

  for (let i = 1; i <= horizonMonths; i++) {
    const monthDate = addMonths(startDate, i);

    // Single pass over events for this month.
    const { delta, newRate, contributionAdjustment } = applyMonthEvents(
      events,
      bucket.id,
      monthDate,
    );
    if (newRate !== null) currentRate = newRate;
    if (contributionAdjustment !== 0) contributionOverride = contributionAdjustment;

    // 1. Apply monthly growth at the (possibly newly-overridden) rate.
    balance = applyGrowth(balance, currentRate, bucket.compounding, i);

    // 2. Apply scheduled contributions (or override).
    const scheduledContribution = contributionOverride !== null
      ? contributionOverride
      : contributionForMonth(schedules, monthDate);
    balance += scheduledContribution;

    // 3. Apply one-off cash-flow events (deposits, withdrawals).
    balance += delta;

    series.push({
      date: format(monthDate, 'yyyy-MM-dd'),
      balance: roundCurrency(balance),
      contribution: roundCurrency(scheduledContribution + Math.max(delta, 0)),
      rate: currentRate,
    });
  }

  return series;
}

/**
 * Project an entire scenario — runs each bucket and aggregates totals.
 *
 * @returns {{
 *   horizonMonths: number,
 *   startDate: string,
 *   buckets: Array<{bucketId: number, name: string, currency: string, series: ...}>,
 *   aggregate: Array<{date: string, balance: number}>   // in base currency
 * }}
 */
export function projectScenario({
  scenario,
  buckets,
  contributionsByBucket,
  events,
  baseCurrency,
  fxRates,            // { [currency]: rateToBase }
  startDate = new Date(),
}) {
  const horizonMonths = (scenario.horizon_years || 30) * 12;
  // Normalise to first-of-month for stable monthly stepping.
  const monthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

  const bucketSeries = buckets.map((b) => {
    const schedules = contributionsByBucket[b.id] || [];
    const series = projectBucket(b, schedules, events, monthStart, horizonMonths);
    return {
      bucketId: b.id,
      name: b.name,
      currency: b.currency,
      category: b.category,
      icon: b.icon,
      color: b.color,
      targetAmount: b.target_amount,
      targetDate: b.target_date,
      series,
    };
  });

  // Aggregate to base currency.
  const aggregate = [];
  for (let i = 0; i <= horizonMonths; i++) {
    let total = 0;
    for (const bs of bucketSeries) {
      const point = bs.series[i];
      if (!point) continue;
      const rate = bs.currency === baseCurrency
        ? 1
        : (fxRates[bs.currency] || 1);
      total += point.balance * rate;
    }
    aggregate.push({
      date: bucketSeries[0]?.series[i]?.date || '',
      balance: roundCurrency(total),
    });
  }

  return {
    horizonMonths,
    startDate: format(monthStart, 'yyyy-MM-dd'),
    baseCurrency,
    fxRates,
    buckets: bucketSeries,
    aggregate,
  };
}

/**
 * For each bucket with a target, compute when (if ever) the projection
 * crosses the target amount.
 */
export function computeMilestones(projection) {
  const milestones = [];
  for (const bs of projection.buckets) {
    if (!bs.targetAmount) continue;
    let hitDate = null;
    for (const p of bs.series) {
      if (p.balance >= bs.targetAmount) {
        hitDate = p.date;
        break;
      }
    }
    const onTrack = bs.targetDate && hitDate
      ? !isAfterIso(hitDate, bs.targetDate)
      : hitDate !== null;
    milestones.push({
      bucketId: bs.bucketId,
      name: bs.name,
      icon: bs.icon,
      targetAmount: bs.targetAmount,
      targetDate: bs.targetDate,
      projectedHitDate: hitDate,
      currentBalance: bs.series[0]?.balance ?? 0,
      onTrack,
      status: !hitDate
        ? 'unreachable'
        : onTrack
          ? 'on_track'
          : 'drifting',
    });
  }
  return milestones;
}

function isAfterIso(a, b) {
  const da = parseISO(a);
  const db = parseISO(b);
  return !isBefore(da, db) && !isEqual(da, db);
}

function roundCurrency(n) {
  return Math.round(n * 100) / 100;
}
