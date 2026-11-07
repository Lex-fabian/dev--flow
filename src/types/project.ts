export interface Member {
  uid: string
  email: string
  displayName: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: number
}

export interface Project {
  id: string
  name: string
  description: string
  type: 'backend' | 'frontend' | 'mobile' | 'web' | 'fullstack'
  createdAt: number
  userId: string
  workspaceId?: string
  tech?: string
  connections?: string
  server?: string
  doc?: string
  github?: string
  url?: string
  members: Member[]
  memberUids?: string[]
}
