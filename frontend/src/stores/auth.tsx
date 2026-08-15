import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import type { ApiEnvelope, LoginResponse, User } from '@/types/api';

export interface MfaRequired {
  requiresMfa: true;
  mfaToken: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void | MfaRequired>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  companyName: string;
  cnpj?: string;
  planId?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSession(): Promise<void> {
      try {
        const response = await api.get<ApiEnvelope<User>>('/auth/me');
        setUser(response.data.data);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    void loadSession();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.post<ApiEnvelope<LoginResponse>>('/auth/login', { email, password });
    const result = response.data.data;

    if (result.requiresMfa && result.mfaToken) {
      return { requiresMfa: true as const, mfaToken: result.mfaToken };
    }

    const me = await api.get<ApiEnvelope<User>>('/auth/me');
    setUser(me.data.data);
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    await api.post('/auth/mfa/verify', { mfaToken, code });
    const me = await api.get<ApiEnvelope<User>>('/auth/me');
    setUser(me.data.data);
  }, []);

  const register = useCallback(async (data: RegisterInput) => {
    await api.post('/auth/register', data);
    const me = await api.get<ApiEnvelope<User>>('/auth/me');
    setUser(me.data.data);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      login,
      register,
      logout,
      verifyMfa,
    }),
    [user, isLoading, login, register, logout, verifyMfa],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>.');
  }
  return context;
}
