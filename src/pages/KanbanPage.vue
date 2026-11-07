<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { auth, db, storage } from '../firebase'
import { collection, query, orderBy, onSnapshot, addDoc } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { fmtDate } from '../utils/format'
import { useRoute, useRouter } from 'vue-router'
import CalendarRangePicker from '../components/kanban/CalendarRangePicker.vue'
import KanbanCard from '../components/kanban/KanbanCard.vue'
import FloatingCardMenu from '../components/kanban/FloatingCardMenu.vue'
import CloseConfirmDialog from '../components/kanban/CloseConfirmDialog.vue'
import ProjectDrawer from '../components/kanban/ProjectDrawer.vue'
import GitHookModal from '../components/kanban/GitHookModal.vue'

const showGitHookModal = ref(false)
import { useProjects } from '../composables/useProjects'
import { useTickets } from '../composables/useTickets'
import { useEmailNotifications } from '../composables/useEmailNotifications'
import { useTicketFiles } from '../composables/useTicketFiles'
import type { TicketFile } from '../composables/useTicketFiles'
import { useI18n } from '../composables/useI18n'
import { useActivityLog } from '../composables/useActivityLog'
import {
  useGithubRepo,
  slugifyGitBranch,
  generateBranchCommand,
  generateCommitCommand,
  type GitHubCommit,
} from '../composables/useGithubRepo'
import { useGithubToken } from '../composables/useGithubToken'
import type { Ticket, TicketStatus, TicketPriority, GitCommitRef } from '../types/ticket'
import type { Project, Member } from '../types/project'

const route = useRoute()
const router = useRouter()
const { projects, allProjects, loadAndJoinProject, getProjectMembers } = useProjects()
const { tickets, watchProjectTickets, updateTicketStatus, createTicket, updateTicket, deleteTicket, closeTicket, assignTicket, getLinkedTicketDetails } = useTickets()
const { getFiles, uploadFile, uploading } = useTicketFiles()

const { t } = useI18n()
const collapsedSwimlanes = ref<Record<string, boolean>>({})

function toggleSwimlane(colKey: string, priority: string) {
  const key = colKey + '-' + priority
  collapsedSwimlanes.value[key] = !collapsedSwimlanes.value[key]
}

function isSwimlaneCollapsed(colKey: string, priority: string) {
  return !!collapsedSwimlanes.value[colKey + '-' + priority]
}
const { sendTicketCreated, sendTicketMoved } = useEmailNotifications()
const { log: logActivity } = useActivityLog()

const editingFiles = ref<TicketFile[]>([])

const projectId = computed(() => route.params.id as string)

const directProject = ref<Project | null>(null)
const loadingProject = ref(false)

const project = computed(() => {
  return projects.value.find((p) => p.id === projectId.value)
    || allProjects.value.find((p) => p.id === projectId.value)
    || directProject.value
})

// ── Integración GitHub & VS Code (Commits, Ramas & Sincronización) ──
const { token: githubToken } = useGithubToken()
const projectGithubUrl = computed(() => project.value?.github || '')
const {
  commits: githubCommits,
  pulls: githubPulls,
  loading: gitLoading,
  refreshGit,
} = useGithubRepo(projectGithubUrl, githubToken)

const isSyncingGit = ref(false)
const showManualCommitPicker = ref(false)

function copyTicketBranch(ticket: Ticket) {
  const cmd = generateBranchCommand(ticket)
  navigator.clipboard.writeText(cmd)
  closeCardMenu()
  showToast('Comando de rama copiado al portapapeles', 'ok')
}

function copyTicketCommit(ticket: Ticket) {
  const cmd = generateCommitCommand(ticket)
  navigator.clipboard.writeText(cmd)
  closeCardMenu()
  showToast('Comando de commit copiado al portapapeles', 'ok')
}

function getSuggestedBranchCmd(ticket: Ticket) {
  return generateBranchCommand(ticket)
}

function getSuggestedCommitCmd(ticket: Ticket) {
  return generateCommitCommand(ticket)
}

async function manualLinkCommit(ticket: Ticket, gc: GitHubCommit) {
  const commitRef: GitCommitRef = {
    sha: gc.sha,
    shortSha: gc.shortSha,
    message: gc.message.split('\n')[0],
    author: gc.author,
    date: gc.date,
    url: gc.url,
  }
  const currentCommits = ticket.gitCommits || []
  if (currentCommits.some(c => c.sha === commitRef.sha)) {
    showToast('Este commit ya está vinculado a la tarjeta', 'warn')
    return
  }

  const shouldComplete = window.confirm(`¿Deseas marcar el ticket como completado con el commit "${commitRef.shortSha}"?`)

  await updateTicket(ticket.id, {
    status: shouldComplete ? 'completado' : ticket.status,
    gitCommits: [commitRef, ...currentCommits],
  })

  await logActivity(
    ticket.id,
    shouldComplete ? 'closed' : 'edited',
    `Commit de Git vinculado: ${commitRef.shortSha} - ${commitRef.message.slice(0, 30)}`
  )

  showManualCommitPicker.value = false
  showToast('Commit de Git vinculado correctamente', 'ok')
}

async function syncProjectGitCommits() {
  if (!projectGithubUrl.value) {
    showToast('Vincula un repositorio de GitHub al proyecto para sincronizar', 'warn')
    return
  }
  isSyncingGit.value = true
  try {
    await refreshGit()

    const openTickets = projectTickets.value.filter(t => t.status !== 'completado')
    let resolvedCount = 0

    for (const ticket of openTickets) {
      const shortId = ticket.id.slice(0, 6).toLowerCase()
      const titleLower = ticket.title.toLowerCase().trim()
      const branchSlug = slugifyGitBranch(ticket.title).replace('feature/', '')

      const matchingCommit = githubCommits.value.find(c => {
        const msg = c.message.toLowerCase()
        return (
          msg.includes(shortId) ||
          msg.includes(branchSlug) ||
          (titleLower.length >= 6 && msg.includes(titleLower))
        )
      })

      if (matchingCommit) {
        const msg = matchingCommit.message.toLowerCase()
        const isDone = /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved|done|completado|terminado)\b/i.test(msg)

        const commitRef: GitCommitRef = {
          sha: matchingCommit.sha,
          shortSha: matchingCommit.shortSha,
          message: matchingCommit.message.split('\n')[0],
          author: matchingCommit.author,
          date: matchingCommit.date,
          url: matchingCommit.url,
        }

        const current = ticket.gitCommits || []
        const alreadyHasCommit = current.some(c => c.sha === commitRef.sha)

        if (isDone) {
          await updateTicket(ticket.id, {
            status: 'completado',
            gitCommits: alreadyHasCommit ? current : [commitRef, ...current],
          })
          await logActivity(ticket.id, 'closed', `Completado automáticamente vía commit Git (${commitRef.shortSha})`)
          resolvedCount++
        } else if (ticket.status === 'sin-realizar') {
          await updateTicket(ticket.id, {
            status: 'en-proceso',
            gitCommits: alreadyHasCommit ? current : [commitRef, ...current],
          })
          await logActivity(ticket.id, 'moved', `Iniciado automáticamente vía commit Git (${commitRef.shortSha})`)
        }
      }

      // Detectar Pull Requests fusionados
      const matchingPR = githubPulls.value.find(pr => {
        const prTitle = pr.title.toLowerCase()
        const prBranch = pr.headBranch.toLowerCase()
        return (
          prTitle.includes(shortId) ||
          prTitle.includes(branchSlug) ||
          prBranch.includes(branchSlug)
        )
      })

      if (matchingPR && matchingPR.merged && ticket.status !== 'completado') {
        await updateTicket(ticket.id, {
          status: 'completado',
          gitPrNumber: matchingPR.number,
          gitPrUrl: matchingPR.url,
        })
        await logActivity(ticket.id, 'closed', `Completado automáticamente por PR #${matchingPR.number} fusionado en GitHub`)
        resolvedCount++
      }
    }

    if (resolvedCount > 0) {
      showToast(`${resolvedCount} ticket(s) completado(s) vía GitHub`, 'ok')
    } else {
      showToast('Sincronización con GitHub completada', 'ok')
    }
  } catch (err: any) {
    console.error('Error sincronizando con Git:', err)
    showToast('Error al consultar commits de GitHub', 'warn')
  } finally {
    isSyncingGit.value = false
  }
}

const ensureProjectLoaded = async (id: string) => {
  if (!id) return
  watchProjectTickets(id)
  if (!projects.value.some(p => p.id === id) && !allProjects.value.some(p => p.id === id)) {
    loadingProject.value = true
    try {
      const p = await loadAndJoinProject(id)
      if (p) directProject.value = p
    } finally {
      loadingProject.value = false
    }
  } else {
    loadAndJoinProject(id).catch(() => {})
  }
}

onMounted(() => {
  ensureProjectLoaded(projectId.value)
})

watch(projectId, (newId) => {
  if (newId) {
    ensureProjectLoaded(newId)
  }
})

const toastMsg = ref('')
const toastType = ref<'ok' | 'warn'>('ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, type: 'ok' | 'warn' = 'ok') {
  toastMsg.value = msg
  toastType.value = type
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 4000)
}


const projectTickets = computed(() =>
  tickets.value.filter((t) => {
    if (t.projectId !== projectId.value) return false
    // Hide closed tickets
    if (t.closedAt) return false
    // Auto-hide completed tickets after 3 days
    if (t.status === 'completado' && t.completedAt) {
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
      if (t.completedAt < threeDaysAgo) return false
    }
    return true
  })
)

const statusColumns: { key: TicketStatus; label: string }[] = [
  { key: 'sin-realizar', label: 'Sin Realizar' },
  { key: 'en-proceso', label: 'En Proceso' },
  { key: 'testing', label: 'Testing' },
  { key: 'completado', label: 'Completado' },
]

const statusLabel = (key: TicketStatus): string => {
  const map: Record<string, string> = {
    'sin-realizar': t('sin_realizar'),
    'en-proceso': t('en_proceso'),
    'testing': t('testing'),
    'completado': t('completado'),
  }
  return map[key] ?? key
}

const showFutureTickets = ref(true)

function isTicketOverdue(t: Ticket): boolean {
  if (t.status === 'completado' || t.closedAt) return false
  const targetDate = t.endDate || t.startDate
  if (!targetDate) return false
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  return targetDate < todayStart.getTime()
}

function isTicketFarFuture(t: Ticket): boolean {
  const targetDate = t.startDate || t.endDate
  if (!targetDate) return false
  const fourDaysLater = new Date()
  fourDaysLater.setHours(23, 59, 59, 999)
  fourDaysLater.setDate(fourDaysLater.getDate() + 4)
  return targetDate > fourDaysLater.getTime()
}

const visibleProjectTickets = computed(() =>
  projectTickets.value.filter((t) => {
    // 1. Overdue tickets ALWAYS remain visible (never hidden by date)
    if (isTicketOverdue(t)) return true

    // 2. Far future tickets (> 4 days from now) hidden unless showFutureTickets is true
    if (!showFutureTickets.value && isTicketFarFuture(t)) return false

    return true
  })
)

const activeFilter = ref<string>('all')

const getTicketsByStatus = (status: TicketStatus) =>
  visibleProjectTickets.value.filter((t) => {
    if (t.status !== status) return false
    if (activeFilter.value === 'all') return true
    return t.priority === activeFilter.value
  })

const typeLabel: Record<string, string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  mobile: 'Móvil',
  web: 'Web',
  fullstack: 'Full Stack',
}

const priorityLabel: Record<string, string> = {
  urgent: 'urgente', high: 'alta', medium: 'media', low: 'baja',
}

const priorityOrder = ['urgent', 'high', 'medium', 'low']
function groupedByPriority(status: TicketStatus) {
  const groups: Record<string, any[]> = {}
  for (const p of priorityOrder) {
    groups[p] = visibleProjectTickets.value.filter((t) => t.status === status && t.priority === p)
  }
  // Apply filter
  if (activeFilter.value !== 'all') {
    for (const p of priorityOrder) {
      if (p !== activeFilter.value) groups[p] = []
    }
  }
  return groups
}

