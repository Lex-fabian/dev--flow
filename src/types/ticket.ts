export type TicketStatus = 'sin-realizar' | 'en-proceso' | 'testing' | 'completado'
export type TicketPriority = 'urgent' | 'high' | 'medium' | 'low'
export type LinkType = 'blocks' | 'depends_on' | 'related_to'

export interface LinkedTicket {
  ticketId: string
  type: LinkType
}

export interface GitCommitRef {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
  url: string
}

export interface Ticket {
  id: string
  projectId: string
  title: string
  description: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  status: TicketStatus
  startDate: number | null
  endDate: number | null
  createdAt: number
  createdBy: string
  createdByEmail: string
  completedAt: number | null
  closedAt: number | null
  parentId: string | null
  assignedTo: string | null
  assignedToEmail: string | null
  linkedTickets: LinkedTicket[]
  hasStarted?: boolean
  gitBranch?: string | null
  gitCommits?: GitCommitRef[]
  gitPrNumber?: number | null
  gitPrUrl?: string | null
}
