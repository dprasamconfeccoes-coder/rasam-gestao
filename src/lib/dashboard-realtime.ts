import { supabase } from './supabase'
import type { ModuleKey } from './types'

export type DashboardLiveEvent = {
  id: string
  title: string
  detail: string
  destination: ModuleKey
  priority: 'urgente' | 'atencao' | 'informacao'
  createdAt: string
}

type LiveCallback = (event: DashboardLiveEvent) => void

const tableMap: Record<string, { title: string; detail: string; destination: ModuleKey; priority: DashboardLiveEvent['priority'] }> = {
  financeiro_lancamentos: { title: 'Movimentação financeira', detail: 'Um lançamento financeiro foi atualizado.', destination: 'financeiro', priority: 'atencao' },
  ordens_servico: { title: 'Ordem de serviço atualizada', detail: 'Uma ordem mudou de status ou prazo.', destination: 'ordens', priority: 'informacao' },
  producao_lotes: { title: 'Produção atualizada', detail: 'Um lote recebeu uma nova movimentação.', destination: 'producao', priority: 'informacao' },
  atestados: { title: 'Novo atestado para análise', detail: 'Um documento de saúde aguarda atenção do RH.', destination: 'atestados', priority: 'atencao' },
  rh_solicitacoes: { title: 'Nova solicitação ao RH', detail: 'Uma solicitação foi criada ou atualizada.', destination: 'solicitacoes', priority: 'atencao' },
  rh_avisos: { title: 'Novo aviso publicado', detail: 'Há um novo comunicado da empresa.', destination: 'avisos', priority: 'informacao' },
  registros_ponto: { title: 'Atualização de ponto', detail: 'Um registro de ponto foi alterado.', destination: 'ponto', priority: 'informacao' },
}

export function subscribeDashboardRealtime(onEvent: LiveCallback) {
  const channel = supabase.channel(`rasam-dashboard-${Math.random().toString(36).slice(2)}`)
  Object.entries(tableMap).forEach(([table, meta]) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const row = (payload.new || payload.old || {}) as { id?: string }
      onEvent({
        id: `${table}-${row.id || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...meta,
        createdAt: new Date().toISOString(),
      })
    })
  })
  channel.subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported' as const
  return Notification.requestPermission()
}

export function showDashboardNotification(event: DashboardLiveEvent) {
  if (getNotificationPermission() !== 'granted') return
  const notification = new Notification(event.title, {
    body: event.detail,
    tag: `rasam-${event.destination}`,
    icon: '/brand/rf-logo.png',
  })
  window.setTimeout(() => notification.close(), 8000)
}
