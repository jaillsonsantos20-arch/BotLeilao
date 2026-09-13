import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Exige autenticação. Enquanto a sessão é verificada, exibe um loader.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullScreenLoader />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

/**
 * Redireciona usuários autenticados para fora das rotas públicas (login/registro).
 */
export function GuestRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <FullScreenLoader />;
  if (isAuthenticated) return <Navigate to="/painel" replace />;
  return <>{children}</>;
}

/**
 * Exige que o usuário autenticado possua exatamente a role informada.
 * Usado para áreas exclusivas da plataforma (ex.: gestão de assinaturas).
 */
export function RoleRoute({ role, children }: { role: User['role']; children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <FullScreenLoader />;
  if (!user || user.role !== role) return <Navigate to="/painel" replace />;
  return <>{children}</>;
}
