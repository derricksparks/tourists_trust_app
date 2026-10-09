import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AdminProfile, api, setUnauthorizedHandler, tokenStore } from './api';

interface AuthState {
  admin: AdminProfile | null;
  /** True while an existing token is being checked on page load. */
  checking: boolean;
  /** Why the admin was signed out, shown on the login screen. */
  notice: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: (notice?: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [checking, setChecking] = useState(() => !!tokenStore.get());
  const [notice, setNotice] = useState<string | null>(null);

  const logout = useCallback(
    (why?: string) => {
      tokenStore.set(null);
      setAdmin(null);
      setNotice(why ?? null);
      queryClient.clear();
    },
    [queryClient],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => logout('Your session ended. Sign in again to continue.'));
    if (!tokenStore.get()) return;
    api
      .me()
      .then(setAdmin)
      .catch(() => tokenStore.set(null))
      .finally(() => setChecking(false));
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    tokenStore.set(result.accessToken);
    setNotice(null);
    setAdmin(result.admin);
  }, []);

  return <AuthContext.Provider value={{ admin, checking, notice, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Moderators and super admins decide on operators and reviews; content editors only view them. */
export function useCanModerate() {
  const { admin } = useAuth();
  return admin?.role === 'SUPER_ADMIN' || admin?.role === 'MODERATOR';
}

/** Content editors and super admins edit visa and travel guides. */
export function useCanEditContent() {
  const { admin } = useAuth();
  return admin?.role === 'SUPER_ADMIN' || admin?.role === 'CONTENT_EDITOR';
}
