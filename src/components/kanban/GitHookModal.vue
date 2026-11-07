<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const activeOsTab = ref<'bash' | 'powershell' | 'download'>('bash')
const copied = ref(false)
const showScriptCode = ref(false)

const bashCmd = `curl -fsSL https://dev-flow-7b197.web.app/hooks/prepare-commit-msg -o .git/hooks/prepare-commit-msg && chmod +x .git/hooks/prepare-commit-msg`
const powershellCmd = `Invoke-WebRequest -Uri "https://dev-flow-7b197.web.app/hooks/prepare-commit-msg" -OutFile ".git/hooks/prepare-commit-msg"`

const rawScript = `#!/bin/sh
# -------------------------------------------------------------
# dev->flow Git Hook: prepare-commit-msg
# Inyecta automáticamente el ID del ticket de la rama activa
# Ejemplo: rama 'feature/DF-5-auth' -> 'mi mensaje [fixes DF-5]'
# -------------------------------------------------------------

COMMIT_MSG_FILE=$1
COMMIT_SOURCE=$2
SHA1=$3

if [ "$COMMIT_SOURCE" = "merge" ] || [ "$COMMIT_SOURCE" = "squash" ]; then
  exit 0
fi

BRANCH_NAME=$(git symbolic-ref --short HEAD 2>/dev/null)
if [ -z "$BRANCH_NAME" ]; then
  exit 0
fi

TICKET_ID=$(echo "$BRANCH_NAME" | grep -o -E '(DF-[0-9]+|[A-Z]{2,10}-[0-9]+)' | head -n 1)

if [ -n "$TICKET_ID" ]; then
  ORIGINAL_MSG=$(cat "$COMMIT_MSG_FILE" 2>/dev/null)
  
  if ! echo "$ORIGINAL_MSG" | grep -q -i "$TICKET_ID"; then
    FIRST_LINE=$(head -n 1 "$COMMIT_MSG_FILE" 2>/dev/null)
    REST_OF_MSG=$(tail -n +2 "$COMMIT_MSG_FILE" 2>/dev/null)
    
    if [ -n "$FIRST_LINE" ]; then
      if [ -n "$REST_OF_MSG" ]; then
        printf "%s [fixes %s]\\n\\n%s" "$FIRST_LINE" "$TICKET_ID" "$REST_OF_MSG" > "$COMMIT_MSG_FILE"
      else
        printf "%s [fixes %s]\\n" "$FIRST_LINE" "$TICKET_ID" > "$COMMIT_MSG_FILE"
      fi
    fi
  fi
fi`

async function copyCommand(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2200)
  } catch (err) {
    console.error('Error al copiar:', err)
  }
}

function downloadHookFile() {
  const blob = new Blob([rawScript], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'prepare-commit-msg'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div v-if="visible" class="hook-modal-overlay" @click="emit('close')">
    <div class="hook-modal-card" @click.stop>
      <div class="hook-modal-header">
        <div class="hook-header-title-row">
          <span class="hook-badge-bolt">⚡</span>
          <div>
            <h3 class="hook-modal-title">Automatización Git en VS Code & Terminal</h3>
            <p class="hook-modal-subtitle">Inyección automática de tickets en cada commit</p>
          </div>
        </div>
        <button class="hook-modal-close" @click="emit('close')" title="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="hook-modal-body">
        <!-- Beneficio explicativo -->
        <div class="hook-banner">
          <p class="hook-banner-text">
            <strong>¿Cómo funciona?</strong> Cuando programas en una rama como <code>feature/DF-5-auth</code>, cada vez que haces un commit desde <strong>VS Code</strong> o la <strong>terminal</strong>, el hook inyecta automáticamente <code>[fixes DF-5]</code>.
          </p>
          <p class="hook-banner-highlight">
            Al hacer <code>git push</code>, dev->flow detecta el commit y mueve la tarjeta a <strong>Completado</strong> de forma 100% automática.
          </p>
        </div>

        <!-- Selector de Sistema / Shell -->
        <div class="hook-tabs">
          <button
            type="button"
            class="hook-tab"
            :class="{ active: activeOsTab === 'bash' }"
            @click="activeOsTab = 'bash'"
          >
            Mac / Linux / Git Bash
          </button>
          <button
            type="button"
            class="hook-tab"
            :class="{ active: activeOsTab === 'powershell' }"
            @click="activeOsTab = 'powershell'"
          >
            Windows (PowerShell)
          </button>
          <button
            type="button"
            class="hook-tab"
            :class="{ active: activeOsTab === 'download' }"
            @click="activeOsTab = 'download'"
          >
            Descarga manual
          </button>
        </div>

        <!-- Tab 1: Bash -->
        <div v-if="activeOsTab === 'bash'" class="hook-cmd-box">
          <span class="hook-step-label">1. Ejecuta este comando en la raíz de tu repositorio:</span>
          <div class="hook-cmd-code-row">
            <code class="hook-code-snippet">{{ bashCmd }}</code>
            <button
              type="button"
              class="btn-copy-hook"
              :class="{ 'is-copied': copied }"
              @click="copyCommand(bashCmd)"
            >
              {{ copied ? '¡Copiado!' : 'Copiar' }}
            </button>
          </div>
        </div>

        <!-- Tab 2: PowerShell -->
        <div v-else-if="activeOsTab === 'powershell'" class="hook-cmd-box">
          <span class="hook-step-label">1. Ejecuta este comando en PowerShell en la raíz de tu repositorio:</span>
          <div class="hook-cmd-code-row">
            <code class="hook-code-snippet">{{ powershellCmd }}</code>
            <button
              type="button"
              class="btn-copy-hook"
              :class="{ 'is-copied': copied }"
              @click="copyCommand(powershellCmd)"
            >
              {{ copied ? '¡Copiado!' : 'Copiar' }}
            </button>
          </div>
        </div>

        <!-- Tab 3: Descarga directa -->
        <div v-else class="hook-cmd-box">
          <span class="hook-step-label">1. Descarga el archivo y cópialo dentro de tu carpeta <code>.git/hooks/</code>:</span>
          <div class="hook-download-row">
            <button type="button" class="btn-download-hook" @click="downloadHookFile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Descargar prepare-commit-msg
            </button>
            <span class="hook-download-hint">Destino: <code>tu-proyecto/.git/hooks/prepare-commit-msg</code></span>
          </div>
        </div>

        <!-- Paso 2: Flujo automático -->
        <div class="hook-workflow-steps">
          <span class="hook-workflow-title">Flujo diario de trabajo:</span>
          <ol class="hook-ol">
            <li>
              Crea tu rama desde el ticket en dev->flow:
              <code>git checkout -b feature/DF-5-nueva-funcion</code>
            </li>
            <li>
              Programa en VS Code y haz commits normales:
              <code>git commit -m "agrega estilos y validaciones"</code>
            </li>
            <li>
              El hook inyectará el ticket:
              <code>agrega estilos y validaciones [fixes DF-5]</code>
            </li>
            <li>
              Al hacer <code>git push</code>, dev->flow detecta el commit y completa el ticket automáticamente.
            </li>
          </ol>
        </div>

        <!-- Ver código del script -->
        <div class="hook-accordion">
          <button
            type="button"
            class="hook-accordion-trigger"
            @click="showScriptCode = !showScriptCode"
          >
            <span>{{ showScriptCode ? 'Ocultar código del script' : 'Ver código de prepare-commit-msg' }}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="accordion-chevron"
              :class="{ rotated: showScriptCode }"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div v-if="showScriptCode" class="hook-script-preview">
            <pre><code>{{ rawScript }}</code></pre>
          </div>
        </div>
      </div>

      <div class="hook-modal-footer">
        <button type="button" class="btn-hook-close" @click="emit('close')">
          Entendido
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hook-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.hook-modal-card {
  width: 100%;
  max-width: 600px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 90vh;
}

.hook-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--code-bg);
}

