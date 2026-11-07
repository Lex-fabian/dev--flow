/**
 * @file useWorkspaces.ts
 * @description Gestión reactiva de áreas de trabajo (propias y compartidas/invitadas).
 * Soporta hasta MAX_WORKSPACES (5) por usuario y sincronización automática en Firestore.
 */

import { ref, computed } from 'vue'
import { db, auth } from '../firebase'
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore'
import type { Workspace } from '../types/workspace'

/** Clave de almacenamiento local para persistir el ID del área activa */
const STORAGE_KEY = 'dev-flow-active-workspace-id'

/** Límite máximo de áreas de trabajo propias que puede crear un usuario */
export const MAX_WORKSPACES = 5

/** Lista reactiva de áreas de trabajo propiedad del usuario autenticado */
const workspaces = ref<Workspace[]>([])

/** Lista reactiva de áreas compartidas donde el usuario participa como invitado */
const sharedWorkspaces = ref<Workspace[]>([])

/** Área de trabajo actualmente seleccionada */
const currentWorkspace = ref<Workspace | null>(null)

/** Estado de carga inicial de las áreas de trabajo */
const loading = ref(true)

let unsubWorkspaces: (() => void) | null = null

/**
 * Transforma un documento de Firestore al modelo tipado Workspace.
 * @param docSnap Documento de Firestore
 */
function mapWorkspace(docSnap: any): Workspace {
  const data = docSnap.data()
  const ts = data.createdAt as Timestamp | null
  return {
    id: docSnap.id,
    name: data.name || 'Sin nombre',
    userId: data.userId || '',
    createdAt: ts ? ts.toMillis() : Date.now(),
  }
}

/**
 * Consulta un área de trabajo compartida y la incorpora al estado local reactivo.
 * Si el usuario no tiene área activa o no posee áreas propias, la selecciona automáticamente.
 * @param workspaceId ID del área de trabajo a consultar
 */
export async function fetchAndAddSharedWorkspace(workspaceId: string): Promise<Workspace | null> {
  if (!workspaceId) return null
  const existing = workspaces.value.find(w => w.id === workspaceId) || sharedWorkspaces.value.find(w => w.id === workspaceId)
  if (existing) {
    if (!currentWorkspace.value) {
      currentWorkspace.value = existing
      localStorage.setItem(STORAGE_KEY, existing.id)
    }
    return existing
  }

  try {
    const snap = await getDoc(doc(db, 'workspaces', workspaceId))
    if (!snap.exists()) return null
    const ws = mapWorkspace(snap)
    if (!sharedWorkspaces.value.some(w => w.id === ws.id)) {
      sharedWorkspaces.value.push(ws)
    }
    const savedId = localStorage.getItem(STORAGE_KEY)
    if (!currentWorkspace.value || savedId === ws.id || (workspaces.value.length === 0 && !currentWorkspace.value)) {
      currentWorkspace.value = ws
      localStorage.setItem(STORAGE_KEY, ws.id)
    }
    return ws
  } catch (err) {
    console.error('Error fetching shared workspace:', err)
    return null
  }
}

// Suscripción reactiva al ciclo de vida de autenticación para cargar áreas de trabajo
auth.onAuthStateChanged((user) => {
  if (unsubWorkspaces) {
    unsubWorkspaces()
    unsubWorkspaces = null
  }

  if (!user) {
    workspaces.value = []
    sharedWorkspaces.value = []
    currentWorkspace.value = null
    loading.value = false
    return
  }

  loading.value = true

  const q = query(
    collection(db, 'workspaces'),
    where('userId', '==', user.uid)
  )

  unsubWorkspaces = onSnapshot(
    q,
    (snapshot) => {
      const list: Workspace[] = []
      for (const d of snapshot.docs) {
        list.push(mapWorkspace(d))
      }
      list.sort((a, b) => a.createdAt - b.createdAt)
      workspaces.value = list

      // Sincronizar área activa preferente
      const savedId = localStorage.getItem(STORAGE_KEY)
      const allAvailable = [...list, ...sharedWorkspaces.value]
      if (savedId && allAvailable.some(w => w.id === savedId)) {
        currentWorkspace.value = allAvailable.find(w => w.id === savedId) || null
      } else if (list.length > 0) {
        currentWorkspace.value = list[0]
        localStorage.setItem(STORAGE_KEY, list[0].id)
      } else if (sharedWorkspaces.value.length > 0) {
        currentWorkspace.value = sharedWorkspaces.value[0]
        localStorage.setItem(STORAGE_KEY, sharedWorkspaces.value[0].id)
      } else {
        currentWorkspace.value = null
      }

      loading.value = false
    },
    (err) => {
      console.error('Error fetching workspaces:', err)
      loading.value = false
    }
  )
})

/**
 * Composable useWorkspaces: Provee métodos y estado para gestión de áreas de trabajo.
 */
export function useWorkspaces() {
  /** Lista consolidada de todas las áreas accesibles (propias y compartidas) */
  const allWorkspaces = computed<Workspace[]>(() => {
    const result: Workspace[] = [...workspaces.value]
    for (const sw of sharedWorkspaces.value) {
      if (!result.some(w => w.id === sw.id)) {
        result.push(sw)
      }
    }
    return result
  })

  /** Indica si el usuario actual es el propietario del área de trabajo activa */
  const isCurrentWorkspaceOwner = computed(() => {
    const user = auth.currentUser
    if (!user || !currentWorkspace.value) return false
    return currentWorkspace.value.userId === user.uid
  })

  /**
   * Crea una nueva área de trabajo propia en Firestore.
   * Valida nombre no vacío y límite de MAX_WORKSPACES.
   * @param name Nombre del área de trabajo
   */
  const createWorkspace = async (name: string): Promise<Workspace> => {
    const user = auth.currentUser
    if (!user) throw new Error('No hay usuario autenticado')

    const cleanName = name.trim()
    if (!cleanName) throw new Error('El nombre del área de trabajo es requerido')

    if (workspaces.value.length >= MAX_WORKSPACES) {
      throw new Error(`Puedes crear hasta un máximo de ${MAX_WORKSPACES} áreas de trabajo.`)
    }

    const docRef = await addDoc(collection(db, 'workspaces'), {
      name: cleanName,
      userId: user.uid,
      createdAt: serverTimestamp(),
    })

    const newWs: Workspace = {
      id: docRef.id,
      name: cleanName,
      userId: user.uid,
      createdAt: Date.now(),
    }

    currentWorkspace.value = newWs
    localStorage.setItem(STORAGE_KEY, newWs.id)

    return newWs
  }

  /**
   * Establece el área de trabajo activa y la persiste en almacenamiento local.
   * @param ws Área de trabajo a seleccionar
   */
  const setCurrentWorkspace = (ws: Workspace) => {
    currentWorkspace.value = ws
    localStorage.setItem(STORAGE_KEY, ws.id)
  }

  /**
   * Elimina un área de trabajo de Firestore (solo permitido para el propietario).
   * @param workspaceId ID del área a eliminar
   */
  const deleteWorkspace = async (workspaceId: string) => {
    const user = auth.currentUser
    if (!user) return
    await deleteDoc(doc(db, 'workspaces', workspaceId))
  }

  return {
    workspaces,
    sharedWorkspaces,
    allWorkspaces,
    currentWorkspace,
    isCurrentWorkspaceOwner,
    loading,
    MAX_WORKSPACES,
    createWorkspace,
    setCurrentWorkspace,
    deleteWorkspace,
    fetchAndAddSharedWorkspace,
  }
}
