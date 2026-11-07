<script setup lang="ts">
defineProps<{
  position: { top: number; left: number }
}>()

const emit = defineEmits<{
  edit: []
  comments: []
  childTicket: []
  copyBranch: []
  copyCommit: []
}>()
</script>

<template>
  <div class="filter-overlay" @click="$emit('edit')"></div>
  <div class="card-menu-floating" :style="{ top: position.top + 'px', left: position.left + 'px' }" @click.stop>
    <button class="card-menu-item" @click="$emit('edit')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Editar
    </button>
    <button class="card-menu-item" @click="$emit('comments')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Comentarios
    </button>
    <button class="card-menu-item" @click="$emit('childTicket')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M12 5v14M5 12h14"/></svg>
      Crear sub-ticket
    </button>
    <div class="card-menu-divider"></div>
    <button class="card-menu-item card-menu-item--git" @click="$emit('copyCommit')" title="Copiar comando de commit para Git / VS Code">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/></svg>
      Copiar commit Git
    </button>
    <button class="card-menu-item card-menu-item--git" @click="$emit('copyBranch')" title="Copiar comando para crear rama de Git">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
      Copiar rama Git
    </button>
  </div>
</template>

<style scoped>
.filter-overlay { position: fixed; inset: 0; z-index: 29; }
.card-menu-floating {
  position: fixed; z-index: 200; width: 190px;
  background: var(--card-bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 4px;
  display: flex; flex-direction: column; gap: 1px;
  animation: fadeIn 0.1s ease-out;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  pointer-events: auto;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.card-menu-item {
  display: flex; align-items: center; gap: 0.45rem;
  padding: 0.4rem 0.6rem; border: none; background: none;
  color: var(--text); font: inherit; font-size: 0.75rem; font-weight: 500;
  cursor: pointer !important; white-space: nowrap; border-radius: 6px;
  transition: background 0.1s, color 0.1s; user-select: none;
}
.card-menu-item:hover { background: var(--accent-bg); color: var(--accent); }
.card-menu-divider {
  height: 1px; background: var(--border); margin: 3px 0;
}
.card-menu-item--git {
  color: var(--text-h);
}
</style>
