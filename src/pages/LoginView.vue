<script setup lang="ts">
import { ref } from 'vue'
import { auth } from '../firebase'
import logo from '../assets/dev-flow.png'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  sendPasswordResetEmail,
  updateProfile,
  fetchSignInMethodsForEmail,
} from 'firebase/auth'
import { useI18n } from '../composables/useI18n'
import { useGithubToken } from '../composables/useGithubToken'

type AuthMode = 'login' | 'register' | 'forgot'
type PendingAction = 'google' | 'register' | null

const { t, locale, setLocale } = useI18n()
const { setToken: setGithubToken } = useGithubToken()

const mode = ref<AuthMode>('login')
const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
const loading = ref(false)

// ── Aviso de Iniciar con GitHub (sin la palabra 'recomendado') ──
const showGithubModal = ref(false)
const pendingAction = ref<PendingAction>(null)

const promptGithubRecommendation = (action: PendingAction) => {
  pendingAction.value = action
  showGithubModal.value = true
}

const closeGithubModal = () => {
  showGithubModal.value = false
  pendingAction.value = null
}

const proceedWithGithub = () => {
  closeGithubModal()
  signInWithGithub()
}

const proceedWithOriginalAction = () => {
  const action = pendingAction.value
  closeGithubModal()
  if (action === 'google') {
    executeGoogleSignIn()
  } else if (action === 'register') {
    mode.value = 'register'
    errorMsg.value = ''
    successMsg.value = ''
  }
}

const switchMode = (newMode: AuthMode) => {
  if (newMode === 'register') {
    promptGithubRecommendation('register')
    return
  }
  mode.value = newMode
  errorMsg.value = ''
  successMsg.value = ''
}

const togglePasswordVisibility = () => {
  showPassword.value = !showPassword.value
}

const toggleConfirmPasswordVisibility = () => {
  showConfirmPassword.value = !showConfirmPassword.value
}

const handleFirebaseError = (err: any) => {
  const code = err?.code || ''
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      errorMsg.value = t('err_credenciales_invalidas')
      break
    case 'auth/email-already-in-use':
      errorMsg.value = t('err_correo_en_uso')
      break
    case 'auth/weak-password':
      errorMsg.value = t('err_contrasena_debil')
      break
    case 'auth/invalid-email':
      errorMsg.value = t('err_correo_invalido')
      break
    case 'auth/too-many-requests':
      errorMsg.value = t('err_demasiados_intentos')
      break
    case 'auth/network-request-failed':
      errorMsg.value = t('err_conexion')
      break
    case 'auth/user-disabled':
      errorMsg.value = t('err_cuenta_inhabilitada')
      break
    case 'auth/popup-blocked':
      errorMsg.value = 'La ventana emergente de autenticación fue bloqueada por el navegador.'
      break
    case 'auth/account-exists-with-different-credential':
      errorMsg.value = 'Ya existe una cuenta con este correo utilizando otro método de inicio.'
      break
    default:
      errorMsg.value = err?.message || t('err_generico')
  }
}

