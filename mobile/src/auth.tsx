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
  setAuthToken,
  setUnauthorizedHandler,
  type SessionUser,
} from './api';
import { tokenStore } from './tokenStore';

interface AuthState {
  user: SessionUser | null;
  /** True until the stored session has been checked on launch. */
  restoring: boolean;
  signInCustomer: (accountNumber: string, pin: string) => Promise<void>;
  signInStaff: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Fire-and-forget: starts a sleeping free-tier instance booting while the
    // user is still reaching for their PIN, rather than when they press Sign in.
    void api.health().catch(() => {});

    (async () => {
      try {
        const stored = await tokenStore.get();
        if (!stored) return;

        setAuthToken(stored);
        // Confirm the token is still valid before trusting it, otherwise the
        // app renders a dashboard that immediately fails to load.
        const session = await api.me();
        if (!cancelled) setUser(session);
      } catch {
        // An expired or rejected token is normal on launch; drop it and show
        // the login screen rather than blocking startup.
        setAuthToken(null);
        await tokenStore.clear();
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (token: string, session: SessionUser) => {
    setAuthToken(token);
    await tokenStore.set(token);
    setUser(session);
  }, []);

  const signInCustomer = useCallback(
    async (accountNumber: string, pin: string) => {
      const result = await api.loginCustomer(accountNumber, pin);
      await persist(result.token, result.user);
    },
    [persist],
  );

  const signInStaff = useCallback(
    async (email: string, password: string) => {
      const result = await api.loginStaff(email, password);
      await persist(result.token, result.user);
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    await tokenStore.clear();
  }, []);

  // Any 401 from a signed-in request ends the session, so the app falls back to
  // the login screen instead of showing data it can no longer act on.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo(
    () => ({ user, restoring, signInCustomer, signInStaff, signOut }),
    [user, restoring, signInCustomer, signInStaff, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
