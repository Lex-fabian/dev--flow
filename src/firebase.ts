import { initializeApp } from 'firebase/app'
import { getAnalytics } from 'firebase/analytics'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getMessaging } from 'firebase/messaging'

// Your web app's Firebase configuration (loaded from environment variables)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'dev-flow-7b197.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'dev-flow-7b197',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'dev-flow-7b197.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '684838430331',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:684838430331:web:eb080734681a4ff554a4de',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-CSPHLC3C8M',
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)
const analytics = typeof window !== 'undefined' && firebaseConfig.measurementId ? getAnalytics(app) : null
const auth = getAuth(app)
const db = getFirestore(app)
const storage = getStorage(app)
const messaging = typeof window !== 'undefined' ? getMessaging(app) : null

export { app, analytics, auth, db, storage, messaging }
