<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { signOut, onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from './firebase'
import { useAvatar } from './composables/useAvatar'
import { useProjects } from './composables/useProjects'
import { useGithubToken } from './composables/useGithubToken'
import { useAppNotifications, type AppNotification } from './composables/useAppNotifications'
import { useEmailNotifications, getNotificationEmail, setNotificationEmail } from './composables/useEmailNotifications'
import { useI18n } from './composables/useI18n'
import { useWorkspaces, MAX_WORKSPACES } from './composables/useWorkspaces'
import type { Workspace } from './types/workspace'
import type { Member } from './types/project'
import { getUserInitials } from './utils/format'
import LoginView from './pages/LoginView.vue'

const user = ref<User | null>(null)
const ready = ref(false)

onAuthStateChanged(auth, (u) => {
  user.value = u
  ready.value = true
})

const { avatarUrl, loadAvatar, uploadAvatar } = useAvatar()

const router = useRouter()
const route = useRoute()

const {
  workspaces,
  sharedWorkspaces,
  currentWorkspace,
  isCurrentWorkspaceOwner,
  loading: workspacesLoading,
  createWorkspace,
  setCurrentWorkspace,
} = useWorkspaces()

const {
  projects,
  allProjects,
  acceptInvite,
  rejectInvite,
  addMember,
  removeMember,
  MAX_PROJECTS_PER_WORKSPACE,
} = useProjects()

const showWorkspaceMenu = ref(false)
const showCreateWorkspaceModal = ref(false)
const newWorkspaceName = ref('')
const creatingWs = ref(false)
const workspaceError = ref('')

const hasInvitedOrMemberProjects = computed(() => {
  return allProjects.value.some(p => p.userId !== user.value?.uid)
})

const pendingInvites = computed(() => {
  const email = auth.currentUser?.email
  if (!email) return []
  return allProjects.value.filter(p =>
    p.members?.some(m => m.uid === 'pending_' + email)
  )
})

const canCloseWorkspaceModal = computed(() => {
  return workspaces.value.length > 0 || sharedWorkspaces.value.length > 0 || hasInvitedOrMemberProjects.value
})

const shouldPromptFirstWorkspace = computed(() => {
  if (!ready.value || !user.value || workspacesLoading.value) return false
  if (route.path.startsWith('/proyectos/')) return false
  if (sharedWorkspaces.value.length > 0 || hasInvitedOrMemberProjects.value || pendingInvites.value.length > 0) {
    return false
  }
  return workspaces.value.length === 0
})

const openCreateWorkspaceModal = () => {
  showWorkspaceMenu.value = false
  newWorkspaceName.value = ''
  workspaceError.value = ''
  showCreateWorkspaceModal.value = true
}

const closeCreateWorkspaceModal = () => {
  if (!canCloseWorkspaceModal.value) return
  showCreateWorkspaceModal.value = false
  newWorkspaceName.value = ''
  workspaceError.value = ''
}

const handleCreateWorkspace = async () => {
  workspaceError.value = ''
  const name = newWorkspaceName.value.trim()
  if (!name) return

  creatingWs.value = true
  try {
    await createWorkspace(name)
    showCreateWorkspaceModal.value = false
    newWorkspaceName.value = ''
  } catch (err: any) {
    workspaceError.value = err?.message || 'Error al crear el área de trabajo'
  } finally {
    creatingWs.value = false
  }
}

const selectWorkspace = (ws: Workspace) => {
  setCurrentWorkspace(ws)
  showWorkspaceMenu.value = false
  if (router.currentRoute.value.path.startsWith('/proyectos/')) {
    router.push('/')
  }
}

const closeMenus = () => {
  showWorkspaceMenu.value = false
  profileOpen.value = false
  showNotifications.value = false
}

const isTablet = ref(typeof window !== 'undefined' ? window.innerWidth <= 1024 : false)
const sidebarOpen = ref(!isTablet.value)

const checkScreen = () => {
  isTablet.value = window.innerWidth <= 1024
  if (!isTablet.value) {
    sidebarOpen.value = true
  }
}

function onWindowClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (!target.closest('.notif-wrapper')) {
    showNotifications.value = false
  }
}

onMounted(() => {
  loadAvatar()
  checkScreen()
  window.addEventListener('resize', checkScreen)
  window.addEventListener('click', onWindowClick)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkScreen)
  window.removeEventListener('click', onWindowClick)
})

const { locale, setLocale } = useI18n()
const {
  sendInviteEmail,
  sendProjectAddedEmail,
  sendProjectRemovedEmail,
  sendWorkspaceRemovedEmail,
} = useEmailNotifications()

router.afterEach(() => {
  if (isTablet.value) {
    sidebarOpen.value = false
  }
})

const profileOpen = ref(false)
const showLogoutModal = ref(false)
const showSettingsModal = ref(false)
const settingsTab = ref('profile')

// ── Workspace drawer & member management ──
const showWorkspaceDrawer = ref(false)
const wsInviteEmail = ref('')
const selectedWsProjectIds = ref<string[]>([])
const wsInviteStatus = ref('')
const wsInviteError = ref('')
const sendingWsInvite = ref(false)

const openWorkspaceDrawer = () => {
  showWorkspaceMenu.value = false
  profileOpen.value = false
  wsInviteEmail.value = ''
  selectedWsProjectIds.value = projects.value.map(p => p.id)
  wsInviteStatus.value = ''
  wsInviteError.value = ''
  showWorkspaceDrawer.value = true
}

const closeWorkspaceDrawer = () => {
  showWorkspaceDrawer.value = false
  wsInviteEmail.value = ''
  wsInviteStatus.value = ''
  wsInviteError.value = ''
}

const toggleAllWsProjects = () => {
  if (selectedWsProjectIds.value.length === projects.value.length) {
    selectedWsProjectIds.value = []
  } else {
    selectedWsProjectIds.value = projects.value.map(p => p.id)
  }
}

interface WsMemberProjectInfo {
  id: string
  name: string
}

interface WsMemberSummary {
  email: string
  displayName: string
  role: 'owner' | 'admin' | 'member'
  isPending: boolean
  projects: WsMemberProjectInfo[]
  availableProjects: WsMemberProjectInfo[]
}

const activeAddProjMemberEmail = ref<string | null>(null)
const toggleAddProjDropdown = (email: string) => {
  activeAddProjMemberEmail.value = activeAddProjMemberEmail.value === email ? null : email
}

const workspaceMembersSummary = computed<WsMemberSummary[]>(() => {
  const map: Record<string, WsMemberSummary> = {}
  for (const p of projects.value) {
    for (const m of p.members || []) {
      const email = m.email || (m.uid.startsWith('pending_') ? m.uid.replace('pending_', '') : '')
      if (!email) continue
      if (!map[email]) {
        map[email] = {
          email,
          displayName: m.displayName || email.split('@')[0],
          role: m.role || 'member',
          isPending: m.uid.startsWith('pending_'),
          projects: [],
          availableProjects: [],
        }
      }
      if (!map[email].projects.some(proj => proj.id === p.id)) {
        map[email].projects.push({ id: p.id, name: p.name })
      }
      if (m.role === 'owner') {
        map[email].role = 'owner'
      }
      if (!m.uid.startsWith('pending_')) {
        map[email].isPending = false
      }
    }
  }

  const allWorkspaceProjects = projects.value.map(p => ({ id: p.id, name: p.name }))
  for (const email of Object.keys(map)) {
    const assignedIds = new Set(map[email].projects.map(p => p.id))
    map[email].availableProjects = allWorkspaceProjects.filter(p => !assignedIds.has(p.id))
  }

  return Object.values(map)
})

