<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { auth } from '../../firebase'
import { useProjects } from '../../composables/useProjects'
import { useTickets } from '../../composables/useTickets'
import { useGithubRepo } from '../../composables/useGithubRepo'
import { useGithubToken } from '../../composables/useGithubToken'
import { useUserGithubRepos } from '../../composables/useUserGithubRepos'
import { useActivityLog } from '../../composables/useActivityLog'
import { useEmailNotifications } from '../../composables/useEmailNotifications'
import type { Ticket, TicketStatus } from '../../types/ticket'
import type { Member } from '../../types/project'
import GitHookModal from './GitHookModal.vue'

const showGitHookModal = ref(false)

const { sendInviteEmail } = useEmailNotifications()

const props = defineProps<{
  projectId: string
  visible: boolean
  initialTab?: string
}>()

const emit = defineEmits<{
  close: []
  'select-ticket': [ticketId: string]
}>()

const router = useRouter()
const { projects, updateProject, deleteProject, addMember, removeMember, getProjectMembers } = useProjects()
const { tickets } = useTickets()
const { getActivities, loadActivities } = useActivityLog()

const project = computed(() => projects.value.find(p => p.id === props.projectId))
const projectMembers = computed(() => getProjectMembers(props.projectId))
const isOwner = computed(() => Boolean(project.value && auth.currentUser && project.value.userId === auth.currentUser.uid))

// ── Field editing & GitHub URL ──
const projectTech = ref('')
const projectConnections = ref('')
const projectServer = ref('')
const projectDoc = ref('')
const projectGithub = ref('')

watch(project, (p) => {
  if (!p) return
  projectTech.value = p.tech ?? ''
  projectConnections.value = p.connections ?? ''
  projectServer.value = p.server ?? ''
  projectDoc.value = p.doc ?? ''
  projectGithub.value = p.github ?? ''
}, { immediate: true })

const githubUrl = computed(() => projectGithub.value || project.value?.github || '')
const { token: githubToken, connectWithGithubOAuth } = useGithubToken()
const { info: repoInfo, readme: repoReadme, files: repoFiles, loading: repoLoading, error: repoError } = useGithubRepo(githubUrl, githubToken)

// ── GitHub Repositories for Linking / Unlinking ──
const {
  hasToken: hasGithubToken,
  repos: userRepos,
  loading: loadingUserRepos,
  error: userReposError,
  fetchRepos: fetchUserRepos,
  connectToken: connectGithubToken,
} = useUserGithubRepos()

const newGithubUrl = ref('')
const selectedRepoUrl = ref('')
const isLinkingGithub = ref(false)
const isChangingRepo = ref(false)
const connectingOAuth = ref(false)
const quickTokenInput = ref('')
const isConnectingToken = ref(false)
const showManualToken = ref(false)

async function handleConnectOAuth() {
  connectingOAuth.value = true
  try {
    const t = await connectWithGithubOAuth()
    if (t) {
      await fetchUserRepos(true)
    }
  } catch (err) {
    console.error('Error conectando GitHub OAuth:', err)
  } finally {
    connectingOAuth.value = false
  }
}

async function handleConnectManualToken() {
  const val = quickTokenInput.value.trim()
  if (!val) return
  isConnectingToken.value = true
  try {
    await connectGithubToken(val)
    quickTokenInput.value = ''
    showManualToken.value = false
  } catch (e) {
    console.error('Error conectando token:', e)
  } finally {
    isConnectingToken.value = false
  }
}

function startChangeRepo() {
  isChangingRepo.value = true
  selectedRepoUrl.value = projectGithub.value || ''
  newGithubUrl.value = projectGithub.value || ''
}

function cancelChangeRepo() {
  isChangingRepo.value = false
  selectedRepoUrl.value = ''
  newGithubUrl.value = ''
}

async function handleLinkGithub(customUrl?: string) {
  const url = (customUrl || (hasGithubToken.value ? selectedRepoUrl.value : newGithubUrl.value)).trim()
  if (!url || !isOwner.value) return
  isLinkingGithub.value = true
  try {
    projectGithub.value = url
    await updateProject(props.projectId, { github: url } as any)
    newGithubUrl.value = ''
    selectedRepoUrl.value = ''
    isChangingRepo.value = false
  } catch (e) {
    console.error('Error vinculando repositorio:', e)
  } finally {
    isLinkingGithub.value = false
  }
}

async function handleUnlinkGithub() {
  if (!isOwner.value) return
  const ok = window.confirm('¿Seguro que deseas desvincular el repositorio de GitHub de este proyecto?')
  if (!ok) return
  try {
    projectGithub.value = ''
    await updateProject(props.projectId, { github: '' } as any)
    selectedRepoUrl.value = ''
    newGithubUrl.value = ''
    isChangingRepo.value = false
  } catch (e) {
    console.error('Error desvinculando repositorio:', e)
  }
}

const activeTab = ref(props.initialTab || 'inicio')

watch(activeTab, (tab) => {
  if (tab === 'ajustes' || tab === 'github') {
    fetchUserRepos().catch(() => {})
  }
}, { immediate: true })

const allProjectTickets = computed(() =>
  tickets.value.filter(t => t.projectId === props.projectId)
)

const parentTickets = computed(() =>
  allProjectTickets.value.filter(t => !t.parentId)
)

const ticketChildren = computed(() => {
  const map: Record<string, Ticket[]> = {}
  for (const t of allProjectTickets.value) {
    if (t.parentId) {
      if (!map[t.parentId]) map[t.parentId] = []
      map[t.parentId].push(t)
    }
  }
  return map
})

const selectedTicketId = ref<string | null>(null)

const projectStats = computed(() => {
  const all = tickets.value.filter(t => t.projectId === props.projectId)
  const total = all.length
  const completed = all.filter(t => t.status === 'completado').length
  const inProgress = all.filter(t => t.status === 'en-proceso').length
  const testing = all.filter(t => t.status === 'testing').length
  const pending = all.filter(t => t.status === 'sin-realizar').length
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return { total, completed, inProgress, testing, pending, pct }
})

function getTicketById(id: string) {
  return tickets.value.find(t => t.id === id && t.projectId === props.projectId) ?? null
}

// ── Comment state (separated by status) ──
interface DrawerComment {
  id: string
  author: string
  text: string
  time: number
  status: TicketStatus
  imageUrl?: string | null
}

const ticketComments = ref<Record<string, DrawerComment[]>>({})
const commentListeners = ref<Record<string, () => void>>({})
const activeCommentTab = ref<TicketStatus>('sin-realizar')
const ticketHistorySubTab = ref<'comments' | 'activity' | 'changes'>('comments')

const movedActivities = computed(() => {
  if (!selectedTicketId.value) return []
  return getActivities(selectedTicketId.value).filter(a => a.action === 'moved')
})

const changeActivities = computed(() => {
  if (!selectedTicketId.value) return []
  return getActivities(selectedTicketId.value).filter(a => a.action === 'edited' || a.action === 'created' || a.action === 'closed')
})
const statusList: TicketStatus[] = ['sin-realizar', 'en-proceso', 'testing', 'completado']

function getStatusComments(ticketId: string | null, status: TicketStatus): DrawerComment[] {
  if (!ticketId) return []
  const all = ticketComments.value[ticketId] || []
  return all.filter(c => c.status === status)
}

import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'

function loadTicketComments(ticketId: string) {
  if (commentListeners.value[ticketId]) commentListeners.value[ticketId]()
  const q = query(collection(db, 'tickets', ticketId, 'comments'), orderBy('time', 'asc'))
  commentListeners.value[ticketId] = onSnapshot(q, (snap) => {
    ticketComments.value[ticketId] = snap.docs.map(d => {
      const data = d.data()
      return {
        id: d.id,
        author: data.author || 'Anónimo',
        text: data.text || '',
        time: (data.time as number) || Date.now(),
        status: (data.status || 'sin-realizar') as TicketStatus,
        imageUrl: data.imageUrl || null,
      }
    })
  })
}

