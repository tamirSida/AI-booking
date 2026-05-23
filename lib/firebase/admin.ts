// Firebase Admin SDK singleton. Lazy-initialized so the module can be imported
// in code paths that don't need Firestore without crashing on missing creds.
// docs: https://firebase.google.com/docs/admin/setup (verify before relying on payloads)

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | null = null;

function getApp(): App {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApps()[0]!;
    return app;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not set. Copy .env.local.example to .env.local and fill it in.",
    );
  }
  const serviceAccount = JSON.parse(raw);
  app = initializeApp({ credential: cert(serviceAccount) });
  return app;
}

let firestore: Firestore | null = null;
export function db(): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(getApp());
  // Reservations are progressively built up; many fields start as undefined.
  // Without this setting, every write with a missing value throws.
  // Wrapped in try/catch because Next.js dev hot-reload re-evaluates this
  // module while the underlying Firestore instance persists at the SDK level,
  // and settings() can only be called once per instance.
  try {
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    /* already initialized — harmless on hot-reload */
  }
  return firestore;
}

// Typed collection accessors mirror design doc §14.
export const usersCol = () => db().collection("users");
export const conversationsCol = () => db().collection("conversations");
export const reservationsCol = () => db().collection("reservationRequests");
export const callsCol = () => db().collection("calls");
export const logsCol = () => db().collection("logs");