const handleSendWorkspaceInvite = async () => {
  wsInviteError.value = ''
  wsInviteStatus.value = ''
  const email = wsInviteEmail.value.trim()
  if (!email || !email.includes('@')) {
    wsInviteError.value = 'Por favor ingresa un correo electrónico válido.'
    return
  }
  if (selectedWsProjectIds.value.length === 0) {
    wsInviteError.value = 'Debes seleccionar al menos un proyecto para otorgar acceso.'
    return
  }

  sendingWsInvite.value = true
  try {
    const inviterName = user.value?.displayName || user.value?.email?.split('@')[0] || 'Un usuario'
    const wsName = currentWorkspace.value?.name || 'Dev Flow'
    for (const projId of selectedWsProjectIds.value) {
      const proj = projects.value.find(p => p.id === projId)
      if (proj) {
        const member: Member = {
          uid: 'pending_' + email,
          email,
          displayName: email.split('@')[0],
          role: 'member',
          joinedAt: Date.now(),
        }
        await addMember(projId, member)
        await sendInviteEmail(proj.name, projId, inviterName, email, wsName)
      }
    }
    wsInviteStatus.value = `¡Invitación enviada con éxito a ${email}!`
    wsInviteEmail.value = ''
    setTimeout(() => { wsInviteStatus.value = '' }, 3500)
  } catch (err: any) {
    wsInviteError.value = err?.message || 'Error al enviar invitación'
  } finally {
    sendingWsInvite.value = false
  }
}

const handleRemoveMemberFromProject = async (memberEmail: string, projectId: string) => {
  const proj = projects.value.find(p => p.id === projectId)
  if (!proj) return
  const mem = proj.members?.find(m => m.email === memberEmail || m.uid === 'pending_' + memberEmail)
  if (mem && mem.role !== 'owner') {
    await removeMember(projectId, mem)
    const inviterName = user.value?.displayName || user.value?.email?.split('@')[0] || 'El administrador'
    const wsName = currentWorkspace.value?.name || 'Dev Flow'
    sendProjectRemovedEmail(proj.name, wsName, inviterName, memberEmail).catch(() => {})
  }
}

const handleAddMemberToProject = async (memberEmail: string, projectId: string) => {
  activeAddProjMemberEmail.value = null
  const proj = projects.value.find(p => p.id === projectId)
  if (!proj) return

  let realUid: string | null = null
  let displayName = memberEmail.split('@')[0]
  for (const p of projects.value) {
    const m = p.members?.find(mem => mem.email === memberEmail && !mem.uid.startsWith('pending_'))
    if (m) {
      realUid = m.uid
      displayName = m.displayName || displayName
      break
    }
  }

  const newMember: Member = {
    uid: realUid ? realUid : 'pending_' + memberEmail,
    email: memberEmail,
    displayName,
    role: 'member',
    joinedAt: Date.now(),
  }

  await addMember(projectId, newMember)
  const inviterName = user.value?.displayName || user.value?.email?.split('@')[0] || 'El administrador'
  const wsName = currentWorkspace.value?.name || 'Dev Flow'
  sendProjectAddedEmail(proj.name, projectId, wsName, inviterName, memberEmail).catch(() => {})
}

const handleRemoveMemberFromWorkspace = async (memberEmail: string) => {
  for (const proj of projects.value) {
    const mem = proj.members?.find(m => m.email === memberEmail || m.uid === 'pending_' + memberEmail)
    if (mem && mem.role !== 'owner') {
      await removeMember(proj.id, mem)
    }
  }
  const inviterName = user.value?.displayName || user.value?.email?.split('@')[0] || 'El administrador'
  const wsName = currentWorkspace.value?.name || 'Dev Flow'
  sendWorkspaceRemovedEmail(wsName, inviterName, memberEmail).catch(() => {})
}

const logout = () => {
  profileOpen.value = false
  showLogoutModal.value = true
}

const confirmLogout = async () => {
  showLogoutModal.value = false
  await signOut(auth)
}

const cancelLogout = () => {
  showLogoutModal.value = false
}

const isOAuthUser = computed(() => {
  if (!user.value) return false
  return user.value.providerData.some((p: any) => p.providerId === 'google.com' || p.providerId === 'github.com')
})

const isGithubUser = computed(() => {
  if (!user.value) return false
  return user.value.providerData.some((p: any) => p.providerId === 'github.com')
})

const isGoogleUser = computed(() => {
  if (!user.value) return false
  return user.value.providerData.some((p: any) => p.providerId === 'google.com')
})

const notificationEmailInput = ref('')
const notificationEmailSaved = ref(false)
const showGithubToken = ref(false)
const githubTokenSavedMsg = ref(false)

const openSettings = () => {
  profileOpen.value = false
  settingsTab.value = 'profile'
  githubTokenInput.value = githubToken.value
  notificationEmailInput.value = getNotificationEmail() || user.value?.email || ''
  notificationEmailSaved.value = false
  githubTokenSavedMsg.value = false
  showSettingsModal.value = true
}

const closeSettings = () => {
  showSettingsModal.value = false
}

const toggleProfile = () => {
  profileOpen.value = !profileOpen.value
}

// ── App Notifications ──
const {
  notifications: appNotifications,
  unreadCount: unreadNotifCount,
  markAsRead: markNotifAsRead,
  markAllAsRead: markAllNotifsAsRead,
} = useAppNotifications()

const showNotifications = ref(false)
const notifFilter = ref<'all' | 'unread'>('all')

const filteredNotifications = computed(() => {
  if (notifFilter.value === 'unread') {
    return appNotifications.value.filter(n => !n.read)
  }
  return appNotifications.value
})

function toggleNotifications() {
  showNotifications.value = !showNotifications.value
  if (showNotifications.value) {
    profileOpen.value = false
    showWorkspaceMenu.value = false
  }
}

async function handleAcceptInvite(projectId: string) {
  await acceptInvite(projectId)
}

async function handleRejectInvite(projectId: string) {
  await rejectInvite(projectId)
}

function handleNotificationClick(n: AppNotification) {
  markNotifAsRead(n.id)
  if (n.type === 'invite') {
    return
  }
  showNotifications.value = false
  if (n.projectId) {
    if (n.ticketId) {
      router.push(`/proyectos/${n.projectId}?ticket=${n.ticketId}`)
    } else {
      router.push(`/proyectos/${n.projectId}`)
    }
  }
}

// GitHub token & notifications
const { token: githubToken, setToken: setGithubToken, clearToken } = useGithubToken()
const githubTokenInput = ref(githubToken.value)

const cancelGithubToken = () => {
  githubTokenInput.value = githubToken.value
}

const saveGithubToken = () => {
  setGithubToken(githubTokenInput.value)
  githubTokenSavedMsg.value = true
  setTimeout(() => { githubTokenSavedMsg.value = false }, 2500)
}

const clearGithubToken = () => {
  githubTokenInput.value = ''
  clearToken()
}

const cancelNotificationEmail = () => {
  notificationEmailInput.value = getNotificationEmail() || user.value?.email || ''
}

const saveNotificationEmail = () => {
  setNotificationEmail(notificationEmailInput.value)
  notificationEmailSaved.value = true
  setTimeout(() => { notificationEmailSaved.value = false }, 2500)
}

// VS Code Extension Integration
const vscodeTokenCopied = ref(false)

async function handleVSCodeAuth() {
  if (!user.value) return
  const token = await user.value.getIdToken()
  const uid = user.value.uid
  const email = user.value.email || ''
  const uri = `vscode://dev-flow.dev-flow/auth?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&uid=${encodeURIComponent(uid)}`
  window.location.href = uri
}

async function copyVSCodeToken() {
  if (!user.value) return
  const token = await user.value.getIdToken()
  await navigator.clipboard.writeText(token)
  vscodeTokenCopied.value = true
  setTimeout(() => { vscodeTokenCopied.value = false }, 2500)
}

watch([ready, user], ([isReady, u]: [boolean, User | null]) => {
  if (isReady && u && route.query.action === 'vscode-auth') {
    handleVSCodeAuth()
  }
})

const onAvatarChange = (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    uploadAvatar(file)
  }
}
</script>

