<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  ticketId: string | null
}>()

const emit = defineEmits<{
  confirm: [ticketId: string, hasError: boolean]
  cancel: []
}>()

const hasError = ref(false)

function confirm() {
  if (props.ticketId) emit('confirm', props.ticketId, hasError.value)
  hasError.value = false
}

function cancel() {
  hasError.value = false
  emit('cancel')
}
</script>

<template>
  <div class="close-confirm-overlay" @click="cancel"></div>
  <div class="close-confirm" @click.stop>
    <div class="close-confirm-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:#22c55e">
        <circle cx="12" cy="12" r="10"/><polyline points="16 10 11 15 8 12"/>
      </svg>
      <span>Ticket completado</span>
    </div>
    <p class="close-confirm-text">¿Seguro que desea cerrarlo?</p>
    <label class="close-confirm-check">
      <input type="checkbox" v-model="hasError" />
      <span>Hubo un error — crear ticket relacionado</span>
    </label>
    <div class="close-confirm-actions">
      <button class="edit-btn-cancel" @click="cancel">Cancelar</button>
      <button class="close-confirm-btn" @click="confirm">
        {{ hasError ? 'Crear ticket' : 'Confirmar' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.close-confirm-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 100; }
.close-confirm {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 100; background: var(--card-bg); border: 1px solid var(--border);
  border-radius: 12px; padding: 1.25rem; min-width: 280px;
  animation: fadeIn 0.15s ease-out; display: flex; flex-direction: column; gap: 0.75rem;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.close-confirm-header { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; font-weight: 700; color: var(--text-h); }
.close-confirm-text { margin: 0; font-size: 0.85rem; color: var(--text); }
.close-confirm-check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text); cursor: pointer; }
.close-confirm-check input { width: 16px; height: 16px; cursor: pointer; }
.close-confirm-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.25rem; }
.close-confirm-btn {
  padding: 0.4rem 1rem; border: none; background: #22c55e; color: #fff;
  font: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer;
  border-radius: 8px; transition: background 0.15s;
}
.close-confirm-btn:hover { background: #16a34a; }
.edit-btn-cancel { padding: 0.5rem 1rem; border: 1.5px solid var(--border); font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer; background: transparent; color: var(--text); }
.edit-btn-cancel:hover { background: var(--code-bg); color: var(--text-h); }
</style>
