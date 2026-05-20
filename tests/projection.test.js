import { describe, it, expect } from 'vitest';
import { projectBucket, projectScenario, computeMilestones } from '../server/lib/projection.js';

describe('projectBucket', () => {
  const start = new Date('2025-01-01');

  it('grows zero with no return and no contributions', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 1000, expected_return: 0, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const series = projectBucket(bucket, [], [], start, 12);
    expect(series[0].balance).toBeCloseTo(1000);
    expect(series[12].balance).toBeCloseTo(1000);
  });

  it('compounds monthly correctly', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 1000, expected_return: 0.12, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const series = projectBucket(bucket, [], [], start, 12);
    // 12% nominal / monthly compounding => (1.01)^12 ≈ 1.12683
    expect(series[12].balance).toBeCloseTo(1126.83, 1);
  });

  it('compounds annually equivalent to (1+r)^n at year boundaries', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 1000, expected_return: 0.07, compounding: 'annual',
      target_amount: null, target_date: null,
    };
    const series = projectBucket(bucket, [], [], start, 24);
    // 2 years at 7% annual => 1000 * 1.07^2 = 1144.9
    expect(series[24].balance).toBeCloseTo(1144.9, 0);
  });

  it('annual compounding stays flat between year boundaries', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 1000, expected_return: 0.10, compounding: 'annual',
      target_amount: null, target_date: null,
    };
    const series = projectBucket(bucket, [], [], start, 24);
    // Months 1..11 should all equal the starting balance.
    for (let m = 1; m <= 11; m++) {
      expect(series[m].balance).toBeCloseTo(1000);
    }
    // Year 1 boundary applies interest exactly once.
    expect(series[12].balance).toBeCloseTo(1100);
    // Months 13..23 should equal the year-1 balance.
    for (let m = 13; m <= 23; m++) {
      expect(series[m].balance).toBeCloseTo(1100);
    }
    // Year 2 boundary compounds again.
    expect(series[24].balance).toBeCloseTo(1210);
  });

  it('annual vs monthly compounding produce different end-of-year totals (effective rate)', () => {
    const make = (compounding) => ({
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 10_000, expected_return: 0.12, compounding,
      target_amount: null, target_date: null,
    });
    const annual = projectBucket(make('annual'), [], [], start, 12);
    const monthly = projectBucket(make('monthly'), [], [], start, 12);
    // Annual: 10000 * 1.12 = 11200 exactly
    expect(annual[12].balance).toBeCloseTo(11200);
    // Monthly: 10000 * (1.01)^12 ≈ 11268.25 (higher because of intra-year compounding)
    expect(monthly[12].balance).toBeCloseTo(11268.25, 1);
    expect(monthly[12].balance).toBeGreaterThan(annual[12].balance);
  });

  it('annual compounding with monthly contributions credits year-end interest on the accumulated balance', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 1000, expected_return: 0.10, compounding: 'annual',
      target_amount: null, target_date: null,
    };
    const schedules = [
      { bucket_id: 1, amount: 100, cadence: 'monthly', start_date: '2025-01-01', end_date: null },
    ];
    const series = projectBucket(bucket, schedules, [], start, 12);
    // Months 1..11: 1000 + (100 * m) — no interest yet.
    expect(series[11].balance).toBeCloseTo(1000 + 100 * 11);
    // Month 12: apply 10% interest to the balance at month 12-1 (which already
    // had 11 contributions added), then add this month's contribution.
    //   pre-interest balance at start of step 12 = 1000 + 1100 = 2100
    //   post-interest = 2100 * 1.10 = 2310
    //   plus contribution 100 = 2410
    expect(series[12].balance).toBeCloseTo(2410);
  });

  it('applies monthly contributions', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 0, expected_return: 0, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const schedules = [
      { bucket_id: 1, amount: 100, cadence: 'monthly', start_date: '2025-01-01', end_date: null },
    ];
    const series = projectBucket(bucket, schedules, [], start, 12);
    // 12 monthly contributions of $100, no growth => $1200
    expect(series[12].balance).toBeCloseTo(1200);
  });

  it('applies one-off deposit event', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 1000, expected_return: 0, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const events = [
      { id: 1, scenario_id: 1, bucket_id: 1, type: 'deposit', amount: 500, date: '2025-06-01',
        enabled: 1, recurring: 0, cadence: null, end_date: null, new_rate: null, notes: null },
    ];
    const series = projectBucket(bucket, [], events, start, 12);
    expect(series[5].balance).toBeCloseTo(1500);
    expect(series[12].balance).toBeCloseTo(1500);
  });

  it('applies withdrawal event', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 10000, expected_return: 0, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const events = [
      { id: 1, scenario_id: 1, bucket_id: 1, type: 'withdrawal', amount: 2500, date: '2025-03-01',
        enabled: 1, recurring: 0, cadence: null, end_date: null, new_rate: null, notes: null },
    ];
    const series = projectBucket(bucket, [], events, start, 12);
    expect(series[12].balance).toBeCloseTo(7500);
  });

  it('applies rate change event from date forward', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 1000, expected_return: 0, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const events = [
      { id: 1, scenario_id: 1, bucket_id: 1, type: 'rate_change', new_rate: 0.12, date: '2025-07-01',
        enabled: 1, recurring: 0, cadence: null, end_date: null, amount: null, notes: null },
    ];
    const series = projectBucket(bucket, [], events, start, 18);
    // Month 5 (June 2025): still at 0%, balance unchanged
    expect(series[5].balance).toBeCloseTo(1000);
    // Month 6 (July 2025): first month under new rate, 1% monthly growth
    expect(series[6].balance).toBeCloseTo(1010);
    // Month 18 (July 2026): 13 months of compounding at 1% monthly
    // 1000 * 1.01^13 ≈ 1138.09
    expect(series[18].balance).toBeCloseTo(1138.09, 1);
  });

  it('ignores disabled events', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 1000, expected_return: 0, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const events = [
      { id: 1, scenario_id: 1, bucket_id: 1, type: 'deposit', amount: 500, date: '2025-06-01',
        enabled: 0, recurring: 0, cadence: null, end_date: null, new_rate: null, notes: null },
    ];
    const series = projectBucket(bucket, [], events, start, 12);
    expect(series[12].balance).toBeCloseTo(1000);
  });

  // ---- APR semantics ----
  it('treats expected_return as APR — 12% APR monthly = 1% per month', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 10000, expected_return: 0.12, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const series = projectBucket(bucket, [], [], start, 12);
    expect(series[1].balance).toBeCloseTo(10100);          // +1% one month
    expect(series[12].balance).toBeCloseTo(11268.25, 1);   // (1.01)^12
  });

  it('treats expected_return as APR — 15% APR annual = +15% at year boundary', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 10000, expected_return: 0.15, compounding: 'annual',
      target_amount: null, target_date: null,
    };
    const series = projectBucket(bucket, [], [], start, 24);
    expect(series[11].balance).toBeCloseTo(10000);   // flat
    expect(series[12].balance).toBeCloseTo(11500);   // exactly +15%
    expect(series[24].balance).toBeCloseTo(13225);   // 1.15^2
  });

  // ---- Escalating amounts ----
  it('escalates a recurring monthly withdrawal at 3% annual', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 100_000, expected_return: 0, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const events = [
      { id: 1, scenario_id: 1, bucket_id: 1, type: 'withdrawal', amount: 1000,
        date: '2025-01-01', enabled: 1, recurring: 1, cadence: 'monthly',
        end_date: null, new_rate: null, escalation_rate: 0.03, notes: null },
    ];
    const series = projectBucket(bucket, [], events, start, 24);
    // Month 1: first withdrawal of $1000 × 1.03^(1/12) ≈ $1002.47
    expect(series[1].balance).toBeCloseTo(100_000 - 1000 * Math.pow(1.03, 1 / 12), 1);
    // Month 12: this occurrence's amount = $1000 × 1.03^1 = $1030
    const expected12 = 100_000 - sumEscalated(1000, 0.03, 12);
    expect(series[12].balance).toBeCloseTo(expected12, 0);
    // Month 24: this occurrence's amount = $1000 × 1.03^2 = $1060.90
    const expected24 = 100_000 - sumEscalated(1000, 0.03, 24);
    expect(series[24].balance).toBeCloseTo(expected24, 0);
  });

  it('escalates a recurring annual deposit at 5%', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 0, expected_return: 0, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const events = [
      { id: 1, scenario_id: 1, bucket_id: 1, type: 'deposit', amount: 5000,
        date: '2025-01-01', enabled: 1, recurring: 1, cadence: 'annual',
        end_date: null, new_rate: null, escalation_rate: 0.05, notes: null },
    ];
    const series = projectBucket(bucket, [], events, start, 36);
    expect(series[11].balance).toBeCloseTo(0);
    expect(series[12].balance).toBeCloseTo(5250);                                  // 5000 × 1.05
    expect(series[24].balance).toBeCloseTo(5250 + 5512.50);                        // + 5000 × 1.05^2
    expect(series[36].balance).toBeCloseTo(5250 + 5512.50 + 5788.125, 1);          // + 5000 × 1.05^3
  });

  it('no escalation when escalation_rate is null (back-compat)', () => {
    const bucket = {
      id: 1, name: 'Test', currency: 'USD',
      starting_balance: 0, expected_return: 0, compounding: 'monthly',
      target_amount: null, target_date: null,
    };
    const events = [
      { id: 1, scenario_id: 1, bucket_id: 1, type: 'deposit', amount: 100,
        date: '2025-01-01', enabled: 1, recurring: 1, cadence: 'monthly',
        end_date: null, new_rate: null, escalation_rate: null, notes: null },
    ];
    const series = projectBucket(bucket, [], events, start, 12);
    expect(series[12].balance).toBeCloseTo(1200);
  });
});

