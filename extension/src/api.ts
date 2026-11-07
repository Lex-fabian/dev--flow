/**
 * @file api.ts
 * @description Conexión con Firestore REST API para dev->flow
 */

export interface DevFlowTicket {
  id: string
  title: string
  description?: string
  status: 'sin-realizar' | 'en-proceso' | 'testing' | 'completado'
  priority: 'urgent' | 'high' | 'medium' | 'low'
  projectId: string
  assignedToEmail?: string
  gitBranch?: string
  createdAt?: number
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

export async function fetchUserTickets(userId: string, userEmail?: string): Promise<DevFlowTicket[]> {
  try {
    // Consulta estructurada por userId o assignedToEmail
    const queryPayload: any = {
      structuredQuery: {
        from: [{ collectionId: 'tickets' }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
        limit: 100,
      },
    }

    if (userId) {
      queryPayload.structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: 'userId' },
          op: 'EQUAL',
          value: { stringValue: userId },
        },
      }
    }

    const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryPayload),
    })

    if (!res.ok) {
      throw new Error(`Error en API dev->flow (${res.status})`)
    }

    const results = await res.json()
    if (!Array.isArray(results)) return []

    const tickets: DevFlowTicket[] = []
    for (const item of results) {
      if (!item.document || !item.document.fields) continue
      const f = item.document.fields
      const pathParts = item.document.name.split('/')
      const id = pathParts[pathParts.length - 1]

      tickets.push({
        id,
        title: parseFirestoreField(f.title) || 'Sin título',
        description: parseFirestoreField(f.description) || '',
        status: parseFirestoreField(f.status) || 'sin-realizar',
        priority: parseFirestoreField(f.priority) || 'medium',
        projectId: parseFirestoreField(f.projectId) || '',
        assignedToEmail: parseFirestoreField(f.assignedToEmail) || '',
        gitBranch: parseFirestoreField(f.gitBranch) || '',
        createdAt: parseFirestoreField(f.createdAt) || 0,
      })
    }

    return tickets
  } catch (err) {
    console.error('Error obteniendo tickets en extensión:', err)
    return []
  }
}

