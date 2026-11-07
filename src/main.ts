import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import './firebase'
import router from './router'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

// Global error handler - logs to Firestore
window.onerror = (message, source, lineno, colno, error) => {
  try {
    addDoc(collection(db, 'logs'), {
      level: 'error',
      message: String(message),
      data: `Source: ${source}:${lineno}:${colno}\nStack: ${error?.stack || ''}`.slice(0, 2000),
      url: window.location.href,
      timestamp: serverTimestamp(),
    })
  } catch {}
}

window.addEventListener('unhandledrejection', (event) => {
  try {
    addDoc(collection(db, 'logs'), {
      level: 'error',
      message: 'Unhandled Promise rejection: ' + String(event.reason),
      data: event.reason?.stack?.slice(0, 2000) || '',
      url: window.location.href,
      timestamp: serverTimestamp(),
    })
  } catch {}
  console.error(event.reason)
})

const app = createApp(App)
app.use(router)
app.mount('#app')

if ('serviceWorker' in navigator && import.meta.env.VITE_FIREBASE_API_KEY) {
  const swQuery = new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'dev-flow-7b197',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '684838430331',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:684838430331:web:eb080734681a4ff554a4de',
  })
  navigator.serviceWorker.register(`/sw.js?${swQuery.toString()}`).catch(() => {})
}