const handleSubmit = async () => {
  errorMsg.value = ''
  successMsg.value = ''

  const cleanEmail = email.value.trim()
  if (!cleanEmail) {
    errorMsg.value = t('err_correo_invalido')
    return
  }

  // ── Flujo: Recuperación de contraseña ──
  if (mode.value === 'forgot') {
    loading.value = true
    try {
      const methods = await fetchSignInMethodsForEmail(auth, cleanEmail).catch(() => [] as string[])
      
      if (methods.includes('github.com') && !methods.includes('password')) {
        errorMsg.value = t('cuenta_con_github')
        return
      }
      if (methods.includes('google.com') && !methods.includes('password')) {
        errorMsg.value = t('cuenta_con_google')
        return
      }

      await sendPasswordResetEmail(auth, cleanEmail)
      successMsg.value = t('recuperacion_enviada')
    } catch (err: any) {
      handleFirebaseError(err)
    } finally {
      loading.value = false
    }
    return
  }

  // ── Flujo: Registro con Email ──
  if (mode.value === 'register') {
    const cleanName = name.value.trim()
    if (!cleanName) {
      errorMsg.value = t('err_nombre_requerido')
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMsg.value = t('err_contrasenas_no_coinciden')
      return
    }
    if (password.value.length < 6) {
      errorMsg.value = t('err_contrasena_debil')
      return
    }

    loading.value = true
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password.value)
      await updateProfile(userCredential.user, {
        displayName: cleanName,
      })
    } catch (err: any) {
      handleFirebaseError(err)
    } finally {
      loading.value = false
    }
    return
  }

  // ── Flujo: Iniciar sesión con Email ──
  loading.value = true
  try {
    await signInWithEmailAndPassword(auth, cleanEmail, password.value)
  } catch (err: any) {
    const code = err?.code
    if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
      const methods = await fetchSignInMethodsForEmail(auth, cleanEmail).catch(() => [] as string[])
      if (methods.includes('github.com') && !methods.includes('password')) {
        errorMsg.value = t('cuenta_con_github')
        return
      }
      if (methods.includes('google.com') && !methods.includes('password')) {
        errorMsg.value = t('cuenta_con_google')
        return
      }
    }
    handleFirebaseError(err)
  } finally {
    loading.value = false
  }
}

// ── Iniciar con Google ──
const onGoogleClick = () => {
  promptGithubRecommendation('google')
}

const executeGoogleSignIn = async (targetEmail?: string) => {
  errorMsg.value = ''
  successMsg.value = ''
  loading.value = true
  try {
    const provider = new GoogleAuthProvider()
    const hint = typeof targetEmail === 'string' && targetEmail.trim() ? targetEmail.trim() : email.value.trim()
    if (hint) {
      provider.setCustomParameters({ login_hint: hint, prompt: 'select_account' })
    } else {
      provider.setCustomParameters({ prompt: 'select_account' })
    }
    await signInWithPopup(auth, provider)
  } catch (err: any) {
    if (err.code !== 'auth/popup-closed-by-user') {
      handleFirebaseError(err)
    }
  } finally {
    loading.value = false
  }
}