<template>
  <div v-if="!ready" class="loading-screen">
    <div class="loader"></div>
  </div>

  <LoginView v-else-if="!user" />

  <div v-else class="app-shell">
    <!-- Top header (full width) -->
    <header class="top-header">
      <div class="header-left">
        <button
          v-if="isTablet"
          type="button"
          class="hamburger-btn"
          @click="sidebarOpen = !sidebarOpen"
          title="Menú"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <img src="./assets/dev-flow.png" alt="Dev Flow" class="header-logo" />
      </div>

      <div class="header-right">
        <!-- Notificaciones (Campana fija en App Bar) -->
        <div class="notif-wrapper" @click.stop>
          <button
            type="button"
            class="notif-bell-btn"
            :class="{ active: showNotifications }"
            @click="toggleNotifications"
            title="Notificaciones"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="notif-bell-icon">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span v-if="unreadNotifCount > 0" class="notif-badge">
              {{ unreadNotifCount > 9 ? '9+' : unreadNotifCount }}
            </span>
          </button>

          <!-- Dropdown de notificaciones -->
          <div v-if="showNotifications" class="notif-dropdown">
            <div class="notif-dropdown-header">
              <div class="notif-header-title-row">
                <span class="notif-header-title">Notificaciones</span>
                <span v-if="unreadNotifCount > 0" class="notif-unread-tag">{{ unreadNotifCount }} nuevas</span>
              </div>
              <button
                v-if="unreadNotifCount > 0"
                type="button"
                class="btn-mark-all-read"
                @click="markAllNotifsAsRead"
              >
                Marcar leídas
              </button>
            </div>

            <div class="notif-filters">
              <button
                type="button"
                class="notif-filter-tab"
                :class="{ active: notifFilter === 'all' }"
                @click="notifFilter = 'all'"
              >
                Todas ({{ appNotifications.length }})
              </button>
              <button
                type="button"
                class="notif-filter-tab"
                :class="{ active: notifFilter === 'unread' }"
                @click="notifFilter = 'unread'"
              >
                No leídas ({{ unreadNotifCount }})
              </button>
            </div>

            <div class="notif-dropdown-body">
              <div v-if="filteredNotifications.length === 0" class="notif-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="notif-empty-icon">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>No tienes notificaciones {{ notifFilter === 'unread' ? 'sin leer' : '' }}</span>
              </div>

              <div
                v-for="n in filteredNotifications"
                :key="n.id"
                class="notif-item"
                :class="['notif--' + n.severity, { 'notif--unread': !n.read }]"
                @click="handleNotificationClick(n)"
              >
                <div class="notif-icon-col">
                  <!-- Ticket caducado -->
                  <span v-if="n.type === 'ticket-expired'" class="notif-type-icon icon--urgent">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 15 15"/><line x1="12" y1="8" x2="12" y2="12"/></svg>
                  </span>
                  <!-- Ticket por vencer -->
                  <span v-else-if="n.type === 'ticket-due-soon'" class="notif-type-icon icon--warning">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </span>
                  <!-- Invitación aceptada -->
                  <span v-else-if="n.type === 'invite-accepted'" class="notif-type-icon icon--success">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
                  </span>
                  <!-- Invitación pendiente -->
                  <span v-else-if="n.type === 'invite'" class="notif-type-icon icon--info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                  </span>
                  <!-- Sugerencia GitHub -->
                  <span v-else class="notif-type-icon icon--github">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                  </span>
                </div>

                <div class="notif-content-col">
                  <div class="notif-title-row">
                    <span class="notif-title">{{ n.title }}</span>
                    <span v-if="!n.read" class="notif-unread-dot" title="No leída"></span>
                  </div>
                  <p class="notif-message">{{ n.message }}</p>
                  <span v-if="n.detail" class="notif-detail">{{ n.detail }}</span>

                  <!-- Acciones para invitación pendiente -->
                  <div v-if="n.type === 'invite' && n.projectId" class="notif-invite-actions" @click.stop>
                    <button class="notif-btn-accept" @click="handleAcceptInvite(n.projectId); markNotifAsRead(n.id)">
                      Aceptar
                    </button>
                    <button class="notif-btn-reject" @click="handleRejectInvite(n.projectId); markNotifAsRead(n.id)">
                      Rechazar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="profile-wrapper" @click="toggleProfile">
          <button type="button" class="user-menu-trigger" :class="{ active: profileOpen }">
            <span class="user-display-name">{{ user.displayName || user.email }}</span>
            <svg class="chevron-down-icon" :class="{ rotated: profileOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <!-- Dropdown sin iconos -->
          <div v-if="profileOpen" class="profile-dropdown" @click.stop>
            <button class="dropdown-item" @click="openSettings">
              Ajustes
            </button>
            <button class="dropdown-item logout-item" @click="logout">
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="body-row">
      <!-- Backdrop en tablet/móvil cuando el menú lateral está abierto -->
      <div
        v-if="isTablet && sidebarOpen"
        class="sidebar-mobile-backdrop"
        @click="sidebarOpen = false"
      ></div>

      <!-- Sidebar -->
      <aside
        v-show="!isTablet || sidebarOpen"
        class="sidebar"
        :class="{ 'sidebar--tablet': isTablet }"
      >
        <!-- Selector de Área de Trabajo en el Menú Lateral -->
        <div v-if="currentWorkspace" class="sidebar-workspace-container">
          <div class="sidebar-workspace-row">
            <button
              type="button"
              class="sidebar-workspace-btn"
              :class="{ active: showWorkspaceMenu, 'is-guest': !isCurrentWorkspaceOwner }"
              @click.stop="showWorkspaceMenu = !showWorkspaceMenu"
              :title="currentWorkspace.name + (!isCurrentWorkspaceOwner ? ' (Invitado)' : '')"
            >
              <div v-show="sidebarOpen" class="sidebar-ws-label-wrapper">
                <span class="sidebar-ws-name">{{ currentWorkspace.name }}</span>
                <span v-if="!isCurrentWorkspaceOwner" class="sidebar-ws-guest-badge">Invitado</span>
              </div>
              <svg
                class="chevron-down-icon sidebar-ws-chevron"
                :class="{ rotated: showWorkspaceMenu }"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button
              v-show="sidebarOpen && isCurrentWorkspaceOwner"
              type="button"
              class="workspace-settings-btn"
              title="Ajustes y miembros del área de trabajo"
              @click.stop="openWorkspaceDrawer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>

          <!-- Dropdown de áreas de trabajo -->
          <div v-if="showWorkspaceMenu" class="sidebar-ws-dropdown" @click.stop>
            <div v-if="workspaces.length > 0" class="ws-dropdown-header">
              <span class="ws-header-title">Mis Áreas de Trabajo</span>
              <span class="ws-header-badge">{{ workspaces.length }}/{{ MAX_WORKSPACES }}</span>
            </div>
            <div v-if="workspaces.length > 0" class="ws-dropdown-list">
              <button
                v-for="ws in workspaces"
                :key="ws.id"
                type="button"
                class="ws-dropdown-item"
                :class="{ 'is-active': ws.id === currentWorkspace.id }"
                @click="selectWorkspace(ws)"
              >
                <span class="ws-item-label">{{ ws.name }}</span>
                <svg v-if="ws.id === currentWorkspace.id" class="ws-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </div>

            <div v-if="sharedWorkspaces.length > 0" class="ws-dropdown-header" :class="{ 'mt-shared': workspaces.length > 0 }">
              <span class="ws-header-title">Áreas Compartidas</span>
              <span class="ws-header-badge ws-header-badge--guest">Invitado</span>
            </div>
            <div v-if="sharedWorkspaces.length > 0" class="ws-dropdown-list">
              <button
                v-for="ws in sharedWorkspaces"
                :key="ws.id"
                type="button"
                class="ws-dropdown-item ws-dropdown-item--shared"
                :class="{ 'is-active': ws.id === currentWorkspace.id }"
                @click="selectWorkspace(ws)"
              >
                <div class="ws-shared-item-row">
                  <span class="ws-item-label">{{ ws.name }}</span>
                  <span class="ws-shared-tag">Invitado</span>
                </div>
                <svg v-if="ws.id === currentWorkspace.id" class="ws-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </div>

            <div class="ws-dropdown-footer">
              <button
                v-if="workspaces.length < MAX_WORKSPACES"
                type="button"
                class="btn-add-ws"
                @click="openCreateWorkspaceModal"
              >
                Crear mi propia área
              </button>
              <span v-else class="ws-limit-tag">
                Máximo 5 áreas alcanzado
              </span>
            </div>
          </div>
        </div>

        <nav class="sidebar-nav">
          <router-link class="nav-item" to="/" exact-active-class="active" title="Inicio">
            <span v-show="sidebarOpen">Inicio</span>
          </router-link>
          <div class="sidebar-section-header">
            <span v-show="sidebarOpen">Mis proyectos</span>
            <span v-show="sidebarOpen" class="section-count">{{ projects.length }}/{{ MAX_PROJECTS_PER_WORKSPACE }}</span>
          </div>
          <div v-if="sidebarOpen" class="sidebar-subnav">
            <button
              v-for="p in projects"
              :key="p.id"
              class="sidebar-subitem"
              :class="{ 'sidebar-subitem--active': route.params.id === p.id }"
              @click="router.push('/proyectos/' + p.id)"
            >
              <span class="subitem-name">{{ p.name }}</span>
            </button>
          </div>
        </nav>
      </aside>

      <!-- Main area -->
      <div class="main-area">
        <!-- Logout modal -->
        <div v-if="showLogoutModal" class="modal-overlay" @click="cancelLogout">
          <div class="modal-card" @click.stop>
            <div class="modal-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>
            <h3 class="modal-title">Cerrar sesión</h3>
            <p class="modal-desc">¿Estás seguro de que quieres cerrar sesión?</p>
            <div class="modal-actions">
              <button class="modal-btn modal-btn--cancel" @click="cancelLogout">Cancelar</button>
              <button class="modal-btn modal-btn--confirm" @click="confirmLogout">Sí, cerrar sesión</button>
            </div>
          </div>
        </div>

        <!-- Settings drawer modal (anchored right with margins) -->
        <div v-if="showSettingsModal" class="settings-overlay" @click="closeSettings"></div>
        <div v-if="showSettingsModal" class="settings-drawer" @click.stop>
          <div class="settings-header">
            <h3 class="settings-title">Ajustes</h3>
            <button class="settings-close" @click="closeSettings" title="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="settings-layout">
            <!-- Mini sidebar -->
            <nav class="settings-nav">
              <button
                class="settings-nav-item"
                :class="{ active: settingsTab === 'profile' }"
                @click="settingsTab = 'profile'"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Perfil
              </button>
              <button
                class="settings-nav-item"
                :class="{ active: settingsTab === 'connections' }"
                @click="settingsTab = 'connections'"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                </svg>
                Conexiones
              </button>
              <button
                class="settings-nav-item"
                :class="{ active: settingsTab === 'appearance' }"
                @click="settingsTab = 'appearance'"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
                Apariencia
              </button>
            </nav>

            <!-- Content -->
            <div class="settings-content">
              <!-- Profile tab -->
              <div v-if="settingsTab === 'profile'" class="settings-tab">
                <div class="settings-avatar-row">
                  <div class="settings-avatar" :title="user.displayName || (user.email ?? '')">
                    <img v-if="avatarUrl" :src="avatarUrl" class="avatar-img" />
                    <span v-else>{{ getUserInitials(user) }}</span>
                  </div>
                  <div>
                    <p class="settings-name">{{ user.displayName || 'Usuario' }}</p>
                    <p class="settings-email">{{ user.email }}</p>
                    <span v-if="isGithubUser" class="auth-provider-pill">Cuenta vinculada con GitHub</span>
                    <span v-else-if="isGoogleUser" class="auth-provider-pill">Cuenta vinculada con Google</span>
                  </div>
                </div>
                <label class="avatar-upload-btn settings-option">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  Cambiar foto
                  <input type="file" accept="image/*" hidden @change="onAvatarChange" />
                </label>

                <!-- Si inició sesión con Google o GitHub (OAuth), no se muestran cambiar correo ni cambiar contraseña -->
                <template v-if="!isOAuthUser">
                  <div class="settings-opt-divider"></div>
                  <button class="settings-option">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    Cambiar correo electrónico
                  </button>
                  <button class="settings-option">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Cambiar contraseña
                  </button>
                </template>
              </div>

              <!-- Connections tab -->
              <div v-if="settingsTab === 'connections'" class="settings-tab settings-tab--connections">
                <!-- Sección GitHub -->
                <div class="settings-conn-block">
                  <div class="connection-header-row">
                    <div class="connection-icon-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="conn-icon">
                        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                      </svg>
                      <div>
                        <span class="settings-field-label">GitHub</span>
                        <p class="settings-field-desc">Vinculación y acceso a repositorios</p>
                      </div>
                    </div>
                    <span v-if="isGithubUser" class="connection-badge-active">Conectado · Acceso completo</span>
                    <span v-else-if="githubToken" class="connection-badge-active">Token activo</span>
                    <span v-else class="connection-badge-inactive">No conectado</span>
                  </div>

                  <!-- Si inició con GitHub, acceso completo automático sin exponer token -->
                  <div v-if="isGithubUser" class="conn-oauth-box">
                    <p class="conn-info-text">
                      Iniciaste sesión directamente con tu cuenta de GitHub. Tienes acceso completo por defecto a todos tus repositorios vinculados sin necesidad de configurar un token manual.
                    </p>
                  </div>

                  <!-- Si inició con Google o correo manual: token por usuario protegido -->
                  <div v-else class="conn-token-box">
                    <p class="conn-info-text">
                      Para sincronizar con repositorios de GitHub usando tu cuenta actual, ingresa un Personal Access Token (PAT).
                    </p>
                    <div class="settings-token-row">
                      <input
                        v-model="githubTokenInput"
                        :type="showGithubToken ? 'text' : 'password'"
                        class="settings-input"
                        placeholder="ghp_••••••••••••••••••••••••"
                      />
                      <button
                        type="button"
                        class="token-toggle-btn"
                        @click="showGithubToken = !showGithubToken"
                        :title="showGithubToken ? 'Ocultar token' : 'Ver token'"
                      >
                        <svg v-if="showGithubToken" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                    </div>
                    <div class="token-help-row">
                      <a href="https://github.com/settings/tokens" target="_blank" class="settings-link">
                        Crear token en GitHub →
                      </a>
                      <span v-if="githubTokenSavedMsg" class="success-hint">¡Token guardado!</span>
                    </div>

                    <div class="connection-actions-row">
                      <button v-if="githubToken" type="button" class="btn-clear-token" @click="clearGithubToken">Eliminar token</button>
                      <div class="actions-right">
                        <button type="button" class="btn-text-danger" @click="cancelGithubToken">Cancelar</button>
                        <button type="button" class="btn-outline-white" @click="saveGithubToken">Guardar</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="settings-opt-divider"></div>

                <!-- Sección Gmail / Notificaciones de Correo -->
                <div class="settings-conn-block">
                  <div class="connection-header-row">
                    <div class="connection-icon-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="conn-icon">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                      <div>
                        <span class="settings-field-label">Correo para avisos (Gmail / Outlook)</span>
                        <p class="settings-field-desc">Notificaciones de tickets nuevos, cambios de estado y asignaciones</p>
                      </div>
                    </div>
                    <span class="connection-badge-active">Activo</span>
                  </div>

                  <p class="conn-info-text">
                    {{ isGithubUser 
                      ? 'Al iniciar con GitHub, los avisos van por defecto al correo principal de tu cuenta GitHub. Si deseas recibirlos en tu Gmail, Outlook u otro correo particular, especifícalo aquí:'
                      : 'Especifica la dirección de correo (Gmail, Outlook, etc.) donde deseas recibir las alertas de tus proyectos:' }}
                  </p>

                  <div class="settings-token-row">
                    <input
                      v-model="notificationEmailInput"
                      type="email"
                      class="settings-input"
                      :placeholder="user.email || 'tu-correo@gmail.com'"
                    />
                  </div>
                  <div class="token-help-row">
                    <span class="default-email-hint">Predeterminado de tu cuenta: {{ user.email }}</span>
                    <span v-if="notificationEmailSaved" class="success-hint">¡Correo de avisos guardado!</span>
                  </div>

                  <div class="connection-actions-row">
                    <div class="actions-right">
                      <button type="button" class="btn-text-danger" @click="cancelNotificationEmail">Cancelar</button>
                      <button type="button" class="btn-outline-white" @click="saveNotificationEmail">Guardar</button>
                    </div>
                  </div>
                </div>

                <div class="settings-opt-divider"></div>

                <!-- Sección Extensión de VS Code -->
                <div class="settings-conn-block">
                  <div class="connection-header-row">
                    <div class="connection-icon-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="conn-icon">
                        <polyline points="16 18 22 12 16 6" />
                        <polyline points="8 6 2 12 8 18" />
                      </svg>
                      <div>
                        <span class="settings-field-label">Extensión de Visual Studio Code</span>
                        <p class="settings-field-desc">Vincula tu editor VS Code para ver tickets y crear ramas en vivo</p>
                      </div>
                    </div>
                  </div>

                  <p class="conn-info-text">
                    Sincroniza tus tableros, tickets y automatización de ramas directamente dentro de tu editor VS Code:
                  </p>

                  <div class="connection-actions-row" style="margin-top: 12px">
                    <div class="actions-left" style="display: flex; gap: 10px; align-items: center">
                      <button type="button" class="btn-outline-white" @click="handleVSCodeAuth">
                        ⚡ Vincular con VS Code en 1 Clic
                      </button>
                      <button type="button" class="btn-outline-white" @click="copyVSCodeToken">
                        Copiar Token de Acceso
                      </button>
                      <span v-if="vscodeTokenCopied" class="success-hint">¡Token copiado!</span>
                    </div>
                  </div>
                </div>
              </div>

                <!-- Appearance tab -->
                <div v-if="settingsTab === 'appearance'" class="settings-tab">
                  <div class="settings-field">
                    <label class="settings-field-label">Idioma / Language</label>
                    <div class="lang-toggle">
                      <button class="lang-btn" :class="{ active: locale === 'es' }" @click="setLocale('es')">Español</button>
                      <button class="lang-btn" :class="{ active: locale === 'en' }" @click="setLocale('en')">English</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        <!-- Workspace Settings & Members Drawer Modal -->
        <div v-if="showWorkspaceDrawer" class="settings-overlay" @click="closeWorkspaceDrawer"></div>
        <div v-if="showWorkspaceDrawer" class="settings-drawer ws-members-drawer" @click.stop>
          <div class="settings-header">
            <div class="ws-drawer-title-wrap">
              <span class="ws-drawer-badge">Área de trabajo</span>
              <h3 class="settings-title">{{ currentWorkspace?.name }}</h3>
            </div>
            <button class="settings-close" @click="closeWorkspaceDrawer" title="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="ws-drawer-body">
            <!-- Sección: Vincular miembro con checkboxes de proyectos -->
            <div class="ws-drawer-section">
              <div class="ws-section-header">
                <h4 class="ws-section-title">Vincular miembro a proyectos</h4>
                <span class="ws-permission-tag">Acceso restringido</span>
              </div>

              <div class="ws-input-group">
                <label class="ws-label">Correo electrónico</label>
                <input
                  v-model="wsInviteEmail"
                  type="email"
                  placeholder="correo@ejemplo.com"
                  class="settings-input"
                  @keyup.enter="handleSendWorkspaceInvite"
                />
              </div>

              <div class="ws-input-group">
                <div class="ws-checklist-header">
                  <label class="ws-label">Proyectos con acceso</label>
                  <button
                    v-if="projects.length > 0"
                    type="button"
                    class="ws-btn-toggle-all"
                    @click="toggleAllWsProjects"
                  >
                    {{ selectedWsProjectIds.length === projects.length ? 'Desmarcar todos' : 'Seleccionar todos' }}
                  </button>
                </div>

                <div v-if="projects.length === 0" class="ws-empty-projects">
                  No hay proyectos en esta área de trabajo todavía.
                </div>
                <div v-else class="ws-projects-checklist">
                  <label
                    v-for="p in projects"
                    :key="p.id"
                    class="ws-project-check-item"
                    :class="{ 'is-checked': selectedWsProjectIds.includes(p.id) }"
                  >
                    <input
                      type="checkbox"
                      :value="p.id"
                      v-model="selectedWsProjectIds"
                      class="ws-checkbox"
                    />
                    <span class="ws-check-title">{{ p.name }}</span>
                    <span v-if="p.github" class="ws-github-badge">GitHub</span>
                  </label>
                </div>
              </div>

              <p v-if="wsInviteError" class="modal-error">{{ wsInviteError }}</p>
              <p v-if="wsInviteStatus" class="success-hint">{{ wsInviteStatus }}</p>

              <div class="connection-actions-row">
                <div class="actions-right">
                  <button type="button" class="btn-text-danger" @click="closeWorkspaceDrawer">Cancelar</button>
                  <button
                    type="button"
                    class="btn-outline-white"
                    :disabled="sendingWsInvite"
                    @click="handleSendWorkspaceInvite"
                  >
                    {{ sendingWsInvite ? 'Enviando...' : 'Vincular y enviar invitación' }}
                  </button>
                </div>
              </div>
            </div>

            <div class="settings-opt-divider"></div>

            <!-- Sección: Miembros del área de trabajo -->
            <div class="ws-drawer-section">
              <div class="ws-members-header">
                <h4 class="ws-section-title">Miembros con acceso</h4>
                <span class="ws-members-count">{{ workspaceMembersSummary.length }}</span>
              </div>

              <div v-if="workspaceMembersSummary.length === 0" class="ws-empty-projects">
                No hay miembros registrados en esta área de trabajo.
              </div>
              <div v-else class="ws-members-list">
                <div
                  v-for="m in workspaceMembersSummary"
                  :key="m.email"
                  class="ws-member-card"
                >
                  <div class="ws-member-info">
                    <span class="member-avatar" :class="{ 'member-avatar--pending': m.isPending }">
                      {{ m.isPending ? '?' : (m.displayName ? m.displayName[0].toUpperCase() : 'U') }}
                    </span>
                    <div class="ws-member-details">
                      <div class="ws-member-name-row">
                        <span class="ws-member-name">{{ m.displayName }}</span>
                        <span v-if="m.isPending" class="ws-pending-tag">Pendiente</span>
                      </div>
                      <span class="ws-member-email">{{ m.email }}</span>
                      <div class="ws-member-projects-chips">
                        <span v-for="proj in m.projects" :key="proj.id" class="ws-proj-chip">
                          <span class="ws-proj-chip-name">{{ proj.name }}</span>
                          <button
                            v-if="m.role !== 'owner'"
                            type="button"
                            class="ws-proj-chip-remove"
                            title="Quitar de este proyecto"
                            @click="handleRemoveMemberFromProject(m.email, proj.id)"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:9px;height:9px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </span>

                        <div v-if="m.role !== 'owner' && m.availableProjects.length > 0" class="ws-add-proj-wrapper">
                          <button
                            type="button"
                            class="ws-add-proj-btn"
                            title="Agregar a otro proyecto"
                            @click="toggleAddProjDropdown(m.email)"
                          >
                            + Proyecto
                          </button>
                          <div v-if="activeAddProjMemberEmail === m.email" class="ws-add-proj-dropdown" @click.stop>
                            <div class="ws-add-proj-dropdown-title">Agregar a proyecto:</div>
                            <button
                              v-for="avail in m.availableProjects"
                              :key="avail.id"
                              type="button"
                              class="ws-add-proj-dropdown-item"
                              @click="handleAddMemberToProject(m.email, avail.id)"
                            >
                              + {{ avail.name }}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="ws-member-role-col">
                    <span class="badge" :class="m.role === 'owner' ? 'badge--fullstack' : 'badge--frontend'">
                      {{ m.role === 'owner' ? 'Propietario' : 'Miembro' }}
                    </span>
                    <button
                      v-if="m.role !== 'owner'"
                      type="button"
                      class="ws-member-remove-btn"
                      title="Expulsar de todos los proyectos"
                      @click="handleRemoveMemberFromWorkspace(m.email)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Modal: Crear Área de Trabajo (al iniciar sesión con 0 áreas o al crear nueva hasta 5) -->
        <div
          v-if="showCreateWorkspaceModal || shouldPromptFirstWorkspace"
          class="modal-overlay"
          @click="canCloseWorkspaceModal ? closeCreateWorkspaceModal() : null"
        >
          <div class="modal-card ws-create-card" @click.stop>
            <div class="ws-folder-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h3 class="modal-title">
              {{ workspaces.length === 0 ? 'Crear tu primera área de trabajo' : 'Crear área de trabajo' }}
            </h3>
            <p class="modal-desc">
              {{ workspaces.length === 0
                ? 'Separa tus proyectos personales, de trabajo o con amigos en espacios independientes para no mezclar nada.'
                : 'Crea un nuevo espacio independiente para organizar tus proyectos sin mezclar información.' }}
            </p>

            <form @submit.prevent="handleCreateWorkspace" class="ws-modal-form">
              <div class="ws-form-group">
                <label for="new-ws-name" class="ws-input-label">Nombre de área de trabajo</label>
                <input
                  id="new-ws-name"
                  v-model="newWorkspaceName"
                  type="text"
                  required
                  maxlength="40"
                  :disabled="creatingWs"
                  class="ws-input"
                  autofocus
                />
              </div>

              <p v-if="workspaceError" class="modal-error">{{ workspaceError }}</p>

              <div class="modal-actions">
                <button
                  v-if="canCloseWorkspaceModal"
                  type="button"
                  class="modal-btn modal-btn--cancel"
                  @click="closeCreateWorkspaceModal"
                  :disabled="creatingWs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  class="modal-btn modal-btn--confirm"
                  :class="{ 'is-empty': !newWorkspaceName.trim() }"
                  :disabled="!newWorkspaceName.trim() || creatingWs"
                  :title="!newWorkspaceName.trim() ? 'Ingresa un nombre de área de trabajo' : ''"
                >
                  <span v-if="creatingWs">Creando...</span>
                  <span v-else>Crear área de trabajo</span>
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- Overlay to close dropdowns -->
        <div v-if="profileOpen || showWorkspaceMenu || showNotifications" class="overlay" @click="closeMenus"></div>

        <!-- Content -->
        <main class="content">
          <router-view :user="user" />
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Loading ── */
.loading-screen {
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loader {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Shell ── */
.app-shell {
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.body-row {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ── Sidebar ── */
.sidebar {
  width: 155px;
  background: var(--card-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0.4rem;
  padding-top: 0.4rem;
  animation: fadeIn 0.3s ease-out;
  flex-shrink: 0;
  overflow: visible;
  position: relative;
  z-index: 50;
}

.sidebar--tablet {
  position: fixed !important;
  left: 0;
  top: 40px;
  bottom: 0;
  width: 210px !important;
  z-index: 80 !important;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.25);
  animation: slideInSidebar 0.2s ease-out;
}

@keyframes slideInSidebar {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

.sidebar-mobile-backdrop {
  position: fixed;
  inset: 0;
  top: 40px;
  background: rgba(0, 0, 0, 0.45);
  z-index: 75;
  animation: fadeIn 0.15s ease-out;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.5rem;
  border-radius: 4px;
  color: var(--text);
  text-decoration: none;
  font-size: 0.78rem;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.nav-item svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.nav-item:hover {
  background: var(--accent-bg);
  color: var(--text-h);
}

.nav-item.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

/* ── Sidebar section header ── */
.sidebar-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.45rem 0.5rem 0.25rem;
  color: var(--text);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
  user-select: none;
}

.section-count {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text);
  opacity: 0.8;
}

.sidebar-subnav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 0.5rem 0.25rem;
}

.sidebar-subitem {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
  border-radius: 4px;
}

.sidebar-subitem:hover {
  background: var(--accent-bg);
  color: var(--text-h);
}

.sidebar-subitem--active {
  background: rgba(255, 255, 255, 0.12) !important;
  color: #ffffff !important;
  font-weight: 700 !important;
}

.sidebar-subitem--active .subitem-name {
  color: #ffffff !important;
  font-weight: 700 !important;
}

.subitem-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-subitem--create {
  margin-top: 0.15rem;
  opacity: 0.5;
  font-size: 0.72rem;
  gap: 0.4rem;
}

.sidebar-subitem--create:hover {
  opacity: 1;
}

.sidebar-subitem--create svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

/* ── Main area ── */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
}

/* ── Top header (más compacto) ── */
.top-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.22rem 1.25rem;
  min-height: 40px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  animation: fadeIn 0.3s ease-out;
  width: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hamburger-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 4px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-h);
  cursor: pointer;
  transition: all 0.15s ease;
}

