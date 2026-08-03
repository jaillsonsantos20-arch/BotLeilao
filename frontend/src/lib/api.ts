import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { tokenStore } from './storage';
import type { ApiEnvelope, AuthTokens } from '@/types/api';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

/**
 * Instância axios compartilhada.
 * - Injeta o Bearer token automaticamente.
 * - Em 401, tenta renovar o access token uma única vez e repete a requisição.
 * - Falha na renovação => limpa a sessão e redireciona ao login.
 */
export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) {
    throw new Error('Sem refresh token.');
  }

  const response = await axios.post<ApiEnvelope<AuthTokens>>(
    `${BASE_URL}/auth/refresh`,
    { refreshToken },
  );

  const tokens = response.data.data;
  tokenStore.setTokens(tokens.accessToken, tokens.refreshToken);
  return tokens.accessToken;
}

api.interceptors.request.use((config) => {
  const token = tokenStore.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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
      const token = await refreshPromise;
      refreshPromise = null;
      original.headers.Authorization = `Bearer ${token}`;
      return api(original);
    } catch (refreshError) {
      refreshPromise = null;
      handleSessionExpired();
      return Promise.reject(refreshError);
    }
  },
);

function handleSessionExpired(): void {
  tokenStore.clear();
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}