function openChildTicket(parentId: string) {
  closeCardMenu()
  closeEditTicket()
  ticketTargetStatus.value = 'sin-realizar'
  ticketTitle.value = ''
  ticketDesc.value = ''
  ticketPriority.value = 'medium'
  ticketStartDate.value = ''
  ticketEndDate.value = ''
  showTicketDrawer.value = true
  // Store parentId for create handler
  pendingParentId.value = parentId
}
const pendingParentId = ref<string | null>(null)

// ── Card menu ──
const cardMenuId = ref<string | null>(null)
const cardMenuTicket = ref<Ticket | null>(null)
const cardMenuPosition = ref({ top: 0, left: 0 })

function toggleCardMenu(event: MouseEvent, ticket: Ticket) {
  if (cardMenuId.value === ticket.id) {
    cardMenuId.value = null
    cardMenuTicket.value = null
    return
  }
  const btn = (event.currentTarget as HTMLElement)
  const rect = btn.getBoundingClientRect()
  cardMenuPosition.value = {
    top: rect.bottom + 4,
    left: rect.right - 180, // menu width ~180px, right align
  }
  cardMenuId.value = ticket.id
  cardMenuTicket.value = ticket
}

function closeCardMenu() {
  cardMenuId.value = null
  cardMenuTicket.value = null
}

// ── Inspector & Comments view ──
const inspectorView = ref<'details' | 'comments'>('details')
const activeCommentTab = ref<TicketStatus>('sin-realizar')
const newCommentText = ref('')

function openTicketComments(ticket: any) {
  closeCardMenu()
  selectedTicketId.value = ticket.id
  inspectorView.value = 'comments'
  activeCommentTab.value = ticket.status || 'sin-realizar'
  loadTicketComments(ticket.id)
}

const focusSection = ref<'general' | 'comments'>('general')

// ── Close ticket confirmation ──
const showCloseConfirm = ref(false)
const closeConfirmTicketId = ref<string | null>(null)

function openCloseConfirm(ticketId: string) {
  closeConfirmTicketId.value = ticketId
  showCloseConfirm.value = true
}

function closeCloseConfirm() {
  showCloseConfirm.value = false
  closeConfirmTicketId.value = null
}

async function confirmCloseTicket(ticketId: string, hasError: boolean) {
  if (hasError) {
    showCloseConfirm.value = false
    ticketTargetStatus.value = 'sin-realizar'
    ticketTitle.value = ''
    ticketDesc.value = ''
    ticketPriority.value = 'medium'
    ticketStartDate.value = ''
    ticketEndDate.value = ''
    pendingParentId.value = ticketId
    showTicketDrawer.value = true
    return
  }
  await closeTicket(ticketId)
  await logActivity(ticketId, 'closed', 'Ticket cerrado')
  closeCloseConfirm()
  showToast('Ticket cerrado', 'ok')
}

interface TicketComment {
  id: string
  author: string
  text: string
  time: number
  status: TicketStatus
  imageUrl?: string | null
}

const ticketComments = ref<Record<string, TicketComment[]>>({})
const commentListeners = ref<Record<string, () => void>>({})
const newCommentImage = ref<{ file: File; preview: string } | null>(null)
const isSendingComment = ref(false)
const commentTextareaRef = ref<HTMLTextAreaElement | null>(null)

// ── Comment image preview modal ──
const imagePreviewModal = ref<TicketComment | null>(null)

function openCommentImageModal(c: TicketComment) {
  if (!c.imageUrl) return
  imagePreviewModal.value = c
}

function closeCommentImageModal() {
  imagePreviewModal.value = null
}

function formatCommentFullDate(time: number): string {
  try {
    return new Date(time).toLocaleString([], {
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

function onCommentModalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && imagePreviewModal.value) {
    closeCommentImageModal()
  }
}

function onCommentImageSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    showToast('Solo se permiten imágenes', 'warn')
    input.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('La imagen supera el límite de 10 MB', 'warn')
    input.value = ''
    return
  }
  if (newCommentImage.value) {
    URL.revokeObjectURL(newCommentImage.value.preview)
  }
  newCommentImage.value = {
    file,
    preview: URL.createObjectURL(file),
  }
  input.value = ''
}

function removeCommentImage() {
  if (newCommentImage.value) {
    URL.revokeObjectURL(newCommentImage.value.preview)
    newCommentImage.value = null
  }
}

function autoResizeCommentTextarea() {
  const el = commentTextareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 88) + 'px'
}

function onCommentKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendTicketComment()
  }
}

function getTicketComments(ticketId: string, status?: TicketStatus): TicketComment[] {
  const all = ticketComments.value[ticketId] || []
  if (!status) return all
  return all.filter((c) => c.status === status)
}

function loadTicketComments(ticketId: string) {
  if (commentListeners.value[ticketId]) {
    commentListeners.value[ticketId]()
  }
  const commentsQuery = query(
    collection(db, 'tickets', ticketId, 'comments'),
    orderBy('time', 'asc')
  )
  commentListeners.value[ticketId] = onSnapshot(commentsQuery, (snap) => {
    ticketComments.value[ticketId] = snap.docs.map((d) => {
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

async function sendTicketComment() {
  if (!selectedTicket.value) return
  if (activeCommentTab.value !== selectedTicket.value.status) {
    showToast('Solo puedes comentar en el estado actual del ticket', 'warn')
    return
  }
  const text = newCommentText.value.trim()
  const image = newCommentImage.value
  if ((!text && !image) || isSendingComment.value) return

  const ticketId = selectedTicket.value.id
  const targetStatus = activeCommentTab.value
  const user = auth.currentUser

  isSendingComment.value = true
  try {
    let imageUrl: string | null = null
    if (image) {
      const path = `tickets/${ticketId}/comments/${Date.now()}_${image.file.name}`
      const sRef = storageRef(storage, path)
      await uploadBytes(sRef, image.file)
      imageUrl = await getDownloadURL(sRef)
    }

    await addDoc(collection(db, 'tickets', ticketId, 'comments'), {
      author: user?.displayName || user?.email || 'Anónimo',
      text,
      time: Date.now(),
      status: targetStatus,
      imageUrl: imageUrl || null,
    })

    await logActivity(
      ticketId,
      'commented',
      `Comentario en ${statusLabel(targetStatus)}: ${text.slice(0, 40) || (imageUrl ? 'Foto adjunta' : '')}`
    )

    newCommentText.value = ''
    removeCommentImage()
    if (commentTextareaRef.value) {
      commentTextareaRef.value.style.height = 'auto'
    }
  } catch (err) {
    console.error('Error sending comment:', err)
    showToast('Error al enviar el comentario', 'warn')
  } finally {
    isSendingComment.value = false
  }
}

function parseLocalDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).getTime()
}

const formatDate = (ts: number | null) => {
  if (!ts) return ''
  const d = new Date(ts)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

const showProjectDrawer = ref(false)

const ticketTitle = ref('')
const ticketDesc = ref('')
const ticketPriority = ref<TicketPriority>('medium')
const ticketStartDate = ref('')
const ticketEndDate = ref('')
const ticketAssignedTo = ref<string>('')
const newTicketImages = ref<{ file: File; preview: string }[]>([])
const isCreatingTicket = ref(false)
const showTicketDrawer = ref(false)
const ticketTargetStatus = ref<TicketStatus>('sin-realizar')

function onNewTicketImagesSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || !files.length) return

  const remaining = 3 - newTicketImages.value.length
  if (remaining <= 0) {
    showToast('Máximo 3 imágenes permitidas', 'warn')
    input.value = ''
    return
  }

  const validFiles: File[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file.type.startsWith('image/')) {
      showToast('Solo se permiten archivos de imagen', 'warn')
      continue
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast(`La imagen "${file.name}" supera el límite de 10 MB`, 'warn')
      continue
    }
    validFiles.push(file)
  }

  if (validFiles.length > remaining) {
    showToast('Solo se pueden agregar hasta 3 imágenes en total', 'warn')
  }

  const toAdd = validFiles.slice(0, remaining)
  for (const file of toAdd) {
    newTicketImages.value.push({
      file,
      preview: URL.createObjectURL(file),
    })
  }

  input.value = ''
}

function removeNewTicketImage(index: number) {
  const [removed] = newTicketImages.value.splice(index, 1)
  if (removed) {
    URL.revokeObjectURL(removed.preview)
  }
}

const ticketDateRange = computed({
  get: () => ({ start: ticketStartDate.value || null, end: ticketEndDate.value || null }),
  set: (val) => { ticketStartDate.value = val.start || ''; ticketEndDate.value = val.end || '' }
})

const editDateRange = computed({
  get: () => ({ start: editTicketStart.value || null, end: editTicketEnd.value || null }),
  set: (val) => { editTicketStart.value = val.start || ''; editTicketEnd.value = val.end || '' }
})

const priorities = [
  { value: 'urgent' as TicketPriority, label: 'urgente' },
  { value: 'high' as TicketPriority, label: 'alta' },
  { value: 'medium' as TicketPriority, label: 'media' },
  { value: 'low' as TicketPriority, label: 'baja' },
]

const openTicketDrawer = (status: TicketStatus) => {
  ticketTargetStatus.value = status
  ticketTitle.value = ''
  ticketDesc.value = ''
  ticketPriority.value = 'medium'
  ticketStartDate.value = ''
  ticketEndDate.value = ''
  ticketAssignedTo.value = ''
  newTicketImages.value.forEach(img => URL.revokeObjectURL(img.preview))
  newTicketImages.value = []
  showTicketDrawer.value = true
}

const closeTicketDrawer = () => {
  showTicketDrawer.value = false
  newTicketImages.value.forEach(img => URL.revokeObjectURL(img.preview))
  newTicketImages.value = []
  ticketAssignedTo.value = ''
}

// ── Edit ticket ──
const showEditTicket = ref(false)
const editTicketId = ref<string | null>(null)
const editTicketTitle = ref('')
const editTicketDesc = ref('')
const editTicketPriority = ref<TicketPriority>('medium')
const editTicketStart = ref('')
const editTicketEnd = ref('')
const originalEndDate = ref<number | null>(null)
const dateExtensionReason = ref('')

const editingTicket = computed(() =>
  editTicketId.value ? tickets.value.find(t => t.id === editTicketId.value) ?? null : null
)

const isScopeLocked = computed(() => {
  if (!editingTicket.value) return false
  return editingTicket.value.status !== 'sin-realizar' || Boolean(editingTicket.value.hasStarted)
})

const isDateExtended = computed(() => {
  if (!isScopeLocked.value || !originalEndDate.value || !editTicketEnd.value) return false
  const newEndMs = parseLocalDate(editTicketEnd.value)
  return newEndMs > originalEndDate.value
})

const canSaveEdit = computed(() => {
  if (!editTicketTitle.value.trim()) return false
  if (isDateExtended.value && !dateExtensionReason.value.trim()) return false
  return true
})

function openEditTicket(ticket: { id: string; title: string; description: string; priority: TicketPriority; startDate: number | null; endDate: number | null }) {
  editTicketId.value = ticket.id
  editTicketTitle.value = ticket.title
  editTicketDesc.value = ticket.description
  editTicketPriority.value = ticket.priority
  editTicketStart.value = ticket.startDate ? fmtDate(new Date(ticket.startDate)) : ''
  editTicketEnd.value = ticket.endDate ? fmtDate(new Date(ticket.endDate)) : ''
  originalEndDate.value = ticket.endDate || null
  dateExtensionReason.value = ''
  showEditTicket.value = true
  focusSection.value = 'general'
  closeCardMenu()
  // Load comments to check if ticket has comments (blocks deletion)
  loadTicketComments(ticket.id)
  // Load attached files
  getFiles(ticket.id).then((files) => {
    editingFiles.value = files
  })
}

const showDeleteTicketConfirm = ref(false)

const editingTicketHasComments = computed(() => {
  if (!editTicketId.value) return false
  const list = ticketComments.value[editTicketId.value]
  return Array.isArray(list) && list.length > 0
})

function attemptDeleteTicket() {
  if (editingTicketHasComments.value) {
    showToast('No se puede eliminar un ticket que ya tiene comentarios', 'warn')
    return
  }
  showDeleteTicketConfirm.value = true
}

function closeEditTicket() {
  showEditTicket.value = false
  editTicketId.value = null
  editingFiles.value = []
  originalEndDate.value = null
  dateExtensionReason.value = ''
  showDeleteTicketConfirm.value = false
}

async function confirmDeleteTicket() {
  if (!editTicketId.value) return
  if (editingTicketHasComments.value) {
    showToast('No se puede eliminar un ticket que ya tiene comentarios', 'warn')
    showDeleteTicketConfirm.value = false
    return
  }
  try {
    await logActivity(editTicketId.value, 'deleted', 'Ticket eliminado')
    await deleteTicket(editTicketId.value)
    showToast('Ticket eliminado', 'ok')
  } catch (e) {
    console.error('Error deleting ticket:', e)
    showToast('Error al eliminar ticket', 'warn')
  }
  showDeleteTicketConfirm.value = false
  closeEditTicket()
}

async function handleEditTicket() {
  if (!editTicketId.value || !editTicketTitle.value.trim()) return
  if (isDateExtended.value && !dateExtensionReason.value.trim()) {
    showToast('Debes indicar el motivo de la extensión de fecha', 'warn')
    return
  }
  let startStr = editTicketStart.value
  let endStr = editTicketEnd.value
  if (startStr && !endStr) {
    endStr = startStr
  } else if (startStr && endStr && endStr < startStr) {
    endStr = startStr
  }
  const start = startStr ? parseLocalDate(startStr) : null
  const end = endStr ? parseLocalDate(endStr) : null

  const payload: any = {
    priority: editTicketPriority.value,
    startDate: start,
    endDate: end,
  }
  if (!isScopeLocked.value) {
    payload.title = editTicketTitle.value.trim()
    payload.description = editTicketDesc.value.trim()
  }

  await updateTicket(editTicketId.value, payload)

  if (isDateExtended.value && end) {
    await logActivity(
      editTicketId.value,
      'edited',
      `Fecha de entrega extendida al ${formatDate(end)}. Motivo: ${dateExtensionReason.value.trim()}`
    )
  } else if (!isScopeLocked.value) {
    logActivity(editTicketId.value, 'edited', `Título: ${editTicketTitle.value.trim()}`)
  }
  closeEditTicket()
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !editTicketId.value) return
  try {
    await uploadFile(editTicketId.value, file)
    // Refresh files list
    editingFiles.value = await getFiles(editTicketId.value)
  } catch (err: any) {
    showToast(err?.message || 'Error al subir el archivo', 'warn')
  } finally {
    // Reset input so the same file can be re-selected
    input.value = ''
  }
}

