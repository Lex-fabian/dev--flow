importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js')

const swUrl = new URL(self.location.href)
const apiKey = swUrl.searchParams.get('apiKey')
const projectId = swUrl.searchParams.get('projectId') || 'dev-flow-7b197'

if (apiKey) {
  firebase.initializeApp({
    apiKey: apiKey,
    authDomain: swUrl.searchParams.get('authDomain') || `${projectId}.firebaseapp.com`,
    projectId: projectId,
    storageBucket: swUrl.searchParams.get('storageBucket') || `${projectId}.firebasestorage.app`,
    messagingSenderId: swUrl.searchParams.get('messagingSenderId') || '684838430331',
    appId: swUrl.searchParams.get('appId') || '',
  })

  const messaging = firebase.messaging()

  messaging.onBackgroundMessage((payload) => {
    const { title, body } = payload.notification || {}
    self.registration.showNotification(title || 'Dev Flow', {
      body: body || '',
      icon: '/icons/icon-192.svg',
    })
  })
}
