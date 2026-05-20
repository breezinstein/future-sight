// Shared API types. Mirror the backend response shapes.

export interface User {
  id: number;
  email: string;
  name: string;
}

export type Role = 'owner' | 'editor' | 'viewer';

export interface Plan {
  id: number;
  name: string;
  base_currency: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  version: number;
  my_role: Role;
}

export interface PlanMember {
  id: number;
  email: string;
  name: string;
  role: Role;
  joined_at: string;
}

export interface Scenario {
  id: number;
  plan_id: number;
  name: string;
  description: string | null;
  is_base: 0 | 1;
  cloned_from_scenario_id: number | null;
  horizon_years: number;
  start_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bucket {
  id: number;
  scenario_id: number;
  name: string;
  category: string | null;
  currency: string;
  starting_balance: number;
  expected_return: number;
  compounding: 'monthly' | 'annual';
  target_amount: number | null;
  target_date: string | null;
  icon: string;
  color: string;
  sort_order: number;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

export type EventType = 'deposit' | 'withdrawal' | 'rate_change' | 'contribution_change';

export type Cadence = 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'biennial';

export interface PlanEvent {
  id: number;
  scenario_id: number;
  bucket_id: number | null;
  type: EventType;
  date: string;
  amount: number | null;
  new_rate: number | null;
  recurring: 0 | 1;
  cadence: Cadence | null;
  end_date: string | null;
  escalation_rate: number | null;
  enabled: 0 | 1;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Actual {
  id: number;
  bucket_id: number;
  date: string;
  balance: number;
  notes: string | null;
  created_by: number | null;
  created_at: string;
}

export interface ProjectionPoint {
  date: string;
  balance: number;
  contribution?: number;
  rate?: number;
}

export interface BucketSeries {
  bucketId: number;
  name: string;
  currency: string;
  category: string | null;
  icon: string;
  color: string;
  targetAmount: number | null;
  targetDate: string | null;
  series: ProjectionPoint[];
}

export interface Projection {
  horizonMonths: number;
  startDate: string;
  baseCurrency: string;
  fxRates: Record<string, number>;
  buckets: BucketSeries[];
  aggregate: ProjectionPoint[];
}

export interface Milestone {
  bucketId: number;
  name: string;
  icon: string;
  targetAmount: number;
  targetDate: string | null;
  projectedHitDate: string | null;
  currentBalance: number;
  onTrack: boolean;
  status: 'on_track' | 'drifting' | 'unreachable';
}

export interface ProjectionResponse {
  scenario: Scenario;
  projection: Projection;
  milestones: Milestone[];
}

export interface CompareResponse {
  baseCurrency: string;
  horizonYears: number[];
  scenarios: Array<{
    scenario: Scenario;
    projection: Projection;
    milestones: Milestone[];
    checkpoints: Array<{ years: number; balance: number; date: string }>;
  }>;
}

export interface ActivityEntry {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: unknown;
  created_at: string;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
}
