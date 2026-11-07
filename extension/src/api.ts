/**
 * @file api.ts
 * @description Conexión con Firestore REST API para Dev Flow
 */

export interface DevFlowTicket {
  id: string
  title: string
  description?: string
  status: 'sin-realizar' | 'en-proceso' | 'testing' | 'completado'
  priority: 'urgent' | 'high' | 'medium' | 'low'
  projectId: string
  assignedToEmail?: string
  createdByEmail?: string
  gitBranch?: string
  createdAt?: number
}

export interface DevFlowProject {
  id: string
  name: string
  description?: string
  github?: string
  userId: string
  memberEmails?: string[]
}

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/dev-flow-7b197/databases/(default)/documents'

function parseFirestoreField(field: any): any {
  if (!field) return null
  if ('stringValue' in field) return field.stringValue
  if ('integerValue' in field) return parseInt(field.integerValue, 10)
  if ('doubleValue' in field) return parseFloat(field.doubleValue)
  if ('booleanValue' in field) return field.booleanValue
  if ('timestampValue' in field) return new Date(field.timestampValue).getTime()
  if ('nullValue' in field) return null
  return null
}

function parseProjectMembers(field: any): string[] {
  if (!field?.arrayValue?.values) return []
  return field.arrayValue.values
    .map((v: any) => v.mapValue?.fields?.email?.stringValue?.toLowerCase() || '')
    .filter(Boolean)
}

export async function fetchUserProjects(userId?: string, userEmail?: string): Promise<DevFlowProject[]> {
  try {
    const queryPayload: any = {
      structuredQuery: {
        from: [{ collectionId: 'projects' }],
        limit: 50,
      },
    }

    const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryPayload),
    })

    if (!res.ok) return []
    const results = await res.json()
    if (!Array.isArray(results)) return []

    const cleanEmail = (userEmail || '').trim().toLowerCase()
    const projects: DevFlowProject[] = []

    for (const item of results) {
      if (!item.document || !item.document.fields) continue
      const f = item.document.fields
      const pathParts = item.document.name.split('/')
      const id = pathParts[pathParts.length - 1]

      const pUserId = parseFirestoreField(f.userId) || ''
      const memberEmails = parseProjectMembers(f.members)

      // Filtrar si el usuario coincide (propietario o miembro)
      if (cleanEmail) {
        const isMember = memberEmails.includes(cleanEmail)
        const isOwner = userId && pUserId === userId
        // Si no tenemos userId aún pero el email coincide o no hay filtro estricto
        if (!isMember && !isOwner && memberEmails.length > 0) {
          continue
        }
      }

      projects.push({
        id,
        name: parseFirestoreField(f.name) || 'Proyecto sin nombre',
        description: parseFirestoreField(f.description) || '',
        github: parseFirestoreField(f.github) || '',
        userId: pUserId,
        memberEmails,
      })
    }

    return projects
  } catch (err) {
    console.error('Error fetching projects in extension:', err)
    return []
  }
}

export async function fetchUserTickets(userId?: string, userEmail?: string, projectId?: string): Promise<{ tickets: DevFlowTicket[]; resolvedUid?: string }> {
  try {
    const queryPayload: any = {
      structuredQuery: {
        from: [{ collectionId: 'tickets' }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
        limit: 100,
      },
    }

    const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryPayload),
    })

    if (!res.ok) {
      return { tickets: [] }
    }

    const results = await res.json()
    if (!Array.isArray(results)) return { tickets: [] }

    const cleanEmail = (userEmail || '').trim().toLowerCase()
    const tickets: DevFlowTicket[] = []
    let resolvedUid: string | undefined

    for (const item of results) {
      if (!item.document || !item.document.fields) continue
      const f = item.document.fields
      const pathParts = item.document.name.split('/')
      const id = pathParts[pathParts.length - 1]

      const tAssigned = (parseFirestoreField(f.assignedToEmail) || '').trim().toLowerCase()
      const tCreatedByEmail = (parseFirestoreField(f.createdByEmail) || '').trim().toLowerCase()
      const tUserId = parseFirestoreField(f.userId) || parseFirestoreField(f.createdBy) || ''
      const tProjectId = parseFirestoreField(f.projectId) || ''

      // Auto-resolver UID del usuario si encontramos su email en el ticket
      if (cleanEmail && (tAssigned === cleanEmail || tCreatedByEmail === cleanEmail) && tUserId) {
        resolvedUid = tUserId
      }

      // Si se especificó correo, verificar si pertenece a este usuario
      if (cleanEmail) {
        const matchesUser =
          tAssigned === cleanEmail ||
          tCreatedByEmail === cleanEmail ||
          (userId && tUserId === userId)

        // Si no coincide y tiene correos explícitos, omitir
        if (!matchesUser && (tAssigned || tCreatedByEmail)) {
          continue
        }
      }

      // Filtrar por proyecto si hay uno seleccionado
      if (projectId && tProjectId && tProjectId !== projectId) {
        continue
      }

      tickets.push({
        id,
        title: parseFirestoreField(f.title) || 'Sin título',
        description: parseFirestoreField(f.description) || '',
        status: parseFirestoreField(f.status) || 'sin-realizar',
        priority: parseFirestoreField(f.priority) || 'medium',
        projectId: tProjectId,
        assignedToEmail: tAssigned,
        createdByEmail: tCreatedByEmail,
        gitBranch: parseFirestoreField(f.gitBranch) || '',
        createdAt: parseFirestoreField(f.createdAt) || 0,
      })
    }

    return { tickets, resolvedUid }
  } catch (err) {
    console.error('Error fetching tickets in extension:', err)
    return { tickets: [] }
  }
}
