import React, { createContext, useContext, useState, useEffect } from 'react';
import type { AppUser } from '../types';
import { IS_DEMO_MODE, firebaseReady } from '../lib/firebase';
import { USE_SUPABASE, getSupabase } from '../lib/supabase';
import { MOCK_USERS } from '../data/mockData';

const IS_LOCAL_DEMO_MODE = IS_DEMO_MODE && !USE_SUPABASE;

// ─── Context Shape ────────────────────────────────────────────────────────────

interface AuthContextValue {
  currentUser: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isDemo: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Demo Auth Helpers ────────────────────────────────────────────────────────

const DEMO_SESSION_KEY = 'ssp_demo_user';

// All demo users share password: demo123
const DEMO_PASSWORD = 'demo123';

function demoLogin(email: string, password: string): AppUser {
  if (password !== DEMO_PASSWORD) throw new Error('Invalid password. Demo password is: demo123');
  const user = MOCK_USERS.find(u => u.email === email);
  if (!user) throw new Error('No user found with that email. Check demo credentials.');
  return user;
}

async function getSupabaseUser(uid: string): Promise<AppUser | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('id, name, email, role, employee_id')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    uid: data.id,
    name: data.name,
    email: data.email,
    role: data.role,
    employeeId: data.employee_id ?? '',
  } as AppUser;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Demo mode bootstrap ──────────────────────────────────────────────────
  useEffect(() => {
    if (IS_LOCAL_DEMO_MODE) {
      const stored = sessionStorage.getItem(DEMO_SESSION_KEY);
      if (stored) {
        try { setCurrentUser(JSON.parse(stored)); } catch { /* ignore */ }
      }
      setLoading(false);
      return;
    }

    if (USE_SUPABASE) {
      const supabase = getSupabase();
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
        try {
          setCurrentUser(session?.user ? await getSupabaseUser(session.user.id) : null);
        } catch (err) {
          console.error('Error loading Supabase user data', err);
          setCurrentUser(null);
        } finally {
          setLoading(false);
        }
      });
      return () => subscription.unsubscribe();
    }

    // ── Firebase mode bootstrap ────────────────────────────────────────────
    let unsubscribe: (() => void) | undefined;

    (async () => {
      await firebaseReady;
      const { getFirebaseAuth } = await import('../lib/firebase');
      const { onAuthStateChanged } = await import('firebase/auth');
      const { doc, getDoc } = await import('firebase/firestore');
      const { getDb } = await import('../lib/firebase');
        const { ensureFirebaseBaseData } = await import('../services/dataService');

      const auth = getFirebaseAuth();
      unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
        if (fbUser) {
          try {
            const snap = await getDoc(doc(getDb(), 'users', fbUser.uid));
            if (snap.exists()) {
              const appUser = { uid: fbUser.uid, ...snap.data() } as AppUser;
              if (appUser.role === 'manager') await ensureFirebaseBaseData();
              setCurrentUser(appUser);
            }
          } catch (err) {
            console.error('Error loading user data', err);
          }
        } else {
          setCurrentUser(null);
        }
        setLoading(false);
      });
    })();

    return () => unsubscribe?.();
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  async function login(email: string, password: string) {
    setError(null);
    try {
      if (IS_LOCAL_DEMO_MODE) {
        const user = demoLogin(email.trim().toLowerCase(), password);
        sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
        setCurrentUser(user);
        return;
      }

      if (USE_SUPABASE) {
        const { data, error } = await getSupabase().auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
        if (!data.user) throw new Error('Login failed: no user returned.');
        const appUser = await getSupabaseUser(data.user.id);
        if (!appUser) throw new Error('No profile found for this account.');
        setCurrentUser(appUser);
        return;
      }

      await firebaseReady;
      const { getFirebaseAuth } = await import('../lib/firebase');
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const { doc, getDoc } = await import('firebase/firestore');
      const { getDb } = await import('../lib/firebase');
      const { ensureFirebaseBaseData } = await import('../services/dataService');

      const auth = getFirebaseAuth();
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(getDb(), 'users', cred.user.uid));
      if (snap.exists()) {
        const appUser = { uid: cred.user.uid, ...snap.data() } as AppUser;
        if (appUser.role === 'manager') await ensureFirebaseBaseData();
        setCurrentUser(appUser);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      throw err;
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  async function logout() {
    if (IS_LOCAL_DEMO_MODE) {
      sessionStorage.removeItem(DEMO_SESSION_KEY);
      setCurrentUser(null);
      return;
    }
    if (USE_SUPABASE) {
      const { error } = await getSupabase().auth.signOut();
      if (error) throw error;
      setCurrentUser(null);
      return;
    }
    const { getFirebaseAuth } = await import('../lib/firebase');
    const { signOut } = await import('firebase/auth');
    await signOut(getFirebaseAuth());
    setCurrentUser(null);
  }

  return (
    <AuthContext.Provider value={{ currentUser, loading, login, logout, isDemo: IS_LOCAL_DEMO_MODE, error }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
