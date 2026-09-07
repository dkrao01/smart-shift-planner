/**
 * Firebase initialization.
 * If env variables are missing → DEMO MODE (no Firebase, uses localStorage).
 */

let firebaseApp: import('firebase/app').FirebaseApp | null = null;
let firestoreDb: import('firebase/firestore').Firestore | null = null;
let firebaseAuth: import('firebase/auth').Auth | null = null;

export const IS_DEMO_MODE = !import.meta.env.VITE_FIREBASE_API_KEY;

export const firebaseReady: Promise<void> = IS_DEMO_MODE
  ? Promise.resolve()
  : (async () => {
    const { initializeApp } = await import('firebase/app');
    const { getFirestore } = await import('firebase/firestore');
    const { getAuth } = await import('firebase/auth');

    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };

    firebaseApp = initializeApp(firebaseConfig);
    firestoreDb = getFirestore(firebaseApp);
    firebaseAuth = getAuth(firebaseApp);
  })();

export { firebaseApp, firestoreDb, firebaseAuth };

export function getDb() {
  if (!firestoreDb) throw new Error('Firestore not initialized. Check Firebase config.');
  return firestoreDb;
}

export function getFirebaseAuth() {
  if (!firebaseAuth) throw new Error('Firebase Auth not initialized. Check Firebase config.');
  return firebaseAuth;
}