// ── Assign member ──
const showMemberPicker = ref(false)
const memberSearch = ref('')

const projectMembers = computed(() => getProjectMembers(projectId.value))

const filteredMembers = computed(() => {
  if (!memberSearch.value.trim()) return projectMembers.value
  const q = memberSearch.value.toLowerCase()
  return projectMembers.value.filter(m => m.email.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q))
})

async function handleAssignMember(ticketId: string, member: Member | null) {
  await assignTicket(ticketId, member?.uid ?? null, member?.email ?? null)
  showMemberPicker.value = false
  memberSearch.value = ''
}

function getAssignedMember(uid: string | null): Member | undefined {
  if (!uid) return undefined
  return projectMembers.value.find(m => m.uid === uid)
}

function hasBlockersNotDone(ticketId: string): boolean {
  const links = getLinkedTicketDetails(ticketId)
  return links.some(lt => {
    if (lt.link.type !== 'depends_on') return false
    if (!lt.ticket) return true
    return lt.ticket.status !== 'completado' && !lt.ticket.closedAt
  })
}

const handleCreateTicket = async () => {
  if (!ticketTitle.value.trim() || isCreatingTicket.value) return
  let startStr = ticketStartDate.value
  let endStr = ticketEndDate.value
  if (startStr && !endStr) {
    endStr = startStr
  } else if (startStr && endStr && endStr < startStr) {
    endStr = startStr
  }
  const start = startStr ? parseLocalDate(startStr) : null
  const end = endStr ? parseLocalDate(endStr) : null

  const assignedMember = ticketAssignedTo.value
    ? projectMembers.value.find(m => m.uid === ticketAssignedTo.value)
    : null

  isCreatingTicket.value = true
  try {
    const createdTicketId = await createTicket(
      projectId.value,
      ticketTitle.value.trim(),
      ticketDesc.value.trim(),
      ticketPriority.value,
      start,
      end,
      ticketTargetStatus.value,
      pendingParentId.value,
      assignedMember ? assignedMember.uid : null,
      assignedMember ? assignedMember.email : null,
    )

    if (createdTicketId && newTicketImages.value.length > 0) {
      for (const img of newTicketImages.value) {
        await uploadFile(createdTicketId, img.file)
      }
    }

    const parentId = pendingParentId.value
    pendingParentId.value = null
    // If this is a child ticket created from "Hubo un error", close the parent
    if (parentId) {
      await closeTicket(parentId)
      await logActivity(parentId, 'closed', 'Ticket cerrado por error vinculado')
    }
    // Send notification (silent)
    if (project.value) {
      sendTicketCreated(
        ticketTitle.value.trim(),
        project.value.name,
        ticketDesc.value.trim(),
        assignedMember ? assignedMember.email : undefined
      ).catch(() => {})
    }
    closeTicketDrawer()
  } catch (err) {
    console.error('Error creating ticket:', err)
    showToast('Error al crear el ticket', 'warn')
  } finally {
    isCreatingTicket.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onCommentModalKeydown)
})

// Cleanup listeners on unmount
onUnmounted(() => {
  window.removeEventListener('keydown', onCommentModalKeydown)
  Object.values(commentListeners.value).forEach((unsub) => unsub())
})

const selectedTicketId = ref<string | null>(null)

watch(selectedTicketId, (newId: string | null) => {
  if (newId) {
    loadTicketComments(newId)
    inspectorView.value = 'details'
    const t = tickets.value.find((x) => x.id === newId)
    if (t) {
      activeCommentTab.value = t.status || 'sin-realizar'
    }
  } else {
    inspectorView.value = 'details'
  }
})

// Abrir inspector automáticamente si el ticket viene especificado en la URL (p.ej. desde una notificación)
watch(
  [() => route.query.ticket, () => route.query.ticketId, projectTickets],
  ([q1, q2, pTickets]) => {
    const tId = (q1 || q2) as string | undefined
    if (tId && pTickets.some(t => t.id === tId)) {
      selectedTicketId.value = tId
    }
  },
  { immediate: true }
)

watch(
  projectTickets,
  (newTickets) => {
    newTickets.forEach((t) => {
      if (!commentListeners.value[t.id]) {
        loadTicketComments(t.id)
      }
    })
  },
  { immediate: true }
)

const currentStatusCommentCount = computed(() => {
  if (!selectedTicket.value) return 0
  return getTicketComments(selectedTicket.value.id, selectedTicket.value.status).length
})

const activeTabComments = computed(() => {
  if (!selectedTicket.value) return []
  return getTicketComments(selectedTicket.value.id, activeCommentTab.value)
})

const selectedTicket = computed(() => {
  if (!selectedTicketId.value) return null
  return tickets.value.find((t) => t.id === selectedTicketId.value) || null
})

const selectedTicketLinkedDetails = computed(() => {
  if (!selectedTicket.value) return []
  return getLinkedTicketDetails(selectedTicket.value.id)
})

const linkTypeLabel: Record<string, string> = {
  blocks: 'Bloquea a',
  depends_on: 'Depende de',
  related_to: 'Relacionado con',
}