// ── Iniciar / Registrar con GitHub ──
const signInWithGithub = async () => {
  errorMsg.value = ''
  successMsg.value = ''
  loading.value = true
  try {
    const provider = new GithubAuthProvider()
    provider.addScope('read:user')
    provider.addScope('repo')
    const result = await signInWithPopup(auth, provider)
    const credential = GithubAuthProvider.credentialFromResult(result)
    if (credential?.accessToken) {
      setGithubToken(credential.accessToken, result.user.uid)
    }
  } catch (err: any) {
    if (err.code !== 'auth/popup-closed-by-user') {
      if (err.code === 'auth/account-exists-with-different-credential') {
        errorMsg.value = 'Ya existe una cuenta con este correo utilizando otro método de inicio.'
      } else {
        errorMsg.value = t('err_github_auth')
      }
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="split-layout">
    <!-- Panel Izquierdo: Fondo azul limpio con dev->flow centrado sin animaciones ni colores -->
    <div class="hero-panel">
      <div class="hero-content">
        <img :src="logo" alt="dev->flow" class="hero-logo" />
      </div>
    </div>

    <!-- Panel Derecho: Formulario Compacto y Elegante -->
    <div class="form-panel">
      <!-- Selector de idioma -->
      <div class="lang-switch-top">
        <div class="lang-toggle-capsule">
          <button
            class="lang-pill"
            :class="{ active: locale === 'es' }"
            type="button"
            @click="setLocale('es')"
          >
            ES
          </button>
          <button
            class="lang-pill"
            :class="{ active: locale === 'en' }"
            type="button"
            @click="setLocale('en')"
          >
            EN
          </button>
        </div>
      </div>

      <div class="login-card">
        <div class="card-header">
          <h2 class="card-title">
            <template v-if="mode === 'login'">{{ t('iniciar_sesion') }}</template>
            <template v-else-if="mode === 'register'">{{ t('crear_cuenta') }}</template>
            <template v-else>{{ t('recuperar_contrasena') }}</template>
          </h2>
          <p v-if="mode === 'forgot'" class="card-subtitle">
            {{ t('instrucciones_recuperacion') }}
          </p>
        </div>

        <form @submit.prevent="handleSubmit" class="login-form" novalidate>
          <!-- Campo Nombre (solo en registro) -->
          <div v-if="mode === 'register'" class="input-group">
            <input
              id="name"
              v-model="name"
              type="text"
              autocomplete="name"
              required
              placeholder=" "
              :disabled="loading"
            />
            <label for="name">{{ t('nombre_completo') }}</label>
          </div>

          <!-- Campo Email -->
          <div class="input-group">
            <input
              id="email"
              v-model="email"
              type="email"
              autocomplete="email"
              required
              placeholder=" "
              :disabled="loading"
            />
            <label for="email">{{ t('correo_electronico') }}</label>
          </div>

          <!-- Campo Contraseña (en login y registro) -->
          <div v-if="mode !== 'forgot'" class="input-group has-trailing-btn">
            <input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              required
              placeholder=" "
              :disabled="loading"
            />
            <label for="password">{{ t('contrasena') }}</label>
            <button
              type="button"
              class="field-action-btn"
              @click="togglePasswordVisibility"
              :title="showPassword ? t('ocultar_contrasena') : t('mostrar_contrasena')"
              tabindex="-1"
            >
              <svg v-if="showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>

          <!-- Olvidaste contraseña (en modo login) -->
          <div v-if="mode === 'login'" class="forgot-wrapper">
            <button
              type="button"
              class="link-forgot"
              @click="switchMode('forgot')"
              :disabled="loading"
            >
              {{ t('olvidaste_contrasena') }}
            </button>
          </div>

          <!-- Campo Confirmar Contraseña (solo en registro) -->
          <div v-if="mode === 'register'" class="input-group has-trailing-btn">
            <input
              id="confirmPassword"
              v-model="confirmPassword"
              :type="showConfirmPassword ? 'text' : 'password'"
              autocomplete="new-password"
              required
              placeholder=" "
              :disabled="loading"
            />
            <label for="confirmPassword">{{ t('confirmar_contrasena') }}</label>
            <button
              type="button"
              class="field-action-btn"
              @click="toggleConfirmPasswordVisibility"
              :title="showConfirmPassword ? t('ocultar_contrasena') : t('mostrar_contrasena')"
              tabindex="-1"
            >
              <svg v-if="showConfirmPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>

          <!-- Mensajes de Error y Éxito -->
          <div v-if="errorMsg" class="feedback-banner error-banner">
            <svg viewBox="0 0 24 24" fill="currentColor" class="alert-icon">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
            <div class="banner-text">
              <span>{{ errorMsg }}</span>
              <!-- Si el usuario intentó recuperar contraseña o login con Google / GitHub -->
              <div v-if="errorMsg === t('cuenta_con_google')" class="banner-quick-action">
                <button type="button" class="btn-banner-link" @click="executeGoogleSignIn()">
                  <svg viewBox="0 0 24 24" class="inline-svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span>{{ t('iniciar_directo_google') }}</span>
                </button>
              </div>
              <div v-else-if="errorMsg === t('cuenta_con_github')" class="banner-quick-action">
                <button type="button" class="btn-banner-link" @click="signInWithGithub()">
                  <svg viewBox="0 0 24 24" class="inline-svg" fill="currentColor">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                  </svg>
                  <span>{{ t('iniciar_directo_github') }}</span>
                </button>
              </div>
            </div>
          </div>

          <div v-if="successMsg" class="feedback-banner success-banner">
            <svg viewBox="0 0 24 24" fill="currentColor" class="alert-icon">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <div class="banner-text">
              <span>{{ successMsg }}</span>
              <p v-if="mode === 'forgot'" class="banner-subtip">
                {{ t('aviso_recuperacion_con_google') }}
              </p>
              <div v-if="mode === 'forgot'" class="banner-quick-actions-row">
                <button type="button" class="btn-banner-link" @click="executeGoogleSignIn()">
                  <svg viewBox="0 0 24 24" class="inline-svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span>Google</span>
                </button>
                <button type="button" class="btn-banner-link" @click="signInWithGithub()">
                  <svg viewBox="0 0 24 24" class="inline-svg" fill="currentColor">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                  </svg>
                  <span>GitHub</span>
                </button>
              </div>
            </div>
          </div>

          <!-- FILA PRINCIPAL: GOOGLE (SOLO ICONO Y PALABRA) - BOTÓN SUBMIT (OUTLINE AZUL) - GITHUB (SOLO ICONO Y PALABRA) -->
          <div v-if="mode !== 'forgot'" class="actions-trio-row">
            <!-- Google: Solo icono y palabra -->
            <button
              type="button"
              class="plain-oauth-action"
              @click="onGoogleClick()"
              :disabled="loading"
              title="Google"
            >
              <svg viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>Google</span>
            </button>

            <!-- Botón Iniciar sesión / Registrar con fondo transparente, bordes azules y texto azul -->
            <button
              type="submit"
              class="btn-outline-blue btn-submit-compact"
              :disabled="loading"
            >
              <span v-if="loading" class="spinner-blue"></span>
              <span v-else>
                <template v-if="mode === 'login'">{{ t('iniciar_sesion') }}</template>
                <template v-else>{{ t('crear_cuenta') }}</template>
              </span>
            </button>

            <!-- GitHub: Solo icono y palabra -->
            <button
              type="button"
              class="plain-oauth-action"
              @click="signInWithGithub()"
              :disabled="loading"
              title="GitHub"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
              <span>GitHub</span>
            </button>
          </div>

          <!-- Botón de submit cuando está en modo 'forgot' -->
          <button
            v-else
            type="submit"
            class="btn-outline-blue btn-submit-full"
            :disabled="loading"
          >
            <span v-if="loading" class="spinner-blue"></span>
            <span v-else>{{ t('enviar_enlace') }}</span>
          </button>
        </form>

        <!-- Toggle entre Modos -->
        <div class="toggle-container">
          <template v-if="mode === 'login'">
            <span class="toggle-text">{{ t('no_tienes_cuenta') }}</span>
            <button type="button" class="link-btn" @click="switchMode('register')" :disabled="loading">
              {{ t('registrate') }}
            </button>
          </template>

          <template v-else-if="mode === 'register'">
            <span class="toggle-text">{{ t('ya_tienes_cuenta') }}</span>
            <button type="button" class="link-btn" @click="switchMode('login')" :disabled="loading">
              {{ t('inicia_sesion') }}
            </button>
          </template>

          <template v-else>
            <button type="button" class="link-btn back-btn" @click="switchMode('login')" :disabled="loading">
              ← {{ t('volver_a_login') }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- MODAL ELEGANTE: AVISO DE INICIAR / REGISTRARSE CON GITHUB -->
    <div
      v-if="showGithubModal"
      class="rec-modal-overlay"
      @click="closeGithubModal"
    >
      <div class="rec-modal-card" @click.stop>
        <button class="rec-modal-close" @click="closeGithubModal" title="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>

        <div class="rec-icon-wrapper">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
          </svg>
        </div>

        <h3 class="rec-title">{{ t('rec_github_title') }}</h3>
        <p class="rec-desc">{{ t('rec_github_desc') }}</p>

        <div class="rec-actions">
          <button type="button" class="btn-rec-github" @click="proceedWithGithub">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
            </svg>
            {{ t('rec_github_btn') }}
          </button>

          <button type="button" class="btn-rec-fallback" @click="proceedWithOriginalAction">
            {{ pendingAction === 'google' ? t('rec_google_btn') : t('rec_register_btn') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.split-layout {
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  animation: fadeIn 0.4s ease-out;
  background: var(--bg);
  overflow: hidden;
}

@media (max-width: 900px) {
  .split-layout {
    grid-template-columns: 1fr;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
}

/* ── Panel Izquierdo: Fondo Azul con dev->flow en el centro sin colores ni animaciones ── */
.hero-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0f172a, #1e3a5f);
  padding: 3rem 2rem;
  color: #fff;
}

.hero-content {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  max-width: 380px;
}

.hero-logo {
  width: 230px;
  max-width: 85%;
  height: auto;
  object-fit: contain;
  filter: brightness(0) invert(1);
  opacity: 0.95;
}

/* ── Panel Derecho: Formulario ── */
.form-panel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3rem 2rem;
  background: var(--bg);
}

.lang-switch-top {
  position: absolute;
  top: 1.4rem;
  right: 1.8rem;
  z-index: 10;
}

.lang-toggle-capsule {
  display: flex;
  align-items: center;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 2px;
  gap: 2px;
}

.lang-pill {
  background: transparent;
  border: none;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text);
  opacity: 0.6;
  cursor: pointer;
  padding: 3px 9px;
  border-radius: 14px;
  transition: all 0.2s ease;
}

.lang-pill:hover {
  opacity: 1;
  color: var(--text-h);
}

.lang-pill.active {
  background: var(--accent);
  color: #fff;
  opacity: 1;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

/* ── Contenedor compacto del Formulario (Ancho reducido a 320px) ── */
.login-card {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  animation: slideUp 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

.card-header {
  margin-bottom: 1.6rem;
}

.card-title {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 700;
  color: var(--text-h);
  letter-spacing: -0.4px;
}

.card-subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  color: var(--text);
  opacity: 0.75;
  line-height: 1.35;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* ── Inputs estilizados (Bordes reducidos y radios suaves de 6px) ── */
.input-group {
  position: relative;
  display: flex;
  flex-direction: column;
}

.input-group input {
  width: 100%;
  padding: 0.72rem 0.8rem;
  font-size: 0.85rem;
  font-family: inherit;
  color: var(--text-h);
  background: var(--code-bg);
  border: 1.2px solid var(--border);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  box-sizing: border-box;
}

.input-group input:hover:not(:disabled) {
  border-color: rgba(59, 130, 246, 0.45);
}

.input-group input:focus {
  border-color: var(--accent);
  background: var(--bg);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
}

.input-group input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.input-group label {
  position: absolute;
  top: 0.72rem;
  left: 0.8rem;
  font-size: 0.82rem;
  color: var(--text);
  opacity: 0.65;
  pointer-events: none;
  transform-origin: left top;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.input-group input:focus + label,
.input-group input:not(:placeholder-shown) + label {
  transform: translateY(-1.3rem) scale(0.82);
  color: var(--accent);
  opacity: 1;
  font-weight: 600;
  background: var(--bg);
  padding: 0 4px;
}

.input-group.has-trailing-btn input {
  padding-right: 2.4rem;
}

.field-action-btn {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  opacity: 0.5;
  cursor: pointer;
  border-radius: 4px;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.field-action-btn:hover {
  opacity: 1;
  color: var(--accent);
}

.field-action-btn svg {
  width: 16px;
  height: 16px;
}

.forgot-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: -0.4rem;
  margin-bottom: 0.1rem;
}

.link-forgot {
  background: transparent;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 0.74rem;
  color: var(--accent);
  cursor: pointer;
  opacity: 0.9;
  transition: opacity 0.15s ease, text-decoration 0.15s ease;
}

.link-forgot:hover {
  opacity: 1;
  text-decoration: underline;
}

/* ── Banners de Error y Éxito ── */
.feedback-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.65rem 0.75rem;
  border-radius: 6px;
  font-size: 0.75rem;
  line-height: 1.35;
  animation: shake 0.3s ease-in-out;
}

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #ef4444;
}

.success-banner {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.25);
  color: #16a34a;
  animation: fadeIn 0.3s ease-out;
}

.alert-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  margin-top: 1px;
}

.banner-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.banner-subtip {
  margin: 0;
  font-size: 0.7rem;
  opacity: 0.85;
}

.banner-quick-actions-row,
.banner-quick-action {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.2rem;
}

.btn-banner-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.55rem;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-banner-link:hover {
  background: rgba(0, 0, 0, 0.05);
}

.inline-svg {
  width: 13px;
  height: 13px;
}

/* ── Fila de Acciones: Google a la izquierda, Iniciar Sesión al centro, GitHub a la derecha ── */
.actions-trio-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-top: 0.5rem;
  width: 100%;
}

/* Botón Iniciar Sesión: Fondo transparente, borde azul, texto azul */
.btn-outline-blue {
  background: transparent !important;
  color: var(--accent) !important;
  border: 1.5px solid var(--accent) !important;
  border-radius: 6px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.btn-submit-compact {
  flex: 1 1 auto;
  min-width: 110px;
  padding: 0.62rem 0.75rem;
  font-size: 0.8rem;
}

.btn-submit-full {
  width: 100%;
  padding: 0.68rem 1rem;
  font-size: 0.84rem;
  margin-top: 0.4rem;
}

.btn-outline-blue:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.08) !important;
  border-color: var(--accent) !important;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.18);
}

