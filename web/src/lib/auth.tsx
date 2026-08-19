import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  getToken,
  setToken,
  setUnauthorizedHandler,
  type SessionUser,
} from './api';

interface AuthState {
  user: SessionUser | null;
  restoring: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoring, setRestoring] = useState(true);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  // Any 401 on a signed-in request ends the session, so a revoked or expired
  // token returns the operator to the login screen instead of leaving a
  // console full of data they can no longer act on.
  useEffect(() => {
    setUnauthorizedHandler(signOut);
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!getToken()) {
        setRestoring(false);
        return;
      }
      try {
        const session = await api.me();
        if (!cancelled) setUser(session);
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.loginStaff(email, password);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const value = useMemo(
    () => ({ user, restoring, signIn, signOut }),
    [user, restoring, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

/** Convenience for the many places that branch on who is signed in. */
export function useIsManager(): boolean {
  return useAuth().user?.role === 'MANAGER';
}

export function useIsAdmin(): boolean {
  return useAuth().user?.role === 'ADMIN';
}
