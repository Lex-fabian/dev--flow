/**
 * @file useAppNotifications.ts
 * @description Composable reactivo para notificaciones del sistema:
 * - Invitaciones pendientes a proyectos (con aceptar / rechazar)
 * - Miembros que aceptaron invitaciones del usuario
 * - Tickets caducados (vencidos sin completar)
 * - Tickets a punto de caducar (vencen hoy o en las próximas 48 horas)
 * - Sugerencias de vinculación con GitHub para proyectos sin repositorio
 */

import { ref, computed } from 'vue'
import { auth } from '../firebase'
import { useProjects } from './useProjects'
import { useTickets } from './useTickets'
import { onAuthStateChanged } from 'firebase/auth'

export type NotificationType =
  | 'invite'
  | 'invite-accepted'
  | 'ticket-expired'
  | 'ticket-due-soon'
  | 'github-suggestion'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  detail?: string
  timestamp: number
  read: boolean
  projectId?: string
  ticketId?: string
  severity: 'urgent' | 'warning' | 'info' | 'success'
}

const readIds = ref<Set<string>>(new Set())

function loadReadIds(uid?: string | null) {
  const currentUid = uid ?? auth.currentUser?.uid
  if (!currentUid || typeof localStorage === 'undefined') {
    readIds.value = new Set()
    return
  }
  try {
    const raw = localStorage.getItem(`dev-flow-read-notifs_${currentUid}`)
    if (raw) {
      const arr = JSON.parse(raw)
      readIds.value = new Set(Array.isArray(arr) ? arr : [])
    } else {
      readIds.value = new Set()
    }
  } catch {
    readIds.value = new Set()
  }
}

function saveReadIds(uid?: string | null) {
  const currentUid = uid ?? auth.currentUser?.uid
  if (!currentUid || typeof localStorage === 'undefined') return
  try {
    const arr = Array.from(readIds.value)
    localStorage.setItem(`dev-flow-read-notifs_${currentUid}`, JSON.stringify(arr))
  } catch (err) {
    console.error('Error saving read notifications:', err)
  }
}

if (typeof localStorage !== 'undefined' && auth.currentUser) {
  loadReadIds(auth.currentUser.uid)
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    loadReadIds(user.uid)
  } else {
    readIds.value = new Set()
  }
})

export function useAppNotifications() {
  const { allProjects } = useProjects()
  const { tickets } = useTickets()

  const notifications = computed<AppNotification[]>(() => {
    const user = auth.currentUser
    if (!user) return []

    const items: AppNotification[] = []
    const now = Date.now()
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000

    // 1. Invitaciones pendientes (el usuario actual fue invitado)
    const userEmail = user.email?.toLowerCase().trim()
    if (userEmail) {
      for (const p of allProjects.value) {
        const isPending = p.members?.some(m => m.uid === 'pending_' + userEmail || m.email?.toLowerCase().trim() === userEmail && m.uid.startsWith('pending_'))
        if (isPending) {
          const owner = p.members?.find(m => m.role === 'owner')
          const id = `invite_${p.id}`
          items.push({
            id,
            type: 'invite',
            title: 'Invitación a colaborar',
            message: `Te invitaron al proyecto "${p.name}"`,
            detail: owner?.displayName ? `Por ${owner.displayName}` : 'Colaborador',
            timestamp: p.createdAt || now,
            read: readIds.value.has(id),
            projectId: p.id,
            severity: 'info',
          })
        }
      }
    }

    // 2. Invitaciones aceptadas (en proyectos donde el usuario es owner)
    for (const p of allProjects.value) {
      if (p.userId === user.uid && p.members) {
        for (const m of p.members) {
          if (!m.uid.startsWith('pending_') && m.role !== 'owner') {
            const id = `accepted_${p.id}_${m.uid}`
            items.push({
              id,
              type: 'invite-accepted',
              title: 'Invitación aceptada',
              message: `${m.displayName || m.email} aceptó tu invitación`,
              detail: `Proyecto: "${p.name}"`,
              timestamp: p.createdAt || now,
              read: readIds.value.has(id),
              projectId: p.id,
              severity: 'success',
            })
          }
        }
      }
    }

    // 3. Mapa de nombres de proyecto para tickets
    const projectMap = new Map<string, string>()
    for (const p of allProjects.value) {
      projectMap.set(p.id, p.name)
    }

    // 4. Tickets caducados o a punto de caducar
    for (const t of tickets.value) {
      if (t.status === 'completado') continue
      if (!t.endDate) continue

      const projectName = projectMap.get(t.projectId) || 'Proyecto'

      if (t.endDate < now) {
        const id = `ticket_expired_${t.id}`
        const diffDays = Math.max(1, Math.floor((now - t.endDate) / (24 * 60 * 60 * 1000)))
        items.push({
          id,
          type: 'ticket-expired',
          title: 'Ticket caducado',
          message: `"${t.title}" ha vencido`,
          detail: `${projectName} • Venció hace ${diffDays === 1 ? '1 día' : `${diffDays} días`}`,
          timestamp: t.endDate,
          read: readIds.value.has(id),
          projectId: t.projectId,
          ticketId: t.id,
          severity: 'urgent',
        })
      } else if (t.endDate - now <= twoDaysMs) {
        const isToday = new Date(t.endDate).toDateString() === new Date(now).toDateString()
        const id = `ticket_due_${t.id}`
        items.push({
          id,
          type: 'ticket-due-soon',
          title: 'Ticket por vencer',
          message: `"${t.title}" vence pronto`,
          detail: `${projectName} • Vence ${isToday ? 'hoy' : 'mañana'}`,
          timestamp: t.endDate,
          read: readIds.value.has(id),
          projectId: t.projectId,
          ticketId: t.id,
          severity: 'warning',
        })
      }
    }

    // 5. Sugerencias de vinculación con GitHub (para proyectos sin repo)
    for (const p of allProjects.value) {
      if (p.userId === user.uid && (!p.github || !p.github.trim())) {
        const id = `gh_suggest_${p.id}`
        items.push({
          id,
          type: 'github-suggestion',
          title: 'Vincular con GitHub',
          message: `"${p.name}" no está vinculado a GitHub`,
          detail: 'Conéctalo para ver ramas, commits y sincronización',
          timestamp: p.createdAt || now,
          read: readIds.value.has(id),
          projectId: p.id,
          severity: 'info',
        })
      }
    }

    // Ordenar: No leídas primero, luego por severidad (urgent > warning > info > success) y fecha descendente
    const severityWeight: Record<string, number> = {
      urgent: 4,
      warning: 3,
      info: 2,
      success: 1,
    }

    return items.sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1
      const weightDiff = (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0)
      if (weightDiff !== 0) return weightDiff
      return b.timestamp - a.timestamp
    })
  })

  const unreadCount = computed(() => {
    return notifications.value.filter(n => !n.read).length
  })

  const markAsRead = (id: string) => {
    readIds.value.add(id)
    saveReadIds()
  }

  const markAllAsRead = () => {
    for (const n of notifications.value) {
      readIds.value.add(n.id)
    }
    saveReadIds()
  }

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
  }
}

