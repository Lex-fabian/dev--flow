/**
 * @file useGithubRepo.ts
 * @description Conexión con GitHub REST API v3 y fallback a raw.githubusercontent.com.
 * Carga información de repositorios, archivos, README, commits recientes y Pull Requests para proyectos vinculados.
 */

import { ref, watch, type Ref, type ComputedRef } from 'vue'

export interface RepoInfo {
  name: string
  description: string
  stars: number
  forks: number
  language: string
  topics: string[]
  lastPush: string
  defaultBranch: string
}

export interface RepoFile {
  name: string
  path: string
  type: 'file' | 'dir'
}

export interface GitHubCommit {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
  url: string
}

export interface GitHubPR {
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  headBranch: string
  url: string
  author: string
}

/**
 * Convierte un título a un formato de rama Git estandarizado (kebab-case).
 */
export function slugifyGitBranch(title: string): string {
  const clean = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
  return `feature/${clean || 'task'}`
}

/**
 * Genera el comando de checkout para crear la rama en Git o VS Code.
 */
export function generateBranchCommand(ticket: { title: string }): string {
  return `git checkout -b ${slugifyGitBranch(ticket.title)}`
}

/**
 * Genera el comando de commit sugerido compatible con la rama main o ramas de feature.
 * Si se incluye en main, Dev Flow reconocerá el ID o el slug para auto-completar el ticket.
 */
export function generateCommitCommand(ticket: { id: string; title: string }, action: 'feat' | 'fix' = 'fix'): string {
  const shortId = ticket.id.slice(0, 6)
  const cleanTitle = ticket.title.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 50)
  return `git commit -m "${action}: ${cleanTitle} (close #${shortId})"`
}

/**
 * Composable useGithubRepo: Inspecciona repositorios de GitHub vinculados a proyectos.
 * @param repoUrl URL del repositorio (reactiva)
 * @param token Token de acceso personal o token de OAuth opcional
 */
export function useGithubRepo(
  repoUrl: Ref<string | undefined> | ComputedRef<string | undefined>,
  token?: Ref<string>
) {
  const info = ref<RepoInfo | null>(null)
  const readme = ref<string>('')
  const files = ref<RepoFile[]>([])
  const commits = ref<GitHubCommit[]>([])
  const pulls = ref<GitHubPR[]>([])
  const loading = ref(false)
  const error = ref('')

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    }
    if (token?.value) h['Authorization'] = `Bearer ${token.value}`
    return h
  }

  function parseUrl(url: string): { owner: string; repo: string } | null {
    const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') }
  }

  async function fetchRepo(owner: string, repo: string) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: headers() })
      if (res.ok) {
        const data = await res.json()
        info.value = {
          name: data.name || repo,
          description: data.description || 'Sin descripción',
          stars: data.stargazers_count ?? 0,
          forks: data.forks_count ?? 0,
          language: data.language || '',
          topics: data.topics || [],
          lastPush: data.pushed_at || '',
          defaultBranch: data.default_branch || 'main',
        }
        return
      }
    } catch {}

    if (!info.value) {
      info.value = {
        name: repo,
        description: 'Repositorio vinculado en GitHub',
        stars: 0,
        forks: 0,
        language: '',
        topics: [],
        lastPush: '',
        defaultBranch: 'main',
      }
    }
  }

  async function fetchReadme(owner: string, repo: string, defaultBranch = 'main') {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers: headers() })
      if (res.ok) {
        const data = await res.json()
        const cleanContent = (data.content || '').replace(/\s/g, '')
        const binaryString = atob(cleanContent)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        readme.value = new TextDecoder('utf-8').decode(bytes)
        return
      }
    } catch {}

    try {
      const branches = [defaultBranch, 'main', 'master']
      for (const b of branches) {
        const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${b}/README.md`)
        if (rawRes.ok) {
          readme.value = await rawRes.text()
          return
        }
      }
    } catch {}

    readme.value = 'No se encontró un archivo README.md disponible en el repositorio.'
  }

  async function fetchFiles(owner: string, repo: string) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents`, { headers: headers() })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          files.value = data.map((item: any) => ({
            name: item.name,
            path: item.path,
            type: item.type === 'dir' ? 'dir' : 'file',
          }))
          return
        }
      }
    } catch {}
    files.value = []
  }

  async function fetchCommits(owner: string, repo: string) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=30`, { headers: headers() })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          commits.value = data.map((c: any) => ({
            sha: c.sha || '',
            shortSha: (c.sha || '').slice(0, 7),
            message: c.commit?.message || '',
            author: c.commit?.author?.name || c.author?.login || 'Autor',
            date: c.commit?.author?.date || '',
            url: c.html_url || `https://github.com/${owner}/${repo}/commit/${c.sha}`,
          }))
          return
        }
      }
    } catch {}
    commits.value = []
  }

  async function fetchPulls(owner: string, repo: string) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=20`, { headers: headers() })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          pulls.value = data.map((pr: any) => ({
            number: pr.number,
            title: pr.title || '',
            state: pr.state || 'open',
            merged: Boolean(pr.merged_at),
            headBranch: pr.head?.ref || '',
            url: pr.html_url || '',
            author: pr.user?.login || 'Autor',
          }))
          return
        }
      }
    } catch {}
    pulls.value = []
  }

  async function load(url: string) {
    const parsed = parseUrl(url)
    if (!parsed) {
      error.value = 'URL de GitHub no válida'
      loading.value = false
      return
    }
    loading.value = true
    error.value = ''
    info.value = null
    readme.value = ''
    files.value = []
    commits.value = []
    pulls.value = []

    try {
      await Promise.allSettled([
        fetchRepo(parsed.owner, parsed.repo),
        fetchReadme(parsed.owner, parsed.repo),
        fetchFiles(parsed.owner, parsed.repo),
        fetchCommits(parsed.owner, parsed.repo),
        fetchPulls(parsed.owner, parsed.repo),
      ])
    } catch (e: any) {
      error.value = e.message || 'Error al conectar con GitHub'
    }
    loading.value = false
  }

  async function refreshGit() {
    if (!repoUrl.value) return
    const parsed = parseUrl(repoUrl.value)
    if (!parsed) return
    loading.value = true
    await Promise.allSettled([
      fetchCommits(parsed.owner, parsed.repo),
      fetchPulls(parsed.owner, parsed.repo),
    ])
    loading.value = false
  }

  watch(repoUrl, (val) => {
    if (val) load(val)
  }, { immediate: true })

  return {
    info,
    readme,
    files,
    commits,
    pulls,
    loading,
    error,
    load,
    refreshGit,
    parseUrl,
  }
}