.hamburger-btn:hover {
  background: var(--accent-bg);
  border-color: var(--accent);
}

.hamburger-btn svg {
  width: 16px;
  height: 16px;
}

.header-logo {
  height: 20px;
  width: auto;
  object-fit: contain;
  filter: brightness(0) invert(1);
}

/* ── Selector de Área de Trabajo en el Menú Lateral ── */
.sidebar-workspace-container {
  position: relative;
  margin-bottom: 0.5rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid var(--border);
}

.sidebar-workspace-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
}

.sidebar-workspace-row .sidebar-workspace-btn {
  flex: 1;
  min-width: 0;
}

.workspace-settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  padding: 0;
  transition: all 0.15s ease;
}

.workspace-settings-btn:hover {
  border-color: var(--accent);
  color: var(--text-h);
  background: var(--accent-bg);
}

.workspace-settings-btn svg {
  width: 14px;
  height: 14px;
}

.sidebar-workspace-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  width: 100%;
  background: var(--code-bg);
  border: 1px solid var(--border);
  padding: 0.32rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  transition: all 0.15s ease;
  user-select: none;
  text-align: left;
}

.sidebar-workspace-btn:hover,
.sidebar-workspace-btn.active {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.sidebar-ws-name {
  flex: 1;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-h);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}

