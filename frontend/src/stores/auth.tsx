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
import { tokenStore } from '@/lib/storage';
import type { ApiEnvelope, AuthTokens, User } from '@/types/api';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  companyName: string;
  cnpj?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applyTokens(tokens: AuthTokens): void {
  tokenStore.setTokens(tokens.accessToken, tokens.refreshToken);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSession(): Promise<void> {
      const hasToken = tokenStore.getAccessToken() !== null;
      if (!hasToken) {
        setIsLoading(false);
        return;
      }

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
    const response = await api.post<ApiEnvelope<AuthTokens>>('/auth/login', { email, password });
    applyTokens(response.data.data);
    const me = await api.get<ApiEnvelope<User>>('/auth/me');
    setUser(me.data.data);
  }, []);

  const register = useCallback(async (data: RegisterInput) => {
    const response = await api.post<ApiEnvelope<AuthTokens>>('/auth/register', data);
    applyTokens(response.data.data);
    const me = await api.get<ApiEnvelope<User>>('/auth/me');
    setUser(me.data.data);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.getRefreshToken();
    try {
      if (refreshToken) {
        await api.post('/auth/logout', { refreshToken });
      }
    } finally {
      tokenStore.clear();
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
    }),
    [user, isLoading, login, register, logout],
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
