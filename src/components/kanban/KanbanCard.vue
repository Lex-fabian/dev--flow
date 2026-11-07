<script setup lang="ts">
import type { Ticket } from '../../types/ticket'
import { auth } from '../../firebase'

const props = defineProps<{
  ticket: Ticket
  isDragging: boolean
  isSelected?: boolean
  isOverdue?: boolean
  hasBlockers: boolean
  commentCount: number
  formatDate: (ts: number | null) => string
  assignedMemberName: string | undefined
  assignedMemberInitial: string | undefined
}>()

const emit = defineEmits<{
  'card-mouse-down': [e: MouseEvent, ticketId: string]
  'dblclick': [ticket: Ticket]
  'toggle-menu': [e: MouseEvent, ticket: Ticket]
  'close': [ticketId: string]
  'open-comments': [ticket: Ticket]
}>()
</script>

<template>
  <div
    class="kanban-card"
    :class="[
      'card--' + ticket.priority,
      {
        'kanban-card--dragging': isDragging,
        'kanban-card--selected': isSelected,
        'kanban-card--overdue': isOverdue
      }
    ]"
    @mousedown="emit('card-mouse-down', $event, ticket.id)"
    @dblclick="emit('dblclick', ticket)"
  >
    <div v-if="isOverdue" class="kanban-card-top">
      <span class="overdue-tag">Vencido</span>
    </div>
    <p class="kanban-title">{{ ticket.title }}</p>
    <p v-if="ticket.description" class="kanban-desc">{{ ticket.description }}</p>
    <div v-if="ticket.startDate || ticket.endDate" class="kanban-dates" :class="{ 'text-overdue': isOverdue }">
      {{ formatDate(ticket.startDate) }}{{ ticket.startDate && ticket.endDate ? ' → ' : '' }}{{ formatDate(ticket.endDate) }}
    </div>
    <div class="kanban-card-footer">
      <div v-if="ticket.assignedTo" class="card-assignee" :title="assignedMemberName || ticket.assignedToEmail || ''">
        <span class="card-assignee-avatar">{{ assignedMemberInitial || '?' }}</span>
      </div>
      <div v-if="ticket.gitCommits && ticket.gitCommits.length > 0" class="card-git-badge" :title="ticket.gitCommits.length + ' commit(s) vinculados'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px"><circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/></svg>
        <span>{{ ticket.gitCommits.length }}</span>
      </div>
      <div v-if="hasBlockers" class="card-blocked-warning" title="Dependencias pendientes">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
      </div>
    </div>
    <button class="card-more-btn" @click.stop="emit('toggle-menu', $event, ticket)" title="Más opciones">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
    </button>
    <button
      v-if="ticket.status === 'completado' && (!ticket.createdBy || ticket.createdBy === auth.currentUser?.uid)"
      class="card-close-btn"
      @click.stop="emit('close', ticket.id)"
      title="Cerrar ticket"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:14px;height:14px"><polyline points="20 6 9 17 4 12"/></svg>
    </button>
  </div>
</template>

<style scoped>
.kanban-card {
  position: relative; background: transparent; border: none;
  border-bottom: 1px solid var(--border);
  padding: 0.55rem 0.65rem; display: flex; flex-direction: column; gap: 0.22rem;
  height: 104px; box-sizing: border-box; flex-shrink: 0;
  cursor: grab; border-radius: 0; overflow: hidden;
  transition: background 0.15s;
  margin-left: 0;
}
.kanban-card:hover { background: var(--code-bg); box-shadow: none; transform: none; }
.kanban-card:active { cursor: grabbing; }
.kanban-card--dragging {
  opacity: 0.85 !important; background: var(--code-bg) !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important; pointer-events: none !important;
}
.kanban-card--selected {
  background: var(--accent-bg) !important;
  box-shadow: none !important;
}
.kanban-card--overdue {
  background: rgba(239, 68, 68, 0.04) !important;
}
.kanban-card-top {
  display: flex; align-items: center; gap: 0.3rem;
}
.overdue-tag {
  font-size: 0.55rem; font-weight: 700; color: #ef4444; background: rgba(239, 68, 68, 0.12);
  padding: 1px 4px; border-radius: 3px;
}
.text-overdue {
  color: #ef4444 !important; opacity: 1 !important; font-weight: 600;
}
.card--urgent { border-left: 3px solid #ef4444; }
.card--high { border-left: 3px solid #f97316; }
.card--medium { border-left: 3px solid #3b82f6; }
.card--low { border-left: 3px solid var(--border); }
.kanban-prio { font-size: 0.55rem; font-weight: 600; padding: 1px 5px; align-self: flex-start; }
.kanban-title {
  font-size: 0.78rem; font-weight: 600; color: var(--text-h); margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 1.5rem;
}
.kanban-desc {
  font-size: 0.7rem; color: var(--text); margin: 0; line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.85;
}
.kanban-dates {
  font-size: 0.6rem; color: var(--text); opacity: 0.7;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.kanban-card-footer { display: flex; align-items: center; gap: 0.25rem; margin-top: auto; }
.card-assignee { display: flex; align-items: center; }
.card-git-badge {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 0.6rem; font-weight: 600; color: var(--text-h);
  background: var(--code-bg); border: 1px solid var(--border);
  border-radius: 4px; padding: 1px 4px; line-height: 1;
}
.card-assignee-avatar {
  width: 20px; height: 20px; border-radius: 50%; background: var(--accent);
  color: #fff; font-size: 0.55rem; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.card-blocked-warning { color: #ef4444; opacity: 0.7; display: flex; align-items: center; }
.card-more-btn {
  position: absolute; top: 0.3rem; right: 0.3rem;
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  background: var(--code-bg); border: 1px solid var(--border);
  color: var(--text); cursor: pointer; opacity: 0.6;
  transition: opacity 0.15s, background 0.15s; padding: 0; border-radius: 4px;
}
.kanban-card:hover .card-more-btn { opacity: 1; }
.card-more-btn:hover { opacity: 1 !important; color: var(--accent); border-color: var(--accent); }
.card-comment-badge {
  display: flex; align-items: center; gap: 0.2rem;
  font-size: 0.6rem; color: var(--text); opacity: 0.6; margin-top: 0.15rem;
  cursor: pointer; transition: opacity 0.15s, color 0.15s;
}
.card-comment-badge:hover { opacity: 1; color: var(--accent); }
.card-close-btn {
  position: absolute; bottom: 0.3rem; right: 0.3rem;
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.3); color: #22c55e;
  cursor: pointer; border-radius: 50%; opacity: 0;
  transition: opacity 0.15s, background 0.15s; padding: 0;
}
.kanban-card:hover .card-close-btn { opacity: 1; }
.card-close-btn:hover { background: rgba(34,197,94,0.25); }
</style>
