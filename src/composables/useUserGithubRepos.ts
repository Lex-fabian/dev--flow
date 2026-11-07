import { ref, computed } from 'vue'
import { useGithubToken } from './useGithubToken'

export interface GithubRepoItem {
  id: number
  name: string
  full_name: string
  html_url: string
  private: boolean
  description: string | null
}

const repos = ref<GithubRepoItem[]>([])
const loading = ref(false)
const error = ref('')

export function useUserGithubRepos() {
  const { token, setToken, clearToken } = useGithubToken()

  const hasToken = computed(() => Boolean(token.value && token.value.trim().length > 0))

  const fetchRepos = async (force = false) => {
    if (!token.value) {
      repos.value = []
      return
    }

    if (!force && repos.value.length > 0) {
      return
    }

    loading.value = true
    error.value = ''
    try {
      const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: {
          Authorization: `Bearer ${token.value.trim()}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })

      if (!res.ok) {
        if (res.status === 401) {
          clearToken()
          throw new Error('Tu sesión de GitHub ha expirado o el token es inválido. Por favor reconéctate.')
        }
        throw new Error(`Error (${res.status}) al obtener repositorios de GitHub`)
      }

      const data = await res.json()
      repos.value = Array.isArray(data) ? data : []
    } catch (e: any) {
      error.value = e?.message || 'No se pudo conectar con GitHub'
      repos.value = []
    } finally {
      loading.value = false
    }
  }

  const connectToken = async (newToken: string) => {
    if (!newToken.trim()) return
    setToken(newToken.trim())
    await fetchRepos(true)
  }

  return {
    token,
    hasToken,
    repos,
    loading,
    error,
    fetchRepos,
    connectToken,
  }
}

