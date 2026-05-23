// Server-side ID token verification. Every Next.js API route calls
// requireAuth() before doing real work. Returns either the decoded auth or
// a 401 Response that the handler should return directly.
//
// Usage:
//   const auth = await requireAuth(req);
//   if (auth instanceof Response) return auth;
//   // use auth.uid, auth.email

import { NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp, cert } from "firebase-admin/app";

function ensureApp() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON not set");
  initializeApp({ credential: cert(JSON.parse(raw)) });
}

export interface AuthedUser {
  uid: string;
  email?: string;
}

export async function requireAuth(req: Request): Promise<AuthedUser | Response> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "missing auth" }, { status: 401 });
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return NextResponse.json({ error: "empty token" }, { status: 401 });
  }
  try {
    ensureApp();
    const decoded = await getAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
}
