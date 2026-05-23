"use client";

// Client-side auth state. Wraps the app at the layout level. Provides:
//   - useAuth(): { user, loading, signIn, signOut }
//   - AuthGate: renders children only when signed in; otherwise shows login form
// All API calls go through authedFetch() in lib/auth/fetch-with-auth.ts which
// reads the current user's ID token from this context.

import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth(), (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const value: AuthState = {
    user,
    loading,
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(firebaseAuth(), email, password);
    },
    signOut: async () => {
      await fbSignOut(firebaseAuth());
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