const statusMeta: Record<TicketStatus, { label: string; color: string; bg: string }> = {
  'sin-realizar': { label: t('sin_realizar'), color: '#6b7280', bg: 'rgba(107, 114, 128, 0.12)' },
  'en-proceso': { label: t('en_proceso'), color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' },
  'testing': { label: t('testing'), color: '#f97316', bg: 'rgba(249, 115, 22, 0.12)' },
  'completado': { label: t('completado'), color: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)' },
}

function selectTicket(ticketId: string) {
  if (selectedTicketId.value === ticketId) {
    selectedTicketId.value = null
  } else {
    selectedTicketId.value = ticketId
  }
}

const draggingId = ref<string | null>(null)
const dragOverCol = ref<string | null>(null)
const dragOffset = ref({ x: 0, y: 0 })
const dragPos = ref({ x: 0, y: 0 })
const dragStartPos = ref({ x: 0, y: 0 })
const dragEl = ref<HTMLElement | null>(null)

const openProjectDrawer = () => {
  showProjectDrawer.value = true
}

const closeProjectDrawer = () => {
  showProjectDrawer.value = false
}


function onCardMouseDown(e: MouseEvent, ticketId: string) {
  // Ignore if clicking on a button or card menu inside the card
  const btn = (e.target as HTMLElement).closest('button, .card-menu')
  if (btn) return
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  draggingId.value = ticketId
  dragEl.value = target
  dragOffset.value = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  dragPos.value = { x: e.clientX, y: e.clientY }
  dragStartPos.value = { x: e.clientX, y: e.clientY }
  target.style.position = 'fixed'
  target.style.zIndex = '1000'
  target.style.width = rect.width + 'px'
  target.style.pointerEvents = 'none'
  target.style.transition = 'none'
  target.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'
  target.style.transform = 'scale(1.03)'
  updateCardPos(e)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('selectstart', preventSelect)
}

function preventSelect(e: Event) {
  e.preventDefault()
}

function updateCardPos(e: MouseEvent) {
  if (!dragEl.value) return
  dragEl.value.style.left = (e.clientX - dragOffset.value.x) + 'px'
  dragEl.value.style.top = (e.clientY - dragOffset.value.y) + 'px'
  dragPos.value = { x: e.clientX, y: e.clientY }
  // Detect column under cursor
  const col = (e.target as HTMLElement)?.closest?.('.kanban-column')
  if (col) {
    const status = (col as HTMLElement)?.dataset?.col
    if (status) dragOverCol.value = status
  }
}

function onMouseMove(e: MouseEvent) {
  e.preventDefault()
  updateCardPos(e)
}

async function onMouseUp(_e: MouseEvent) {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('selectstart', preventSelect)
  const id = draggingId.value
  const targetStatus = dragOverCol.value

  const isClick = Math.abs(_e.clientX - dragStartPos.value.x) < 4 && Math.abs(_e.clientY - dragStartPos.value.y) < 4
  if (isClick && id) {
    selectTicket(id)
  }

  // Reset card style
  if (dragEl.value) {
    dragEl.value.style.position = ''
    dragEl.value.style.zIndex = ''
    dragEl.value.style.width = ''
    dragEl.value.style.pointerEvents = ''
    dragEl.value.style.transition = ''
    dragEl.value.style.boxShadow = ''
    dragEl.value.style.transform = ''
    dragEl.value.style.left = ''
    dragEl.value.style.top = ''
    dragEl.value = null
  }
  draggingId.value = null
  dragOverCol.value = null
  if (id && targetStatus) {
    const ticket = tickets.value.find((t) => t.id === id)
    const oldStatus = ticket?.status
    // Only creator can mark as completed (allow if no creator set = legacy ticket)
    if (targetStatus === 'completado' && ticket && ticket.createdBy && ticket.createdBy !== auth.currentUser?.uid) {
      showToast('Solo el creador del ticket puede marcarlo como completado', 'warn')
      return
    }
    try {
      await updateTicketStatus(id, targetStatus as TicketStatus)
      // Log activity
      if (ticket && oldStatus && oldStatus !== targetStatus) {
        logActivity(id, 'moved', `De "${statusLabel(oldStatus)}" a "${statusLabel(targetStatus as TicketStatus)}"`)
      }
      // Send notification (only if status actually changed)
      if (ticket && project.value && oldStatus && oldStatus !== targetStatus) {
        sendTicketMoved(ticket.title, project.value.name, oldStatus, targetStatus as TicketStatus).catch(() => {})
      }
    } catch (err) {
      console.error('Error moving ticket:', err)
    }
  }
}
</script>

<template>
  <div class="kanban-page">
    <div v-if="loadingProject" class="kanban-empty">
      <p>Cargando proyecto...</p>
    </div>
    <div v-else-if="!project" class="kanban-empty">
      <p>{{ t('proyecto_no_encontrado') }}</p>
    </div>
    <template v-else>
      <div class="kanban-header">
        <button class="back-btn" @click="router.push('/')" title="Volver al inicio">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div class="kanban-header-info">
          <h2 class="kanban-header-title">{{ project.name }}</h2>
          <span class="kanban-header-type" :class="'badge--' + project.type">{{ typeLabel[project.type] || project.type }}</span>
        </div>
        <button
          v-if="projectGithubUrl"
          class="git-sync-btn"
          :class="{ 'is-syncing': isSyncingGit }"
          @click="syncProjectGitCommits"
          title="Sincronizar commits y PRs de GitHub para auto-completar tareas"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="git-sync-icon">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span class="git-sync-label">{{ isSyncingGit ? 'Sincronizando...' : 'Sincronizar Git' }}</span>
        </button>
        <button
          class="git-hook-btn"
          @click="showGitHookModal = true"
          title="Configurar Git Hook para automatizar commits en VS Code y terminal"
        >
          <span class="git-hook-icon">⚡</span>
          <span class="git-hook-label">Git Hook</span>
        </button>
        <button class="info-btn" @click="openProjectDrawer" title="Ajustes del proyecto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <!-- Floating card menu -->
      <FloatingCardMenu
        v-if="cardMenuId && cardMenuTicket"
        :position="cardMenuPosition"
        @edit="openEditTicket(cardMenuTicket!)"
        @comments="openTicketComments(cardMenuTicket!)"
        @child-ticket="openChildTicket(cardMenuTicket!.id)"
        @copy-branch="copyTicketBranch(cardMenuTicket!)"
        @copy-commit="copyTicketCommit(cardMenuTicket!)"
      />

      <div class="kanban-board-wrapper">
        <!-- Main Kanban Board -->
        <div class="kanban-board">
          <div
            v-for="col in statusColumns"
            :key="col.key"
            class="kanban-column"
            :class="['col--' + col.key, { 'col--drag-over': dragOverCol === col.key }]"
            :data-col="col.key"
          >
            <div class="column-header">
              <span class="column-title">{{ statusLabel(col.key) }}</span>
              <span class="column-count">{{ getTicketsByStatus(col.key).length }}</span>
              <button class="column-add" @click="openTicketDrawer(col.key)" title="Nuevo ticket">+</button>
            </div>
            <div class="column-body">
              <template v-for="(group, p) in groupedByPriority(col.key)" :key="p">
                <div v-if="group.length" class="swimlane">
                  <div class="swimlane-header" :class="'swimlane--' + p" @click="toggleSwimlane(col.key, p)">
                    <svg class="swimlane-chevron" :class="{ rotated: !isSwimlaneCollapsed(col.key, p) }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    <span>{{ p === 'urgent' ? 'Urgente' : p === 'high' ? 'Alta' : p === 'medium' ? 'Media' : 'Baja' }}</span>
                    <span class="swimlane-count">{{ group.length }}</span>
                  </div>
                  <template v-if="!isSwimlaneCollapsed(col.key, p)">
                  <KanbanCard
                    v-for="ticket in group"
                    :key="ticket.id"
                    :ticket="ticket"
                    :is-dragging="draggingId === ticket.id"
                    :is-selected="selectedTicketId === ticket.id"
                    :is-overdue="isTicketOverdue(ticket)"
                    :has-blockers="hasBlockersNotDone(ticket.id)"
                    :comment-count="getTicketComments(ticket.id, ticket.status).length"
                    :format-date="formatDate"
                    :assigned-member-name="getAssignedMember(ticket.assignedTo)?.displayName"
                    :assigned-member-initial="(getAssignedMember(ticket.assignedTo)?.displayName || ticket.assignedToEmail || '?')[0].toUpperCase()"
                    @card-mouse-down="onCardMouseDown"
                    @dblclick="openEditTicket"
                    @toggle-menu="toggleCardMenu"
                    @open-comments="openTicketComments"
                    @close="openCloseConfirm"
                  />
                  </template>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- Right Side Ticket Inspector Panel -->
        <aside class="ticket-inspector-panel" :class="{ open: !!selectedTicket }">
          <!-- DETAILS VIEW IN SIDE PANEL -->
          <div v-if="selectedTicket && inspectorView === 'details'" class="inspector-content">
            <div class="inspector-header">
              <div class="inspector-header-left">
                <div
                  class="inspector-status-badge"
                  :style="{ background: statusMeta[selectedTicket.status]?.bg, color: statusMeta[selectedTicket.status]?.color }"
                >
                  <span class="inspector-status-dot" :style="{ background: statusMeta[selectedTicket.status]?.color }"></span>
                  <span>{{ statusMeta[selectedTicket.status]?.label }}</span>
                </div>
                <button class="inspector-edit-btn" @click="openEditTicket(selectedTicket)" title="Editar ticket">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
              <button class="inspector-close-btn" @click="selectedTicketId = null" title="Cerrar panel">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div class="inspector-body">
              <!-- Ticket Title -->
              <div class="inspector-field">
                <span class="inspector-field-label">Nombre del Ticket</span>
                <h4 class="inspector-ticket-title">{{ selectedTicket.title }}</h4>
              </div>

              <!-- Priority & Dates Row -->
              <div class="inspector-row">
                <div class="inspector-field">
                  <span class="inspector-field-label">Prioridad</span>
                  <span class="prio-badge" :class="'prio--' + selectedTicket.priority">
                    {{ priorityLabel[selectedTicket.priority] || selectedTicket.priority }}
                  </span>
                </div>

                <div class="inspector-field">
                  <span class="inspector-field-label">Fecha</span>
                  <span class="inspector-date-text">
                    <template v-if="selectedTicket.startDate || selectedTicket.endDate">
                      {{ formatDate(selectedTicket.startDate) }}{{ selectedTicket.startDate && selectedTicket.endDate ? ' → ' : '' }}{{ formatDate(selectedTicket.endDate) }}
                    </template>
                    <template v-else>Sin fecha</template>
                  </span>
                </div>
              </div>

              <!-- Assigned Member -->
              <div class="inspector-field">
                <span class="inspector-field-label">Asignado a</span>
                <div v-if="selectedTicket.assignedTo && getAssignedMember(selectedTicket.assignedTo)" class="inspector-assignee">
                  <span class="assignee-avatar-sm">{{ getAssignedMember(selectedTicket.assignedTo)!.displayName[0].toUpperCase() }}</span>
                  <span class="assignee-name">{{ getAssignedMember(selectedTicket.assignedTo)!.displayName }}</span>
                </div>
                <span v-else class="inspector-empty-text">Sin asignar</span>
              </div>

              <!-- Description -->
              <div class="inspector-field">
                <span class="inspector-field-label">Descripción</span>
                <p v-if="selectedTicket.description" class="inspector-desc-text">{{ selectedTicket.description }}</p>
                <p v-else class="inspector-empty-text">Sin descripción proporcionada</p>
              </div>

              <!-- Linked Tickets -->
              <div class="inspector-field">
                <span class="inspector-field-label">Tickets Vinculados</span>
                <div v-if="selectedTicketLinkedDetails.length" class="inspector-linked-list">
                  <div
                    v-for="item in selectedTicketLinkedDetails"
                    :key="item.link.ticketId"
                    class="inspector-linked-item"
                    @click="item.ticket && (selectedTicketId = item.ticket.id)"
                  >
                    <span class="linked-rel-tag" :class="'rel--' + item.link.type">
                      {{ linkTypeLabel[item.link.type] || item.link.type }}
                    </span>
                    <span class="linked-title">{{ item.ticket?.title || 'Ticket eliminado' }}</span>
                    <span v-if="item.ticket" class="linked-status-pill" :style="{ color: statusMeta[item.ticket.status]?.color }">
                      {{ statusMeta[item.ticket.status]?.label }}
                    </span>
                  </div>
                </div>
                <p v-else class="inspector-empty-text">Sin tickets vinculados</p>
              </div>

              <!-- Git & GitHub Integration -->
              <div class="inspector-field">
                <div class="inspector-git-header">
                  <span class="inspector-field-label">Git & GitHub</span>
                  <button
                    v-if="projectGithubUrl"
                    class="inspector-git-refresh-btn"
                    :class="{ 'is-spinning': isSyncingGit }"
                    @click="syncProjectGitCommits"
                    title="Sincronizar commits y PRs de GitHub"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  </button>
                </div>

                <!-- Command Cards for VS Code / Git -->
                <div class="git-commands-container">
                  <!-- Commit Command (ideal for main or feature branches) -->
                  <div class="git-command-card">
                    <div class="git-cmd-meta">
                      <span class="git-cmd-tag">Para main o cualquier rama</span>
                      <span class="git-cmd-name">Comando de Commit</span>
                    </div>
                    <div class="git-cmd-interactive" @click="copyTicketCommit(selectedTicket)">
                      <code class="git-code-snippet">{{ getSuggestedCommitCmd(selectedTicket) }}</code>
                      <button class="git-cmd-copy-btn" title="Copiar comando">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      </button>
                    </div>
                  </div>

                  <!-- Branch Command (for collaborators) -->
                  <div class="git-command-card">
                    <div class="git-cmd-meta">
                      <span class="git-cmd-tag">Colaboradores</span>
                      <span class="git-cmd-name">Crear Rama</span>
                    </div>
                    <div class="git-cmd-interactive" @click="copyTicketBranch(selectedTicket)">
                      <code class="git-code-snippet">{{ getSuggestedBranchCmd(selectedTicket) }}</code>
                      <button class="git-cmd-copy-btn" title="Copiar comando">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Git Hook 1-click shortcut -->
                <div class="git-hook-shortcut-banner" @click="showGitHookModal = true">
                  <div class="git-hook-shortcut-left">
                    <span class="git-hook-shortcut-bolt">⚡</span>
                    <span class="git-hook-shortcut-text">¿Quieres que los commits se etiqueten solos?</span>
                  </div>
                  <button type="button" class="btn-hook-shortcut-pill">
                    Git Hook
                  </button>
                </div>

                <!-- Linked Pull Request -->
                <div v-if="selectedTicket.gitPrNumber" class="git-linked-pr">
                  <span class="pr-badge">PR #{{ selectedTicket.gitPrNumber }}</span>
                  <a :href="selectedTicket.gitPrUrl || '#'" target="_blank" class="pr-link">
                    Pull Request fusionado en GitHub ↗
                  </a>
                </div>

                <!-- Linked Commits History -->
                <div v-if="selectedTicket.gitCommits && selectedTicket.gitCommits.length > 0" class="git-linked-commits-list">
                  <div v-for="c in selectedTicket.gitCommits" :key="c.sha" class="git-linked-commit-card">
                    <div class="commit-card-top">
                      <span class="commit-hash">{{ c.shortSha }}</span>
                      <span class="commit-author">{{ c.author }}</span>
                      <a :href="c.url" target="_blank" class="commit-external-link" title="Ver en GitHub">↗</a>
                    </div>
                    <p class="commit-message-text">{{ c.message }}</p>
                  </div>
                </div>

                <!-- Manual commit link from main -->
                <div v-if="projectGithubUrl" class="git-manual-link-container">
                  <button
                    type="button"
                    class="git-manual-toggle-btn"
                    @click="showManualCommitPicker = !showManualCommitPicker"
                  >
                    <span>{{ showManualCommitPicker ? 'Ocultar commits de main' : '+ Vincular commit reciente de main' }}</span>
                  </button>

                  <div v-if="showManualCommitPicker" class="git-recent-picker-dropdown">
                    <div v-if="gitLoading" class="git-picker-status">Cargando commits de GitHub...</div>
                    <div v-else-if="!githubCommits.length" class="git-picker-status">No se encontraron commits recientes en el repositorio.</div>
                    <div v-else class="git-picker-list">
                      <div
                        v-for="gc in githubCommits.slice(0, 8)"
                        :key="gc.sha"
                        class="git-picker-item"
                        @click="manualLinkCommit(selectedTicket, gc)"
                        title="Haz clic para vincular este commit"
                      >
                        <div class="picker-item-top">
                          <span class="commit-hash">{{ gc.shortSha }}</span>
                          <span class="commit-author">{{ gc.author }}</span>
                        </div>
                        <p class="picker-item-msg">{{ gc.message }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Comments Trigger Card -->
              <div class="inspector-field">
                <span class="inspector-field-label">Comentarios</span>
                <button type="button" class="inspector-comments-card" @click="inspectorView = 'comments'">
                  <div class="inspector-comments-left">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="comments-card-icon">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span>Ver comentarios</span>
                  </div>
                  <span class="inspector-comments-badge" :class="{ 'has-comments': currentStatusCommentCount > 0 }">
                    {{ currentStatusCommentCount }}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <!-- COMMENTS VIEW IN SIDE PANEL -->
          <div v-else-if="selectedTicket && inspectorView === 'comments'" class="inspector-content inspector-comments-view">
            <div class="inspector-header">
              <div class="inspector-header-left">
                <button class="inspector-back-btn" @click="inspectorView = 'details'" title="Volver a detalles">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="width:16px;height:16px">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span class="inspector-comments-title">Comentarios</span>
              </div>
              <button class="inspector-close-btn" @click="selectedTicketId = null" title="Cerrar panel">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <!-- 4 STATUS TABS AT THE TOP: PURE TEXT WITH UNDERLINE -->
            <div class="comments-status-tabs">
              <button
                v-for="col in statusColumns"
                :key="col.key"
                class="status-tab-btn"
                :class="{ active: activeCommentTab === col.key }"
                @click="activeCommentTab = col.key"
              >
                {{ statusLabel(col.key) }} ({{ getTicketComments(selectedTicket.id, col.key).length }})
              </button>
            </div>

            <!-- COMMENTS LIST FOR ACTIVE STATUS TAB -->
            <div class="comments-messages-list">
              <div
                v-for="(c, i) in activeTabComments"
                :key="c.id || i"
                class="comment-msg-item"
              >
                <div class="comment-avatar">
                  {{ (c.author || '?')[0].toUpperCase() }}
                </div>
                <div class="comment-bubble">
                  <div class="comment-meta">
                    <span class="comment-author">{{ c.author }}</span>
                    <span class="comment-time">{{ new Date(c.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
                  </div>
                  <p v-if="c.text" class="comment-text">{{ c.text }}</p>
                  <div v-if="c.imageUrl" class="comment-image-wrap">
                    <button
                      type="button"
                      class="comment-image-trigger"
                      @click="openCommentImageModal(c)"
                      title="Ver imagen con comentario"
                    >
                      <img :src="c.imageUrl" class="comment-image" alt="Foto adjunta" />
                      <span class="comment-image-hint">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
                          <polyline points="15 3 21 3 21 9"/>
                          <polyline points="9 21 3 21 3 15"/>
                          <line x1="21" y1="3" x2="14" y2="10"/>
                          <line x1="3" y1="21" x2="10" y2="14"/>
                        </svg>
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              <div v-if="!activeTabComments.length" class="comments-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-chat-icon">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p>Sin comentarios en <strong>{{ statusLabel(activeCommentTab) }}</strong></p>
                <span class="empty-hint">{{ activeCommentTab === selectedTicket.status ? 'Escribe abajo para agregar un comentario en este estado.' : 'Solo se pueden agregar comentarios en el estado actual (' + statusLabel(selectedTicket.status) + ').' }}</span>
              </div>
            </div>

            <!-- UNIFIED COMMENT BAR: ONLY EDITABLE FOR CURRENT TICKET STATUS -->
            <div v-if="activeCommentTab === selectedTicket.status" class="comments-unified-bar">
              <!-- Inline attached photo preview chip -->
              <div v-if="newCommentImage" class="comment-attached-preview">
                <img :src="newCommentImage.preview" class="comment-attached-thumb" alt="Vista previa" />
                <span class="comment-attached-name" :title="newCommentImage.file.name">{{ newCommentImage.file.name }}</span>
                <button type="button" class="comment-attached-remove" @click="removeCommentImage" title="Quitar foto">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              <div class="comments-unified-row">
                <!-- Attach photo button -->
                <label class="comment-attach-btn" :class="{ 'has-file': !!newCommentImage }" title="Adjuntar foto">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <input type="file" accept="image/*" hidden @change="onCommentImageSelected" />
                </label>

                <!-- Auto-expanding textarea (up to 4 lines, then scrolls within) -->
                <textarea
                  ref="commentTextareaRef"
                  v-model="newCommentText"
                  rows="1"
                  :placeholder="'Escribe un comentario en ' + statusLabel(activeCommentTab) + '...'"
                  class="comments-unified-textarea"
                  @input="autoResizeCommentTextarea"
                  @keydown="onCommentKeydown"
                ></textarea>

                <!-- Send button -->
                <button
                  class="comments-unified-send-btn"
                  :disabled="(!newCommentText.trim() && !newCommentImage) || isSendingComment"
                  @click="sendTicketComment"
                  title="Enviar"
                >
                  <svg v-if="!isSendingComment" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polyline points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  <span v-else class="comment-sending-dots">...</span>
                </button>
              </div>
            </div>

            <!-- READONLY NOTICE WHEN VIEWING PREVIOUS OR FUTURE STATUSES -->
            <div v-else class="comments-readonly-notice">
              <span>Solo lectura. El ticket está en <strong>{{ statusLabel(selectedTicket.status) }}</strong></span>
            </div>
          </div>
        </aside>
      </div>

      <!-- Close confirmation -->
      <CloseConfirmDialog
        v-if="showCloseConfirm"
        :ticket-id="closeConfirmTicketId"
        @confirm="confirmCloseTicket"
        @cancel="closeCloseConfirm"
      />

      <!-- Ticket drawer -->
      <div v-if="showTicketDrawer" class="drawer-overlay" @click="closeTicketDrawer"></div>
      <div v-if="showTicketDrawer" class="drawer drawer--ticket" @click.stop>
        <div class="drawer-header">
          <h3 class="drawer-title">{{ pendingParentId ? 'Crear sub-ticket' : t('crear_ticket') }}</h3>
        </div>
        <div class="drawer-body">
          <div class="drawer-field">
            <span class="detail-label">{{ t('titulo') }}</span>
            <input v-model="ticketTitle" type="text" class="drawer-input" autocomplete="off" />
          </div>
          <div class="drawer-field">
            <span class="detail-label">{{ t('descripcion') }}</span>
            <textarea v-model="ticketDesc" class="drawer-textarea" rows="3"></textarea>
          </div>
          <div class="drawer-inline-row">
            <div class="drawer-field drawer-field--priority">
              <span class="detail-label">{{ t('prioridad') }}</span>
              <div class="custom-select-wrap">
                <select v-model="ticketPriority" class="custom-select">
                  <option v-for="p in priorities" :key="p.value" :value="p.value">{{ t(p.label) }}</option>
                </select>
                <svg v-if="ticketPriority === 'urgent'" class="select-icon prio-icon-urgent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                <svg v-else-if="ticketPriority === 'high'" class="select-icon prio-icon-high" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                <svg v-else-if="ticketPriority === 'medium'" class="select-icon prio-icon-medium" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <svg v-else class="select-icon prio-icon-low" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 5 19 12"/></svg>
              </div>
            </div>
            <div class="drawer-field drawer-field--date">
              <span class="detail-label">Fechas</span>
              <CalendarRangePicker v-model="ticketDateRange" />
            </div>
          </div>

          <div class="drawer-field">
            <span class="detail-label">A cargo de</span>
            <select v-model="ticketAssignedTo" class="drawer-input">
              <option value="">Sin asignar</option>
              <option v-for="m in projectMembers" :key="m.uid" :value="m.uid">
                {{ m.displayName }} ({{ m.email }})
              </option>
            </select>
          </div>

          <div class="drawer-field">
            <div class="field-header-row">
              <span class="detail-label">Imágenes adjuntas (máx. 3)</span>
              <span class="images-count-badge">{{ newTicketImages.length }}/3</span>
            </div>

            <div v-if="newTicketImages.length" class="ticket-images-preview-grid">
              <div v-for="(img, idx) in newTicketImages" :key="idx" class="image-preview-card">
                <img :src="img.preview" :alt="img.file.name" class="image-preview-thumb" />
                <button type="button" class="image-remove-btn" @click="removeNewTicketImage(idx)" title="Eliminar imagen">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <span class="image-preview-name" :title="img.file.name">{{ img.file.name }}</span>
              </div>
            </div>

            <label v-if="newTicketImages.length < 3" class="file-upload-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span>Subir imagen ({{ 3 - newTicketImages.length }} restante{{ 3 - newTicketImages.length === 1 ? '' : 's' }})</span>
              <input
                type="file"
                hidden
                accept="image/*"
                multiple
                @change="onNewTicketImagesSelected"
              />
            </label>
          </div>
        </div>
        <div class="drawer-footer">
          <button class="edit-btn-cancel" @click="closeTicketDrawer">{{ t('cancelar') }}</button>
          <button class="edit-btn-save" :disabled="!ticketTitle.trim() || isCreatingTicket" @click="handleCreateTicket">{{ isCreatingTicket ? 'Creando...' : (pendingParentId ? 'Crear sub-ticket' : t('crear_ticket')) }}</button>
        </div>
      </div>

      <!-- Edit ticket drawer -->
      <div v-if="showEditTicket" class="drawer-overlay" @click="closeEditTicket"></div>
      <div v-if="showEditTicket" class="drawer drawer--ticket" @click.stop>
        <div class="drawer-header">
          <h3 class="drawer-title">{{ editingTicket?.status === 'completado' ? 'Información del ticket' : t('editar_ticket') }}</h3>
          <div class="drawer-header-actions">
            <!-- Trash icon: delete ticket (disabled if ticket has comments) -->
            <button
              v-if="editingTicket?.status !== 'completado'"
              type="button"
              class="drawer-icon-btn drawer-icon-btn--trash"
              :class="{ 'is-disabled': editingTicketHasComments }"
              @click="attemptDeleteTicket"
              :title="editingTicketHasComments ? 'No se puede eliminar un ticket que ya tiene comentarios' : 'Eliminar ticket'"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>

            <!-- Close icon button -->
            <button
              type="button"
              class="drawer-icon-btn drawer-icon-btn--close"
              @click="closeEditTicket"
              title="Cerrar"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div class="drawer-body">
          <div class="drawer-field">
            <span class="detail-label">{{ t('titulo') }}</span>
            <input v-model="editTicketTitle" type="text" class="drawer-input" :disabled="isScopeLocked || editingTicket?.status === 'completado'" autocomplete="off" />
          </div>
          <div class="drawer-field">
            <span class="detail-label">{{ t('descripcion') }}</span>
            <textarea v-model="editTicketDesc" class="drawer-textarea" rows="3" :disabled="isScopeLocked || editingTicket?.status === 'completado'"></textarea>
          </div>
          <div class="drawer-inline-row">
            <div class="drawer-field drawer-field--priority">
              <span class="detail-label">{{ t('prioridad') }}</span>
              <select v-model="editTicketPriority" class="drawer-input" :disabled="editingTicket?.status === 'completado'">
                <option v-for="p in priorities" :key="p.value" :value="p.value">{{ t(p.label) }}</option>
              </select>
            </div>
            <div class="drawer-field drawer-field--date">
              <span class="detail-label">{{ t('fecha') }}</span>
              <CalendarRangePicker v-model="editDateRange" />
            </div>
          </div>

          <!-- Reason required if date extended -->
          <div v-if="isDateExtended" class="drawer-field date-extension-field">
            <div class="field-header-row">
              <span class="detail-label text-warning">Motivo de extensión de fecha *</span>
            </div>
            <textarea
              v-model="dateExtensionReason"
              class="drawer-textarea date-extension-textarea"
              rows="2"
              placeholder="Describe por qué se extiende la fecha de entrega..."
            ></textarea>
            <span class="extension-hint">Es obligatorio justificar la extensión de la fecha de entrega.</span>
          </div>

          <div class="drawer-field">
            <span class="detail-label">{{ t('archivos_adjuntos') }}</span>
            <div v-if="editingFiles.length" class="ticket-files">
              <a v-for="f in editingFiles" :key="f.name" :href="f.url" target="_blank" class="ticket-file-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span>{{ f.name }}</span>
              </a>
            </div>
            <label v-if="editingTicket?.status !== 'completado'" class="file-upload-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {{ uploading ? t('subiendo') : t('adjuntar_archivo') }}
              <input type="file" hidden :disabled="uploading" @change="onFileSelected" />
            </label>
          </div>

          <div class="drawer-divider"></div>

          <!-- Assign member -->
          <div class="drawer-field" v-if="editingTicket?.status !== 'completado'">
            <span class="detail-label">Asignar a</span>
            <div class="assign-picker">
              <button class="assign-trigger" @click="showMemberPicker = !showMemberPicker">
                <template v-if="editingTicket?.assignedTo && getAssignedMember(editingTicket.assignedTo)">
                  <span class="assignee-avatar">{{ getAssignedMember(editingTicket.assignedTo)!.displayName[0].toUpperCase() }}</span>
                  <span>{{ getAssignedMember(editingTicket.assignedTo)!.displayName }}</span>
                </template>
                <span v-else class="assign-placeholder">Sin asignar</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;margin-left:auto"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div v-if="showMemberPicker" class="assign-dropdown" @click.stop>
                <input v-model="memberSearch" type="text" class="assign-search" placeholder="Buscar miembro..." @keyup.escape="showMemberPicker = false" />
                <div class="assign-options">
                  <button class="assign-option" @click="handleAssignMember(editTicketId!, null)">
                    <span class="assign-none">Sin asignar</span>
                  </button>
                  <button v-for="m in filteredMembers" :key="m.uid" class="assign-option" @click="handleAssignMember(editTicketId!, m)">
                    <span class="assignee-avatar-sm">{{ m.displayName[0].toUpperCase() }}</span>
                    <span>{{ m.displayName }}</span>
                    <span class="assign-email">{{ m.email }}</span>
                  </button>
                  <p v-if="!filteredMembers.length" class="assign-empty">Sin resultados</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="drawer-footer">
          <button class="edit-btn-cancel" @click="closeEditTicket">{{ t('cancelar') }}</button>
          <button v-if="editingTicket?.status !== 'completado'" class="edit-btn-save" :disabled="!canSaveEdit" @click="handleEditTicket">{{ t('guardar') }}</button>
        </div>
      </div>

      <!-- Delete ticket confirmation dialog modal -->
      <div
        v-if="showDeleteTicketConfirm"
        class="delete-ticket-modal-overlay"
        @click="showDeleteTicketConfirm = false"
      >
        <div class="delete-ticket-modal-card" @click.stop>
          <div class="delete-ticket-modal-header">
            <div class="delete-ticket-modal-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:#ef4444">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <h4 class="delete-ticket-modal-title">Eliminar ticket</h4>
          </div>
          <p class="delete-ticket-modal-text">¿Seguro que deseas eliminar este ticket? Esta acción no se puede deshacer.</p>
          <div class="delete-ticket-modal-actions">
            <button type="button" class="delete-modal-cancel-btn" @click="showDeleteTicketConfirm = false">Cancelar</button>
            <button type="button" class="delete-modal-confirm-btn" @click="confirmDeleteTicket">Eliminar</button>
          </div>
        </div>
      </div>

      <!-- Project details drawer -->
      <ProjectDrawer
        v-if="showProjectDrawer"
        :project-id="projectId"
        :visible="showProjectDrawer"
        @close="closeProjectDrawer"
      />

      <!-- Comment Image Lightbox Modal with Comment Details -->
      <div
        v-if="imagePreviewModal"
        class="comment-img-modal-overlay"
        @click="closeCommentImageModal"
      >
        <div class="comment-img-modal-card" @click.stop>
          <div class="comment-img-modal-header">
            <div class="comment-img-modal-user">
              <span class="comment-img-modal-avatar">{{ (imagePreviewModal.author || '?')[0].toUpperCase() }}</span>
              <div class="comment-img-modal-info">
                <div class="comment-img-modal-author-row">
                  <span class="comment-img-modal-author">{{ imagePreviewModal.author }}</span>
                  <span class="comment-img-modal-badge">{{ statusLabel(imagePreviewModal.status) }}</span>
                </div>
                <span class="comment-img-modal-date">{{ formatCommentFullDate(imagePreviewModal.time) }}</span>
              </div>
            </div>
            <button
              type="button"
              class="comment-img-modal-close"
              @click="closeCommentImageModal"
              title="Cerrar (Esc)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div class="comment-img-modal-media">
            <img :src="imagePreviewModal.imageUrl || ''" class="comment-img-modal-pic" alt="Imagen del comentario" />
          </div>

          <div v-if="imagePreviewModal.text" class="comment-img-modal-footer">
            <p class="comment-img-modal-text">{{ imagePreviewModal.text }}</p>
          </div>
        </div>
      </div>
    </template>
    <!-- Toast -->
    <div v-if="toastMsg" class="toast" :class="'toast--' + toastType">
      {{ toastMsg }}
    </div>

    <!-- Git Hook Setup Modal -->
    <GitHookModal :visible="showGitHookModal" @close="showGitHookModal = false" />
  </div>
</template>

<style scoped>
.kanban-page {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  padding: 0.6rem 1rem;
  box-sizing: border-box; overflow: hidden;
}
.kanban-empty { height: 100%; display: flex; align-items: center; justify-content: center; }
.kanban-empty p { font-size: 0.9rem; color: var(--text); }
.kanban-board { flex: 1; overflow: hidden; display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid var(--border); border-radius: 6px; background: transparent; min-height: 0; height: 100%; max-height: 100%; }

.drawer--ticket { width: 440px !important; }
.drawer--comments { width: 400px !important; }
.drawer--ticket .calendar-popup { right: 0; left: auto; }

/* ── Header ── */
.kanban-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.35rem;
  margin-bottom: 0.35rem;
  flex-shrink: 0;
  position: relative;
}

.kanban-filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toggle-future {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-h);
  cursor: pointer;
  background: var(--code-bg);
  border: 1px solid var(--border);
  padding: 0.25rem 0.55rem;
  border-radius: 6px;
  user-select: none;
  transition: border-color 0.15s;
}

.toggle-future:hover {
  border-color: var(--accent);
}

.toggle-future input {
  cursor: pointer;
}

.back-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  transition: color 0.15s;
}

.back-btn:hover {
  color: var(--accent);
}

.back-btn svg {
  width: 18px;
  height: 18px;
}

.kanban-header-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.kanban-header-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-h);
}

