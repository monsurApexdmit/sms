import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from "../api/client";
import type { LoginResponse, MfaChallenge, TokenResponse, User } from "../api/types";

/** Signed in, or the password was right and a second step (code or 2FA setup) is needed. */
export type LoginResult = { user: User; challenge?: undefined } | { user?: undefined; challenge: MfaChallenge };

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Starts the session from a token response (the two-factor step's answer). */
  finishLogin: (data: TokenResponse) => User;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      queryClient.clear();
    });
    // Restore the session from the refresh cookie on page load.
    refreshSession()
      .then(async (token) => {
        if (token) setUser((await api.get<User>("/auth/me")).data);
      })
      .finally(() => setLoading(false));
  }, [queryClient]);

  const finishLogin = useCallback((data: TokenResponse) => {
    setAccessToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const { data } = await api.post<LoginResponse>("/auth/login", { email, password });
      if ("mfa_token" in data) return { challenge: data };
      return { user: finishLogin(data) };
    },
    [finishLogin],
  );

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(() => ({ user, loading, login, finishLogin, logout, setUser }), [user, loading, login, finishLogin, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Logged-in user; only call inside routes guarded by RequireAuth. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("No user");
  return user;
}
