"use client";
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from "react";
import { apiService, User, UserPreferences } from "@/services/api";

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  preferences: UserPreferences | null;
  preferencesLoading: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  updatePreferences: (preferences: Partial<UserPreferences>) => Promise<void>;
  refreshPreferences: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  // A request may outlive the session that created it. Keep the session
  // identity separate from React state so an old 401 cannot clear a newer
  // login's token.
  const sessionRef = React.useRef<{ email: string; token: string } | null>(null);
  // Track which user email we've already fetched prefs for - prevents redundant
  // fetches on every page navigation while the user stays logged in.
  const prefsFetchedForRef = React.useRef<string | null>(null);

  useEffect(() => {
    // Restore session from localStorage
    const storedToken = localStorage.getItem("access_token");
    const storedUser = localStorage.getItem("user_info");
    if (storedToken && storedUser) {
      const parsedUser = JSON.parse(storedUser) as User;
      sessionRef.current = { email: parsedUser.email, token: storedToken };
      setToken(storedToken);
      setUser(parsedUser);
    }
    setLoading(false);
  }, []);

  // Load user preferences once per logged-in user - skip if already fetched.
  useEffect(() => {
    if (user && prefsFetchedForRef.current !== user.email) {
      prefsFetchedForRef.current = user.email;
      refreshPreferences();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const logout = useCallback(() => {
    sessionRef.current = null;
    setUser(null);
    setToken(null);
    setPreferences(null);
    prefsFetchedForRef.current = null;
    localStorage.removeItem("access_token");
    localStorage.removeItem("user_info");
  }, []);

  const isCurrentSession = useCallback((email: string, requestToken: string | null) => {
    const current = sessionRef.current;
    return Boolean(current && current.email === email && current.token === requestToken);
  }, []);

  const refreshPreferences = useCallback(async () => {
    if (!user) return;

    const requestEmail = user.email;
    const requestToken = sessionRef.current?.token ?? token;

    setPreferencesLoading(true);
    try {
      const prefs = await apiService.getPreferences(requestEmail);
      if (!isCurrentSession(requestEmail, requestToken)) {
        console.warn('Preferences: ignoring response from an older session.');
        return;
      }
      setPreferences(prefs);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);

      // Backend is offline / unreachable - keep the stale session alive silently.
      if (
        error instanceof TypeError ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError')
      ) {
        console.warn('Preferences: backend unreachable, keeping cached session.');
        return;
      }

      // Backend confirmed the user no longer exists (stale localStorage token,
      // e.g. after a fresh DB reset). Force logout to clear the invalid session.
      const lowMsg = msg.toLowerCase();
      if (
        lowMsg.includes('user not found') ||
        lowMsg.includes('not found') ||
        lowMsg.includes('authentication required') ||
        lowMsg.includes('invalid authentication token') ||
        lowMsg.includes('expired token')
      ) {
        console.warn('Preferences: user not found on backend - clearing stale session.');
        if (isCurrentSession(requestEmail, requestToken)) {
          logout();
        } else {
          console.warn('Preferences: ignoring authentication failure from an older session.');
        }
        return;
      }

      // Any other error: clear stale preferences so we don't show a previous
      // user's data, then log a warning to avoid Next.js dev overlay.
      if (!isCurrentSession(requestEmail, requestToken)) {
        console.warn('Preferences: ignoring error from an older session.');
        return;
      }
      setPreferences(null);
      console.warn('Failed to load preferences:', msg);
    } finally {
      setPreferencesLoading(false);
    }
  }, [user, token, logout, isCurrentSession]);

  const updatePreferences = useCallback(async (newPreferences: Partial<UserPreferences>) => {
    if (!user) return;

    const requestEmail = user.email;
    const requestToken = sessionRef.current?.token ?? token;

    // Optimistic update - UI reflects change instantly
    setPreferences(prev => prev ? { ...prev, ...newPreferences } : prev);

    try {
      await apiService.updatePreferences(requestEmail, newPreferences);
    } catch (error) {
      const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        msg.includes('authentication required') ||
        msg.includes('invalid authentication token') ||
        msg.includes('expired token')
      ) {
        if (isCurrentSession(requestEmail, requestToken)) {
          logout();
        } else {
          console.warn('Preferences: ignoring authentication failure from an older session.');
        }
        return;
      }
      // Network errors (backend unreachable) — keep optimistic update, don't cascade
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        console.warn('Failed to update preferences: backend unreachable');
        return;
      }
      // Server errors — roll back optimistic update
      refreshPreferences();
      console.error("Failed to update preferences:", error);
      throw error;
    }
  }, [user, token, refreshPreferences, logout, isCurrentSession]);

  const login = useCallback((user: User, token: string) => {
    // Clear stale preferences immediately so the previous user's data never
    // bleeds into the new session while the async fetch is in flight.
    setPreferences(null);
    prefsFetchedForRef.current = null;
    sessionRef.current = { email: user.email, token };
    setUser(user);
    setToken(token);
    localStorage.setItem("access_token", token);
    localStorage.setItem("user_info", JSON.stringify(user));
  }, []);

  // logout is now defined above refreshPreferences to satisfy dependency order

  const value = useMemo(() => ({
    user,
    token,
    loading,
    preferences,
    preferencesLoading,
    login,
    logout,
    updatePreferences,
    refreshPreferences
  }), [user, token, loading, preferences, preferencesLoading, login, logout, updatePreferences, refreshPreferences]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
