import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/app-layout';
import { GuestRoute, ProtectedRoute } from '@/components/layout/route-guards';
import { AuctionsPage } from '@/pages/auctions/auctions';
import { LoginPage } from '@/pages/auth/login';
import { RegisterPage } from '@/pages/auth/register';
import { DashboardPage } from '@/pages/dashboard/dashboard';
import { GroupsPage } from '@/pages/groups/groups';
import { WhatsAppPage } from '@/pages/whatsapp/whatsapp';
import { NotFoundPage } from '@/pages/not-found';

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestRoute>
            <LoginPage />
          </GuestRoute>
        }
      />
      <Route
        path="/registro"
        element={
          <GuestRoute>
            <RegisterPage />
          </GuestRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="grupos" element={<GroupsPage />} />
        <Route path="leiloes" element={<AuctionsPage />} />
        <Route path="whatsapp" element={<WhatsAppPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
