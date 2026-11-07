/**
 * @file useProjects.ts
 * @description Gestión reactiva de proyectos, invitaciones, miembros y vinculación colaborativa.
 * Aplica el límite de MAX_PROJECTS_PER_WORKSPACE (20) y gestiona la auto-vinculación de invitados.
 */

import { ref, computed } from 'vue'
import { db, auth } from '../firebase'
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  type Timestamp,
} from 'firebase/firestore'
import type { Project, Member } from '../types/project'
import { useWorkspaces, fetchAndAddSharedWorkspace } from './useWorkspaces'

/** Límite máximo de proyectos permitidos por cada área de trabajo */
export const MAX_PROJECTS_PER_WORKSPACE = 20

/** Colección reactiva consolidada de proyectos (propios, miembros y pendientes) */
const allProjects = ref<Project[]>([])

/** Estado de carga inicial de proyectos */
const loading = ref(true)

let unsubOwned: (() => void) | null = null
let unsubMember: (() => void) | null = null
let unsubPending: (() => void) | null = null

/**
 * Transforma un documento de Firestore al modelo tipado Project.
 * @param docSnap Documento de Firestore
 */
function mapProject(docSnap: any): Project {
  const data = docSnap.data()
  const ts = data.createdAt as Timestamp | null
  return {
    id: docSnap.id,
    name: data.name,
    description: data.description,
    type: data.type,
    createdAt: ts ? ts.toMillis() : Date.now(),
    userId: data.userId,
    workspaceId: data.workspaceId ?? '',
    tech: data.tech ?? '',
    connections: data.connections ?? '',
    server: data.server ?? '',
    doc: data.doc ?? '',
    github: data.github ?? '',
    url: data.url ?? '',
    members: data.members ?? [],
    memberUids: data.memberUids ?? [],
  } as Project
}

// Suscripción reactiva al ciclo de vida de autenticación para cargar proyectos
auth.onAuthStateChanged((user) => {
  if (unsubOwned) { unsubOwned(); unsubOwned = null }
  if (unsubMember) { unsubMember(); unsubMember = null }
  if (unsubPending) { unsubPending(); unsubPending = null }

  if (!user) {
    allProjects.value = []
    loading.value = false
    return
  }

  // 1. Proyectos donde el usuario es el propietario
  const ownedQuery = query(
    collection(db, 'projects'),
    where('userId', '==', user.uid),
    orderBy('createdAt', 'desc')
  )

  // 2. Proyectos donde el usuario es miembro confirmado
  const memberQuery = query(
    collection(db, 'projects'),
    where('memberUids', 'array-contains', user.uid),
    orderBy('createdAt', 'desc')
  )

  unsubOwned = onSnapshot(
    ownedQuery,
    (snapshot) => {
      const upcoming = new Set<string>()
      for (const docSnap of snapshot.docs) {
        const p = mapProject(docSnap)
        upcoming.add(p.id)
        const idx = allProjects.value.findIndex(pr => pr.id === p.id)
        if (idx >= 0) allProjects.value[idx] = p
        else allProjects.value.push(p)
      }
      allProjects.value = allProjects.value.filter(pr => {
        if (pr.userId === user.uid && !upcoming.has(pr.id)) return false
        return true
      })
      loading.value = false
    },
    (error) => {
      console.error('Firestore owned error:', error)
      loading.value = false
    }
  )

  unsubMember = onSnapshot(
    memberQuery,
    (snapshot) => {
      for (const docSnap of snapshot.docs) {
        const p = mapProject(docSnap)
        if (p.userId === user.uid) continue
        const idx = allProjects.value.findIndex(pr => pr.id === p.id)
        if (idx >= 0) allProjects.value[idx] = p
        else allProjects.value.push(p)
        if (p.workspaceId) {
          fetchAndAddSharedWorkspace(p.workspaceId)
        }
      }
      loading.value = false
    },
    (error) => {
      console.error('Firestore member error:', error)
      loading.value = false
    }
  )

  // 3. Proyectos donde el correo del usuario tiene invitación pendiente
  if (user.email) {
    const pendingQuery = query(
      collection(db, 'projects'),
      where('memberUids', 'array-contains', 'pending_' + user.email),
      orderBy('createdAt', 'desc')
    )
    unsubPending = onSnapshot(
      pendingQuery,
      (snapshot) => {
        for (const docSnap of snapshot.docs) {
          const p = mapProject(docSnap)
          const idx = allProjects.value.findIndex(pr => pr.id === p.id)
          if (idx >= 0) allProjects.value[idx] = p
          else allProjects.value.push(p)
          if (p.workspaceId) {
            fetchAndAddSharedWorkspace(p.workspaceId)
          }
        }
      },
      (error) => {
        console.error('Firestore pending error:', error)
      }
    )
  }
})

