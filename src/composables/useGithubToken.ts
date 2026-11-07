import { ref } from 'vue'
import { auth } from '../firebase'
import { onAuthStateChanged, GithubAuthProvider, signInWithPopup, reauthenticateWithPopup, linkWithPopup } from 'firebase/auth'

const token = ref('')

function reloadToken(uid?: string | null) {
  const currentUid = uid ?? auth.currentUser?.uid
  if (!currentUid) {
    const legacy = typeof localStorage !== 'undefined' ? localStorage.getItem('dev-flow-github-token') : null
    if (legacy) {
      token.value = legacy
    }
    return
  }
  const key = `dev-flow-github-token_${currentUid}`
  let saved = localStorage.getItem(key)
  if (!saved) {
    // Check legacy global storage key and migrate
    const legacy = localStorage.getItem('dev-flow-github-token')
    if (legacy) {
      saved = legacy
      localStorage.setItem(key, legacy)
    }
  }
  token.value = saved || ''
}

// Initial immediate load
if (typeof localStorage !== 'undefined') {
  const legacy = localStorage.getItem('dev-flow-github-token')
  if (legacy) token.value = legacy
}
if (auth.currentUser) {
  reloadToken(auth.currentUser.uid)
}

// React to auth state changes to isolate tokens per user
onAuthStateChanged(auth, (user) => {
  if (user) {
    reloadToken(user.uid)
  } else {
    token.value = ''
  }
})

export async function connectWithGithubOAuth(): Promise<string | null> {
  const provider = new GithubAuthProvider()
  provider.addScope('read:user')
  provider.addScope('repo')
  let result: any = null
  if (auth.currentUser) {
    const isGithub = auth.currentUser.providerData.some(p => p.providerId === 'github.com')
    try {
      if (isGithub) {
        result = await reauthenticateWithPopup(auth.currentUser, provider)
      } else {
        result = await linkWithPopup(auth.currentUser, provider)
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') throw err
      result = await signInWithPopup(auth, provider)
    }
  } else {
    result = await signInWithPopup(auth, provider)
  }
  const credential = GithubAuthProvider.credentialFromResult(result)
  if (credential?.accessToken) {
    const currentUid = auth.currentUser?.uid || result.user.uid
    token.value = credential.accessToken
    const key = `dev-flow-github-token_${currentUid}`
    localStorage.setItem(key, credential.accessToken)
    localStorage.setItem('dev-flow-github-token', credential.accessToken)
    return credential.accessToken
  }
  return null
}

export function useGithubToken() {
  const setToken = (newToken: string, explicitUid?: string) => {
    token.value = newToken
    const currentUid = explicitUid ?? auth.currentUser?.uid
    if (currentUid) {
      const key = `dev-flow-github-token_${currentUid}`
      if (newToken) {
        localStorage.setItem(key, newToken)
        localStorage.setItem('dev-flow-github-token', newToken)
      } else {
        localStorage.removeItem(key)
      }
    } else {
      if (newToken) {
        localStorage.setItem('dev-flow-github-token', newToken)
      } else {
        localStorage.removeItem('dev-flow-github-token')
      }
    }
  }

  const clearToken = (explicitUid?: string) => {
    token.value = ''
    const currentUid = explicitUid ?? auth.currentUser?.uid
    if (currentUid) {
      localStorage.removeItem(`dev-flow-github-token_${currentUid}`)
    }
    localStorage.removeItem('dev-flow-github-token')
  }

  return {
    token,
    setToken,
    clearToken,
    reloadToken,
    connectWithGithubOAuth,
  }
}
