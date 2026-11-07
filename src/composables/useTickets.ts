/**
 * @file useTickets.ts
 * @description Gestión reactiva de tickets, dependencias, subtickets y sincronización colaborativa en tiempo real.
 * Soporta escucha por usuario y escucha directa por proyecto (`watchProjectTickets`) para tableros compartidos.
 */

import { ref } from 'vue'
import { db, auth } from '../firebase'
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  type Timestamp,
} from 'firebase/firestore'
import type { Ticket, LinkedTicket } from '../types/ticket'

/** Colección reactiva consolidada de tickets cargados en memoria */
const tickets = ref<Ticket[]>([])

/** Estado de carga inicial de tickets */
const loading = ref(true)

/**
 * Transforma un documento de Firestore al modelo tipado Ticket.
 * @param docSnap Documento de Firestore
 */
function mapTicketDoc(docSnap: any): Ticket {
  const data = docSnap.data()
  const start = data.startDate as Timestamp | null
  const end = data.endDate as Timestamp | null
  const created = data.createdAt as Timestamp | null
  const completed = data.completedAt as Timestamp | null
  const closed = data.closedAt as Timestamp | null
  return {
    id: docSnap.id,
    projectId: data.projectId,
    title: data.title,
    description: data.description,
    priority: data.priority,
    startDate: start ? start.toMillis() : null,
    endDate: end ? end.toMillis() : null,
    status: data.status ?? 'sin-realizar',
    createdAt: created ? created.toMillis() : Date.now(),
    createdBy: data.createdBy ?? '',
    createdByEmail: data.createdByEmail ?? '',
    completedAt: completed ? completed.toMillis() : null,
    closedAt: closed ? closed.toMillis() : null,
    parentId: data.parentId ?? null,
    assignedTo: data.assignedTo ?? null,
    assignedToEmail: data.assignedToEmail ?? null,
    linkedTickets: data.linkedTickets ?? [],
    hasStarted: Boolean(data.hasStarted || (data.status && data.status !== 'sin-realizar')),
    gitBranch: data.gitBranch ?? null,
    gitCommits: data.gitCommits ?? [],
    gitPrNumber: data.gitPrNumber ?? null,
    gitPrUrl: data.gitPrUrl ?? null,
  } as Ticket
}

let unsubUserTickets: (() => void) | null = null
let unsubProjectTickets: (() => void) | null = null
let currentWatchedProjectId: string | null = null

// Escucha global de tickets creados por el usuario activo
auth.onAuthStateChanged((user) => {
  if (unsubUserTickets) {
    unsubUserTickets()
    unsubUserTickets = null
  }
  if (unsubProjectTickets) {
    unsubProjectTickets()
    unsubProjectTickets = null
    currentWatchedProjectId = null
  }

  if (!user) {
    tickets.value = []
    loading.value = false
    return
  }

  const q = query(
    collection(db, 'tickets'),
    where('userId', '==', user.uid),
    orderBy('createdAt', 'desc')
  )

  unsubUserTickets = onSnapshot(
    q,
    (snapshot) => {
      const userTickets = snapshot.docs.map(mapTicketDoc)
      const map = new Map<string, Ticket>()
      for (const t of tickets.value) {
        map.set(t.id, t)
      }
      for (const t of userTickets) {
        map.set(t.id, t)
      }
      tickets.value = Array.from(map.values())
      loading.value = false
    },
    (error) => {
      console.error('Tickets error:', error)
      loading.value = false
    }
  )
})

/**
 * Composable useTickets: Provee operaciones CRUD, transiciones de estado y relaciones entre tickets.
 */