/**
 * Composable useProjects: Métodos y estado para administración de proyectos y miembros.
 */
export function useProjects() {
  const { currentWorkspace, workspaces, setCurrentWorkspace } = useWorkspaces()

  /**
   * Proyectos filtrados de forma reactiva por el área de trabajo activa.
   * Si el usuario no tiene área activa pero tiene proyectos invitados, los devuelve directamente.
   */
  const projects = computed<Project[]>(() => {
    const activeWsId = currentWorkspace.value?.id || localStorage.getItem('dev-flow-active-workspace-id')
    if (!activeWsId) {
      if (workspaces.value.length === 0 && allProjects.value.length > 0) {
        return allProjects.value
      }
      return []
    }
    const firstWsId = workspaces.value[0]?.id

    return allProjects.value.filter(p => {
      if (p.workspaceId) {
        return p.workspaceId === activeWsId
      }
      return Boolean(firstWsId && activeWsId === firstWsId)
    })
  })

  /**
   * Carga un proyecto por su ID y añade automáticamente al usuario actual como miembro
   * si accede a través de un enlace de invitación. Sincroniza además el área compartida.
   * @param projectId ID del proyecto
   */
  const loadAndJoinProject = async (projectId: string): Promise<Project | null> => {
    const user = auth.currentUser
    if (!user || !projectId) return null

    try {
      const snap = await getDoc(doc(db, 'projects', projectId))
      if (!snap.exists()) return null
      const p = mapProject(snap)

      const isOwner = p.userId === user.uid
      const isMember = (p.memberUids || []).includes(user.uid)

      if (!isOwner && !isMember) {
        const cleanEmail = user.email || ''
        const realMember: Member = {
          uid: user.uid,
          email: cleanEmail,
          displayName: user.displayName || cleanEmail.split('@')[0] || 'Invitado',
          role: 'member',
          joinedAt: Date.now(),
        }

        const pendingUid = 'pending_' + cleanEmail
        const pendingMember = (p.members || []).find(m => m.uid === pendingUid)

        await updateDoc(doc(db, 'projects', projectId), {
          members: arrayUnion(realMember),
          memberUids: arrayUnion(user.uid),
        })

        if (pendingMember) {
          await updateDoc(doc(db, 'projects', projectId), {
            members: arrayRemove(pendingMember),
            memberUids: arrayRemove(pendingUid),
          }).catch(() => {})
        }

        p.members = [...(p.members || []).filter(m => m.uid !== pendingUid), realMember]
        p.memberUids = [...(p.memberUids || []).filter(uid => uid !== pendingUid), user.uid]
      }

      const idx = allProjects.value.findIndex(pr => pr.id === p.id)
      if (idx >= 0) allProjects.value[idx] = p
      else allProjects.value.push(p)

      if (p.workspaceId) {
        const ws = await fetchAndAddSharedWorkspace(p.workspaceId)
        if (ws && (!currentWorkspace.value || workspaces.value.length === 0)) {
          setCurrentWorkspace(ws)
        }
      }

      return p
    } catch (err) {
      console.error('Error loading or joining project:', err)
      return null
    }
  }

  /**
   * Crea un nuevo proyecto en Firestore validando el límite máximo de 20 por área de trabajo.
   * @param name Nombre del proyecto
   * @param description Descripción detallada
   * @param type Tipo de proyecto (backend, frontend, mobile, web, fullstack)
   * @param extra Parámetros opcionales (correo de colega, repositorio de GitHub)
   */
  const createProject = async (
    name: string,
    description: string,
    type: Project['type'] = 'fullstack',
    extra?: { colleagueEmail?: string; githubRepo?: string }
  ) => {
    const user = auth.currentUser
    if (!user) return

    if (projects.value.length >= MAX_PROJECTS_PER_WORKSPACE) {
      throw new Error(`Has alcanzado el límite máximo de ${MAX_PROJECTS_PER_WORKSPACE} proyectos en esta área de trabajo.`)
    }

    const targetWsId = currentWorkspace.value?.id
      || localStorage.getItem('dev-flow-active-workspace-id')
      || workspaces.value[0]?.id
      || ''

    const ownerMember: Member = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Usuario',
      role: 'owner',
      joinedAt: Date.now(),
    }

    const members: Member[] = [ownerMember]
    const memberUids: string[] = [user.uid]

    if (extra?.colleagueEmail?.trim()) {
      const email = extra.colleagueEmail.trim()
      members.push({
        uid: 'pending_' + email,
        email: email,
        displayName: email.split('@')[0],
        role: 'member',
        joinedAt: Date.now(),
      })
      memberUids.push('pending_' + email)
    }

    const projectData: any = {
      name,
      description,
      type: type || 'fullstack',
      userId: user.uid,
      workspaceId: targetWsId,
      createdAt: serverTimestamp(),
      members,
      memberUids,
    }

    if (extra?.githubRepo?.trim()) {
      projectData.github = extra.githubRepo.trim()
    }

    await addDoc(collection(db, 'projects'), projectData)
  }

  /**
   * Elimina un proyecto de Firestore (restringido a propietarios en reglas de seguridad).
   * @param projectId ID del proyecto
   */
  const deleteProject = async (projectId: string) => {
    const user = auth.currentUser
    if (!user) return
    await deleteDoc(doc(db, 'projects', projectId))
  }

  /**
   * Actualiza metadatos técnicos y enlaces del proyecto.
   * @param projectId ID del proyecto
   * @param data Campos a actualizar
   */
  const updateProject = async (projectId: string, data: Partial<Pick<Project, 'tech' | 'connections' | 'server' | 'doc' | 'github' | 'url'>>) => {
    const user = auth.currentUser
    if (!user) return
    await updateDoc(doc(db, 'projects', projectId), data)
  }

  /**
   * Añade un nuevo miembro a la lista de miembros de un proyecto.
   * @param projectId ID del proyecto
   * @param member Objeto de miembro a incorporar
   */
  const addMember = async (projectId: string, member: Member) => {
    const user = auth.currentUser
    if (!user) return
    await updateDoc(doc(db, 'projects', projectId), {
      members: arrayUnion(member),
      memberUids: arrayUnion(member.uid),
    })
  }

  /**
   * Remueve a un miembro de un proyecto.
   * @param projectId ID del proyecto
   * @param member Objeto de miembro a retirar
   */
  const removeMember = async (projectId: string, member: Member) => {
    const user = auth.currentUser
    if (!user) return
    await updateDoc(doc(db, 'projects', projectId), {
      members: arrayRemove(member),
      memberUids: arrayRemove(member.uid),
    })
  }

  /**
   * Retorna los miembros actuales de un proyecto en memoria.
   * @param projectId ID del proyecto
   */
  const getProjectMembers = (projectId: string): Member[] => {
    const p = allProjects.value.find(pr => pr.id === projectId)
    return p?.members ?? []
  }

  /**
   * Acepta una invitación pendiente por correo, transformando el registro en miembro oficial.
   * @param projectId ID del proyecto
   */
  const acceptInvite = async (projectId: string) => {
    const user = auth.currentUser
    if (!user || !user.email) return false
    const p = allProjects.value.find(pr => pr.id === projectId)
    if (!p) return false
    const pendingMember = p.members.find(m => m.uid === 'pending_' + user.email)
    if (!pendingMember) return false
    await updateDoc(doc(db, 'projects', projectId), {
      members: arrayRemove(pendingMember),
      memberUids: arrayRemove(pendingMember.uid),
    })
    const realMember: Member = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || user.email?.split('@')[0] || 'Usuario',
      role: 'member',
      joinedAt: Date.now(),
    }
    await updateDoc(doc(db, 'projects', projectId), {
      members: arrayUnion(realMember),
      memberUids: arrayUnion(user.uid),
    })
    if (p.workspaceId) {
      const ws = await fetchAndAddSharedWorkspace(p.workspaceId)
      if (ws && (!currentWorkspace.value || workspaces.value.length === 0)) {
        setCurrentWorkspace(ws)
      }
    }
    return true
  }

  /**
   * Rechaza una invitación pendiente, removiendo el registro pendiente del proyecto.
   * @param projectId ID del proyecto
   */
  const rejectInvite = async (projectId: string) => {
    const user = auth.currentUser
    if (!user || !user.email) return
    const p = allProjects.value.find(pr => pr.id === projectId)
    if (!p) return
    const pendingMember = p.members.find(m => m.uid === 'pending_' + user.email)
    if (!pendingMember) return
    await updateDoc(doc(db, 'projects', projectId), {
      members: arrayRemove(pendingMember),
      memberUids: arrayRemove(pendingMember.uid),
    })
  }

  return {
    projects,
    allProjects,
    loading,
    MAX_PROJECTS_PER_WORKSPACE,
    loadAndJoinProject,
    createProject,
    updateProject,
    deleteProject,
    addMember,
    removeMember,
    getProjectMembers,
    acceptInvite,
    rejectInvite,
  }
}