.btn-outline-blue:active:not(:disabled) {
  transform: translateY(0);
  background: rgba(59, 130, 246, 0.14) !important;
}

.btn-outline-blue:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* Botones Google y GitHub: Sin caja contenedora, solo icono y palabra */
.plain-oauth-action {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  border: none;
  padding: 0.45rem 0.35rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-h);
  cursor: pointer;
  border-radius: 4px;
  opacity: 0.85;
  transition: opacity 0.15s ease, transform 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.plain-oauth-action:hover:not(:disabled) {
  opacity: 1;
  color: var(--accent);
  transform: translateY(-1px);
}

.plain-oauth-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.plain-oauth-action svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

/* Spinner azul para botón con outline */
.spinner-blue {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(59, 130, 246, 0.25);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* ── Toggle entre Modos ── */
.toggle-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin-top: 1.5rem;
  font-size: 0.77rem;
}

.toggle-text {
  color: var(--text);
  opacity: 0.75;
}

.link-btn {
  background: transparent;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 0.77rem;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
  transition: opacity 0.15s ease, text-decoration 0.15s ease;
}

.link-btn:hover {
  text-decoration: underline;
  opacity: 0.9;
}

.link-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.back-btn {
  color: var(--text);
  opacity: 0.7;
}

.back-btn:hover {
  opacity: 1;
  color: var(--accent);
}

