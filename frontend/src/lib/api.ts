import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiEnvelope, AuthTokens } from '@/types/api';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

/**
 * Instância axios compartilhada.
 * - Os tokens vivem em cookies HttpOnly (setados pelo backend), então NÃO são
 *   armazenados em localStorage — `withCredentials` envia os cookies na requisição.
 * - Em 401, tenta renovar o access token uma única vez e repete a requisição.
 * - Falha na renovação => limpa a sessão e redireciona ao login.
 */
export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let refreshPromise: Promise<unknown> | null = null;

async function refreshAccessToken(): Promise<void> {
  await axios.post<ApiEnvelope<AuthTokens>>(`${BASE_URL}/auth/refresh`, undefined, {
    withCredentials: true,
  });
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (error.response?.status !== 401 || !original || original._retried) {
      if (error.response?.status === 401) {
        handleSessionExpired();
      }
      return Promise.reject(error);
    }

    original._retried = true;

    try {
      refreshPromise = refreshPromise ?? refreshAccessToken();
      await refreshPromise;
      refreshPromise = null;
      return api(original);
    } catch (refreshError) {
      refreshPromise = null;
      handleSessionExpired();
      return Promise.reject(refreshError);
    }
  },
);

function handleSessionExpired(): void {
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}