.kanban-header-type {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 2px 8px;
}

.info-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  transition: color 0.15s;
}

.info-btn:hover {
  color: var(--accent);
}

.info-btn svg {
  width: 20px;
  height: 20px;
}
.col--sin-realizar { --col-accent: #6b7280; }
.col--sin-realizar .column-header { background: rgba(107,114,128,0.1); border-bottom-color: #6b7280; }
.col--en-proceso { --col-accent: #6b7280; }
.col--en-proceso .column-header { background: rgba(107,114,128,0.1); border-bottom-color: #6b7280; }
.col--testing { --col-accent: #6b7280; }
.col--testing .column-header { background: rgba(107,114,128,0.1); border-bottom-color: #6b7280; }
.col--completado { --col-accent: #6b7280; }
.col--completado .column-header { background: rgba(107,114,128,0.1); border-bottom-color: #6b7280; }
.kanban-column {
  display: flex; flex-direction: column;
  background: transparent; border: none;
  border-right: 1px solid var(--border);
  border-radius: 0;
  min-height: 0;
  overflow: hidden;
}
.kanban-column:last-child {
  border-right: none;
}
.column-header {
  display: flex; align-items: center; gap: 0.3rem;
  padding: 0.22rem 0.55rem;
  background: var(--card-bg); flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.column-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-h); }
.column-count { margin-left: auto; font-size: 0.65rem; color: var(--text); background: var(--code-bg); padding: 1px 6px; }
.column-body {
  flex: 1; overflow-y: auto; padding: 0;
  display: flex; flex-direction: column; gap: 0;
  min-height: 40px;
}

.column-body:empty {
  padding-bottom: 2rem;
}
.kanban-column.col--drag-over .column-body {
  background: rgba(37, 99, 235, 0.03);
}

.toast {
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.6rem 1.2rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #fff;
  z-index: 200;
  animation: toastIn 0.3s ease-out;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.toast--ok { background: #22c55e; }
.toast--warn { background: #f97316; }

@keyframes toastIn {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ── Drawer ── */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 100;
}

.drawer {
  position: fixed;
  top: 0.75rem;
  bottom: 0.75rem;
  right: 0.75rem;
  width: 440px;
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
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

@keyframes slideInRight {
  from { transform: translateX(calc(100% + 1rem)); }
  to { transform: translateX(0); }
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.drawer-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-h);
}

.drawer-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  padding: 4px;
  transition: background 0.15s, color 0.15s;
}

.drawer-close:hover {
  background: var(--code-bg);
  color: var(--text-h);
}

.drawer-close svg {
  width: 16px;
  height: 16px;
}

.drawer-body {
  flex: 1;
  padding: 0.75rem 1.25rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.drawer-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.drawer-inline-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.drawer-field--priority {
  width: 125px;
  flex-shrink: 0;
}

.drawer-field--date {
  width: 190px;
  flex-shrink: 0;
}

.drawer-divider {
  height: 1px;
  background: var(--border);
  margin: 0.15rem 0;
}

.detail-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
}

.detail-value {
  font-size: 0.88rem;
  color: var(--text-h);
  margin: 0;
  line-height: 1.5;
}

.detail-placeholder {
  font-size: 0.85rem;
  color: var(--text);
  margin: 0;
  font-style: italic;
  opacity: 0.5;
}

.badge--backend { background: rgba(59,130,246,0.12); color:#3b82f6; }
.badge--frontend { background: rgba(239,68,68,0.12); color:#ef4444; }
.badge--mobile { background: rgba(34,197,94,0.12); color:#22c55e; }
.badge--web { background: rgba(168,85,247,0.12); color:#a855f7; }
.badge--fullstack { background: rgba(234,179,8,0.12); color:#eab308; }

/* ── Column add button ── */
.column-add {
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: 1px solid var(--border);
  color: var(--text); cursor: pointer;
  font-size: 0.75rem; font-weight: 700; line-height: 1;
  border-radius: 50%;
  padding: 0;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}
.column-add:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

/* ── Drawer input / textarea ── */
.drawer-input {
  width: 100%; padding: 0.35rem 0.6rem;
  background: var(--code-bg);
  border: 1.5px solid var(--border);
  font: inherit; font-size: 0.85rem; color: var(--text-h);
  outline: none; transition: border-color 0.2s;
  box-sizing: border-box;
}
.drawer-input:focus { border-color: var(--accent); }
.drawer-textarea {
  width: 100%; padding: 0.35rem 0.6rem;
  background: var(--code-bg);
  border: 1.5px solid var(--border);
  font: inherit; font-size: 0.85rem; color: var(--text-h);
  outline: none; transition: border-color 0.2s;
  box-sizing: border-box; line-height: 1.4;
  font-family: inherit;
  min-height: 120px;
  resize: vertical;
}
.drawer-textarea:focus { border-color: var(--accent); }
.drawer-input:disabled,
.drawer-textarea:disabled {
  opacity: 0.65;
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.03);
}

.field-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.scope-locked-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted, #94a3b8);
  background: rgba(148, 163, 184, 0.12);
  border: 1px solid rgba(148, 163, 184, 0.25);
  padding: 0.15rem 0.45rem;
}

.lock-icon {
  width: 11px;
  height: 11px;
}

.date-extension-field {
  background: rgba(245, 158, 11, 0.05);
  border: 1px dashed rgba(245, 158, 11, 0.35);
  padding: 0.65rem 0.75rem;
  margin-top: 0.25rem;
}

.text-warning {
  color: #f59e0b !important;
}

.date-extension-textarea {
  min-height: 60px !important;
  border-color: rgba(245, 158, 11, 0.4);
}

.date-extension-textarea:focus {
  border-color: #f59e0b !important;
}

.extension-hint {
  font-size: 0.72rem;
  color: var(--text);
  opacity: 0.75;
}

/* ── Custom select ── */
.custom-select-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.custom-select {
  width: 100%;
  height: 32px;
  padding: 0.25rem 1.8rem 0.25rem 0.55rem;
  background: var(--code-bg);
  border: 1.5px solid var(--border);
  border-radius: 4px;
  font: inherit; font-size: 0.82rem; color: var(--text-h);
  outline: none; cursor: pointer;
  appearance: none; -webkit-appearance: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
.custom-select:focus { border-color: var(--accent); }
.select-icon {
  position: absolute;
  right: 0.55rem;
  width: 14px; height: 14px;
  pointer-events: none;
}
.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.edit-btn-cancel {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  color: var(--text);
  padding: 0.35rem 0.6rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s;
}

.edit-btn-cancel:hover {
  color: var(--text-h);
}

.edit-btn-save {
  padding: 0.35rem 0.85rem;
  background: transparent;
  border: 1px solid #ffffff;
  color: #ffffff;
  border-radius: 4px;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.edit-btn-save:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.edit-btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── File attachments ── */
.ticket-files {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ticket-file-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.5rem;
  font-size: 0.78rem;
  color: var(--text);
  text-decoration: none;
  transition: background 0.1s;
}
.ticket-file-item:hover { background: var(--accent-bg); color: var(--text-h); }
.file-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
  transition: background 0.1s;
  border: 1px dashed var(--border);
}
.file-upload-btn:hover { background: var(--accent-bg); border-color: var(--accent); }

/* ── Ticket Image Previews ── */
.ticket-images-preview-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.image-preview-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.image-preview-thumb {
  width: 100%;
  height: 64px;
  object-fit: cover;
  display: block;
  background: #000;
}

.image-remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
}

.image-remove-btn:hover {
  background: #ef4444;
}

.image-preview-name {
  font-size: 0.65rem;
  color: var(--text);
  padding: 0.2rem 0.35rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.images-count-badge {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text);
  background: var(--code-bg);
  border: 1px solid var(--border);
  padding: 1px 6px;
  border-radius: 3px;
}

/* Filters */
.kanban-filters {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  flex-shrink: 0;
  z-index: 30;
}
.filter-dropdown {
  position: relative;
  display: inline-block;
  transition: transform 0.2s ease;
}
.filter-dropdown--open {
  transform: translateX(-80px);
}

.filter-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s;
}

.filter-trigger:hover {
  border-color: var(--accent);
}

.filter-chevron {
  width: 10px;
  height: 10px;
  opacity: 0.5;
}

.filter-menu {
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 6px;
  display: flex;
  gap: 2px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  padding: 3px;
  z-index: 30;
  animation: fadeIn 0.1s ease-out;
  white-space: nowrap;
}

.filter-option {
  padding: 0.2rem 0.5rem;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}

.filter-option:hover {
  background: var(--accent-bg);
  color: var(--text-h);
}

.filter-option.active {
  background: var(--accent);
  color: #fff;
}

/* Swimlanes */
.swimlane { display: flex; flex-direction: column; gap: 0; }
.swimlane-header {
  display: flex; align-items: center; gap: 0.3rem;
  font-size: 0.55rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2px;
  padding: 0.25rem 0.55rem; color: var(--text); opacity: 0.6;
  background: var(--code-bg);
  border-bottom: 1px solid var(--border);
  margin-top: 0;
  cursor: pointer;
  user-select: none;
}
.swimlane-header:hover { opacity: 0.7; }

.swimlane-chevron {
  width: 10px; height: 10px;
  transition: transform 0.15s;
  flex-shrink: 0;
}
.swimlane-chevron.rotated {
  transform: rotate(90deg);
}
.swimlane:first-child .swimlane-header { margin-top: 0; }
.swimlane-count { margin-left: auto; font-size: 0.6rem; color: var(--text); opacity: 0.4; }

.swimlane--urgent { color: #ef4444 !important; opacity: 1 !important; }
.swimlane--urgent .swimlane-count { color: #ef4444 !important; opacity: 0.5 !important; }
.swimlane--high { color: #f97316 !important; opacity: 1 !important; }
.swimlane--high .swimlane-count { color: #f97316 !important; opacity: 0.5 !important; }
.swimlane--medium { color: #3b82f6 !important; opacity: 1 !important; }
.swimlane--medium .swimlane-count { color: #3b82f6 !important; opacity: 0.5 !important; }
.swimlane--low { color: var(--text) !important; opacity: 0.7 !important; }
.swimlane--low .swimlane-count { color: var(--text) !important; opacity: 0.4 !important; }

/* Activity timeline */
.activity-timeline {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 200px;
  overflow-y: auto;
}
.activity-item {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.3rem 0.4rem;
  background: var(--code-bg);
}
.activity-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}
.activity-icon svg { opacity: 0.5; }
.activity-body {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.activity-user {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--accent);
}
.activity-action {
  font-size: 0.75rem;
  color: var(--text-h);
  line-height: 1.3;
}
.activity-time {
  font-size: 0.6rem;
  color: var(--text);
  opacity: 0.5;
}

/* ── Custom scrollbar ── */
.column-body::-webkit-scrollbar,
.readme-content::-webkit-scrollbar,
.repo-files::-webkit-scrollbar,
.activity-timeline::-webkit-scrollbar,
.chat-messages::-webkit-scrollbar,
.drawer-body::-webkit-scrollbar {
  width: 4px;
}
.column-body::-webkit-scrollbar-track,
.readme-content::-webkit-scrollbar-track,
.repo-files::-webkit-scrollbar-track,
.activity-timeline::-webkit-scrollbar-track,
.chat-messages::-webkit-scrollbar-track,
.drawer-body::-webkit-scrollbar-track {
  background: transparent;
}
.column-body::-webkit-scrollbar-thumb,
.readme-content::-webkit-scrollbar-thumb,
.repo-files::-webkit-scrollbar-thumb,
.activity-timeline::-webkit-scrollbar-thumb,
.chat-messages::-webkit-scrollbar-thumb,
.drawer-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.5);
  border-radius: 2px;
}
.column-body::-webkit-scrollbar-thumb:hover,
.readme-content::-webkit-scrollbar-thumb:hover,
.repo-files::-webkit-scrollbar-thumb:hover,
.activity-timeline::-webkit-scrollbar-thumb:hover,
.chat-messages::-webkit-scrollbar-thumb:hover,
.drawer-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.7);
}

/* ── Assign member picker ── */
.assign-picker {
  position: relative;
}
.assign-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.65rem;
  background: var(--code-bg);
  border: 1.5px solid var(--border);
  font: inherit;
  font-size: 0.82rem;
  color: var(--text-h);
  cursor: pointer;
  transition: border-color 0.2s;
}
.assign-trigger:hover {
  border-color: var(--accent);
}
.assign-placeholder {
  color: var(--text);
  opacity: 0.5;
}
.assignee-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 0.6rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.assignee-avatar-sm {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 0.55rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.assign-dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  z-index: 20;
  background: var(--card-bg);
  border: 1px solid var(--border);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.assign-search {
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: none;
  border-bottom: 1px solid var(--border);
  background: var(--code-bg);
  font: inherit;
  font-size: 0.78rem;
  color: var(--text-h);
  outline: none;
  box-sizing: border-box;
}
.assign-options {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.assign-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.78rem;
  color: var(--text-h);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.assign-option:hover {
  background: var(--accent-bg);
}
.assign-email {
  font-size: 0.65rem;
  color: var(--text);
  opacity: 0.6;
  margin-left: auto;
}
.assign-none {
  color: var(--text);
  opacity: 0.5;
  font-style: italic;
}
.assign-empty {
  padding: 0.5rem;
  font-size: 0.75rem;
  color: var(--text);
  opacity: 0.5;
  text-align: center;
  margin: 0;
}

/* ── Linked tickets ── */
.linked-tickets {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.linked-ticket-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  transition: background 0.1s;
}
.linked-ticket-item.linked-blocked {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.04);
}
.linked-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  min-width: 0;
}
.linked-badge {
  font-size: 0.5rem;
  font-weight: 700;
  padding: 1px 5px;
  text-transform: uppercase;
  flex-shrink: 0;
}
.linked--blocks { background: rgba(239,68,68,0.12); color: #ef4444; }
.linked--depends_on { background: rgba(249,115,22,0.12); color: #f97316; }
.linked--related_to { background: rgba(59,130,246,0.12); color: #3b82f6; }
.linked-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-h);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.linked-status {
  font-size: 0.55rem;
  font-weight: 600;
  padding: 1px 5px;
}
.linked-warning {
  font-size: 0.6rem;
  color: #ef4444;
  font-weight: 700;
}
.linked-remove {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  opacity: 0.4;
  flex-shrink: 0;
  transition: opacity 0.15s, color 0.15s;
}
.linked-remove:hover {
  opacity: 1;
  color: #ef4444;
}
.link-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.3rem;
  padding: 0.25rem 0.5rem;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s;
}
.link-add-btn:hover {
  background: var(--accent-bg);
  border-color: var(--accent);
}
.link-picker {
  margin-top: 0.3rem;
  border: 1px solid var(--border);
  background: var(--code-bg);
  overflow: hidden;
}
.link-picker-row {
  display: flex;
  gap: 0.3rem;
  padding: 0.35rem;
  border-bottom: 1px solid var(--border);
}
.link-type-select {
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--border);
  background: var(--card-bg);
  font: inherit;
  font-size: 0.65rem;
  color: var(--text-h);
  outline: none;
  cursor: pointer;
}
.link-search {
  flex: 1;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--border);
  background: var(--card-bg);
  font: inherit;
  font-size: 0.7rem;
  color: var(--text-h);
  outline: none;
}
.link-results {
  max-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.link-result-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.5rem;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.72rem;
  color: var(--text-h);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.link-result-item:hover {
  background: var(--accent-bg);
}
.linked-prio {
  font-size: 0.5rem;
  font-weight: 600;
  padding: 1px 4px;
  flex-shrink: 0;
}
.linked-result-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kanban-board-wrapper {
  display: flex;
  gap: 1rem;
  flex: 1;
  min-height: 0;
  max-height: calc(100vh - 120px);
  height: calc(100vh - 120px);
  overflow: hidden;
  align-items: stretch;
}

/* Left Side Inspector Panel */
.ticket-inspector-panel {
  width: 0;
  padding: 0;
  opacity: 0;
  margin: 0;
  border: none;
  overflow: hidden;
  pointer-events: none;
  transition: width 0.25s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s ease, padding 0.25s ease;
  flex-shrink: 0;
}

.ticket-inspector-panel.open {
  width: 340px;
  opacity: 1;
  pointer-events: auto;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.65rem 0.8rem;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow);
  height: 100%;
  max-height: 100%;
  box-sizing: border-box;
}

.inspector-content {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  height: 100%;
}

.inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--border);
}

.inspector-header-left {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.inspector-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.15rem 0.45rem;
  border-radius: 12px;
}

.inspector-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.inspector-edit-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  padding: 0;
}

.inspector-edit-btn:hover {
  background: var(--code-bg);
  border-color: var(--accent);
  color: var(--accent);
}

.inspector-edit-btn svg {
  width: 12px;
  height: 12px;
}

.inspector-close-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
  padding: 0;
}

.inspector-close-btn:hover {
  background: var(--code-bg);
  color: var(--text-h);
}

.inspector-close-btn svg {
  width: 13px;
  height: 13px;
}

.inspector-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  flex: 1;
  overflow-y: auto;
}

.inspector-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.inspector-field-label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text);
  opacity: 0.75;
}

.inspector-ticket-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-h);
  margin: 0;
  line-height: 1.35;
  word-break: break-word;
}

.inspector-row {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.prio-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-h);
  text-transform: capitalize;
}

