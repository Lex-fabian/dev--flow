<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { User } from 'firebase/auth'
import { useProjects } from '../composables/useProjects'
import { useUserGithubRepos } from '../composables/useUserGithubRepos'
import { useTickets } from '../composables/useTickets'
import { useWorkspaces } from '../composables/useWorkspaces'
import { connectWithGithubOAuth } from '../composables/useGithubToken'

const props = defineProps<{ user: User }>()

const { projects, loading, createProject, MAX_PROJECTS_PER_WORKSPACE } = useProjects()
const isProjectLimitReached = computed(() => projects.value.length >= MAX_PROJECTS_PER_WORKSPACE)
const { tickets } = useTickets()

const ticketCountsByProject = computed(() => {
  const map: Record<string, { 'sin-realizar': number; 'en-proceso': number; 'testing': number; 'completado': number }> = {}
  for (const t of tickets.value) {
    if (t.closedAt) continue
    if (!map[t.projectId]) {
      map[t.projectId] = { 'sin-realizar': 0, 'en-proceso': 0, 'testing': 0, 'completado': 0 }
    }
    const s = t.status || 'sin-realizar'
    if (s in map[t.projectId]) {
      map[t.projectId][s as 'sin-realizar' | 'en-proceso' | 'testing' | 'completado']++
    }
  }
  return map
})

function getCount(projectId: string, status: 'sin-realizar' | 'en-proceso' | 'testing' | 'completado'): number {
  return ticketCountsByProject.value[projectId]?.[status] ?? 0
}

const {
  hasToken: hasGithubToken,
  repos: githubRepos,
  loading: loadingGithubRepos,
  error: githubRepoError,
  fetchRepos: fetchGithubRepos,
  connectToken: connectGithubToken,
} = useUserGithubRepos()

// Drawer state
const showProjectDrawer = ref(false)
const projectName = ref('')
const projectDesc = ref('')
const inviteColleague = ref(false)
const colleagueEmail = ref('')
const linkRepo = ref(false)
const repoUrl = ref('')
const repoDropdownOpen = ref(false)
const quickTokenInput = ref('')
const connectingToken = ref(false)
const tokenError = ref('')

const { currentWorkspace } = useWorkspaces()
const canCreateProject = computed(() => Boolean(currentWorkspace.value && currentWorkspace.value.userId === props.user.uid))

const selectedRepoObj = computed(() => githubRepos.value.find((r) => r.html_url === repoUrl.value))

const isRepoLinked = (url: string) => {
  if (!url) return false
  return projects.value.some(p => p.github && p.github.trim().toLowerCase() === url.trim().toLowerCase())
}

const selectRepo = (url: string) => {
  if (isRepoLinked(url)) return
  repoUrl.value = url
  repoDropdownOpen.value = false
}

const isGithubUser = computed(() => {
  return props.user?.providerData?.some(p => p.providerId === 'github.com')
})

const connectingGithubOAuth = ref(false)

const handleConnectGithubOAuth = async () => {
  connectingGithubOAuth.value = true
  tokenError.value = ''
  try {
    const t = await connectWithGithubOAuth()
    if (t) {
      await fetchGithubRepos(true)
    }
  } catch (err: any) {
    tokenError.value = err?.message || 'Error al conectar con GitHub'
  } finally {
    connectingGithubOAuth.value = false
  }
}

watch(linkRepo, (val) => {
  if (val && hasGithubToken.value) {
    fetchGithubRepos()
  }
})

const handleConnectToken = async () => {
  if (!quickTokenInput.value.trim()) return
  connectingToken.value = true
  tokenError.value = ''
  try {
    await connectGithubToken(quickTokenInput.value.trim())
    quickTokenInput.value = ''
  } catch (err: any) {
    tokenError.value = err?.message || 'Error al conectar token'
  } finally {
    connectingToken.value = false
  }
}

const openProjectDrawer = () => {
  projectName.value = ''
  projectDesc.value = ''
  inviteColleague.value = false
  colleagueEmail.value = ''
  linkRepo.value = false
  repoUrl.value = ''
  repoDropdownOpen.value = false
  quickTokenInput.value = ''
  tokenError.value = ''
  showProjectDrawer.value = true
}

