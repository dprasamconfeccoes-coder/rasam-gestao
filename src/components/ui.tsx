import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, SearchX } from 'lucide-react'

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

export function Pagination({ page, total, pageSize = 8, onChange }: { page: number; total: number; pageSize?: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  return <div className="pagination" aria-label="Paginação"><span>Mostrando {start}–{end} de {total}</span><div className="pagination-actions"><button className="icon-button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={15} /></button><strong>{page} <small>/ {pages}</small></strong><button className="icon-button" aria-label="Próxima página" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={15} /></button></div></div>
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