function sumEscalated(base, annual, months) {
  let total = 0;
  for (let m = 1; m <= months; m++) {
    total += base * Math.pow(1 + annual, m / 12);
  }
  return total;
}

describe('projectScenario', () => {
  it('aggregates multiple buckets and converts currencies', () => {
    const out = projectScenario({
      scenario: { id: 1, horizon_years: 1 },
      buckets: [
        { id: 1, name: 'USD', currency: 'USD', starting_balance: 1000, expected_return: 0, compounding: 'monthly' },
        { id: 2, name: 'EUR', currency: 'EUR', starting_balance: 500, expected_return: 0, compounding: 'monthly' },
      ],
      contributionsByBucket: { 1: [], 2: [] },
      events: [],
      baseCurrency: 'USD',
      fxRates: { USD: 1, EUR: 1.10 }, // 1 EUR = 1.10 USD
    });
    // Aggregate at month 0 = 1000 + 500*1.10 = 1550
    expect(out.aggregate[0].balance).toBeCloseTo(1550);
  });
});

describe('computeMilestones', () => {
  it('detects on-track milestone', () => {
    const projection = {
      buckets: [
        {
          bucketId: 1, name: 'Goal', currency: 'USD',
          targetAmount: 1500, targetDate: '2026-12-31',
          series: [
            { date: '2025-01-01', balance: 1000 },
            { date: '2026-01-01', balance: 1200 },
            { date: '2026-06-01', balance: 1500 },
            { date: '2027-01-01', balance: 1700 },
          ],
        },
      ],
    };
    const milestones = computeMilestones(projection);
    expect(milestones[0].projectedHitDate).toBe('2026-06-01');
    expect(milestones[0].status).toBe('on_track');
  });

  it('detects drifting milestone (hits after target)', () => {
    const projection = {
      buckets: [
        {
          bucketId: 1, name: 'Goal', currency: 'USD',
          targetAmount: 1500, targetDate: '2025-06-01',
          series: [
            { date: '2025-01-01', balance: 1000 },
            { date: '2026-01-01', balance: 1500 },
          ],
        },
      ],
    };
    const milestones = computeMilestones(projection);
    expect(milestones[0].status).toBe('drifting');
  });
});
