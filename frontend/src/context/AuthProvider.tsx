import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  getCurrentUser,
  initializeCsrf,
  loginWithPassword,
  logout as logoutRequest,
} from '../api/client';
import type { ApiError, AuthStatus, LoginRequest, User } from '../types/auth';
import { AuthContext } from './AuthContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        await initializeCsrf();
        const current = await getCurrentUser();
        if (cancelled) return;
        if (current.authenticated && current.user) {
          setUser(current.user);
          setStatus('authenticated');
        } else {
          setUser(null);
          setStatus('unauthenticated');
        }
      } catch {
        // Treat any startup failure (network error, expired/invalid session)
        // as unauthenticated rather than blocking the app indefinitely.
        if (cancelled) return;
        setUser(null);
        setStatus('unauthenticated');
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    setError(null);
    try {
      const response = await loginWithPassword(credentials);
      setUser(response.user);
      setStatus('authenticated');
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{ status, user, error, login, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}