const closeProjectDrawer = () => {
  showProjectDrawer.value = false
  inviteColleague.value = false
  colleagueEmail.value = ''
  linkRepo.value = false
  repoUrl.value = ''
  repoDropdownOpen.value = false
  quickTokenInput.value = ''
  tokenError.value = ''
}

const handleCreateProject = async () => {
  const name = projectName.value.trim()
  if (!name) return
  await createProject(name, projectDesc.value.trim(), 'fullstack', {
    colleagueEmail: inviteColleague.value ? colleagueEmail.value.trim() : undefined,
    githubRepo: linkRepo.value ? repoUrl.value.trim() : undefined,
  })
  closeProjectDrawer()
}
</script>

<template>
  <div class="inicio-page">
    <!-- Loading -->
    <div v-if="loading" class="inicio-loading">
      <div class="loader"></div>
    </div>

    <!-- Empty state -->
    <div v-else-if="projects.length === 0" class="inicio-empty">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      </div>
      <h2 class="inicio-title">No tienes ningún proyecto</h2>
      <p class="inicio-desc">Organiza tus actividades con un tablero Kanban.</p>
      <button v-if="canCreateProject" class="btn-create" @click="openProjectDrawer">
        Crea tu primer proyecto
      </button>
      <p v-else class="inicio-desc">Solo el propietario de esta área de trabajo puede crear proyectos.</p>
    </div>

    <!-- Proyectos en formato tarjeta -->
    <div v-else class="projects-dashboard">
      <div class="projects-header">
        <div class="projects-title-wrap">
          <h2 class="projects-title">Mis proyectos</h2>
          <span class="projects-count-badge">{{ projects.length }}/{{ MAX_PROJECTS_PER_WORKSPACE }}</span>
        </div>
        <button
          v-if="canCreateProject && !isProjectLimitReached"
          class="btn-new-project"
          @click="openProjectDrawer"
        >
          Nuevo
        </button>
        <span v-else-if="canCreateProject && isProjectLimitReached" class="projects-limit-reached-tag">
          Límite de {{ MAX_PROJECTS_PER_WORKSPACE }} proyectos alcanzado
        </span>
      </div>

      <div class="projects-grid">
        <router-link
          v-for="project in projects"
          :key="project.id"
          :to="'/proyectos/' + project.id"
          class="project-card"
        >
          <div class="project-card-header">
            <h3 class="project-name">{{ project.name }}</h3>
            <span v-if="project.members && project.members.length > 1" class="meta-badge meta-members" title="Miembros">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="meta-icon">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>{{ project.members.length }}</span>
            </span>
          </div>

          <div class="project-stats">
            <div class="stat-item stat--sin-realizar">
              <span class="stat-label">Sin realizar</span>
              <span class="stat-count">{{ getCount(project.id, 'sin-realizar') }}</span>
            </div>
            <div class="stat-item stat--en-proceso">
              <span class="stat-label">En proceso</span>
              <span class="stat-count">{{ getCount(project.id, 'en-proceso') }}</span>
            </div>
            <div class="stat-item stat--testing">
              <span class="stat-label">Testing</span>
              <span class="stat-count">{{ getCount(project.id, 'testing') }}</span>
            </div>
            <div class="stat-item stat--completado">
              <span class="stat-label">Completado</span>
              <span class="stat-count">{{ getCount(project.id, 'completado') }}</span>
            </div>
          </div>
        </router-link>
      </div>
    </div>

    <!-- Project drawer -->
    <div v-if="showProjectDrawer" class="drawer-overlay" @click="closeProjectDrawer"></div>
    <div v-if="showProjectDrawer" class="drawer" @click.stop>
      <div class="drawer-header">
        <h3 class="drawer-title">Nuevo proyecto</h3>
      </div>
      <div class="drawer-body">
        <div class="drawer-field">
          <label>Nombre del proyecto</label>
          <input v-model="projectName" type="text" autocomplete="off" />
        </div>
        <div class="drawer-field">
          <label>Descripción</label>
          <textarea v-model="projectDesc" rows="3"></textarea>
        </div>
        <div class="drawer-checkbox-group">
          <label class="drawer-checkbox-row">
            <input v-model="inviteColleague" type="checkbox" class="drawer-checkbox" />
            <span>Invitar a un colega</span>
          </label>
          <div v-if="inviteColleague" class="drawer-subfield">
            <input
              v-model="colleagueEmail"
              type="email"
              placeholder="correo@ejemplo.com"
              class="drawer-subinput"
              autocomplete="off"
            />
          </div>

          <label class="drawer-checkbox-row">
            <input v-model="linkRepo" type="checkbox" class="drawer-checkbox" />
            <span>Vincular con un repositorio</span>
          </label>
          <div v-if="linkRepo" class="drawer-subfield">
            <!-- Si tiene token de GitHub -->
            <div v-if="hasGithubToken" class="drawer-repo-select-wrap">
              <div v-if="loadingGithubRepos" class="repo-loading-state">
                <span class="repo-loading-spinner"></span>
                <span>Cargando repositorios de GitHub...</span>
              </div>
              <div v-else-if="githubRepoError" class="repo-error-state">
                <span class="repo-error-msg">{{ githubRepoError }}</span>
                <button type="button" class="btn-retry-repos" @click="fetchGithubRepos(true)">Reintentar</button>
              </div>
              <div v-else-if="githubRepos.length === 0" class="repo-empty-state">
                <span>No se encontraron repositorios en tu cuenta de GitHub.</span>
                <button type="button" class="btn-retry-repos" @click="fetchGithubRepos(true)">Actualizar</button>
              </div>
              <div v-else class="custom-repo-select">
                <button
                  type="button"
                  class="custom-repo-trigger"
                  @click="repoDropdownOpen = !repoDropdownOpen"
                >
                  <div v-if="selectedRepoObj" class="custom-repo-selected-item">
                    <svg
                      v-if="selectedRepoObj.private"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="repo-eye-icon"
                      title="Privado"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="repo-eye-icon"
                      title="Público"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span class="custom-repo-name">{{ selectedRepoObj.full_name }}</span>
                  </div>
                  <span v-else class="custom-repo-placeholder">Selecciona un repositorio de GitHub</span>

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    class="custom-repo-chevron"
                    :class="{ 'chevron-open': repoDropdownOpen }"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                <div v-if="repoDropdownOpen" class="custom-repo-menu">
                  <div
                    v-for="r in githubRepos"
                    :key="r.id"
                    class="custom-repo-option"
                    :class="{ 
                      'is-selected': repoUrl === r.html_url,
                      'is-disabled': isRepoLinked(r.html_url)
                    }"
                    @click="selectRepo(r.html_url)"
                  >
                    <svg
                      v-if="r.private"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="repo-eye-icon"
                      title="Privado"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="repo-eye-icon"
                      title="Público"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span class="custom-repo-option-name">{{ r.full_name }}</span>
                    <span v-if="isRepoLinked(r.html_url)" class="repo-linked-tag">Ya vinculado</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Si NO tiene token de GitHub conectado -->
            <div v-else class="repo-token-notice">
              <!-- Si el usuario inició sesión con GitHub -->
              <div v-if="isGithubUser" class="repo-oauth-prompt">
                <div class="repo-notice-text">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="notice-info-icon">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                  </svg>
                  <span>Tu cuenta está vinculada a GitHub. Autoriza el acceso a tus repositorios:</span>
                </div>
                <button
                  type="button"
                  class="btn-connect-oauth"
                  :disabled="connectingGithubOAuth"
                  @click="handleConnectGithubOAuth"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;flex-shrink:0">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                  <span>{{ connectingGithubOAuth ? 'Conectando con GitHub...' : 'Conectar con GitHub' }}</span>
                </button>
              </div>

              <!-- Si inició con Google o correo manual: pide PAT -->
              <div v-else>
                <div class="repo-notice-text">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="notice-info-icon">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>Debes conectar dev->flow con GitHub mediante token personal</span>
                </div>
                <div class="repo-token-inline">
                  <input
                    v-model="quickTokenInput"
                    type="password"
                    placeholder="Pega tu Personal Access Token (ghp_...)"
                    class="drawer-subinput repo-token-input"
                    autocomplete="off"
                  />
                  <button
                    type="button"
                    class="btn-connect-token"
                    :disabled="!quickTokenInput.trim() || connectingToken"
                    @click="handleConnectToken"
                  >
                    {{ connectingToken ? 'Conectando...' : 'Conectar' }}
                  </button>
                </div>
              </div>
              <p v-if="tokenError" class="repo-token-error">{{ tokenError }}</p>
            </div>
          </div>
        </div>
      </div>
      <div class="drawer-footer">
        <button class="drawer-btn drawer-btn--cancel" @click="closeProjectDrawer">Cancelar</button>
        <button class="drawer-btn drawer-btn--create" :disabled="!projectName.trim()" @click="handleCreateProject">
          Crear proyecto
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inicio-page {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.inicio-loading {
  height: 100%;
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

/* ── Empty state ── */
.inicio-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem 1.5rem;
}

.empty-icon {
  margin-bottom: 1rem;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  padding: 0;
}

.empty-icon svg {
  width: 40px;
  height: 40px;
}

.inicio-title {
  font-size: 1.3rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
  color: var(--text-h);
}

.inicio-desc {
  font-size: 0.9rem;
  color: var(--text);
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

.btn-create {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  white-space: nowrap;
}

.btn-create:hover {
  opacity: 0.9;
}

/* ── Proyectos Dashboard ── */
.projects-dashboard {
  width: 100%;
  padding: 1.5rem;
  box-sizing: border-box;
}

.projects-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.projects-title-wrap {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.projects-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-h);
}

.projects-count-badge {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text);
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1px 7px;
}

