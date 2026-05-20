import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { FullPageSpinner } from '@/components/Spinner';
import { AppLayout } from '@/components/AppLayout';
import { SignIn } from '@/pages/SignIn';
import { SignUp } from '@/pages/SignUp';
import { Dashboard } from '@/pages/Dashboard';
import { ScenariosList } from '@/pages/ScenariosList';
import { ScenarioDetail } from '@/pages/ScenarioDetail';
import { ScenarioCompare } from '@/pages/ScenarioCompare';
import { ScenarioNew } from '@/pages/ScenarioNew';
import { BucketsPage } from '@/pages/BucketsPage';
import { EventsPage } from '@/pages/EventsPage';
import { ActualsPage } from '@/pages/ActualsPage';
import { ActivityPage } from '@/pages/ActivityPage';
import { SettingsGeneral } from '@/pages/SettingsGeneral';
import { SettingsHousehold } from '@/pages/SettingsHousehold';
import { SettingsPlanNew } from '@/pages/SettingsPlanNew';
import { SettingsLayout } from '@/pages/SettingsLayout';

export default function App() {
  const { state } = useAuth();

  if (state.status === 'loading') return <FullPageSpinner />;

  if (state.status === 'unauthenticated') {
    return (
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="*" element={<Navigate to="/sign-in" replace />} />
      </Routes>
    );
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/scenarios" element={<ScenariosList />} />
        <Route path="/scenarios/new" element={<ScenarioNew />} />
        <Route path="/scenarios/compare" element={<ScenarioCompare />} />
        <Route path="/scenarios/:scenarioId" element={<ScenarioDetail />} />
        <Route path="/buckets" element={<BucketsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/actuals" element={<ActualsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<SettingsGeneral />} />
          <Route path="household" element={<SettingsHousehold />} />
          <Route path="plans/new" element={<SettingsPlanNew />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