.inspector-date-text {
  font-size: 0.75rem;
  color: var(--text-h);
  font-weight: 500;
}

.inspector-assignee {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.assignee-name {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-h);
}

.inspector-desc-text {
  font-size: 0.75rem;
  color: var(--text-h);
  font-weight: 400;
  margin: 0;
  line-height: 1.45;
  white-space: pre-wrap;
  background: var(--code-bg);
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  min-height: 120px;
  max-height: 300px;
  overflow-y: auto;
}

.inspector-empty-text {
  font-size: 0.75rem;
  color: var(--text);
  opacity: 0.6;
  font-style: italic;
  margin: 0;
}

.inspector-linked-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.inspector-linked-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.inspector-linked-item:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.linked-rel-tag {
  font-size: 0.58rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  text-transform: uppercase;
}

.rel--blocks { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
.rel--depends_on { background: rgba(249, 115, 22, 0.12); color: #f97316; }
.rel--related_to { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }

.linked-title {
  flex: 1;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.linked-status-pill {
  font-size: 0.6rem;
  font-weight: 700;
}

/* ── Inspector Comments Card Trigger ── */
.inspector-comments-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.45rem 0.6rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  color: var(--text-h);
  transition: border-color 0.15s, background 0.15s;
}

.inspector-comments-card:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.inspector-comments-left {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.comments-card-icon {
  width: 14px;
  height: 14px;
  color: var(--accent);
}

.inspector-comments-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
  background: rgba(148, 163, 184, 0.15);
  color: var(--text);
}

.inspector-comments-badge.has-comments {
  background: var(--accent-bg);
  color: var(--accent);
  border: 1px solid var(--accent);
}

/* ── Comments Side Panel View ── */
.inspector-comments-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0.5rem;
}

.inspector-back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none !important;
  border: none !important;
  padding: 0 !important;
  margin: 0 !important;
  box-shadow: none !important;
  color: var(--text);
  cursor: pointer;
  width: 22px;
  height: 22px;
  transition: color 0.15s;
}