.btn-new-project {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.85rem;
  background: transparent;
  color: #ffffff;
  border: 1px solid #ffffff;
  border-radius: 4px;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.btn-new-project:hover {
  background: rgba(255, 255, 255, 0.08);
}

.projects-limit-reached-tag {
  font-size: 0.72rem;
  font-weight: 600;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 4px;
  padding: 0.35rem 0.75rem;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}

.project-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s;
}

.project-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow);
}

.project-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.project-name {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-h);
  line-height: 1.3;
}

.project-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  border-top: 1px solid var(--border);
  margin-top: 0.35rem;
  background: transparent;
}

.stat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.55rem 0.65rem;
  background: transparent;
  font-size: 0.73rem;
}

.stat-item:nth-child(odd) {
  border-right: 1px solid var(--border);
}

.stat-item:nth-child(1),
.stat-item:nth-child(2) {
  border-bottom: 1px solid var(--border);
}

.stat-label {
  color: var(--text);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-count {
  font-weight: 700;
  font-size: 0.72rem;
  padding: 0 5px;
  border-radius: 3px;
  min-width: 16px;
  text-align: center;
}

.stat--sin-realizar .stat-count {
  color: #6b7280;
  background: rgba(107, 114, 128, 0.15);
}

.stat--en-proceso .stat-count {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.15);
}