/* ── MODAL: AVISO DE INICIAR / REGISTRARSE CON GITHUB ── */
.rec-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  z-index: 1000;
  animation: fadeIn 0.25s ease-out;
}

.rec-modal-card {
  position: relative;
  background: #090d16;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 2rem 1.8rem 1.6rem;
  max-width: 380px;
  width: 100%;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.rec-modal-close {
  position: absolute;
  top: 0.8rem;
  right: 0.8rem;
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 0.9rem;
  cursor: pointer;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  transition: color 0.15s;
}

.rec-modal-close:hover {
  color: #e2e8f0;
}

.rec-icon-wrapper {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.1rem;
  color: #fff;
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.08);
}

.rec-icon-wrapper svg {
  width: 28px;
  height: 28px;
}

.rec-title {
  margin: 0 0 0.55rem;
  font-size: 1.15rem;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: -0.3px;
}

.rec-desc {
  margin: 0 0 1.5rem;
  font-size: 0.78rem;
  color: #94a3b8;
  line-height: 1.45;
}

.rec-actions {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  width: 100%;
}

.btn-rec-github {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.7rem;
  background: #24292f;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
}

.btn-rec-github svg {
  width: 17px;
  height: 17px;
}

.btn-rec-github:hover {
  background: #0f1419;
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}

.btn-rec-fallback {
  background: transparent;
  border: none;
  color: #94a3b8;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.4rem;
  transition: color 0.15s;
}

.btn-rec-fallback:hover {
  color: #e2e8f0;
  text-decoration: underline;
}

/* ── Animaciones ── */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

/* Responsive adjustment for small screens */
@media (max-width: 900px) {
  .hero-panel {
    padding: 2.5rem 1.5rem;
  }
  .hero-logo {
    width: 180px;
  }
  .form-panel {
    padding: 2.5rem 1.5rem 3.5rem;
  }
}
</style>
