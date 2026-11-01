export const WEEK_DAYS = [
  { key: '1', label: 'Segunda-feira', short: 'Segunda' },
  { key: '2', label: 'Terça-feira', short: 'Terça' },
  { key: '3', label: 'Quarta-feira', short: 'Quarta' },
  { key: '4', label: 'Quinta-feira', short: 'Quinta' },
  { key: '5', label: 'Sexta-feira', short: 'Sexta' },
  { key: '6', label: 'Sábado', short: 'Sábado' },
  { key: '7', label: 'Domingo', short: 'Domingo' },
] as const

export type ScheduleMode = 'horarios_fixos' | 'carga_semanal'
export interface WorkPeriod { inicio: string; fim: string }
export interface WorkScheduleDay { ativo: boolean; periodos: WorkPeriod[]; minutos: number }
export type WorkScheduleWeek = Record<string, WorkScheduleDay>

export function createEmptyScheduleWeek(): WorkScheduleWeek {
  return Object.fromEntries(WEEK_DAYS.map(({ key }) => [key, { ativo: false, periodos: [], minutos: 0 }]))
}

export function timeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export function minutesToTimeParts(total: number) {
  const normalized = Math.max(0, Math.trunc(total))
  return { hours: Math.floor(normalized / 60), minutes: normalized % 60 }
}

export function formatDuration(total: number): string {
  const { hours, minutes } = minutesToTimeParts(total)
  return `${hours}h${String(minutes).padStart(2, '0')}`
}

export function periodMinutes(period: WorkPeriod): number {
  const start = timeToMinutes(period.inicio)
  const end = timeToMinutes(period.fim)
  return start !== null && end !== null && end > start ? end - start : 0
}

export function scheduleWeeklyMinutes(mode: ScheduleMode, days: WorkScheduleWeek): number {
  return Object.values(days).reduce((total, day) => total + (day.ativo
    ? mode === 'horarios_fixos'
      ? day.periodos.reduce((sum, period) => sum + periodMinutes(period), 0)
      : Math.max(0, Math.trunc(day.minutos || 0))
    : 0), 0)
}

export function distributeWeeklyMinutes(total: number, activeKeys: string[]): Record<string, number> {
  const keys = [...new Set(activeKeys)].sort((a, b) => Number(a) - Number(b))
  if (!keys.length || total < 0) return Object.fromEntries(keys.map((key) => [key, 0]))
  const base = Math.floor(total / keys.length)
  let remainder = total % keys.length
  return Object.fromEntries(keys.map((key) => {
    const value = base + (remainder > 0 ? 1 : 0)
    remainder -= remainder > 0 ? 1 : 0
    return [key, value]
  }))
}

export function validateSchedule(mode: ScheduleMode, days: WorkScheduleWeek, weeklyTarget: number): string | null {
  const activeDays = WEEK_DAYS.filter(({ key }) => days[key]?.ativo)
  if (!activeDays.length) return 'Selecione ao menos um dia de trabalho.'

  if (mode === 'carga_semanal') {
    if (!Number.isInteger(weeklyTarget) || weeklyTarget < 1 || weeklyTarget > 10080) return 'Informe uma carga semanal válida.'
    for (const { key, label } of activeDays) {
      const minutes = days[key]?.minutos
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) return `Informe a carga diária de ${label.toLowerCase()}.`
    }
    for (const { key } of WEEK_DAYS.filter(({ key }) => !days[key]?.ativo)) {
      if ((days[key]?.minutos || 0) !== 0) return 'Dias desativados devem ter carga horária igual a zero.'
    }
    if (scheduleWeeklyMinutes(mode, days) !== weeklyTarget) return `A soma dos dias (${formatDuration(scheduleWeeklyMinutes(mode, days))}) precisa corresponder à carga semanal (${formatDuration(weeklyTarget)}).`
    return null
  }

  for (const { key, label } of activeDays) {
    const periods = days[key]?.periodos || []
    if (periods.length < 1 || periods.length > 4) return `${label} deve ter de um a quatro períodos de trabalho.`
    let previousEnd = -1
    for (const period of periods) {
      const start = timeToMinutes(period.inicio)
      const end = timeToMinutes(period.fim)
      if (start === null || end === null) return `Preencha os horários de ${label.toLowerCase()} no formato HH:MM.`
      if (end <= start) return `O fim de cada período de ${label.toLowerCase()} deve ser posterior ao início.`
      if (start < previousEnd) return `Os períodos de ${label.toLowerCase()} não podem se sobrepor e devem estar em ordem.`
      previousEnd = end
    }
  }
  return null
}
