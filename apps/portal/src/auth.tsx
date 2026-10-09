import { useQueryClient } from '@tanstack/react-query';
import type { PortalLoginResult, PortalProfile } from '@ttp/shared-types';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api';

interface AuthState {
  account: PortalProfile | null;
  checking: boolean;
  notice: string | null;
  login: (email: string, password: string) => Promise<PortalProfile>;
  accept: (result: PortalLoginResult) => PortalProfile;
  logout: (notice?: string) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<PortalProfile | null>(null);
  const [checking, setChecking] = useState(() => !!tokenStore.get());
  const [notice, setNotice] = useState<string | null>(null);

  const logout = useCallback((why?: string) => {
    tokenStore.set(null);
    setAccount(null);
    setNotice(why ?? null);
    queryClient.clear();
  }, [queryClient]);

  const refresh = useCallback(async () => setAccount(await api.me()), []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout('Session ended. Please sign in again. / Сеанс завершён, войдите снова.'));
    if (!tokenStore.get()) return;
    api.me().then(setAccount).catch(() => tokenStore.set(null)).finally(() => setChecking(false));
  }, [logout]);

  const accept = useCallback((r: PortalLoginResult) => {
    tokenStore.set(r.accessToken);
    setNotice(null);
    setAccount(r.account);
    return r.account;
  }, []);

  const login = useCallback(async (email: string, password: string) => accept(await api.login(email, password)), [accept]);

  return <AuthContext.Provider value={{ account, checking, notice, login, accept, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