.sidebar-ws-label-wrapper {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  flex: 1;
}

.sidebar-ws-guest-badge {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0.08rem 0.35rem;
  border-radius: 3px;
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  border: 1px solid rgba(59, 130, 246, 0.3);
  line-height: 1;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.mt-shared {
  margin-top: 0.35rem;
  border-top: 1px solid var(--border);
}

.ws-header-badge--guest {
  font-size: 0.64rem;
  font-weight: 700;
  padding: 0.06rem 0.3rem;
  border-radius: 3px;
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.ws-dropdown-item--shared {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ws-shared-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  width: 100%;
  min-width: 0;
}

.ws-shared-tag {
  font-size: 0.62rem;
  color: var(--text);
  opacity: 0.7;
  font-weight: 500;
  flex-shrink: 0;
}

.sidebar-ws-chevron {
  width: 14px;
  height: 14px;
  color: var(--text);
  flex-shrink: 0;
  transition: transform 0.15s ease;
  opacity: 0.7;
}

.sidebar-ws-chevron.rotated {
  transform: rotate(180deg);
}

.sidebar--closed .sidebar-workspace-container {
  margin-bottom: 0.4rem;
  padding-bottom: 0.35rem;
}

.sidebar--closed .sidebar-workspace-btn {
  padding: 0.25rem 0;
  justify-content: center;
  background: transparent;
  border-color: transparent;
}

.sidebar--closed .sidebar-workspace-btn:hover {
  background: var(--accent-bg);
}

/* ── Dropdown de Áreas de Trabajo ── */
.sidebar-ws-dropdown {
  position: absolute;
  top: 0;
  left: calc(100% + 8px);
  width: 220px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: var(--shadow);
  z-index: 100;
  overflow: hidden;
  animation: fadeIn 0.12s ease-out;
}

.sidebar--closed .sidebar-ws-dropdown {
  left: calc(100% + 8px);
  top: 0;
}

.ws-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--text-h);
}

