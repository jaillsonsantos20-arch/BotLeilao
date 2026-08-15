import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/app-layout';
import { GuestRoute, ProtectedRoute } from '@/components/layout/route-guards';
import { AuctionsPage } from '@/pages/auctions/auctions';
import { ForgotPasswordPage } from '@/pages/auth/forgot-password';
import { LoginPage } from '@/pages/auth/login';
import { RegisterPage } from '@/pages/auth/register';
import { ResetPasswordPage } from '@/pages/auth/reset-password';
import { VerifyEmailPage } from '@/pages/auth/verify-email';
import { DashboardPage } from '@/pages/dashboard/dashboard';
import { GroupsPage } from '@/pages/groups/groups';
import { LandingPage } from '@/pages/landing/landing';
import { SecurityPage } from '@/pages/security/security';
import { WhatsAppPage } from '@/pages/whatsapp/whatsapp';
import { NotFoundPage } from '@/pages/not-found';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
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
        path="/esqueci-senha"
        element={
          <GuestRoute>
            <ForgotPasswordPage />
          </GuestRoute>
        }
      />
      <Route
        path="/redefinir-senha"
        element={
          <GuestRoute>
            <ResetPasswordPage />
          </GuestRoute>
        }
      />
      <Route
        path="/verificar-email"
        element={
          <GuestRoute>
            <VerifyEmailPage />
          </GuestRoute>
        }
      />

      <Route
        path="/painel"
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
        <Route path="seguranca" element={<SecurityPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}