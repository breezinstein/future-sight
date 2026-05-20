import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth as authApi, plans as plansApi } from '@/api';
import type { Plan, User } from '@/types';

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: User; plans: Plan[]; activePlanId: number | null };

interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshPlans: () => Promise<void>;
  setActivePlan: (id: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ACTIVE_PLAN_KEY = 'fs.activePlanId';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const loadSession = useCallback(async () => {
    try {
      const user = await authApi.me();
      const plans = await plansApi.list();
      const stored = Number(localStorage.getItem(ACTIVE_PLAN_KEY));
      const activePlanId =
        plans.find((p) => p.id === stored)?.id ?? plans[0]?.id ?? null;
      setState({ status: 'authenticated', user, plans, activePlanId });
    } catch {
      setState({ status: 'unauthenticated' });
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    await authApi.login(email, password);
    await loadSession();
  }, [loadSession]);

  const signUp = useCallback(async (email: string, name: string, password: string) => {
    await authApi.signup(email, name, password);
    await loadSession();
  }, [loadSession]);

  const signOut = useCallback(async () => {
    await authApi.logout();
    localStorage.removeItem(ACTIVE_PLAN_KEY);
    setState({ status: 'unauthenticated' });
  }, []);

  const refreshPlans = useCallback(async () => {
    if (state.status !== 'authenticated') return;
    const plans = await plansApi.list();
    setState((prev) => prev.status === 'authenticated'
      ? { ...prev, plans, activePlanId: prev.activePlanId ?? plans[0]?.id ?? null }
      : prev);
  }, [state.status]);

  const setActivePlan = useCallback((id: number) => {
    localStorage.setItem(ACTIVE_PLAN_KEY, String(id));
    setState((prev) => prev.status === 'authenticated'
      ? { ...prev, activePlanId: id }
      : prev);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signUp, signOut, refreshPlans, setActivePlan }),
    [state, signIn, signUp, signOut, refreshPlans, setActivePlan],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