.stat--testing .stat-count {
  color: #f97316;
  background: rgba(249, 115, 22, 0.15);
}

.stat--completado .stat-count {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.15);
}

.meta-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.68rem;
  padding: 2px 5px;
  border-radius: 3px;
  background: var(--code-bg);
  border: 1px solid var(--border);
  color: var(--text);
}

.meta-icon {
  width: 12px;
  height: 12px;
}

/* ── Drawer Styling ── */
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
  width: 380px;
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
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.drawer-title {
  font-size: 0.88rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-h);
}

.drawer-body {
  flex: 1;
  padding: 1.25rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.drawer-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.drawer-field label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-h);
}

.drawer-field input {
  width: 100%;
  height: 32px;
  padding: 0.25rem 0.55rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit;
  font-size: 0.82rem;
  color: var(--text-h);
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.drawer-field textarea {
  width: 100%;
  padding: 0.35rem 0.55rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit;
  font-size: 0.82rem;
  color: var(--text-h);
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
  resize: vertical;
  min-height: 70px;
}

.drawer-field input:focus,
.drawer-field textarea:focus {
  border-color: var(--accent);
}

.drawer-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-top: 0.2rem;
}

.drawer-checkbox-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  user-select: none;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--text-h);
}

.drawer-checkbox {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  cursor: pointer;
}