export function useTickets() {
  /**
   * Suscribe en tiempo real a los tickets de un proyecto específico.
   * Permite que los miembros invitados visualicen las tarjetas colaborativas al instante.
   * @param projectId ID del proyecto activo en el tablero Kanban
   */
  const watchProjectTickets = (projectId: string) => {
    if (!projectId || projectId === currentWatchedProjectId) return
    if (unsubProjectTickets) {
      unsubProjectTickets()
      unsubProjectTickets = null
    }
    currentWatchedProjectId = projectId

    const qProj = query(
      collection(db, 'tickets'),
      where('projectId', '==', projectId)
    )

    unsubProjectTickets = onSnapshot(
      qProj,
      (snapshot) => {
        const projTickets = snapshot.docs.map(mapTicketDoc)
        const map = new Map<string, Ticket>()
        for (const t of tickets.value) {
          if (t.projectId !== projectId) {
            map.set(t.id, t)
          }
        }
        for (const t of projTickets) {
          map.set(t.id, t)
        }
        tickets.value = Array.from(map.values())
      },
      (err) => console.error('Error watching project tickets:', err)
    )
  }

  /**
   * Crea un nuevo ticket en Firestore.
   * @returns ID del documento creado
   */
  const createTicket = async (
    projectId: string,
    title: string,
    description: string,
    priority: Ticket['priority'],
    startDate: number | null,
    endDate: number | null,
    status: Ticket['status'] = 'sin-realizar',
    parentId: string | null = null,
    assignedTo: string | null = null,
    assignedToEmail: string | null = null,
  ): Promise<string | undefined> => {
    const user = auth.currentUser
    if (!user) return undefined

    const payload: Record<string, any> = {
      projectId,
      title,
      description,
      priority,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      status,
      userId: user.uid,
      createdBy: user.displayName || user.email?.split('@')[0] || 'Usuario',
      createdByEmail: user.email || '',
      createdAt: serverTimestamp(),
      hasStarted: status !== 'sin-realizar',
      parentId: parentId || null,
      assignedTo: assignedTo || null,
      assignedToEmail: assignedToEmail || null,
    }

    if (status === 'completado') {
      payload.completedAt = serverTimestamp()
    }

    const docRef = await addDoc(collection(db, 'tickets'), payload)
    return docRef.id
  }

  /**
   * Actualiza el estado de flujo de trabajo de un ticket (drag and drop o avance directo).
   * @param ticketId ID del ticket
   * @param status Nuevo estado (sin-realizar, en-proceso, testing, completado)
   */
  const updateTicketStatus = async (ticketId: string, status: Ticket['status']) => {
    const user = auth.currentUser
    if (!user) return

    const updates: Record<string, any> = { status }

    if (status !== 'sin-realizar') {
      updates.hasStarted = true
    }

    if (status === 'completado') {
      updates.completedAt = serverTimestamp()
    } else {
      updates.completedAt = null
    }

    await updateDoc(doc(db, 'tickets', ticketId), updates)
  }

  /**
   * Actualiza propiedades editables de un ticket existente.
   * @param ticketId ID del ticket
   * @param data Campos modificados
   */
  const updateTicket = async (
    ticketId: string,
    data: {
      title?: string
      description?: string
      priority?: Ticket['priority']
      startDate?: number | null
      endDate?: number | null
      status?: Ticket['status']
      parentId?: string | null
      assignedTo?: string | null
      assignedToEmail?: string | null
      gitCommits?: import('../types/ticket').GitCommitRef[]
      gitBranch?: string | null
      gitPrNumber?: number | null
      gitPrUrl?: string | null
    }
  ) => {
    const user = auth.currentUser
    if (!user) return

    const payload: Record<string, any> = {}
    if (data.title !== undefined) payload.title = data.title
    if (data.description !== undefined) payload.description = data.description
    if (data.priority !== undefined) payload.priority = data.priority
    if (data.startDate !== undefined) payload.startDate = data.startDate ? new Date(data.startDate) : null
    if (data.endDate !== undefined) payload.endDate = data.endDate ? new Date(data.endDate) : null
    if (data.status !== undefined) {
      payload.status = data.status
      if (data.status !== 'sin-realizar') payload.hasStarted = true
      payload.completedAt = data.status === 'completado' ? serverTimestamp() : null
    }
    if (data.parentId !== undefined) payload.parentId = data.parentId
    if (data.assignedTo !== undefined) payload.assignedTo = data.assignedTo
    if (data.assignedToEmail !== undefined) payload.assignedToEmail = data.assignedToEmail
    if (data.gitCommits !== undefined) payload.gitCommits = data.gitCommits
    if (data.gitBranch !== undefined) payload.gitBranch = data.gitBranch
    if (data.gitPrNumber !== undefined) payload.gitPrNumber = data.gitPrNumber
    if (data.gitPrUrl !== undefined) payload.gitPrUrl = data.gitPrUrl

    await updateDoc(doc(db, 'tickets', ticketId), payload)
  }

  /**
   * Asigna un miembro responsable al ticket.
   * @param ticketId ID del ticket
   * @param uid UID del miembro asignado (o null para desasignar)
   * @param email Correo electrónico del miembro asignado
   */
  const assignTicket = async (ticketId: string, uid: string | null, email: string | null) => {
    const user = auth.currentUser
    if (!user) return
    await updateDoc(doc(db, 'tickets', ticketId), {
      assignedTo: uid,
      assignedToEmail: email,
    })
  }

  /**
   * Elimina un ticket de Firestore.
   * @param ticketId ID del ticket
   */
  const deleteTicket = async (ticketId: string) => {
    const user = auth.currentUser
    if (!user) return
    await deleteDoc(doc(db, 'tickets', ticketId))
  }

  /**
   * Cierra un ticket completado, registrando fecha de cierre para archivarlo del tablero.
   * @param ticketId ID del ticket
   */
  const closeTicket = async (ticketId: string) => {
    const user = auth.currentUser
    if (!user) return
    await updateDoc(doc(db, 'tickets', ticketId), {
      closedAt: serverTimestamp(),
    })
  }

  /**
   * Vincula bidireccionalmente dos tickets con un tipo de relación (blocks, depends_on, related_to).
   * @param sourceId ID del ticket origen
   * @param targetId ID del ticket destino
   * @param type Tipo de enlace
   */
  const linkTicket = async (sourceId: string, targetId: string, type: LinkedTicket['type']) => {
    const user = auth.currentUser
    if (!user || sourceId === targetId) return

    const forwardLink: LinkedTicket = { ticketId: targetId, type }
    const reverseLink: LinkedTicket = {
      ticketId: sourceId,
      type: type === 'blocks' ? 'depends_on' : type === 'depends_on' ? 'blocks' : 'related_to',
    }

    await updateDoc(doc(db, 'tickets', sourceId), {
      linkedTickets: arrayUnion(forwardLink),
    })
    await updateDoc(doc(db, 'tickets', targetId), {
      linkedTickets: arrayUnion(reverseLink),
    })
  }

  /**
   * Desvincula dos tickets previamente enlazados.
   * @param ticketId ID del ticket origen
   * @param link Enlace a remover
   */
  const unlinkTicket = async (ticketId: string, link: LinkedTicket) => {
    const user = auth.currentUser
    if (!user) return
    const reverseLink: LinkedTicket = {
      ticketId,
      type: link.type === 'blocks' ? 'depends_on' : link.type === 'depends_on' ? 'blocks' : 'related_to',
    }
    await updateDoc(doc(db, 'tickets', ticketId), {
      linkedTickets: arrayRemove(link),
    })
    await updateDoc(doc(db, 'tickets', link.ticketId), {
      linkedTickets: arrayRemove(reverseLink),
    })
  }

  /**
   * Obtiene los detalles completos de los tickets vinculados a una tarjeta dada.
   * @param ticketId ID del ticket
   */
  const getLinkedTicketDetails = (ticketId: string) => {
    const ticket = tickets.value.find(t => t.id === ticketId)
    if (!ticket?.linkedTickets?.length) return []
    return ticket.linkedTickets.map(link => {
      const linked = tickets.value.find(t => t.id === link.ticketId)
      return { link, ticket: linked ?? null }
    })
  }

  return {
    tickets,
    loading,
    watchProjectTickets,
    createTicket,
    updateTicketStatus,
    updateTicket,
    deleteTicket,
    closeTicket,
    assignTicket,
    linkTicket,
    unlinkTicket,
    getLinkedTicketDetails,
  }
}