.hook-header-title-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.hook-badge-bolt {
  font-size: 1.25rem;
  line-height: 1;
}

.hook-modal-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-h);
}

.hook-modal-subtitle {
  margin: 0.1rem 0 0;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.hook-modal-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
}

.hook-modal-close:hover {
  background: var(--border);
  color: var(--text-h);
}

.hook-modal-close svg {
  width: 16px;
  height: 16px;
}

.hook-modal-body {
  padding: 1.25rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.hook-banner {
  background: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(14, 165, 233, 0.25);
  border-radius: 6px;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.hook-banner-text {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-h);
  line-height: 1.45;
}

.hook-banner-text code {
  background: rgba(255, 255, 255, 0.08);
  padding: 0.15rem 0.35rem;
  border-radius: 3px;
  color: var(--accent);
  font-size: 0.76rem;
}

.hook-banner-highlight {
  margin: 0;
  font-size: 0.74rem;
  color: var(--accent);
  font-weight: 500;
}

.hook-banner-highlight code {
  background: rgba(255, 255, 255, 0.08);
  padding: 0.15rem 0.35rem;
  border-radius: 3px;
  color: #fff;
  font-size: 0.72rem;
}

.hook-tabs {
  display: flex;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px;
  gap: 3px;
}

.hook-tab {
  flex: 1;
  background: transparent;
  border: none;
  padding: 0.4rem 0.5rem;
  border-radius: 4px;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s;
}

.hook-tab.active {
  background: var(--card-bg);
  color: var(--text-h);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.hook-cmd-box {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.hook-step-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-h);
}

.hook-step-label code {
  color: var(--accent);
}

.hook-cmd-code-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
}

.hook-code-snippet {
  flex: 1;
  font-size: 0.72rem;
  color: #38bdf8;
  word-break: break-all;
  user-select: all;
  font-family: monospace;
}

.btn-copy-hook {
  padding: 0.3rem 0.65rem;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn-copy-hook:hover {
  opacity: 0.9;
}

.btn-copy-hook.is-copied {
  background: #22c55e;
}

.hook-download-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.btn-download-hook {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.8rem;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-download-hook:hover {
  opacity: 0.9;
}

.hook-download-hint {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.hook-download-hint code {
  color: var(--accent);
}

.hook-workflow-steps {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.hook-workflow-title {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
}

.hook-ol {
  margin: 0;
  padding-left: 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--text-h);
  line-height: 1.4;
}

.hook-ol code {
  background: var(--code-bg);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  color: var(--accent);
  font-size: 0.72rem;
  font-family: monospace;
}

.hook-accordion {
  border-top: 1px dashed var(--border);
  padding-top: 0.75rem;
}

.hook-accordion-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  border: none;
  color: var(--text);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}

.hook-accordion-trigger:hover {
  color: var(--text-h);
}

.accordion-chevron {
  width: 14px;
  height: 14px;
  transition: transform 0.2s ease;
}

.accordion-chevron.rotated {
  transform: rotate(180deg);
}

.hook-script-preview {
  margin-top: 0.5rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.6rem;
  max-height: 180px;
  overflow-y: auto;
}

.hook-script-preview pre {
  margin: 0;
  font-family: monospace;
  font-size: 0.7rem;
  color: #e2e8f0;
  line-height: 1.4;
  white-space: pre-wrap;
}

.hook-modal-footer {
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--border);
  background: var(--code-bg);
  display: flex;
  justify-content: flex-end;
}

.btn-hook-close {
  padding: 0.4rem 1rem;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-hook-close:hover {
  opacity: 0.9;
}
</style>