.inspector-back-btn:hover {
  color: #ffffff;
}

.inspector-comments-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-h);
}

/* ── 4 Status Tabs: Pure Text with Underline ── */
.comments-status-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  background: transparent;
  padding: 0;
  border: none;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.2rem;
}

.status-tab-btn {
  background: none !important;
  border: none !important;
  border-bottom: 2px solid transparent !important;
  padding: 0.35rem 0.2rem 0.45rem !important;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  box-shadow: none !important;
  border-radius: 0 !important;
  white-space: nowrap;
}

.status-tab-btn:hover {
  color: var(--text-h);
}

.status-tab-btn.active {
  color: #ffffff !important;
  font-weight: 700;
  border-bottom: 2px solid #ffffff !important;
}

/* ── Comments Messages List ── */
.comments-messages-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.35rem 0.1rem;
  min-height: 0;
}

.comment-msg-item {
  display: flex;
  gap: 0.45rem;
  align-items: flex-start;
}

.comment-avatar {
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

.comment-bubble {
  flex: 1;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.35rem 0.55rem;
  min-width: 0;
}

.comment-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  margin-bottom: 0.15rem;
}

.comment-author {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.comment-time {
  font-size: 0.58rem;
  color: var(--text);
  opacity: 0.6;
  flex-shrink: 0;
}

.comment-text {
  font-size: 0.78rem;
  color: var(--text-h);
  margin: 0;
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
}

.comment-image-wrap {
  margin-top: 0.35rem;
}

.comment-image {
  max-width: 100%;
  max-height: 160px;
  border-radius: 4px;
  object-fit: cover;
  display: block;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: opacity 0.15s;
}

.comment-image:hover {
  opacity: 0.9;
}

.comments-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text);
  gap: 0.35rem;
  margin: auto;
}

