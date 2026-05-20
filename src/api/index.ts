import { api } from './client';
import type {
  User, Plan, PlanMember, Scenario, Bucket, ContributionSchedule, PlanEvent,
  Actual, ProjectionResponse, CompareResponse, ActivityEntry,
} from '@/types';

// ---------- Auth ----------
export const auth = {
  me: () => api.get<User>('/api/auth/me'),
  login: (email: string, password: string) =>
    api.post<User>('/api/auth/login', { email, password }),
  signup: (email: string, name: string, password: string) =>
    api.post<User>('/api/auth/signup', { email, name, password }),
  logout: () => api.post<{ ok: true }>('/api/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>('/api/auth/password', { currentPassword, newPassword }),
};

// ---------- Plans ----------
export const plans = {
  list: () => api.get<Plan[]>('/api/plans'),
  get: (id: number) =>
    api.get<Plan & { members: PlanMember[]; scenarios: Scenario[] }>(`/api/plans/${id}`),
  create: (data: { name: string; baseCurrency?: string }) =>
    api.post<{ id: number }>('/api/plans', data),
  update: (id: number, data: { name?: string; baseCurrency?: string }) =>
    api.patch<{ ok: true }>(`/api/plans/${id}`, data),
  remove: (id: number) => api.del<{ ok: true }>(`/api/plans/${id}`),
  check: (id: number) => api.get<{ version: number; updated_at: string }>(`/api/plans/${id}/check`),
  activity: (id: number, limit = 50) =>
    api.get<ActivityEntry[]>(`/api/plans/${id}/activity?limit=${limit}`),

  members: {
    list: (planId: number) => api.get<PlanMember[]>(`/api/plans/${planId}/members`),
    add: (planId: number, email: string, role: 'owner' | 'editor' | 'viewer') =>
      api.post<PlanMember>(`/api/plans/${planId}/members`, { email, role }),
    setRole: (planId: number, userId: number, role: 'owner' | 'editor' | 'viewer') =>
      api.patch<{ ok: true }>(`/api/plans/${planId}/members/${userId}`, { role }),
    remove: (planId: number, userId: number) =>
      api.del<{ ok: true }>(`/api/plans/${planId}/members/${userId}`),
  },
};

// ---------- Scenarios ----------
export const scenarios = {
  list: (planId: number) => api.get<Scenario[]>(`/api/plans/${planId}/scenarios`),
  get: (id: number) =>
    api.get<Scenario & { buckets: Bucket[]; events: PlanEvent[] }>(`/api/scenarios/${id}`),
  create: (planId: number, data: { name: string; description?: string | null; horizonYears?: number; startDate?: string | null }) =>
    api.post<{ id: number }>(`/api/plans/${planId}/scenarios`, data),
  update: (id: number, data: { name?: string; description?: string | null; horizonYears?: number; startDate?: string | null }) =>
    api.patch<{ ok: true }>(`/api/scenarios/${id}`, data),
  remove: (id: number) => api.del<{ ok: true }>(`/api/scenarios/${id}`),
  clone: (id: number, name: string) =>
    api.post<{ id: number }>(`/api/scenarios/${id}/clone`, { name }),
  projection: (id: number) => api.get<ProjectionResponse>(`/api/scenarios/${id}/projection`),
  compare: (planId: number, scenarioIds: number[], horizonYears?: number[]) =>
    api.post<CompareResponse>(`/api/plans/${planId}/compare`, { scenarioIds, horizonYears }),
  export: (id: number, type: 'actuals' | 'events' | 'contributions') =>
    `/api/scenarios/${id}/export?type=${type}`,
};

// ---------- Buckets ----------
export const buckets = {
  create: (scenarioId: number, data: Partial<Bucket> & { name: string }) =>
    api.post<{ id: number }>(`/api/scenarios/${scenarioId}/buckets`, mapBucketInput(data)),
  get: (id: number) =>
    api.get<Bucket & { contribution_schedules: ContributionSchedule[]; actuals: Actual[] }>(
      `/api/buckets/${id}`,
    ),
  update: (id: number, data: Partial<Bucket>) =>
    api.patch<{ ok: true }>(`/api/buckets/${id}`, mapBucketInput(data)),
  remove: (id: number) => api.del<{ ok: true }>(`/api/buckets/${id}`),

  contributions: {
    add: (bucketId: number, data: { amount: number; cadence: 'monthly'|'quarterly'|'annual'; startDate: string; endDate?: string | null }) =>
      api.post<{ id: number }>(`/api/buckets/${bucketId}/contributions`, data),
    update: (id: number, data: Partial<{ amount: number; cadence: 'monthly'|'quarterly'|'annual'; startDate: string; endDate: string | null }>) =>
      api.patch<{ ok: true }>(`/api/contributions/${id}`, data),
    remove: (id: number) => api.del<{ ok: true }>(`/api/contributions/${id}`),
  },

  actuals: {
    list: (bucketId: number) => api.get<Actual[]>(`/api/buckets/${bucketId}/actuals`),
    add: (bucketId: number, data: { date: string; balance: number; notes?: string | null }) =>
      api.post<{ ok: true }>(`/api/buckets/${bucketId}/actuals`, data),
    remove: (id: number) => api.del<{ ok: true }>(`/api/actuals/${id}`),
    importCsv: (bucketId: number, csv: string) =>
      api.post<{ imported: number; errors: { row: number; reason: string }[] }>(
        `/api/buckets/${bucketId}/actuals/import`,
        { csv },
      ),
  },
};

function mapBucketInput(data: Partial<Bucket>) {
  const out: Record<string, unknown> = {};
  if (data.name !== undefined) out.name = data.name;
  if (data.category !== undefined) out.category = data.category;
  if (data.currency !== undefined) out.currency = data.currency;
  if (data.starting_balance !== undefined) out.startingBalance = data.starting_balance;
  if (data.expected_return !== undefined) out.expectedReturn = data.expected_return;
  if (data.compounding !== undefined) out.compounding = data.compounding;
  if (data.target_amount !== undefined) out.targetAmount = data.target_amount;
  if (data.target_date !== undefined) out.targetDate = data.target_date;
  if (data.icon !== undefined) out.icon = data.icon;
  if (data.color !== undefined) out.color = data.color;
  if (data.sort_order !== undefined) out.sortOrder = data.sort_order;
  if (data.enabled !== undefined) out.enabled = data.enabled === 1;
  return out;
}

// ---------- Events ----------
export const events = {
  list: (scenarioId: number) => api.get<PlanEvent[]>(`/api/scenarios/${scenarioId}/events`),
  create: (scenarioId: number, data: Record<string, unknown>) =>
    api.post<{ id: number }>(`/api/scenarios/${scenarioId}/events`, data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch<{ ok: true }>(`/api/events/${id}`, data),
  remove: (id: number) => api.del<{ ok: true }>(`/api/events/${id}`),
};

// ---------- FX ----------
export const fx = {
  currencies: () => api.get<string[]>('/api/fx/currencies'),
  rate: (base: string, quote: string, date = 'latest') =>
    api.get<{ base: string; quote: string; date: string; rate: number }>(
      `/api/fx/rate?base=${base}&quote=${quote}&date=${date}`,
    ),
};
