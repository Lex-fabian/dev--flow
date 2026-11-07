<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  modelValue: { start: string | null; end: string | null }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: { start: string | null; end: string | null }]
}>()

const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const dayNames = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá']

const show = ref(false)
const viewDate = ref(new Date())
const tempStart = ref<string | null>(null)
const tempEnd = ref<string | null>(null)
const activeField = ref<'start' | 'end'>('start')

function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function displayDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function buildCalendarDays(date: Date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const days: { date: string; day: number; current: boolean }[] = []
  const pad = first.getDay()
  for (let i = pad - 1; i >= 0; i--) {
    const d = new Date(year, month, -i)
    days.push({ date: fmtDate(d), day: d.getDate(), current: false })
  }
  for (let i = 1; i <= last.getDate(); i++) {
    const d = new Date(year, month, i)
    days.push({ date: fmtDate(d), day: i, current: true })
  }
  return days
}

const calendarDays = computed(() => buildCalendarDays(viewDate.value))

function open() {
  tempStart.value = props.modelValue.start || null
  tempEnd.value = props.modelValue.end || props.modelValue.start || null
  activeField.value = 'start'
  viewDate.value = props.modelValue.start ? new Date(props.modelValue.start + 'T12:00:00') : new Date()
  show.value = true
}

function apply() {
  let s = tempStart.value
  let e = tempEnd.value
  if (s && !e) e = s
  if (s && e && e < s) e = s
  emit('update:modelValue', { start: s, end: e })
  show.value = false
}

function cancel() {
  show.value = false
}

function pickDay(date: string) {
  if (activeField.value === 'start') {
    tempStart.value = date
    if (!tempEnd.value || tempEnd.value < date) {
      tempEnd.value = date
    }
    // Pasar automáticamente a seleccionar 'Hasta' para un flujo simple y fluido
    activeField.value = 'end'
  } else {
    if (tempStart.value && date < tempStart.value) {
      tempStart.value = date
      tempEnd.value = date
    } else {
      tempEnd.value = date
    }
  }
}

function isToday(date: string): boolean {
  return date === fmtDate(new Date())
}

function inRange(date: string): boolean {
  if (!tempStart.value || !tempEnd.value) return false
  return date >= tempStart.value && date <= tempEnd.value
}

function isStart(date: string): boolean {
  return tempStart.value === date
}

function isEnd(date: string): boolean {
  return tempEnd.value === date
}

function prevMonth() {
  const d = new Date(viewDate.value)
  d.setMonth(d.getMonth() - 1)
  viewDate.value = d
}

function nextMonth() {
  const d = new Date(viewDate.value)
  d.setMonth(d.getMonth() + 1)
  viewDate.value = d
}

defineExpose({ open, show, displayDate, fmtDate })
</script>

<template>
  <div class="calendar-wrap">
    <div v-if="show" class="calendar-overlay" @click="cancel"></div>
    <button type="button" class="calendar-trigger" @click="open">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <span v-if="!modelValue.start && !modelValue.end" class="placeholder">Seleccionar fecha (Desde / Hasta)</span>
      <span v-else-if="modelValue.start && modelValue.end && modelValue.start === modelValue.end" class="range-text">
        {{ displayDate(modelValue.start) }} (1 día)
      </span>
      <span v-else class="range-text">
        <strong class="label-desde">Desde:</strong> {{ displayDate(modelValue.start) }}
        <span class="range-sep">→</span>
        <strong class="label-hasta">Hasta:</strong> {{ displayDate(modelValue.end || modelValue.start) }}
      </span>
    </button>

    <div v-if="show" class="calendar-popup" @click.stop>
      <!-- Mode Tabs: Desde / Hasta -->
      <div class="cal-mode-tabs">
        <button
          type="button"
          class="cal-mode-btn"
          :class="{ active: activeField === 'start' }"
          @click="activeField = 'start'"
        >
          <span class="mode-tag">Desde</span>
          <span class="mode-val">{{ displayDate(tempStart) || 'Elegir' }}</span>
        </button>

        <span class="cal-mode-arrow">→</span>

        <button
          type="button"
          class="cal-mode-btn"
          :class="{ active: activeField === 'end' }"
          @click="activeField = 'end'"
        >
          <span class="mode-tag">Hasta</span>
          <span class="mode-val">{{ displayDate(tempEnd) || 'Elegir' }}</span>
        </button>
      </div>

      <!-- Quick helper text -->
      <div class="cal-hint-text">
        {{ activeField === 'start' ? 'Toca un día para la fecha de inicio (Desde)' : 'Toca un día para la fecha de entrega (Hasta)' }}
      </div>

      <!-- Header Month Navigation -->
      <div class="cal-header">
        <button type="button" class="cal-nav" @click="prevMonth" title="Mes anterior">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span class="cal-title">{{ monthNames[viewDate.getMonth()] }} {{ viewDate.getFullYear() }}</span>
        <button type="button" class="cal-nav" @click="nextMonth" title="Mes siguiente">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      <div class="cal-weekdays">
        <span v-for="d in dayNames" :key="d" class="cal-weekday">{{ d }}</span>
      </div>

      <div class="cal-grid">
        <button
          v-for="day in calendarDays"
          :key="day.date"
          type="button"
          class="cal-day"
          :class="{
            'cal-day--muted': !day.current,
            'cal-day--today': day.current && isToday(day.date),
            'cal-day--in-range': day.current && inRange(day.date),
            'cal-day--start': day.current && isStart(day.date),
            'cal-day--end': day.current && isEnd(day.date),
          }"
          :disabled="!day.current"
          @click="pickDay(day.date)"
        >{{ day.day }}</button>
      </div>

      <div class="cal-footer">
        <button type="button" class="cal-btn cal-btn--cancel" @click="cancel">Cancelar</button>
        <button type="button" class="cal-btn cal-btn--apply" @click="apply">Aplicar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-wrap { position: relative; }
