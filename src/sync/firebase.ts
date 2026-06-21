// Firebase initialisation. Connects to the local Emulator Suite when
// VITE_USE_EMULATOR is "true" (the default in .env.example), so the app runs
// with no real Firebase project during development.

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

const env = import.meta.env;

const useEmulator = env.VITE_USE_EMULATOR === "true";

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "demo-rummle.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "demo-rummle",
  appId: env.VITE_FIREBASE_APP_ID || "demo-app-id",
};

export const app: FirebaseApp = initializeApp(firebaseConfig);
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

if (useEmulator) {
  const host = env.VITE_EMULATOR_HOST || "127.0.0.1";
  const authPort = Number(env.VITE_AUTH_EMULATOR_PORT || 9099);
  const firestorePort = Number(env.VITE_FIRESTORE_EMULATOR_PORT || 8080);
  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, firestorePort);
}

export { useEmulator };
