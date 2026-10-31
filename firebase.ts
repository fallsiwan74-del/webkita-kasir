import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const firebaseConfig = {
  // Vercel has both names configured; keep the public Firebase key explicit and support the existing `apiKey` variable too.
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const requiredFirebaseKeys = ['apiKey', 'authDomain', 'projectId', 'appId'] as const
const hasFirebaseConfig = requiredFirebaseKeys.every((key) => typeof firebaseConfig[key] === 'string' && firebaseConfig[key].length > 0)
const app = hasFirebaseConfig ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null

export const auth: Auth | null = app ? getAuth(app) : null
export const db: Firestore | null = app ? getFirestore(app) : null

// Struktur Firestore:
// users/{uid} -> profile, promoEligible, promoEndsAt
// users/{uid}/products/{productId} -> name, category, cost, price, active
// users/{uid}/sales/{saleId} -> productId, productName, price, cost, profit, createdAt
// users/{uid}/feedback/{feedbackId} -> name, message, createdAt
