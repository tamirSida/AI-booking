"use client";

// Renders children only when a user is signed in. Otherwise renders a login
// form. Lives in lib/auth/ so the gate is reusable from layouts/pages.

import { useState } from "react";
import { useAuth } from "./AuthProvider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-sm opacity-60">
        Loading…
      </main>
    );
  }
  if (!user) return <LoginForm />;
  return <>{children}</>;
}

function LoginForm() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.replace("Firebase: ", "").replace(/\(auth\/[^)]+\)/, "").trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-black/10 dark:border-white/10 p-6">
        <div>
          <h1 className="text-xl font-semibold">ai_booking</h1>
          <p className="text-sm opacity-70">Sign in to continue.</p>
        </div>
        <label className="block text-sm space-y-1">
          <span className="opacity-80">Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm space-y-1">
          <span className="opacity-80">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-blue-600 px-4 py-2 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
