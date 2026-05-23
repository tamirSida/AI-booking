"use client";

// Client-side fetch wrapper that attaches the current user's Firebase ID
// token as a Bearer header. Use this for any call that hits an authed API
// route (which is now all of them on Next.js side).

import { firebaseAuth } from "@/lib/firebase/client";

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const u = firebaseAuth().currentUser;
  if (!u) throw new Error("Not signed in");
  const token = await u.getIdToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