function formatActivityDateTime(ts: number): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleString([], {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

watch(selectedTicketId, (id) => {
  if (id) {
    loadTicketComments(id)
    loadActivities(id)
    const t = getTicketById(id)
    if (t) {
      activeCommentTab.value = t.status || 'sin-realizar'
    }
  }
})
watch(() => props.visible, (v) => { if (!v) selectedTicketId.value = null })
onUnmounted(() => { Object.values(commentListeners.value).forEach(u => u()) })

// ── Field editing ──
const editField = ref<string | null>(null)
const editValue = ref('')
const showDeleteConfirm = ref(false)

const fieldLabels: Record<string, string> = {
  tech: 'Tecnologías / Herramientas',
  connections: 'Conexiones / Integraciones',
  server: 'Servidor',
  doc: 'Documentación',
  github: 'Repositorio GitHub',
}

function openEdit(field: string) {
  if (field === 'tech') editValue.value = projectTech.value
  else if (field === 'connections') editValue.value = projectConnections.value
  else if (field === 'server') editValue.value = projectServer.value
  else if (field === 'doc') editValue.value = projectDoc.value
  else if (field === 'github') editValue.value = projectGithub.value
  editField.value = field
}

async function saveEdit() {
  if (!editField.value) return
  const field = editField.value
  const value = editValue.value
  if (field === 'tech') projectTech.value = value
  else if (field === 'connections') projectConnections.value = value
  else if (field === 'server') projectServer.value = value
  else if (field === 'doc') projectDoc.value = value
  else if (field === 'github') projectGithub.value = value
  editField.value = null
  await updateProject(props.projectId, { [field]: value } as any)
}

function cancelEdit() { editField.value = null }

async function handleDeleteProject() {
  await deleteProject(props.projectId)
  showDeleteConfirm.value = false
  router.push('/')
}

// ── Members ──
const showInviteMember = ref(false)
const inviteEmail = ref('')
const inviteStatus = ref('')
const copiedLink = ref(false)

function copyInviteLink() {
  if (!isOwner.value) return
  const link = `${window.location.origin}/proyectos/${props.projectId}`
  navigator.clipboard.writeText(link).then(() => {
    copiedLink.value = true
    setTimeout(() => { copiedLink.value = false }, 2500)
  }).catch(() => {
    const textarea = document.createElement('textarea')
    textarea.value = link
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copiedLink.value = true
    setTimeout(() => { copiedLink.value = false }, 2500)
  })
}

async function handleInviteMember() {
  if (!isOwner.value) return
  const email = inviteEmail.value.trim()
  if (!email || !project.value) return
  inviteStatus.value = 'Enviando...'
  try {
    await sendInviteEmail(project.value.name, props.projectId, auth.currentUser?.email || 'Un usuario', email)
    const member: Member = { uid: 'pending_' + email, email, displayName: email.split('@')[0], role: 'member', joinedAt: Date.now() }
    await addMember(props.projectId, member)
    inviteStatus.value = 'Invitación enviada'
    inviteEmail.value = ''
    setTimeout(() => { inviteStatus.value = ''; showInviteMember.value = false }, 2000)
  } catch (e) {
    inviteStatus.value = 'Error al enviar'
    console.error(e)
  }
}

async function handleRemoveMember(member: Member) {
  if (!isOwner.value) return
  await removeMember(props.projectId, member)
}

function getFileUrl(path: string): string {
  const base = (githubUrl.value || '').replace(/\/$/, '')
  const branch = repoInfo.value?.defaultBranch || 'main'
  return `${base}/blob/${branch}/${path}`
}

const priorityLabel: Record<string, string> = {
  urgent: 'urgente', high: 'alta', medium: 'media', low: 'baja',
}
const statusLabel = (key: TicketStatus): string => {
  const map: Record<string, string> = {
    'sin-realizar': 'Sin Realizar', 'en-proceso': 'En Proceso', 'testing': 'Testing', 'completado': 'Completado',
  }
  return map[key] ?? key
}
const formatDate = (ts: number | null) => ts ? new Date(ts).toLocaleDateString() : ''

// ── GitHub files ──
const sortedFiles = computed(() =>
  [...repoFiles.value].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
)

// ── Markdown ──
function renderMarkdown(text: string): string {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="readme-code-block"><code>$2</code></pre>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
  return '<p>' + html + '</p>'
}
</script>

<template>
  <div class="drawer-overlay" @click="emit('close')"></div>
  <div class="drawer" @click.stop>
    <div class="drawer-header">
      <h3 class="drawer-title">{{ project?.name }}</h3>
      <button class="drawer-close" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
    <div class="drawer-tabs">
      <button class="drawer-tab" :class="{ active: activeTab === 'inicio' }" @click="activeTab = 'inicio'; selectedTicketId = null">Inicio</button>
      <button class="drawer-tab" :class="{ active: activeTab === 'ticket' }" @click="activeTab = 'ticket'; selectedTicketId = null">Historial Ticket</button>
      <button class="drawer-tab" :class="{ active: activeTab === 'documentacion' }" @click="activeTab = 'documentacion'; selectedTicketId = null">Documentación</button>
      <button class="drawer-tab" :class="{ active: activeTab === 'github' }" @click="activeTab = 'github'; selectedTicketId = null">GitHub</button>
      <button class="drawer-tab" :class="{ active: activeTab === 'ajustes' }" @click="activeTab = 'ajustes'; selectedTicketId = null">Configuración</button>
    </div>
    <div class="drawer-body">
      <!-- INICIO -->
      <template v-if="activeTab === 'inicio'">
        <div class="project-stats">
          <span class="detail-label">Progreso</span>
          <div class="stats-row">
            <div class="stat-item"><span class="stat-value">{{ projectStats.total }}</span><span class="stat-label">Total</span></div>
            <div class="stat-item"><span class="stat-value stat-pending">{{ projectStats.pending }}</span><span class="stat-label">Pendientes</span></div>
            <div class="stat-item"><span class="stat-value stat-progress">{{ projectStats.inProgress }}</span><span class="stat-label">En Proceso</span></div>
            <div class="stat-item"><span class="stat-value stat-testing">{{ projectStats.testing }}</span><span class="stat-label">Testing</span></div>
            <div class="stat-item"><span class="stat-value stat-done">{{ projectStats.completed }}</span><span class="stat-label">Completados</span></div>
          </div>
          <div class="progress-bar"><div class="progress-fill" :style="{ width: projectStats.pct + '%' }"></div></div>
          <span class="progress-text">{{ projectStats.pct }}% completado</span>
        </div>
        <div class="drawer-divider"></div>
        <div class="drawer-field">
          <span class="detail-label">Equipo</span>
          <div class="member-list">
            <div v-for="m in projectMembers" :key="m.uid" class="member-item">
              <span class="member-avatar" :class="{ 'member-avatar--pending': m.uid.startsWith('pending_') }">{{ m.uid.startsWith('pending_') ? '?' : m.displayName[0].toUpperCase() }}</span>
              <div class="member-info">
                <span class="member-name">{{ m.uid.startsWith('pending_') ? 'Pendiente' : m.displayName }}</span>
                <span class="member-email">{{ m.email }}</span>
                <span class="member-role" :class="m.uid.startsWith('pending_') ? 'role--pending' : 'role--' + m.role">{{ m.uid.startsWith('pending_') ? 'Pendiente' : m.role === 'owner' ? 'Propietario' : m.role === 'admin' ? 'Admin' : 'Miembro' }}</span>
              </div>
              <button v-if="project?.userId === auth.currentUser?.uid && m.role !== 'owner'" class="member-remove" @click="handleRemoveMember(m)" title="Eliminar miembro">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div v-if="isOwner" class="invite-actions">
            <button class="invite-btn" @click="showInviteMember = !showInviteMember">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="23" y2="17"/><line x1="20" y1="14" x2="26" y2="14"/></svg>
              Invitar por correo
            </button>
            <button class="invite-btn" @click="copyInviteLink">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              {{ copiedLink ? '¡Enlace copiado!' : 'Copiar enlace' }}
            </button>
          </div>
          <div v-if="isOwner && showInviteMember" class="invite-form">
            <input v-model="inviteEmail" type="email" class="drawer-input" placeholder="correo@ejemplo.com" @keyup.enter="handleInviteMember" />
            <button class="invite-send-btn" @click="handleInviteMember" :disabled="!inviteEmail.trim()">Enviar invitación</button>
            <span v-if="inviteStatus" class="invite-status">{{ inviteStatus }}</span>
          </div>
        </div>
      </template>

      <!-- TICKET HISTORY -->
      <template v-else-if="activeTab === 'ticket'">
        <div class="ticket-split">
          <div class="ticket-split-left">
            <span class="detail-label">Todos los tickets</span>
            <div class="ticket-tree">
              <div v-for="pt in parentTickets" :key="pt.id" class="ticket-tree-item" :class="{ 'ticket-tree-item--active': selectedTicketId === pt.id }" @click="selectedTicketId = pt.id">
                <div class="ticket-tree-row">
                  <span class="ticket-tree-prio" :class="'prio--' + pt.priority">{{ priorityLabel[pt.priority] }}</span>
                  <span class="ticket-tree-title">{{ pt.title }}</span>
                  <span class="ticket-tree-status" :class="'status--' + pt.status">{{ statusLabel(pt.status) }}</span>
                </div>
                <div v-if="ticketChildren[pt.id]?.length" class="ticket-tree-children">
                  <div v-for="ct in ticketChildren[pt.id]" :key="ct.id" class="ticket-tree-item ticket-tree-item--child" :class="{ 'ticket-tree-item--active': selectedTicketId === ct.id }" @click.stop="selectedTicketId = ct.id">
                    <div class="ticket-tree-row">
                      <span class="ticket-tree-prio" :class="'prio--' + ct.priority">{{ priorityLabel[ct.priority] }}</span>
                      <span class="ticket-tree-title">{{ ct.title }}</span>
                      <span class="ticket-tree-status" :class="'status--' + ct.status">{{ statusLabel(ct.status) }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <p v-if="!parentTickets.length" class="detail-placeholder">No hay tickets en este proyecto</p>
            </div>
          </div>
          <div v-if="selectedTicketId" class="ticket-split-right">
            <div class="drawer-field">
              <span class="detail-label">Título</span>
              <p class="detail-value">{{ getTicketById(selectedTicketId)?.title }}</p>
            </div>
            <div class="drawer-field">
              <span class="detail-label">Descripción</span>
              <p class="detail-value">{{ getTicketById(selectedTicketId)?.description || 'Sin descripción' }}</p>
            </div>
            <div class="ticket-split-meta">
              <span class="ticket-tree-prio" :class="'prio--' + getTicketById(selectedTicketId)?.priority">{{ getTicketById(selectedTicketId) ? priorityLabel[getTicketById(selectedTicketId)!.priority] : '' }}</span>
              <span class="ticket-tree-status" :class="'status--' + getTicketById(selectedTicketId)?.status">{{ getTicketById(selectedTicketId) ? statusLabel(getTicketById(selectedTicketId)!.status) : '' }}</span>
              <span v-if="getTicketById(selectedTicketId)?.startDate || getTicketById(selectedTicketId)?.endDate" class="ticket-split-dates">
                {{ formatDate(getTicketById(selectedTicketId)!.startDate) }}{{ getTicketById(selectedTicketId)!.startDate && getTicketById(selectedTicketId)!.endDate ? ' → ' : '' }}{{ formatDate(getTicketById(selectedTicketId)!.endDate) }}
              </span>
            </div>
            <div class="drawer-divider"></div>
            <div class="ticket-history-tabs">
              <button
                type="button"
                class="history-tab-btn"
                :class="{ active: ticketHistorySubTab === 'comments' }"
                @click="ticketHistorySubTab = 'comments'"
              >
                Comentarios
              </button>
              <button
                type="button"
                class="history-tab-btn"
                :class="{ active: ticketHistorySubTab === 'activity' }"
                @click="ticketHistorySubTab = 'activity'"
              >
                Actividad
              </button>
              <button
                type="button"
                class="history-tab-btn"
                :class="{ active: ticketHistorySubTab === 'changes' }"
                @click="ticketHistorySubTab = 'changes'"
              >
                Cambios
              </button>
            </div>

            <!-- TAB 1: COMENTARIOS -->
            <div v-if="ticketHistorySubTab === 'comments'" class="drawer-field">
              <div class="comments-status-nav">
                <button
                  v-for="st in statusList"
                  :key="st"
                  type="button"
                  class="comment-nav-btn"
                  :class="{ active: activeCommentTab === st }"
                  @click="activeCommentTab = st"
                >
                  <span class="comment-nav-label">{{ statusLabel(st) }}</span>
                  <span class="comment-nav-badge">{{ getStatusComments(selectedTicketId, st).length }}</span>
                </button>
              </div>

              <div class="drawer-comments-box">
                <div
                  v-for="c in getStatusComments(selectedTicketId, activeCommentTab)"
                  :key="c.id"
                  class="drawer-comment-item"
                >
                  <div class="drawer-comment-avatar">
                    {{ (c.author || '?')[0].toUpperCase() }}
                  </div>
                  <div class="drawer-comment-bubble">
                    <div class="drawer-comment-meta">
                      <span class="drawer-comment-author">{{ c.author }}</span>
                      <span class="drawer-comment-time">{{ new Date(c.time).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
                    </div>
                    <p v-if="c.text" class="drawer-comment-text">{{ c.text }}</p>
                    <div v-if="c.imageUrl" class="drawer-comment-img-wrap">
                      <a :href="c.imageUrl" target="_blank" title="Ver imagen completa">
                        <img :src="c.imageUrl" class="drawer-comment-img" alt="Foto adjunta" />
                      </a>
                    </div>
                  </div>
                </div>
                <p v-if="!getStatusComments(selectedTicketId, activeCommentTab).length" class="detail-placeholder">
                  Sin comentarios en {{ statusLabel(activeCommentTab) }}
                </p>
              </div>
            </div>

            <!-- TAB 2: ACTIVIDAD (SOLO PASO DE UN ESTADO A OTRO) -->
            <div v-else-if="ticketHistorySubTab === 'activity'" class="drawer-field">
              <div v-if="movedActivities.length" class="activity-timeline">
                <div v-for="a in movedActivities" :key="a.id" class="activity-item activity--moved">
                  <span class="activity-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
                  <div class="activity-body">
                    <div class="activity-row">
                      <span class="activity-action activity-action--moved">{{ a.detail }}</span>
                      <span class="activity-time">{{ formatActivityDateTime(a.timestamp) }}</span>
                    </div>
                    <span class="activity-user">{{ a.userEmail }}</span>
                  </div>
                </div>
              </div>
              <p v-else class="detail-placeholder">Sin cambios de estado registrados</p>
            </div>

            <!-- TAB 3: CAMBIOS (EXTENSIÓN DE DÍAS, EDICIONES, ALCANCE) -->
            <div v-else class="drawer-field">
              <div v-if="changeActivities.length" class="activity-timeline">
                <div v-for="a in changeActivities" :key="a.id" class="activity-item" :class="'activity--' + a.action">
                  <span class="activity-icon">
                    <svg v-if="a.action === 'created'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M12 5v14M5 12h14"/></svg>
                    <svg v-else-if="a.action === 'edited'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    <svg v-else-if="a.action === 'closed'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><circle cx="12" cy="12" r="10"/></svg>
                  </span>
                  <div class="activity-body">
                    <div class="activity-row">
                      <span class="activity-action">{{ a.detail }}</span>
                      <span class="activity-time">{{ formatActivityDateTime(a.timestamp) }}</span>
                    </div>
                    <span class="activity-user">{{ a.userEmail }}</span>
                  </div>
                </div>
              </div>
              <p v-else class="detail-placeholder">Sin cambios ni modificaciones registrados</p>
            </div>
          </div>
          <div v-else class="ticket-split-right ticket-split-empty">
            <p class="detail-placeholder">Selecciona un ticket para ver su información</p>
          </div>
        </div>
      </template>

      <!-- DOCUMENTACION -->
      <template v-else-if="activeTab === 'documentacion'">
        <div class="drawer-field">
          <div class="field-header">
            <span class="detail-label">Documentación (README del repositorio)</span>
            <a v-if="githubUrl" :href="githubUrl" target="_blank" class="detail-link" style="font-size: 0.72rem;">
              Abrir en GitHub ↗
            </a>
          </div>
          <div v-if="repoLoading" class="repo-loading">Cargando documentación...</div>
          <div v-else-if="repoError" class="repo-error">{{ repoError }}</div>
          <div v-else-if="!githubUrl" class="detail-placeholder">
            Configura la URL del repositorio en la pestaña GitHub para ver la documentación.
          </div>
          <div v-else-if="repoReadme" class="readme-content">
            <div class="readme-rendered" v-html="renderMarkdown(repoReadme)"></div>
          </div>
          <div v-else class="detail-placeholder">
            No se encontró un archivo README.md en el repositorio.
          </div>
        </div>
      </template>

      <!-- GITHUB -->
      <template v-else-if="activeTab === 'github'">
        <div class="drawer-field">
          <div class="field-header">
            <span class="detail-label">Repositorio</span>
            <div v-if="isOwner" class="gh-header-actions">
              <button v-if="projectGithub" type="button" class="btn-gh-unlink-sm" @click="handleUnlinkGithub" title="Desvincular repositorio">
                Desvincular
              </button>
              <button class="edit-btn" @click="openEdit('github')" title="Cambiar repositorio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </div>
          </div>
          <a v-if="projectGithub" :href="projectGithub" target="_blank" class="detail-value detail-link">{{ projectGithub }}</a>
          <p v-else class="detail-placeholder">Agrega la URL del repositorio o vincúlalo desde Configuración...</p>
        </div>
        <div v-if="repoLoading" class="repo-loading">Cargando información del repositorio...</div>
        <div v-else-if="repoError" class="repo-error">{{ repoError }}</div>
        <template v-else-if="repoInfo">
          <div class="github-split">
            <div class="github-info">
              <div class="drawer-field"><span class="detail-label">Descripción</span><p class="detail-value">{{ repoInfo.description }}</p></div>
              <div class="repo-stats-row">
                <div class="repo-stat"><span class="repo-stat-value">{{ repoInfo.stars }}</span><span class="repo-stat-label">Estrellas</span></div>
                <div class="repo-stat"><span class="repo-stat-value">{{ repoInfo.forks }}</span><span class="repo-stat-label">Forks</span></div>
                <div class="repo-stat" v-if="repoInfo.language"><span class="repo-stat-value">{{ repoInfo.language }}</span><span class="repo-stat-label">Lenguaje</span></div>
              </div>
              <div class="repo-topics" v-if="repoInfo.topics.length"><span v-for="topic in repoInfo.topics" :key="topic" class="repo-topic">{{ topic }}</span></div>
            </div>
            <div class="github-files">
              <span class="detail-label">Archivos</span>
              <div class="repo-files">
                <a v-for="f in sortedFiles" :key="f.path" :href="getFileUrl(f.path)" target="_blank" class="repo-file-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <template v-if="f.type === 'dir'"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></template>
                    <template v-else><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></template>
                  </svg>
                  <span>{{ f.name }}</span>
                </a>
              </div>
            </div>
          </div>

          <!-- Tarjeta de Automatización Git Hook -->
          <div class="gh-hook-card">
            <div class="gh-hook-card-header">
              <span class="gh-hook-card-bolt">⚡</span>
              <div class="gh-hook-card-info">
                <span class="gh-hook-card-title">Automatización de Git en VS Code & Terminal</span>
                <p class="gh-hook-card-desc">
                  Inyecta automáticamente <code>[fixes DF-X]</code> en cada commit según la rama activa. Al hacer push, el ticket se completa de forma 100% automática.
                </p>
              </div>
            </div>
            <div class="gh-hook-card-actions">
              <button type="button" class="btn-gh-hook-open" @click="showGitHookModal = true">
                Ver comando de instalación (1 clic)
              </button>
            </div>
          </div>
        </template>
      </template>

      <!-- AJUSTES (CONFIGURACIÓN) -->
      <template v-else-if="activeTab === 'ajustes'">
        <div class="drawer-field"><span class="detail-label">Nombre del proyecto</span><p class="detail-value">{{ project?.name }}</p></div>
        <div class="drawer-field"><span class="detail-label">Descripción</span><p class="detail-value">{{ project?.description || 'Sin descripción' }}</p></div>
        <div class="drawer-divider"></div>

        <!-- REPOSITORIO GITHUB: VINCULAR Y DESVINCULAR -->
        <div class="drawer-field">
          <div class="field-header">
            <span class="detail-label">Repositorio de GitHub</span>
            <span v-if="projectGithub" class="gh-status-badge gh-status--linked">Vinculado</span>
            <span v-else class="gh-status-badge gh-status--unlinked">No vinculado</span>
          </div>

          <!-- Si el proyecto ya está vinculado -->
          <div v-if="projectGithub" class="gh-config-linked">
            <div class="gh-config-link-row">
              <svg viewBox="0 0 24 24" fill="currentColor" class="gh-config-icon">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              <a :href="projectGithub" target="_blank" class="gh-config-url" title="Abrir en GitHub">{{ projectGithub }} ↗</a>
            </div>

            <!-- Panel para cambiar repositorio -->
            <div v-if="isChangingRepo && isOwner" class="gh-config-change-panel">
              <!-- Si está conectado a GitHub: solo selector de repositorios, NUNCA escribir URL -->
              <div v-if="hasGithubToken" class="gh-config-group">
                <span class="gh-config-label">Selecciona el nuevo repositorio:</span>
                <select v-model="selectedRepoUrl" class="gh-config-select">
                  <option value="">-- Elige un repositorio --</option>
                  <option v-for="r in userRepos" :key="r.id" :value="r.html_url">
                    {{ r.name }} {{ r.private ? '(Privado)' : '' }}
                  </option>
                </select>
                <div class="gh-change-actions">
                  <button
                    type="button"
                    class="btn-gh-submit"
                    :disabled="!selectedRepoUrl || selectedRepoUrl === projectGithub || isLinkingGithub"
                    @click="handleLinkGithub(selectedRepoUrl)"
                  >
                    {{ isLinkingGithub ? 'Guardando...' : 'Guardar' }}
                  </button>
                  <button type="button" class="btn-gh-cancel" @click="cancelChangeRepo">
                    Cancelar
                  </button>
                </div>
              </div>
              <!-- Si NO está conectado a GitHub: fallback URL -->
              <div v-else class="gh-config-group">
                <span class="gh-config-label">Nueva URL de GitHub:</span>
                <div class="gh-config-input-row">
                  <input
                    v-model="newGithubUrl"
                    type="url"
                    placeholder="https://github.com/usuario/repositorio"
                    class="gh-config-input"
                  />
                  <button
                    type="button"
                    class="btn-gh-submit"
                    :disabled="!newGithubUrl.trim() || isLinkingGithub"
                    @click="handleLinkGithub(newGithubUrl)"
                  >
                    {{ isLinkingGithub ? 'Guardando...' : 'Guardar' }}
                  </button>
                  <button type="button" class="btn-gh-cancel" @click="cancelChangeRepo">
                    Cancelar
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="isOwner" class="gh-config-btns">
              <button type="button" class="btn-gh-action btn-gh-change" @click="startChangeRepo">
                Cambiar repositorio
              </button>
              <button type="button" class="btn-gh-action btn-gh-unlink" @click="handleUnlinkGithub">
                Desvincular
              </button>
            </div>
          </div>

          <!-- Si el proyecto NO está vinculado -->
          <div v-else class="gh-config-unlinked">
            <p class="gh-config-unlinked-desc">
              Este proyecto no está vinculado a GitHub. Conéctalo para habilitar la sincronización de commits, ramas y lectura del README.
            </p>

            <div v-if="isOwner" class="gh-config-form">
              <!-- Si está conectado a GitHub: SELECTOR DIRECTO, NUNCA ESCRIBIR URL -->
              <div v-if="hasGithubToken" class="gh-config-group">
                <span class="gh-config-label">Seleccionar de tus repositorios de GitHub:</span>
                <div v-if="loadingUserRepos" class="gh-repos-loading">
                  <span class="gh-loading-dot"></span>
                  <span>Cargando repositorios...</span>
                </div>
                <div v-else-if="userReposError" class="gh-repos-error-card">
                  <div class="gh-error-text-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="notice-info-icon-sm">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{{ userReposError }}</span>
                  </div>
                  <div class="gh-error-actions">
                    <button type="button" class="btn-connect-oauth-sm" :disabled="connectingOAuth" @click="handleConnectOAuth">
                      <svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                      {{ connectingOAuth ? 'Reconectando...' : 'Reconectar cuenta de GitHub' }}
                    </button>
                    <button type="button" class="btn-retry-sm" @click="fetchUserRepos(true)">Reintentar</button>
                  </div>
                </div>
                <div v-else-if="userRepos.length === 0" class="gh-repos-empty">
                  <span>No se encontraron repositorios en tu cuenta.</span>
                  <button type="button" class="btn-retry-sm" @click="fetchUserRepos(true)">Actualizar</button>
                </div>
                <div v-else class="gh-config-input-row">
                  <select v-model="selectedRepoUrl" class="gh-config-select">
                    <option value="">-- Elige un repositorio --</option>
                    <option v-for="r in userRepos" :key="r.id" :value="r.html_url">
                      {{ r.name }} {{ r.private ? '(Privado)' : '' }}
                    </option>
                  </select>
                  <button
                    type="button"
                    class="btn-gh-submit"
                    :disabled="!selectedRepoUrl || isLinkingGithub"
                    @click="handleLinkGithub(selectedRepoUrl)"
                  >
                    {{ isLinkingGithub ? 'Vinculando...' : 'Vincular' }}
                  </button>
                </div>
              </div>

              <!-- Si NO está conectado a GitHub -->
              <div v-else class="gh-config-not-connected">
                <div class="repo-token-notice-sm">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="notice-info-icon-sm">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>Tu cuenta no tiene GitHub conectado o la sesión expiró.</span>
                </div>
                <div class="repo-oauth-prompt-sm">
                  <button type="button" class="btn-connect-oauth-sm" :disabled="connectingOAuth" @click="handleConnectOAuth">
                    <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                    {{ connectingOAuth ? 'Conectando...' : 'Conectar con GitHub' }}
                  </button>
                  <button type="button" class="btn-toggle-pat-sm" @click="showManualToken = !showManualToken">
                    {{ showManualToken ? 'Ocultar token' : 'Ingresar token personal (PAT)' }}
                  </button>
                </div>
                <div v-if="showManualToken" class="gh-config-input-row" style="margin-top: 0.25rem;">
                  <input
                    v-model="quickTokenInput"
                    type="password"
                    placeholder="Pega tu token (ghp_...)"
                    class="gh-config-input"
                    autocomplete="off"
                  />
                  <button
                    type="button"
                    class="btn-gh-submit"
                    :disabled="!quickTokenInput.trim() || isConnectingToken"
                    @click="handleConnectManualToken"
                  >
                    {{ isConnectingToken ? 'Guardando...' : 'Guardar token' }}
                  </button>
                </div>
                <div class="gh-config-group" style="margin-top: 0.35rem;">
                  <span class="gh-config-label">O ingresa la URL directamente:</span>
                  <div class="gh-config-input-row">
                    <input
                      v-model="newGithubUrl"
                      type="url"
                      placeholder="https://github.com/usuario/repositorio"
                      class="gh-config-input"
                    />
                    <button
                      type="button"
                      class="btn-gh-submit"
                      :disabled="!newGithubUrl.trim() || isLinkingGithub"
                      @click="handleLinkGithub(newGithubUrl)"
                    >
                      {{ isLinkingGithub ? 'Vinculando...' : 'Vincular' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <p v-else class="detail-placeholder">Solo el creador del proyecto puede vincular un repositorio.</p>
          </div>
        </div>

        <div class="drawer-divider"></div>
        <div class="drawer-field">
          <div class="field-header"><span class="detail-label">Tecnologías / Herramientas</span><button class="edit-btn" @click="openEdit('tech')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></div>
          <p v-if="projectTech" class="detail-value">{{ projectTech }}</p>
          <p v-else class="detail-placeholder">Agrega tecnologías, librerías y herramientas...</p>
        </div>
        <div class="drawer-field">
          <div class="field-header"><span class="detail-label">Conexiones / Integraciones</span><button class="edit-btn" @click="openEdit('connections')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></div>
          <p v-if="projectConnections" class="detail-value">{{ projectConnections }}</p>
          <p v-else class="detail-placeholder">Describe con qué servicios, APIs o bases de datos se conecta...</p>
        </div>
        <div class="drawer-field">
          <div class="field-header"><span class="detail-label">Servidor</span><button class="edit-btn" @click="openEdit('server')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></div>
          <p v-if="projectServer" class="detail-value">{{ projectServer }}</p>
          <p v-else class="detail-placeholder">Indica si corre en local, nube (AWS, Azure, Firebase), etc...</p>
        </div>
        <div class="drawer-divider"></div>
        <div class="drawer-field">
          <span class="detail-label">Miembros del equipo</span>
          <div class="member-list">
            <div v-for="m in projectMembers" :key="m.uid" class="member-item">
              <span class="member-avatar" :class="{ 'member-avatar--pending': m.uid.startsWith('pending_') }">{{ m.uid.startsWith('pending_') ? '?' : m.displayName[0].toUpperCase() }}</span>
              <div class="member-info">
                <span class="member-name">{{ m.uid.startsWith('pending_') ? 'Pendiente' : m.displayName }}</span>
                <span class="member-email">{{ m.email }}</span>
                <span class="member-role" :class="m.uid.startsWith('pending_') ? 'role--pending' : 'role--' + m.role">{{ m.uid.startsWith('pending_') ? 'Pendiente' : m.role === 'owner' ? 'Propietario' : m.role === 'admin' ? 'Admin' : 'Miembro' }}</span>
              </div>
              <button v-if="project?.userId === auth.currentUser?.uid && m.role !== 'owner'" class="member-remove" @click="handleRemoveMember(m)" title="Eliminar miembro">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>
        <template v-if="isOwner">
          <div class="drawer-divider"></div>
          <div class="drawer-field">
            <button class="delete-btn" @click="showDeleteConfirm = true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Eliminar proyecto
            </button>
          </div>
          <div v-if="showDeleteConfirm" class="delete-confirm">
            <p class="delete-confirm-text">¿Eliminar "{{ project?.name }}"? Esta acción no se puede deshacer.</p>
            <div class="delete-confirm-actions">
              <button class="edit-btn-cancel" @click="showDeleteConfirm = false">Cancelar</button>
              <button class="delete-btn delete-btn--confirm" @click="handleDeleteProject">Eliminar</button>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>

  <!-- Edit field modal -->
  <div v-if="editField" class="modal-overlay" @click="cancelEdit">
    <div class="modal-card edit-modal" @click.stop>
      <div class="edit-modal-header">
        <h3 class="edit-modal-title">{{ editField ? fieldLabels[editField] : '' }}</h3>
        <button class="edit-modal-close" @click="cancelEdit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="edit-modal-body">
        <template v-if="editField === 'github'">
          <div v-if="hasGithubToken" class="gh-config-group">
            <span class="gh-config-label">Selecciona el repositorio de GitHub:</span>
            <select v-model="editValue" class="gh-config-select">
              <option value="">-- Elige un repositorio --</option>
              <option v-for="r in userRepos" :key="r.id" :value="r.html_url">
                {{ r.name }} {{ r.private ? '(Privado)' : '' }}
              </option>
            </select>
          </div>
          <input v-else v-model="editValue" type="url" class="edit-modal-input" placeholder="https://github.com/usuario/repositorio" />
        </template>
        <textarea v-else v-model="editValue" rows="6" placeholder="Escribe aquí..."></textarea>
      </div>
      <div class="edit-modal-footer">
        <button class="edit-btn-cancel" @click="cancelEdit">Cancelar</button>
        <button class="edit-btn-save" @click="saveEdit">Guardar</button>
      </div>
    </div>
  </div>

  <!-- Git Hook Setup Modal -->
  <GitHookModal :visible="showGitHookModal" @close="showGitHookModal = false" />
</template>

<style scoped>
.drawer-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 100; }
.drawer {
  position: fixed;
  top: 0.75rem;
  right: 0.75rem;
  bottom: 0.75rem;
  width: min(75vw, 840px);
  max-width: calc(100vw - 1.5rem);
  height: calc(100vh - 1.5rem);
  height: calc(100dvh - 1.5rem);
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  z-index: 110;
  display: flex;
  flex-direction: column;
  animation: slideInRight 0.25s ease-out;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
.drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.drawer-title { font-size: 1rem; font-weight: 700; margin: 0; color: var(--text-h); }
.drawer-close { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: none; border: none; color: var(--text); cursor: pointer; padding: 4px; transition: background 0.15s, color 0.15s; }
.drawer-close:hover { background: var(--code-bg); color: var(--text-h); }
.drawer-close svg { width: 16px; height: 16px; }
.drawer-body { flex: 1; padding: 1.25rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem; }
.drawer-field { display: flex; flex-direction: column; gap: 0.4rem; }
.drawer-divider { height: 1px; background: var(--border); margin: 0; }
.detail-label { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text); }
.detail-value { font-size: 0.88rem; color: var(--text-h); margin: 0; line-height: 1.5; }
.detail-placeholder { font-size: 0.85rem; color: var(--text); margin: 0; font-style: italic; opacity: 0.5; }
.detail-link { color: var(--accent); text-decoration: underline; word-break: break-all; }

.drawer-tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.drawer-tab {
  flex: 1; padding: 0.6rem 0.75rem; background: none; border: none;
  border-bottom: 2px solid transparent; font: inherit; font-size: 0.72rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.3px; color: var(--text); cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.drawer-tab:hover { color: var(--text-h); background: var(--accent-bg); }
.drawer-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

.drawer-input { width: 100%; padding: 0.55rem 0.7rem; background: var(--code-bg); border: 1.5px solid var(--border); font: inherit; font-size: 0.85rem; color: var(--text-h); outline: none; transition: border-color 0.2s; box-sizing: border-box; }
.drawer-input:focus { border-color: var(--accent); }

/* ── Stats ── */
.project-stats { display: flex; flex-direction: column; gap: 0.5rem; }
.stats-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.stat-item { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 50px; padding: 0.4rem 0.3rem; background: var(--code-bg); border-radius: 8px; }
.stat-value { font-size: 1.1rem; font-weight: 700; color: var(--text-h); }
.stat-pending { color: #6b7280; }
.stat-progress { color: #3b82f6; }
.stat-testing { color: #f97316; }
.stat-done { color: #22c55e; }
.stat-label { font-size: 0.6rem; color: var(--text); opacity: 0.7; margin-top: 0.1rem; }
.progress-bar { width: 100%; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #22c55e); border-radius: 3px; transition: width 0.5s ease; }
.progress-text { font-size: 0.65rem; color: var(--text); opacity: 0.6; text-align: right; }

/* ── Members ── */
.member-list { display: flex; flex-direction: column; gap: 4px; max-width: 320px; }
.member-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; transition: background 0.1s; box-sizing: border-box; }
.member-item:hover { background: var(--code-bg); }
.member-avatar { width: 26px; height: 26px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 0.65rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.member-info { flex: 1; display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }
.member-name { font-size: 0.78rem; font-weight: 600; color: var(--text-h); }
.member-email { font-size: 0.63rem; color: var(--text); opacity: 0.6; }
.member-role { font-size: 0.55rem; font-weight: 700; padding: 1px 5px; align-self: flex-start; margin-top: 0.1rem; }
.role--owner { background: rgba(234,179,8,0.12); color: #eab308; }
.role--admin { background: rgba(59,130,246,0.12); color: #3b82f6; }
.role--member { background: rgba(107,114,128,0.1); color: #6b7280; }
.role--pending { background: rgba(251,191,36,0.15); color: #d97706; }
.member-avatar--pending { background: #d97706 !important; }
.member-remove { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: none; border: none; color: var(--text); cursor: pointer; opacity: 0.3; transition: opacity 0.15s, color 0.15s; }
.member-remove:hover { opacity: 1; color: #ef4444; }
.invite-actions { display: flex; gap: 0.4rem; margin-top: 0.4rem; max-width: 320px; }
.invite-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.3rem; padding: 0.35rem 0.5rem; border: 1px dashed var(--border); border-radius: 4px; background: transparent; color: var(--accent); font: inherit; font-size: 0.72rem; font-weight: 600; cursor: pointer; min-width: 0; transition: background 0.1s; white-space: nowrap; }
.invite-btn:hover { background: var(--accent-bg); border-color: var(--accent); }
.invite-form { margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; max-width: 280px; }
.invite-form .drawer-input { width: 100%; max-width: 280px; height: 30px; padding: 0.25rem 0.55rem; font-size: 0.78rem; border-radius: 4px; box-sizing: border-box; }
.invite-send-btn { width: auto; align-self: flex-start; padding: 0.35rem 0.85rem; border: none; border-radius: 4px; background: var(--accent); color: #fff; font: inherit; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s; text-align: center; }
.invite-send-btn:disabled { opacity: 0.5; cursor: default; }
.invite-send-btn:hover:not(:disabled) { opacity: 0.9; }
.invite-status { font-size: 0.7rem; color: var(--accent); font-weight: 600; }

/* ── Ticket tree ── */
.ticket-split { display: flex; gap: 0.75rem; height: 100%; min-height: 0; }
.ticket-split-left { flex: 0 0 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.4rem; border-right: 1px solid var(--border); padding-right: 0.75rem; }
.ticket-split-right { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; }
.ticket-split-empty { display: flex; align-items: center; justify-content: center; }
.ticket-split-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.ticket-split-dates { font-size: 0.7rem; color: var(--text); opacity: 0.7; }
.ticket-tree { display: flex; flex-direction: column; gap: 0.2rem; }
.ticket-tree-item { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; transition: background 0.1s, border-color 0.1s; overflow: hidden; }
.ticket-tree-item:hover { background: var(--accent-bg); }
.ticket-tree-item--active { border-color: var(--accent); background: var(--accent-bg); }
.ticket-tree-item--child { margin-left: 1rem; border: none; border-top: 1px solid var(--border); border-radius: 0; }
.ticket-tree-row { display: flex; align-items: center; gap: 0.45rem; padding: 0.35rem 0.55rem; height: 36px; box-sizing: border-box; }
.ticket-tree-prio { font-size: 0.55rem; font-weight: 600; padding: 1px 5px; flex-shrink: 0; }
.ticket-tree-title { flex: 1; font-size: 0.78rem; font-weight: 600; color: var(--text-h); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.ticket-tree-status { font-size: 0.6rem; font-weight: 600; padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
.status--sin-realizar { color: #6b7280; background: rgba(107,114,128,0.1); }
.status--en-proceso { color: #3b82f6; background: rgba(59,130,246,0.1); }
.status--testing { color: #f97316; background: rgba(249,115,22,0.1); }
.status--completado { color: #22c55e; background: rgba(34,197,94,0.1); }
.ticket-tree-children { border-top: 1px solid var(--border); }

/* ── GitHub ── */
.github-split { display: flex; gap: 1rem; flex: 1; }
.github-info { flex: 1; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
.github-files { width: 200px; flex-shrink: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.github-files .repo-files { max-height: 400px; overflow-y: auto; border: 1px solid var(--border); background: var(--code-bg); }
.github-files .repo-file-item { padding: 0.3rem 0.5rem; font-size: 0.75rem; }
.repo-loading { font-size: 0.82rem; color: var(--text); opacity: 0.6; padding: 0.5rem 0; }
.repo-error { font-size: 0.82rem; color: #ef4444; padding: 0.5rem 0; }
.repo-stats-row { display: flex; gap: 0.75rem; }
.repo-stat { flex: 1; display: flex; flex-direction: column; gap: 0.15rem; background: var(--code-bg); border: 1px solid var(--border); padding: 0.6rem 0.75rem; }
.repo-stat-value { font-size: 1rem; font-weight: 700; color: var(--text-h); }
.repo-stat-label { font-size: 0.6rem; font-weight: 600; color: var(--text); opacity: 0.6; }
.repo-topics { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.repo-topic { font-size: 0.65rem; padding: 2px 8px; background: rgba(37, 99, 235, 0.1); color: var(--accent); font-weight: 600; }
.repo-files { display: flex; flex-direction: column; gap: 2px; max-height: 300px; overflow-y: auto; }
.repo-file-item { display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.5rem; font-size: 0.78rem; color: var(--text); text-decoration: none; transition: background 0.1s, color 0.1s; }
.repo-file-item:hover { background: var(--accent-bg); color: var(--text-h); }
.repo-file-item svg { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.6; }
.readme-content { max-height: 400px; overflow-y: auto; background: var(--card-bg); border: 1px solid var(--border); }
.readme-rendered { padding: 1rem; font-size: 0.82rem; line-height: 1.6; color: var(--text-h); }
.readme-rendered h1 { font-size: 1.2rem; margin: 1rem 0 0.5rem; font-weight: 700; }
.readme-rendered h2 { font-size: 1rem; margin: 0.9rem 0 0.4rem; font-weight: 700; }
.readme-rendered h3 { font-size: 0.9rem; margin: 0.8rem 0 0.35rem; font-weight: 700; }
.readme-rendered h1:first-child, .readme-rendered h2:first-child, .readme-rendered h3:first-child { margin-top: 0; }
.readme-rendered p { margin: 0 0 0.5rem; }
.readme-rendered code { font-family: monospace; font-size: 0.78rem; background: var(--code-bg); padding: 1px 4px; }
.readme-rendered pre.readme-code-block { background: var(--code-bg); border: 1px solid var(--border); padding: 0.75rem; overflow-x: auto; margin: 0.5rem 0; }
.readme-rendered pre.readme-code-block code { background: none; padding: 0; font-size: 0.75rem; line-height: 1.4; }
.readme-rendered a { color: var(--accent); text-decoration: underline; }
.readme-rendered hr { border: none; border-top: 1px solid var(--border); margin: 0.75rem 0; }
.readme-rendered li { margin-left: 1.2rem; margin-bottom: 0.2rem; }

/* ── Ticket History Sub-tabs (Comentarios | Actividad) ── */
.ticket-history-tabs {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.35rem;
  margin-bottom: 0.5rem;
}

.history-tab-btn {
  background: transparent;
  border: none;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
  padding: 0.2rem 0;
  cursor: pointer;
  position: relative;
  transition: color 0.15s ease;
}

.history-tab-btn:hover {
  color: var(--text-h);
}

.history-tab-btn.active {
  color: var(--accent);
}

.history-tab-btn.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -0.42rem;
  height: 2px;
  background: var(--accent);
}

/* ── Comments in Ticket History ── */
.comments-status-nav {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.4rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3rem;
  overflow-x: auto;
}

.comment-nav-btn {
  background: transparent;
  border: none;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text);
  padding: 0.25rem 0.45rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  position: relative;
  transition: color 0.15s ease;
  white-space: nowrap;
}

.comment-nav-btn:hover {
  color: var(--text-h);
}

.comment-nav-btn.active {
  color: var(--accent);
  font-weight: 600;
}

.comment-nav-btn.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -0.35rem;
  height: 2px;
  background: var(--accent);
}

.comment-nav-badge {
  font-size: 0.62rem;
  background: rgba(255, 255, 255, 0.08);
  padding: 0 4px;
  border-radius: 8px;
  line-height: 1.3;
}

.drawer-comments-box {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.drawer-comment-item {
  display: flex;
  gap: 0.45rem;
  align-items: flex-start;
}

.drawer-comment-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.drawer-comment-bubble {
  flex: 1;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.35rem 0.55rem;
  min-width: 0;
}

.drawer-comment-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  margin-bottom: 0.15rem;
}

.drawer-comment-author {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drawer-comment-time {
  font-size: 0.58rem;
  color: var(--text);
  opacity: 0.6;
  flex-shrink: 0;
}

.drawer-comment-text {
  font-size: 0.78rem;
  color: var(--text-h);
  margin: 0;
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
}

.drawer-comment-img-wrap {
  margin-top: 0.35rem;
}

.drawer-comment-img {
  max-width: 100%;
  max-height: 130px;
  border-radius: 4px;
  object-fit: cover;
  display: block;
  border: 1px solid var(--border);
  cursor: pointer;
}

/* ── Activity ── */
.activity-timeline { display: flex; flex-direction: column; gap: 0.4rem; max-height: 200px; overflow-y: auto; }
.activity-item { display: flex; gap: 0.5rem; align-items: flex-start; padding: 0.35rem 0.5rem; background: var(--code-bg); border-radius: 4px; border: 1px solid var(--border); }
.activity-icon { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
.activity-icon svg { opacity: 0.7; }
.activity-body { flex: 1; display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.activity-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
.activity-action { font-size: 0.75rem; color: var(--text-h); line-height: 1.3; }
.activity-action--moved { font-weight: 600; color: var(--accent); }
.activity-time { font-size: 0.62rem; color: var(--text); opacity: 0.7; white-space: nowrap; }
.activity-user { font-size: 0.63rem; color: var(--text); opacity: 0.6; }

/* ── Badges ── */
.badge { font-size: 0.65rem; font-weight: 600; padding: 2px 8px; align-self: flex-start; }
.badge--backend { background: rgba(59,130,246,0.12); color:#3b82f6; }
.badge--frontend { background: rgba(239,68,68,0.12); color:#ef4444; }
.badge--mobile { background: rgba(34,197,94,0.12); color:#22c55e; }
.badge--web { background: rgba(168,85,247,0.12); color:#a855f7; }
.badge--fullstack { background: rgba(234,179,8,0.12); color:#eab308; }

/* ── Edit buttons & modals ── */
.field-header { display: flex; align-items: center; justify-content: space-between; }
.edit-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: none; border: none; color: var(--text); cursor: pointer; padding: 5px; opacity: 0.4; transition: opacity 0.15s, color 0.15s, background 0.15s; }
.edit-btn:hover { opacity: 1; color: var(--accent); background: var(--accent-bg); }
.edit-btn svg { width: 15px; height: 15px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
.edit-modal { width: 480px; background: var(--card-bg); border: 1px solid var(--border); display: flex; flex-direction: column; }
.edit-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border); }
.edit-modal-title { font-size: 0.9rem; font-weight: 700; margin: 0; color: var(--text-h); }
.edit-modal-close { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; background: none; border: none; color: var(--text); cursor: pointer; padding: 4px; transition: background 0.15s, color 0.15s; }
.edit-modal-close:hover { background: var(--code-bg); color: var(--text-h); }
.edit-modal-close svg { width: 15px; height: 15px; }
.edit-modal-body { padding: 1rem 1.25rem; }
.edit-modal-body textarea { width: 100%; padding: 0.65rem 0.75rem; background: var(--code-bg); border: 1.5px solid var(--border); font: inherit; font-size: 0.85rem; color: var(--text-h); outline: none; transition: border-color 0.2s; box-sizing: border-box; line-height: 1.5; }
.edit-modal-body textarea:focus { border-color: var(--accent); }
.edit-modal-footer { display: flex; gap: 0.75rem; padding: 0.85rem 1.25rem; border-top: 1px solid var(--border); justify-content: flex-end; }
.edit-btn-cancel, .edit-btn-save { padding: 0.5rem 1rem; border: 1.5px solid var(--border); font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }
.edit-btn-cancel { background: transparent; color: var(--text); }
.edit-btn-cancel:hover { background: var(--code-bg); color: var(--text-h); }
.edit-btn-save { background: var(--accent); border-color: var(--accent); color: #fff; }
.edit-btn-save:hover { opacity: 0.9; }
.edit-modal-input { width: 100%; padding: 0.65rem 0.75rem; background: var(--code-bg); border: 1.5px solid var(--border); font: inherit; font-size: 0.85rem; color: var(--text-h); outline: none; transition: border-color 0.2s; box-sizing: border-box; }
.edit-modal-input:focus { border-color: var(--accent); }

/* ── Delete ── */
.delete-btn { width: auto; display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; padding: 0.4rem 0.6rem; border: 1.5px solid #ef4444; background: transparent; color: #ef4444; font: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: background 0.15s, color 0.15s; }
.delete-btn:hover { background: #ef4444; color: #fff; }
.delete-btn svg { width: 16px; height: 16px; }
.delete-btn--confirm { background: #ef4444; color: #fff; }
.delete-btn--confirm:hover { opacity: 0.9; }
.delete-confirm { background: rgba(239, 68, 68, 0.06); border: 1.5px solid #ef4444; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
.delete-confirm-text { font-size: 0.82rem; color: var(--text-h); margin: 0; line-height: 1.4; }
.delete-confirm-actions { display: flex; gap: 0.5rem; }

/* ── GitHub Linking in Settings ── */
.gh-status-badge {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 1px 6px;
  border-radius: 4px;
}
.gh-status--linked {
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.25);
}
.gh-status--unlinked {
  background: rgba(148, 163, 184, 0.12);
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.gh-config-linked {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.55rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.gh-config-link-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.gh-config-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-h);
}

.gh-config-url {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.gh-config-url:hover {
  text-decoration: underline;
}

.gh-config-btns {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.15rem;
}

.btn-gh-action {
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-gh-change {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-h);
}

.btn-gh-change:hover {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
}

.btn-gh-unlink {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.btn-gh-unlink:hover {
  background: rgba(239, 68, 68, 0.1);
}

.btn-gh-unlink-sm {
  background: transparent;
  border: none;
  color: #ef4444;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0 0.3rem;
  opacity: 0.8;
  transition: opacity 0.15s;
}

.btn-gh-unlink-sm:hover {
  opacity: 1;
  text-decoration: underline;
}

.gh-header-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.gh-config-unlinked {
  background: var(--code-bg);
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.gh-config-unlinked-desc {
  margin: 0;
  font-size: 0.74rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.gh-config-form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.gh-config-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.gh-config-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-h);
}

.gh-config-select {
  width: 100%;
  padding: 0.35rem 0.5rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-h);
  font: inherit;
  font-size: 0.75rem;
  outline: none;
}

.gh-config-select:focus {
  border-color: var(--accent);
}

.gh-config-input-row {
  display: flex;
  gap: 0.35rem;
}

.gh-config-input {
  flex: 1;
  padding: 0.35rem 0.5rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-h);
  font: inherit;
  font-size: 0.75rem;
  outline: none;
}

.gh-config-input:focus {
  border-color: var(--accent);
}

.btn-gh-submit {
  padding: 0.35rem 0.75rem;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
  white-space: nowrap;
}

.btn-gh-submit:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-gh-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.gh-config-change-panel {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-top: 0.35rem;
  border-top: 1px dashed var(--border);
}

.gh-change-actions {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.25rem;
}

.btn-gh-cancel {
  padding: 0.35rem 0.65rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.btn-gh-cancel:hover {
  background: var(--border);
  color: var(--text-h);
}

.gh-config-not-connected {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.repo-token-notice-sm {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.notice-info-icon-sm {
  width: 14px;
  height: 14px;
  color: #f59e0b;
  flex-shrink: 0;
}

.repo-oauth-prompt-sm {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn-toggle-pat-sm {
  background: none;
  border: none;
  color: var(--accent);
  font: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.btn-toggle-pat-sm:hover {
  opacity: 0.8;
}

.gh-repos-error-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem 0.65rem;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 4px;
}

.gh-error-text-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  color: #ef4444;
}

.gh-error-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.btn-connect-oauth-sm {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.65rem;
  background: #24292f;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-connect-oauth-sm:hover:not(:disabled) {
  opacity: 0.9;
}

.gh-repos-loading {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  color: var(--text-muted);
  padding: 0.25rem 0;
}

.gh-loading-dot {
  width: 12px;
  height: 12px;
  border: 2px solid var(--accent);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.gh-repos-empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.btn-retry-sm {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-h);
  font: inherit;
  font-size: 0.68rem;
  padding: 0.15rem 0.4rem;
  cursor: pointer;
}

/* ── Git Hook Automation Card ── */
.gh-hook-card {
  background: rgba(14, 165, 233, 0.05);
  border: 1px solid rgba(14, 165, 233, 0.2);
  border-radius: 6px;
  padding: 0.85rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-top: 0.75rem;
}

.gh-hook-card-header {
  display: flex;
  gap: 0.65rem;
}

.gh-hook-card-bolt {
  font-size: 1.25rem;
  line-height: 1;
}

.gh-hook-card-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.gh-hook-card-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-h);
}

.gh-hook-card-desc {
  margin: 0;
  font-size: 0.74rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.gh-hook-card-desc code {
  background: var(--code-bg);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  color: var(--accent);
  font-size: 0.72rem;
}

.gh-hook-card-actions {
  display: flex;
}

.btn-gh-hook-open {
  padding: 0.35rem 0.75rem;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-gh-hook-open:hover {
  opacity: 0.9;
}

/* ── Scrollbar ── */
.drawer-body::-webkit-scrollbar { width: 4px; }
.drawer-body::-webkit-scrollbar-track { background: transparent; }
.drawer-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.5); border-radius: 2px; }
.drawer-body::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.7); }
</style>