.drawer-subfield {
  padding-left: 1.45rem;
}

.drawer-subinput {
  width: 100%;
  height: 30px;
  padding: 0.25rem 0.55rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit;
  font-size: 0.78rem;
  color: var(--text-h);
  outline: none;
  box-sizing: border-box;
}

.drawer-subinput:focus {
  border-color: var(--accent);
}

.drawer-repo-select-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.custom-repo-select {
  position: relative;
  width: 100%;
}

.custom-repo-trigger {
  width: 100%;
  height: 32px;
  padding: 0.25rem 0.65rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--text-h);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;
}

.custom-repo-trigger:focus {
  border-color: var(--accent);
  outline: none;
}

.custom-repo-selected-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1;
}

.custom-repo-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.custom-repo-placeholder {
  color: var(--text);
  opacity: 0.6;
}

.custom-repo-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  stroke: var(--text);
  transition: transform 0.2s ease;
}

.custom-repo-chevron.chevron-open {
  transform: rotate(180deg);
}

.custom-repo-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: var(--shadow);
  z-index: 120;
  padding: 4px 0;
}

.custom-repo-option {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.65rem;
  font-size: 0.8rem;
  color: var(--text);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.custom-repo-option:hover {
  background: var(--accent-bg);
  color: var(--text-h);
}

.custom-repo-option.is-selected {
  background: var(--accent-bg);
  color: var(--text-h);
  font-weight: 600;
}

.custom-repo-option.is-disabled {
  opacity: 0.45 !important;
  color: var(--text) !important;
  cursor: not-allowed !important;
  background: transparent !important;
}

.custom-repo-option.is-disabled:hover {
  background: transparent !important;
  color: var(--text) !important;
}

.repo-linked-tag {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--code-bg);
  border: 1px solid var(--border);
  color: var(--text);
  margin-left: auto;
  flex-shrink: 0;
}

.custom-repo-option-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.repo-eye-icon {
  width: 14px;
  height: 14px;
  stroke: #ffffff;
  color: #ffffff;
  flex-shrink: 0;
}

.repo-loading-state,
.repo-empty-state,
.repo-error-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.76rem;
  color: var(--text);
  padding: 0.35rem 0.5rem;
  background: var(--code-bg);
  border-radius: 4px;
}

.repo-error-state {
  color: #ef4444;
}

.btn-retry-repos {
  background: none;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--accent);
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
  padding: 2px 6px;
}

.repo-selected-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.25rem;
  font-size: 0.72rem;
  color: var(--text);
  opacity: 0.8;
  overflow: hidden;
}

.repo-link-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--accent);
}

.repo-selected-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Aviso cuando falta token de GitHub ── */
.repo-token-notice {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.55rem 0.65rem;
  background: rgba(14, 165, 233, 0.05);
  border: 1px solid rgba(14, 165, 233, 0.25);
  border-radius: 5px;
}

.repo-notice-text {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-h);
}

.notice-info-icon {
  width: 15px;
  height: 15px;
  color: var(--accent);
  flex-shrink: 0;
}

.repo-oauth-prompt {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.btn-connect-oauth {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.45rem 0.85rem;
  background: #24292f;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
  width: 100%;
}

.btn-connect-oauth:hover:not(:disabled) {
  background: #1b1f23;
  opacity: 0.95;
}

.btn-connect-oauth:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.repo-token-inline {
  display: flex;
  gap: 0.4rem;
}

.repo-token-input {
  flex: 1;
}

.btn-connect-token {
  padding: 0 0.7rem;
  height: 30px;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
}

.btn-connect-token:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-connect-token:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.repo-token-error {
  margin: 0;
  font-size: 0.72rem;
  color: #ef4444;
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

.drawer-btn {
  padding: 0.35rem 0.85rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.drawer-btn--cancel {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  color: var(--text);
  padding: 0.35rem 0.6rem;
  font-weight: 500;
}

.drawer-btn--cancel:hover {
  color: var(--text-h);
}

.drawer-btn--create {
  background: transparent;
  border: 1px solid #ffffff;
  color: #ffffff;
}

.drawer-btn--create:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.drawer-btn--create:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