.empty-chat-icon {
  width: 28px;
  height: 28px;
  opacity: 0.3;
}

.comments-empty-state p {
  margin: 0;
  font-size: 0.78rem;
}

.empty-hint {
  font-size: 0.68rem;
  opacity: 0.6;
}

/* ── Unified Comment Bar ── */
.comments-unified-bar {
  display: flex;
  flex-direction: column;
  background: var(--code-bg);
  border: 1.5px solid var(--border);
  border-radius: 6px;
  padding: 0.3rem 0.45rem;
  flex-shrink: 0;
  transition: border-color 0.15s;
}

.comments-unified-bar:focus-within {
  border-color: var(--accent);
}

.comment-attached-preview {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.4rem;
  margin-bottom: 0.3rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.comment-attached-thumb {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 3px;
  background: #000;
}

.comment-attached-name {
  flex: 1;
  font-size: 0.68rem;
  color: var(--text-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.comment-attached-remove {
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s;
}

.comment-attached-remove:hover {
  color: #ef4444;
}

.comments-unified-row {
  display: flex;
  align-items: flex-end;
  gap: 0.35rem;
}

.comment-attach-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
  margin-bottom: 1px;
  transition: color 0.15s, background 0.15s;
}

.comment-attach-btn:hover {
  color: var(--text-h);
  background: rgba(255, 255, 255, 0.06);
}

.comment-attach-btn.has-file {
  color: var(--accent);
}

.comments-unified-textarea {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  font-size: 0.78rem;
  color: var(--text-h);
  line-height: 1.4;
  padding: 0.25rem 0.15rem;
  resize: none;
  min-height: 22px;
  max-height: 88px; /* max 4 lines */
  overflow-y: auto;
  box-sizing: border-box;
  font-family: inherit;
}

.comments-unified-textarea::-webkit-scrollbar {
  width: 3px;
}

.comments-unified-textarea::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 2px;
}

.comments-unified-send-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  border: none;
  color: #fff;
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
  margin-bottom: 1px;
  transition: opacity 0.15s;
}

.comments-unified-send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.comments-unified-send-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.comment-sending-dots {
  font-size: 0.65rem;
  font-weight: 700;
}

.comments-readonly-notice {
  padding: 0.55rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-size: 0.73rem;
  color: var(--text);
  text-align: center;
  flex-shrink: 0;
  opacity: 0.8;
}

.comments-readonly-notice strong {
  color: var(--text-h);
}

/* ── Comment Image Trigger & Badge ── */
.comment-image-trigger {
  position: relative;
  display: inline-block;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
  line-height: 0;
}

.comment-image-hint {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease;
  backdrop-filter: blur(2px);
}

.comment-image-trigger:hover .comment-image-hint {
  opacity: 1;
}

/* ── Comment Image Lightbox Modal ── */
.comment-img-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.82);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  box-sizing: border-box;
  animation: modalFadeIn 0.15s ease;
}

.comment-img-modal-card {
  background: var(--card-bg, #1e1e1e);
  border: 1px solid var(--border);
  border-radius: 8px;
  max-width: min(900px, 94vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
  animation: modalPopIn 0.18s ease;
}

.comment-img-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.95rem;
  border-bottom: 1px solid var(--border);
  background: var(--code-bg);
  flex-shrink: 0;
  gap: 0.75rem;
}

.comment-img-modal-user {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.comment-img-modal-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.comment-img-modal-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.comment-img-modal-author-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.comment-img-modal-author {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-h);
}

.comment-img-modal-badge {
  font-size: 0.62rem;
  padding: 0.1rem 0.45rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--accent);
  font-weight: 600;
}

.comment-img-modal-date {
  font-size: 0.65rem;
  color: var(--text);
  opacity: 0.65;
}

.comment-img-modal-close {
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}

.comment-img-modal-close:hover {
  color: var(--text-h);
  background: rgba(255, 255, 255, 0.08);
}

.comment-img-modal-media {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0a0a;
  overflow: auto;
  min-height: 0;
  padding: 0.75rem;
}

.comment-img-modal-pic {
  max-width: 100%;
  max-height: calc(85vh - 120px);
  object-fit: contain;
  border-radius: 4px;
  display: block;
}

.comment-img-modal-footer {
  padding: 0.75rem 0.95rem;
  background: var(--code-bg);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  max-height: 130px;
  overflow-y: auto;
}

.comment-img-modal-text {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-h);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

@keyframes modalFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes modalPopIn {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}

/* ── Drawer Header Action Icons ── */
.drawer-header-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.drawer-icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text);
  padding: 0;
  transition: all 0.15s ease;
}

.drawer-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-h);
}

.drawer-icon-btn--trash:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.drawer-icon-btn.is-disabled,
.drawer-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: auto;
}

.drawer-icon-btn.is-disabled:hover {
  background: transparent;
  color: var(--text);
}

/* ── Delete Ticket Modal Dialog ── */
.delete-ticket-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  animation: modalFadeIn 0.15s ease;
}

.delete-ticket-modal-card {
  background: var(--card-bg, #1a1a1a);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 100%;
  max-width: 380px;
  padding: 1.25rem 1.4rem;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  animation: modalPopIn 0.18s ease;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.delete-ticket-modal-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.delete-ticket-modal-icon-wrap {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.delete-ticket-modal-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-h);
}

.delete-ticket-modal-text {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text);
  line-height: 1.45;
  opacity: 0.9;
}

.delete-ticket-modal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
  margin-top: 0.35rem;
}

.delete-modal-cancel-btn {
  background: transparent;
  border: none;
  color: var(--text);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0.4rem 0.75rem;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.delete-modal-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-h);
}

.delete-modal-confirm-btn {
  background: #ef4444;
  border: none;
  color: #fff;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  transition: opacity 0.15s ease;
}

.delete-modal-confirm-btn:hover {
  opacity: 0.9;
}

/* ── Git & GitHub Integration Styles ── */
.git-sync-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  color: var(--text-h);
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.git-sync-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}

.git-sync-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.3s ease;
}

.git-sync-btn.is-syncing .git-sync-icon {
  animation: spin 0.8s linear infinite;
}

.git-hook-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(14, 165, 233, 0.3);
  color: var(--accent);
  padding: 0.35rem 0.65rem;
  border-radius: 6px;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.git-hook-btn:hover {
  background: rgba(14, 165, 233, 0.16);
  border-color: var(--accent);
}

.git-hook-icon {
  font-size: 0.8rem;
  line-height: 1;
}

.git-hook-shortcut-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  background: rgba(14, 165, 233, 0.05);
  border: 1px dashed rgba(14, 165, 233, 0.25);
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-top: 0.4rem;
}

.git-hook-shortcut-banner:hover {
  background: rgba(14, 165, 233, 0.1);
  border-color: var(--accent);
}

.git-hook-shortcut-left {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.git-hook-shortcut-bolt {
  font-size: 0.85rem;
  line-height: 1;
}

.git-hook-shortcut-text {
  font-size: 0.72rem;
  color: var(--text-h);
  font-weight: 500;
}

.btn-hook-shortcut-pill {
  padding: 0.2rem 0.5rem;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 0.68rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.inspector-git-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.inspector-git-refresh-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease;
}

.inspector-git-refresh-btn:hover {
  color: var(--accent);
}

.inspector-git-refresh-btn.is-spinning svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.git-commands-container {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-bottom: 0.5rem;
}

.git-command-card {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.git-cmd-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.git-cmd-tag {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.4px;
}

.git-cmd-name {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--text-h);
}

.git-cmd-interactive {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  padding: 0.25rem 0.45rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.git-cmd-interactive:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.git-code-snippet {
  font-family: monospace;
  font-size: 0.68rem;
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.git-cmd-copy-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.git-cmd-interactive:hover .git-cmd-copy-btn {
  color: var(--accent);
}

.git-linked-pr {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(168, 85, 247, 0.08);
  border: 1px solid rgba(168, 85, 247, 0.25);
  border-radius: 6px;
  padding: 0.35rem 0.55rem;
  margin-bottom: 0.45rem;
}

.pr-badge {
  font-size: 0.65rem;
  font-weight: 700;
  color: #a855f7;
  background: rgba(168, 85, 247, 0.15);
  padding: 1px 5px;
  border-radius: 4px;
}

.pr-link {
  font-size: 0.72rem;
  color: var(--text-h);
  text-decoration: none;
  font-weight: 500;
}

.pr-link:hover {
  text-decoration: underline;
  color: #a855f7;
}

.git-linked-commits-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
}

.git-linked-commit-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.commit-card-top {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.commit-hash {
  font-family: monospace;
  font-size: 0.65rem;
  font-weight: 700;
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
}

.commit-author {
  font-size: 0.68rem;
  color: var(--text-muted);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.commit-external-link {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.75rem;
  padding: 0 2px;
}

.commit-external-link:hover {
  color: var(--accent);
}

.commit-message-text {
  margin: 0;
  font-size: 0.72rem;
  color: var(--text);
  line-height: 1.35;
}

.git-manual-link-container {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.git-manual-toggle-btn {
  background: none;
  border: 1px dashed var(--border);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.7rem;
  font-weight: 500;
  padding: 0.35rem 0.6rem;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.git-manual-toggle-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}

.git-recent-picker-dropdown {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.3rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.git-picker-status {
  padding: 0.5rem;
  font-size: 0.7rem;
  color: var(--text-muted);
  text-align: center;
}

.git-picker-list {
  max-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.git-picker-item {
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.git-picker-item:hover {
  background: var(--code-bg);
}

.picker-item-top {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.picker-item-msg {
  margin: 0;
  font-size: 0.68rem;
  color: var(--text-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
