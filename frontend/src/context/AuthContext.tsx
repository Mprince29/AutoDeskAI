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
  // Track which user email we've already fetched prefs for - prevents redundant
  // fetches on every page navigation while the user stays logged in.
  const prefsFetchedForRef = React.useRef<string | null>(null);

  useEffect(() => {
    // Restore session from localStorage
    const storedToken = localStorage.getItem("access_token");
    const storedUser = localStorage.getItem("user_info");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
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
    setUser(null);
    setToken(null);
    setPreferences(null);
    prefsFetchedForRef.current = null;
    localStorage.removeItem("access_token");
    localStorage.removeItem("user_info");
  }, []);

  const refreshPreferences = useCallback(async () => {
    if (!user) return;

    setPreferencesLoading(true);
    try {
      const prefs = await apiService.getPreferences(user.email);
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
        msg.includes('Authentication required')
      ) {
        console.warn('Preferences: user not found on backend - clearing stale session.');
        logout();
        return;
      }

      // Any other error: clear stale preferences so we don't show a previous
      // user's data, then log a warning to avoid Next.js dev overlay.
      setPreferences(null);
      console.warn('Failed to load preferences:', msg);
    } finally {
      setPreferencesLoading(false);
    }
  }, [user, logout]);

  const updatePreferences = useCallback(async (newPreferences: Partial<UserPreferences>) => {
    if (!user) return;

    // Optimistic update - UI reflects change instantly
    setPreferences(prev => prev ? { ...prev, ...newPreferences } : prev);

    try {
      await apiService.updatePreferences(user.email, newPreferences);
    } catch (error) {
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
  }, [user, refreshPreferences]);

  const login = useCallback((user: User, token: string) => {
    // Clear stale preferences immediately so the previous user's data never
    // bleeds into the new session while the async fetch is in flight.
    setPreferences(null);
    prefsFetchedForRef.current = null;
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