<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useProjects } from '../composables/useProjects'
import { useUserGithubRepos } from '../composables/useUserGithubRepos'

const { projects, loading, createProject } = useProjects()
const {
  hasToken: hasGithubToken,
  repos: githubRepos,
  loading: loadingGithubRepos,
  error: githubRepoError,
  fetchRepos: fetchGithubRepos,
  connectToken: connectGithubToken,
} = useUserGithubRepos()

const typeLabel: Record<string, string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  mobile: 'Móvil',
  web: 'Web',
  fullstack: 'Full Stack',
}

// Drawer state
const showDrawer = ref(false)
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

const selectedRepoObj = computed(() => githubRepos.value.find((r) => r.html_url === repoUrl.value))

const selectRepo = (url: string) => {
  repoUrl.value = url
  repoDropdownOpen.value = false
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

const openDrawer = () => {
  projectName.value = ''
  projectDesc.value = ''
  inviteColleague.value = false
  colleagueEmail.value = ''
  linkRepo.value = false
  repoUrl.value = ''
  repoDropdownOpen.value = false
  quickTokenInput.value = ''
  tokenError.value = ''
  showDrawer.value = true
}

const closeDrawer = () => {
  showDrawer.value = false
  inviteColleague.value = false
  colleagueEmail.value = ''
  linkRepo.value = false
  repoUrl.value = ''
  repoDropdownOpen.value = false
  quickTokenInput.value = ''
  tokenError.value = ''
}

const handleCreate = async () => {
  const name = projectName.value.trim()
  if (!name) return
  await createProject(name, projectDesc.value.trim(), 'fullstack', {
    colleagueEmail: inviteColleague.value ? colleagueEmail.value.trim() : undefined,
    githubRepo: linkRepo.value ? repoUrl.value.trim() : undefined,
  })
  closeDrawer()
}
</script>

<template>
  <div class="proyectos-page">
    <div v-if="loading" class="page-loading">
      <div class="loader"></div>
    </div>

    <div v-else-if="projects.length === 0" class="page-empty">
      <p>Aún no tienes proyectos.</p>
    </div>

    <div v-else class="proyectos-grid">
      <div class="grid-header">
        <h2 class="grid-title">Mis proyectos</h2>
      </div>
      <div class="grid-cards">
        <router-link
          v-for="project in projects"
          :key="project.id"
          :to="'/proyectos/' + project.id"
          class="project-card"
        >
          <div class="project-type-badge" :class="'badge--' + project.type">
            {{ typeLabel[project.type] || project.type }}
          </div>
          <h3 class="project-name">{{ project.name }}</h3>
          <p v-if="project.description" class="project-desc">{{ project.description }}</p>
          <p class="project-date">{{ new Date(project.createdAt).toLocaleDateString() }}</p>
        </router-link>
      </div>
    </div>

    <!-- Floating create button -->
    <button class="fab-create" @click="openDrawer" title="Crear proyecto">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>

    <!-- Drawer -->
    <div v-if="showDrawer" class="drawer-overlay" @click="closeDrawer"></div>
    <div v-if="showDrawer" class="drawer" @click.stop>
      <div class="drawer-header">
        <h3 class="drawer-title">Nuevo proyecto</h3>
      </div>
      <div class="drawer-body">
        <div class="drawer-field">
          <label for="proj-name">Nombre del proyecto</label>
          <input id="proj-name" v-model="projectName" type="text" autocomplete="off" />
        </div>
        <div class="drawer-field">
          <label for="proj-desc">Descripción</label>
          <textarea id="proj-desc" v-model="projectDesc" rows="3"></textarea>
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
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z" />
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
                    :class="{ 'is-selected': repoUrl === r.html_url }"
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
                  </div>
                </div>
              </div>
            </div>

            <!-- Si NO tiene token de GitHub conectado -->
            <div v-else class="repo-token-notice">
              <div class="repo-notice-text">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="notice-info-icon">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>Debes conectar dev->flow con GitHub mediante token</span>
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
              <p v-if="tokenError" class="repo-token-error">{{ tokenError }}</p>
            </div>
          </div>
        </div>
      </div>
      <div class="drawer-footer">
        <button class="drawer-btn drawer-btn--cancel" @click="closeDrawer">Cancelar</button>
        <button class="drawer-btn drawer-btn--create" :disabled="!projectName.trim()" @click="handleCreate">
          Crear proyecto
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.proyectos-page {
  width: 100%;
  height: 100%;
  padding: 1.5rem;
  box-sizing: border-box;
  overflow-y: auto;
}

.page-loading,
.page-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loader {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.page-empty p {
  font-size: 0.9rem;
  color: var(--text);
}

.proyectos-grid {
  max-width: 900px;
}

.grid-header {
  margin-bottom: 1.25rem;
}

.grid-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-h);
}

/* ── Floating action button ── */
.fab-create {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, var(--accent), #1d4ed8);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s, box-shadow 0.2s;
  z-index: 50;
}

.fab-create:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}

.fab-create:active {
  transform: scale(0.96);
}

.fab-create svg {
  width: 24px;
  height: 24px;
}

.grid-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
}

.project-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  text-decoration: none;
  color: inherit;
}

.project-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow);
}

.project-type-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  align-self: flex-start;
}

.badge--backend { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
.badge--frontend { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
.badge--mobile { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
.badge--web { background: rgba(168, 85, 247, 0.12); color: #a855f7; }
.badge--fullstack { background: rgba(234, 179, 8, 0.12); color: #eab308; }

.project-name {
  font-size: 1rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-h);
}

.project-desc {
  font-size: 0.8rem;
  color: var(--text);
  margin: 0;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-date {
  font-size: 0.7rem;
  color: var(--text);
  margin: 0;
  margin-top: auto;
  opacity: 0.7;
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

/* ── Custom select ── */
.custom-select-wrap {
  position: relative;
}

.custom-select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.65rem;
  background-color: var(--code-bg);
  border: 1.5px solid var(--border);
  font: inherit;
  font-size: 0.85rem;
  color: var(--text-h);
  outline: none;
  cursor: pointer;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.custom-select-trigger:hover,
.custom-select-trigger.open {
  border-color: var(--accent);
}

.custom-select-trigger svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.custom-select-trigger .placeholder {
  color: var(--text);
  opacity: 0.6;
}

.custom-select-trigger .chevron {
  margin-left: auto;
  width: 14px;
  height: 14px;
  opacity: 0.5;
  transition: transform 0.2s;
}

.custom-select-trigger.open .chevron {
  transform: rotate(180deg);
}

.custom-select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--card-bg);
  border: 1.5px solid var(--border);
  z-index: 10;
  overflow: hidden;
  animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.custom-select-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.65rem;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.85rem;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s, color 0.1s;
}

.custom-select-option:hover {
  background: var(--accent-bg);
  color: var(--text-h);
}

.custom-select-option.active {
  color: var(--accent);
  font-weight: 600;
}

.custom-select-option svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
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
