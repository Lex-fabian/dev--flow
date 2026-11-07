import { collection, addDoc, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { ref } from 'vue'

export interface Activity {
  id: string
  ticketId: string
  action: 'created' | 'moved' | 'edited' | 'deleted' | 'commented' | 'closed'
  detail: string
  userEmail: string
  timestamp: number
}

const activities = ref<Record<string, Activity[]>>({})
const activityUnsubs: Record<string, () => void> = {}

export function useActivityLog() {
  function loadActivities(ticketId: string) {
    if (activityUnsubs[ticketId]) {
      // Listener activo existente, no duplicar suscripción
      return
    }
    const q = query(
      collection(db, 'tickets', ticketId, 'activity'),
      orderBy('timestamp', 'asc')
    )
    activityUnsubs[ticketId] = onSnapshot(
      q,
      (snap) => {
        activities.value[ticketId] = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as Activity[]
      },
      (err) => console.error('Activity log error:', err)
    )
  }

  async function log(ticketId: string, action: Activity['action'], detail: string) {
    const user = auth.currentUser
    if (!user) return
    await addDoc(collection(db, 'tickets', ticketId, 'activity'), {
      action,
      detail,
      userEmail: user.email || '',
      timestamp: Date.now(),
    })
  }

  function getActivities(ticketId: string) {
    return activities.value[ticketId] || []
  }

  return { log, getActivities, loadActivities }
}