.ws-header-badge {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text);
  opacity: 0.8;
}

.ws-dropdown-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 0.3rem 0;
}

.ws-dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.45rem 0.85rem;
  border: none;
  background: transparent;
  color: var(--text-h);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}

.ws-dropdown-item:hover {
  background: var(--code-bg);
}

.ws-dropdown-item.is-active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

.ws-item-avatar {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--border);
  color: var(--text-h);
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ws-dropdown-item.is-active .ws-item-avatar {
  background: var(--accent);
  color: #fff;
}

.ws-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-item-check {
  width: 14px;
  height: 14px;
  color: var(--accent);
  flex-shrink: 0;
}

.ws-dropdown-footer {
  padding: 0.45rem 0.65rem;
  border-top: 1px solid var(--border);
  background: var(--code-bg);
}

.btn-add-ws {
  width: 100%;
  padding: 0.4rem 0.6rem;
  border: 1px dashed var(--border);
  border-radius: 4px;
  background: var(--card-bg);
  color: var(--accent);
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;
}

.btn-add-ws:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.ws-limit-tag {
  display: block;
  text-align: center;
  font-size: 0.7rem;
  color: var(--text);
  opacity: 0.8;
  padding: 0.2rem 0;
}

/* ── Modal de Área de Trabajo ── */
.ws-create-card {
  max-width: 360px;
  border-radius: 4px;
}