.calendar-overlay { position: fixed; inset: 0; z-index: 19; }
.calendar-trigger {
  width: 100%; height: 32px; display: flex; align-items: center; gap: 0.45rem;
  padding: 0.25rem 0.55rem;
  background-color: var(--code-bg); border: 1.5px solid var(--border);
  border-radius: 4px;
  font: inherit; font-size: 0.78rem; color: var(--text-h);
  outline: none; cursor: pointer; box-sizing: border-box;
  transition: border-color 0.2s;
}
.calendar-trigger:hover { border-color: var(--accent); }
.calendar-trigger svg { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.7; color: var(--accent); }
.calendar-trigger .placeholder { color: var(--text); opacity: 0.6; }
.calendar-trigger .range-text { font-size: 0.75rem; display: flex; align-items: center; gap: 0.35rem; }
.label-desde, .label-hasta { font-weight: 700; color: var(--text-muted); font-size: 0.68rem; text-transform: uppercase; }
.range-sep { color: var(--accent); font-weight: 700; }

.calendar-popup {
  position: absolute; bottom: calc(100% + 6px); right: 0; left: auto;
  width: 270px; max-width: calc(100vw - 32px);
  background: var(--card-bg); border: 1.5px solid var(--border);
  border-radius: 8px;
  z-index: 200; padding: 0.6rem 0.7rem;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  animation: fadeInUp 0.15s ease-out;
}
@keyframes fadeInUp { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

.cal-mode-tabs {
  display: flex; align-items: center; justify-content: space-between; gap: 0.3rem;
  margin-bottom: 0.35rem;
}

.cal-mode-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 0.3rem 0.4rem; border-radius: 6px;
  background: var(--code-bg); border: 1.5px solid var(--border);
  color: var(--text); cursor: pointer; transition: all 0.15s ease;
}

.cal-mode-btn.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--text-h);
  box-shadow: 0 0 0 1px var(--accent);
}

.mode-tag {
  font-size: 0.58rem; font-weight: 700; text-transform: uppercase;
  color: var(--text-muted); letter-spacing: 0.5px;
}
.cal-mode-btn.active .mode-tag { color: var(--accent); }

.mode-val {
  font-size: 0.72rem; font-weight: 600; margin-top: 1px;
}

.cal-mode-arrow {
  font-size: 0.8rem; font-weight: 700; color: var(--text-muted);
}

.cal-hint-text {
  font-size: 0.64rem; color: var(--text-muted); text-align: center;
  margin-bottom: 0.35rem; font-style: italic;
}

.cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem; }
.cal-title { font-size: 0.78rem; font-weight: 700; color: var(--text-h); }
.cal-nav {
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  background: none; border: none; color: var(--text); cursor: pointer; padding: 2px;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}
.cal-nav:hover { background: var(--accent-bg); color: var(--accent); }
.cal-nav svg { width: 14px; height: 14px; }
.cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; margin-bottom: 0.15rem; }
.cal-weekday { font-size: 0.6rem; font-weight: 600; color: var(--text); opacity: 0.6; padding: 0.15rem 0; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal-day {
  width: 100%; height: 28px; display: flex; align-items: center; justify-content: center;
  border: none; background: none; font: inherit; font-size: 0.76rem; font-weight: 500;
  border-radius: 4px;
  color: var(--text-h); cursor: pointer; transition: background 0.1s, color 0.1s;
}
.cal-day:hover:not(:disabled) { background: var(--accent-bg); }
.cal-day--muted { color: var(--text); opacity: 0.25; cursor: default; }
.cal-day--in-range { background: rgba(37, 99, 235, 0.2) !important; color: var(--text-h) !important; border-radius: 0; font-weight: 600; }
.cal-day--start { background: var(--accent) !important; color: #ffffff !important; font-weight: 700 !important; border-radius: 4px 0 0 4px !important; text-decoration: none !important; }
.cal-day--end { background: var(--accent) !important; color: #ffffff !important; font-weight: 700 !important; border-radius: 0 4px 4px 0 !important; text-decoration: none !important; }
.cal-day--start.cal-day--end { border-radius: 4px !important; }
.cal-day--today:not(.cal-day--start):not(.cal-day--end) { font-weight: 700; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.cal-footer { display: flex; gap: 0.4rem; margin-top: 0.35rem; padding-top: 0.35rem; border-top: 1px solid var(--border); }
.cal-btn {
  flex: 1; height: 22px; line-height: 20px; padding: 0 0.4rem; border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit; font-size: 0.68rem; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
  text-align: center; transition: all 0.15s ease;
}
.cal-btn--cancel { background: transparent; color: var(--text); }
.cal-btn--cancel:hover { background: var(--code-bg); color: var(--text-h); }
.cal-btn--apply { background: var(--accent); border-color: transparent; color: #fff; }
.cal-btn--apply:hover { opacity: 0.9; }
</style>
