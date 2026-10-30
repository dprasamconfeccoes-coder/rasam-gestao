import { useEffect, useRef, type ReactNode } from 'react'
import { Check, LoaderCircle, SearchX } from 'lucide-react'
import './confirmation-modal.css'

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  )
}

export function MetricCard({ label, value, detail, tone = 'gold', onClick }: { label: string; value: string | number; detail: string; tone?: 'gold' | 'pink' | 'green' | 'blue'; onClick?: () => void }) {
  return (
    <article className={`metric-card metric-${tone}${onClick ? ' is-clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(event) => { if (onClick && (event.key === 'Enter' || event.key === ' ')) onClick() }}>
      <div className="metric-top"><span>{label}</span><span className="metric-dot" /></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

export function StatusPill({ value }: { value: string | null | undefined }) {
  const normalized = (value || 'sem status').toLowerCase().replaceAll(' ', '-')
  return <span className={`status-pill status-${normalized}`}>{value || 'Sem status'}</span>
}

export function LoadingState({ label = 'Consultando dados seguros…' }: { label?: string }) {
  return <div className="state-card"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="state-card empty-state"><SearchX size={24} /><div><strong>{title}</strong><p>{description}</p></div></div>
}

export function ErrorState({ message }: { message: string }) {
  return <div className="state-card error-state"><strong>Não foi possível concluir a consulta</strong><p>{message}</p></div>
}

export function SectionCard({ title, caption, children, className = '' }: { title: string; caption?: string; children: ReactNode; className?: string }) {
  return <section className={`section-card ${className}`}><div className="section-header"><div><h2>{title}</h2>{caption && <span>{caption}</span>}</div></div>{children}</section>
}

export function ConfirmationModal({
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Voltar',
  busy = false,
  children,
  onConfirm,
  onCancel,
}: {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  children?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  const returnFocusRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    return () => {
      const trigger = returnFocusRef.current
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      else if (typeof document !== 'undefined') {
        const fallback = document.querySelector<HTMLElement>('.page-heading h1')
        if (fallback) { fallback.tabIndex = -1; fallback.focus({ preventScroll: true }) }
      }
    }
  }, [])
  return <div className="confirmation-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-modal-title" aria-describedby="confirmation-modal-description" onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); return }
      if (event.key !== 'Tab') return
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <div className="confirmation-modal-icon"><Check size={20} /></div>
      <div className="confirmation-modal-copy"><h2 id="confirmation-modal-title">{title}</h2><p id="confirmation-modal-description">{description}</p></div>
      {children && <div className="confirmation-modal-details">{children}</div>}
      <div className="confirmation-modal-actions"><button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{cancelLabel}</button><button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? 'Processando…' : confirmLabel}</button></div>
    </section>
  </div>
}

export function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR')
}

export function formatMoney(value?: number | null) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}