.ws-folder-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 0.65rem;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  padding: 0 !important;
  width: fit-content;
  height: auto;
}

.ws-folder-icon svg {
  width: 26px;
  height: 26px;
  color: #0ea5e9;
  stroke: #0ea5e9;
  background: transparent !important;
  border: none !important;
}

.ws-modal-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  width: 100%;
  margin-top: 0.4rem;
}

.ws-form-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  text-align: left;
}

.ws-input-label {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-h);
}

.ws-input {
  width: 100%;
  padding: 0.38rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--code-bg);
  color: var(--text-h);
  font: inherit;
  font-size: 0.8rem;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.ws-input:focus {
  border-color: #0ea5e9;
  box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.18);
}

.ws-create-card .modal-btn--confirm {
  background: transparent;
  border: 1.5px solid #0ea5e9;
  color: #0ea5e9;
  border-radius: 4px;
  font-weight: 600;
  transition: all 0.15s ease;
  pointer-events: auto !important;
}

.ws-create-card .modal-btn--confirm:hover:not(:disabled) {
  background: rgba(14, 165, 233, 0.08);
  border-color: #0284c7;
  color: #0284c7;
}

.ws-create-card .modal-btn--confirm:disabled {
  opacity: 0.65;
  cursor: not-allowed;
  pointer-events: auto !important;
}

/* Si acerco el mouse y no está colocado el nombre: fondo rojo y texto blanco */
.ws-create-card .modal-btn--confirm.is-empty:hover,
.ws-create-card .modal-btn--confirm:disabled:hover {
  background: #ef4444 !important;
  border-color: #ef4444 !important;
  color: #ffffff !important;
  opacity: 1 !important;
  cursor: not-allowed !important;
}

.ws-create-card .modal-btn--cancel {
  border-radius: 4px;
}

.modal-error {
  color: #ef4444;
  font-size: 0.76rem;
  margin: 0;
  text-align: center;
}

.page-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-h);
}

.header-right {
  display: flex; align-items: center; gap: 0.75rem; margin-left: auto;
}
/* ── Campana y Notificaciones ── */
.notif-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.notif-bell-btn {
  position: relative;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}

.notif-bell-btn:hover,
.notif-bell-btn.active {
  background: var(--code-bg);
  border-color: var(--border);
  color: var(--text-h);
}

.notif-bell-icon {
  width: 18px;
  height: 18px;
}

.notif-badge {
  position: absolute;
  top: 1px;
  right: 1px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #ef4444;
  color: #fff;
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--card-bg);
  line-height: 1;
}

.notif-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 380px;
  max-width: calc(100vw - 1.5rem);
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  z-index: 300;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  animation: fadeIn 0.15s ease-out;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notif-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
}

.notif-header-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.notif-header-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-h);
}

.notif-unread-tag {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
}

.btn-mark-all-read {
  background: none;
  border: none;
  color: var(--accent);
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
  padding: 0;
  transition: opacity 0.15s;
}

.btn-mark-all-read:hover {
  text-decoration: underline;
  opacity: 0.85;
}

.notif-filters {
  display: flex;
  background: var(--code-bg);
  border-bottom: 1px solid var(--border);
  padding: 0.25rem 0.5rem;
  gap: 0.25rem;
}

.notif-filter-tab {
  flex: 1;
  background: none;
  border: none;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s;
}

.notif-filter-tab.active {
  background: var(--card-bg);
  color: var(--text-h);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.notif-dropdown-body {
  max-height: 380px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.notif-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2.5rem 1rem;
  color: var(--text-muted);
  font-size: 0.8rem;
  text-align: center;
}

.notif-empty-icon {
  width: 28px;
  height: 28px;
  color: var(--text-muted);
  opacity: 0.6;
}

.notif-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s ease;
  position: relative;
}

.notif-item:last-child {
  border-bottom: none;
}

.notif-item:hover {
  background: var(--code-bg);
}

.notif--unread {
  background: rgba(59, 130, 246, 0.04);
}

.notif-icon-col {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
}

.notif-type-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notif-type-icon svg {
  width: 15px;
  height: 15px;
}

.icon--urgent {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.icon--warning {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.icon--success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.icon--info {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.icon--github {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-h);
}

.notif-content-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.notif-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.notif-title {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-h);
}

.notif-unread-dot {
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 50%;
  flex-shrink: 0;
}

.notif-message {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-h);
  line-height: 1.35;
  word-break: break-word;
}

.notif-detail {
  font-size: 0.7rem;
  color: var(--text-muted);
}

.notif-invite-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.4rem;
}

.notif-btn-accept {
  padding: 0.25rem 0.6rem;
  background: #22c55e;
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.notif-btn-accept:hover {
  opacity: 0.85;
}

.notif-btn-reject {
  padding: 0.25rem 0.6rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s;
}

.notif-btn-reject:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
  color: #ef4444;
}

/* ── Menú de usuario (sin círculo de avatar, solo nombre/correo y flecha) ── */
.profile-wrapper {
  position: relative;
  cursor: pointer;
}

.user-menu-trigger {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: transparent;
  border: 1px solid transparent;
  padding: 0.2rem 0.45rem;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  color: var(--text-h);
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.15s ease;
  user-select: none;
}

.user-menu-trigger:hover,
.user-menu-trigger.active {
  background: var(--code-bg);
  border-color: var(--border);
}

.user-display-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron-down-icon {
  width: 13px;
  height: 13px;
  color: var(--text);
  opacity: 0.7;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.chevron-down-icon.rotated {
  transform: rotate(180deg);
}

/* ── Tarjeta Dropdown (sin iconos) ── */
.profile-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 140px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  z-index: 50;
  padding: 0.3rem 0;
  overflow: hidden;
  animation: fadeIn 0.12s ease-out;
}

.dropdown-item {
  display: block;
  width: 100%;
  padding: 0.5rem 0.85rem;
  border: none;
  background: none;
  color: var(--text-h);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}

.dropdown-item:hover {
  background: var(--code-bg);
  color: var(--accent);
}

.logout-item {
  color: var(--text);
}

.logout-item:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

.logout-item:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

/* ── Overlay ── */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
}

/* ── Modal ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  animation: fadeIn 0.15s ease-out;
}

.modal-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1rem;
  width: 100%;
  max-width: 260px;
  text-align: center;
  animation: fadeIn 0.2s ease-out;
}

.modal-icon {
  width: 28px;
  height: 28px;
  margin: 0 auto 0.5rem;
  background: rgba(239, 68, 68, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ef4444;
  padding: 5px;
}

.modal-title {
  font-size: 0.85rem;
  font-weight: 700;
  margin: 0 0 0.25rem;
  color: var(--text-h);
}

.modal-desc {
  font-size: 0.75rem;
  color: var(--text);
  margin: 0 0 0.75rem;
  line-height: 1.4;
}

.modal-actions {
  display: flex;
  gap: 0.5rem;
}

.modal-btn {
  flex: 1;
  padding: 0.35rem 0.6rem;
  border: 1.5px solid var(--border);
  border-radius: 4px;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.modal-btn--cancel {
  background: transparent;
  color: var(--text);
}

.modal-btn--cancel:hover {
  background: var(--code-bg);
  color: var(--text-h);
}

.modal-btn--confirm {
  background: #ef4444;
  border-color: #ef4444;
  color: #fff;
}

.modal-btn--confirm:hover {
  background: #dc2626;
  border-color: #dc2626;
}

/* ── Settings drawer modal (Anchored to right with margins) ── */
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 100;
  animation: fadeIn 0.15s ease-out;
}

.settings-drawer {
  position: fixed;
  top: 0.75rem;
  right: 0.75rem;
  bottom: 0.75rem;
  width: min(75vw, 680px);
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
  text-align: left;
}

@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1.25rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.settings-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-h);
}

.settings-close {
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
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}

.settings-close:hover {
  background: var(--code-bg);
  color: var(--text-h);
}

.settings-close svg {
  width: 16px;
  height: 16px;
}

.settings-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ── Mini sidebar ── */
.settings-nav {
  width: 140px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0;
  flex-shrink: 0;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.55rem 0.85rem;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}

.settings-nav-item svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.settings-nav-item:hover {
  background: var(--accent-bg);
  color: var(--text-h);
}

.settings-nav-item.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

/* ── Content ── */
.settings-content {
  flex: 1;
  padding: 1.15rem 1.35rem;
  overflow-y: auto;
}

.settings-tab {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.auth-provider-pill {
  display: inline-block;
  margin-top: 0.25rem;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
}

.settings-conn-block {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.5rem 0;
}

.connection-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.connection-icon-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.conn-icon {
  width: 20px;
  height: 20px;
  color: var(--text-h);
  flex-shrink: 0;
}

.connection-badge-active {
  font-size: 0.68rem;
  font-weight: 600;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.25);
  border-radius: 3px;
  padding: 2px 7px;
  white-space: nowrap;
}

.connection-badge-inactive {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text);
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 7px;
  white-space: nowrap;
}

.conn-oauth-box {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.75rem;
}

.conn-token-box {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.conn-info-text {
  font-size: 0.76rem;
  color: var(--text);
  line-height: 1.45;
  margin: 0;
}

.token-toggle-btn {
  background: var(--code-bg);
  border: 1.5px solid var(--border);
  color: var(--text);
  padding: 0.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, border-color 0.15s;
}

.token-toggle-btn:hover {
  color: var(--text-h);
  border-color: var(--accent);
}

.token-help-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.2rem;
}

.default-email-hint {
  font-size: 0.72rem;
  color: var(--text);
}

.success-hint {
  font-size: 0.72rem;
  font-weight: 600;
  color: #22c55e;
}

.connection-actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.4rem;
  padding-top: 0.35rem;
}

.actions-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-left: auto;
}

.btn-clear-token {
  background: transparent;
  border: 1px solid #ef4444;
  color: #ef4444;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.35rem 0.65rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.btn-clear-token:hover {
  background: rgba(239, 68, 68, 0.15);
}

.btn-text-danger {
  background: transparent !important;
  border: none !important;
  color: #ef4444 !important;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.4rem 0.75rem;
  transition: opacity 0.15s;
}

.btn-text-danger:hover {
  opacity: 0.75;
  text-decoration: underline;
}

.btn-outline-white {
  background: transparent !important;
  border: 1.5px solid #ffffff !important;
  color: #ffffff !important;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.4rem 1rem;
  border-radius: 4px;
  transition: background 0.15s, opacity 0.15s;
}

.btn-outline-white:hover {
  background: rgba(255, 255, 255, 0.15) !important;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0;
}

.settings-field-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-h);
}

.settings-field-desc {
  font-size: 0.74rem;
  color: var(--text);
  margin: 0;
  line-height: 1.4;
}

.settings-token-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.settings-input {
  flex: 1;
  padding: 0.55rem 0.75rem;
  background: var(--code-bg);
  border: 1.5px solid var(--border);
  font: inherit;
  font-size: 0.85rem;
  color: var(--text-h);
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.settings-input:focus {
  border-color: var(--accent);
}

.settings-tab--connections {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.settings-link {
  font-size: 0.78rem;
  color: var(--accent);
  text-decoration: none;
  font-weight: 600;
}

.settings-link:hover {
  text-decoration: underline;
}

.lang-toggle {
  display: flex;
  gap: 0.5rem;
}
.lang-btn {
  flex: 1;
  padding: 0.5rem;
  border: 1.5px solid var(--border);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.lang-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.lang-btn:hover:not(.active) {
  background: var(--accent-bg);
  border-color: var(--accent);
}

.settings-link:hover {
  text-decoration: underline;
}

.settings-avatar-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-bottom: 0.75rem;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}

.settings-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), #1d4ed8);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.settings-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-h);
  margin: 0 0 0.1rem;
}

.settings-email {
  font-size: 0.75rem;
  color: var(--text);
  margin: 0;
}

.settings-option {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0;
  border: none;
  background: none;
  color: var(--text-h);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  text-align: left;
  transition: opacity 0.15s;
}

.avatar-upload-btn {
  cursor: pointer;
}

.settings-option:hover {
  opacity: 0.75;
}

.settings-option svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text);
}

.settings-opt-divider {
  height: 1px;
  background: var(--border);
  margin: 0.15rem 0;
}

.option-badge {
  font-size: 0.6rem;
  color: var(--text);
  background: var(--code-bg);
  padding: 1px 5px;
  margin-left: auto;
  white-space: nowrap;
}

/* ── Content ── */
.content {
  flex: 1;
  display: flex;
  animation: fadeIn 0.5s ease-out 0.15s both;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.welcome-card {
  text-align: center;
}

.welcome-card h2 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.welcome-card p {
  color: var(--text);
  font-size: 1rem;
}

/* ── Workspace Members Drawer ── */
.ws-members-drawer {
  width: min(75vw, 640px) !important;
}

.ws-drawer-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.ws-drawer-badge {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--accent);
  letter-spacing: 0.5px;
}

.ws-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.ws-drawer-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.ws-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.ws-section-title {
  font-size: 0.88rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-h);
}

.ws-permission-tag {
  font-size: 0.68rem;
  font-weight: 600;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 3px;
  padding: 1px 6px;
}

.ws-section-desc {
  font-size: 0.76rem;
  color: var(--text);
  line-height: 1.45;
  margin: 0;
}

.ws-input-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.ws-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-h);
}

.ws-checklist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ws-btn-toggle-all {
  background: none;
  border: none;
  color: var(--accent);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.ws-empty-projects {
  font-size: 0.75rem;
  color: var(--text);
  padding: 0.5rem 0;
}

.ws-projects-checklist {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 150px;
  overflow-y: auto;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.5rem;
}

.ws-project-check-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--text-h);
  transition: background 0.12s;
}

.ws-project-check-item:hover {
  background: var(--accent-bg);
}

.ws-project-check-item.is-checked {
  color: #fff;
}

.ws-checkbox {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: var(--accent);
}

.ws-check-title {
  flex: 1;
  font-size: 0.8rem;
  font-weight: 600;
}

.ws-github-badge {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 1px 5px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text);
}

.ws-members-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ws-members-count {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-bg);
  border: 1px solid var(--border);
  padding: 1px 6px;
  border-radius: 10px;
}

.ws-members-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ws-member-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.ws-member-info {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
  flex: 1;
}

.ws-member-details {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.ws-member-name-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.ws-member-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-h);
}

.ws-pending-tag {
  font-size: 0.65rem;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 3px;
  padding: 1px 4px;
}

.ws-member-email {
  font-size: 0.72rem;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-member-projects-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.ws-proj-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  font-size: 0.65rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--text-h);
}

.ws-proj-chip-remove {
  background: transparent;
  border: none;
  color: var(--text);
  opacity: 0.6;
  font-size: 0.65rem;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  line-height: 1;
  transition: opacity 0.15s, color 0.15s;
}

.ws-proj-chip-remove:hover {
  opacity: 1;
  color: #ef4444;
}

.ws-add-proj-wrapper {
  position: relative;
  display: inline-flex;
}

.ws-add-proj-btn {
  background: transparent;
  border: 1px dashed var(--accent);
  color: var(--accent);
  font-size: 0.65rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.ws-add-proj-btn:hover {
  background: var(--accent-bg);
}

.ws-add-proj-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow);
  z-index: 120;
  min-width: 160px;
  max-height: 180px;
  overflow-y: auto;
  padding: 4px 0;
}

.ws-add-proj-dropdown-title {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--text);
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  opacity: 0.7;
}

.ws-add-proj-dropdown-item {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-h);
  padding: 6px 10px;
  cursor: pointer;
  transition: background 0.1s;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ws-add-proj-dropdown-item:hover {
  background: var(--accent-bg);
  color: var(--accent);
}

.ws-member-role-col {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.ws-member-remove-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}

.ws-member-remove-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
}

/* ── Keyframes ── */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
