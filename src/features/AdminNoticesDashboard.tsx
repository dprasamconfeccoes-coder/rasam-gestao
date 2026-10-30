import { useEffect, useState } from 'react'
import { Archive, Bell, CalendarDays, Check, Eye, Megaphone, Pause, PenLine, Plus, RefreshCw, Send, UsersRound } from 'lucide-react'
import { adminNoticeReaders, adminNoticesPage, saveNotice } from '../lib/api'
import type { AdminNoticePage, AdminNoticeRow, NoticeEmployeeReadRow } from '../lib/types'
import { EmptyState, ErrorState, PageHeading, StatusPill, formatDate } from '../components/ui'
import './notices.css'

const PAGE_SIZE = 20
const categoryOptions = [
  ['jornada_trabalho', 'Jornada de trabalho'], ['holerite', 'Holerite'], ['beneficios', 'Benefícios e cesta'],
  ['reuniao', 'Reuniões'], ['sindicato', 'Sindicato'], ['prevencao', 'Prevenção e saúde'],
  ['informativo', 'Informativo geral'], ['outro', 'Outro'],
] as const
const initialForm = { id: null as string | null, titulo: '', conteudo: '', categoria: 'informativo', prioridade: 'normal', status: 'rascunho' }
const emptyPage: AdminNoticePage = {
  sucesso: true,
  resumo: { total: 0, publicados: 0, rascunhos: 0, arquivados: 0, leituras: 0, funcionarios_ativos: 0 },
  avisos: [], total: 0, offset: 0, limite: PAGE_SIZE,
}

function dateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function auditLabel(event: string) {
  const labels: Record<string, string> = { criado: 'Rascunho criado', editado: 'Conteúdo editado', publicado: 'Publicado', pausado: 'Publicação pausada', arquivado: 'Arquivado' }
  return labels[event] || event
}

function snapshotLine(snapshot: Record<string, unknown> | null) {
  if (!snapshot) return '—'
  const status = typeof snapshot.status === 'string' ? snapshot.status : ''
  const title = typeof snapshot.titulo === 'string' ? snapshot.titulo : ''
  const priority = typeof snapshot.prioridade === 'string' ? snapshot.prioridade : ''
  return [title, status, priority].filter(Boolean).join(' · ') || 'Estado registrado'
}

export function AdminNoticesDashboard({ token }: { token: string }) {
  const [page, setPage] = useState<AdminNoticePage>(emptyPage)
  const [form, setForm] = useState(initialForm)
  const [statusFilter, setStatusFilter] = useState('todos')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [readerOpenId, setReaderOpenId] = useState('')
  const [readerRows, setReaderRows] = useState<Record<string, NoticeEmployeeReadRow[]>>({})
  const [readerBusyId, setReaderBusyId] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await adminNoticesPage(token, statusFilter, categoryFilter || null, offset, PAGE_SIZE)
      if (!result.sucesso) throw new Error(result.erro || 'Falha ao carregar avisos.')
      setPage(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar avisos.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [token, statusFilter, categoryFilter, offset])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await saveNotice(token, form.id, form)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível salvar o aviso.')
      setForm(initialForm)
      setMessage(form.status === 'publicado' ? 'Aviso publicado para os funcionários.' : 'Aviso salvo no histórico.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar aviso.')
    } finally {
      setSaving(false)
    }
  }

  function edit(row: AdminNoticeRow) {
    setForm({ id: row.id, titulo: row.titulo, conteudo: row.conteudo, categoria: row.categoria, prioridade: row.prioridade, status: row.status === 'publicado' ? 'publicado' : row.status === 'arquivado' ? 'arquivado' : 'rascunho' })
    setMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function changeStatus(row: AdminNoticeRow, nextStatus: string) {
    setBusyId(row.id)
    setError('')
    setMessage('')
    try {
      const result = await saveNotice(token, row.id, { titulo: row.titulo, conteudo: row.conteudo, categoria: row.categoria, prioridade: row.prioridade, status: nextStatus })
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar o estado do aviso.')
      setMessage(nextStatus === 'publicado' ? 'Aviso publicado.' : nextStatus === 'arquivado' ? 'Aviso arquivado.' : 'Publicação pausada; o aviso foi mantido como rascunho.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar aviso.')
    } finally {
      setBusyId('')
    }
  }

  async function toggleReaders(row: AdminNoticeRow) {
    if (readerOpenId === row.id) { setReaderOpenId(''); return }
    setReaderOpenId(row.id)
    if (readerRows[row.id]) return
    setReaderBusyId(row.id)
    setError('')
    try {
      const result = await adminNoticeReaders(token, row.id)
      if (!result.sucesso) throw new Error(result.erro || 'Falha ao carregar recibos de leitura.')
      setReaderRows((current) => ({ ...current, [row.id]: result.funcionarios || [] }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar recibos de leitura.')
    } finally {
      setReaderBusyId('')
    }
  }

  const summary = page.resumo || emptyPage.resumo
  return <div className="admin-notices-dashboard">
    <PageHeading eyebrow="Comunicação · gestão RH" title="Avisos da empresa" description="Publique comunicados, acompanhe quem já leu e mantenha o histórico de alterações em um só lugar." action={<button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>} />
    <div className="notices-metric-grid">
      <div className="notices-metric"><span><Bell size={15} /> Total no histórico</span><strong>{summary.total}</strong><small>Todos os avisos cadastrados</small></div>
      <div className="notices-metric is-published"><span><Send size={15} /> Publicados</span><strong>{summary.publicados}</strong><small>Visíveis aos funcionários</small></div>
      <div className="notices-metric is-draft"><span><PenLine size={15} /> Rascunhos</span><strong>{summary.rascunhos}</strong><small>Aguardando publicação</small></div>
      <div className="notices-metric is-reach"><span><UsersRound size={15} /> Alcance</span><strong>{summary.leituras}</strong><small>Leituras registradas · {summary.funcionarios_ativos} funcionários ativos</small></div>
    </div>

    <section className="notices-composer card-surface">
      <div className="notices-section-heading"><div><span className="eyebrow">{form.id ? 'Edição do comunicado' : 'Nova publicação'}</span><h2>{form.id ? 'Editar aviso' : 'Criar aviso'}</h2><p>O aviso publicado aparece na área do funcionário e inicia com status não lido.</p></div>{form.id ? <button className="secondary-button" type="button" onClick={() => setForm(initialForm)}>Cancelar edição</button> : <span className="notices-heading-icon"><Megaphone size={20} /></span>}</div>
      <form className="notices-form" onSubmit={submit}>
        <label className="notices-field notices-field-title">Título<input required minLength={3} maxLength={160} value={form.titulo} onChange={(event) => setForm({ ...form, titulo: event.target.value })} placeholder="Ex.: Holerite de outubro disponível" /></label>
        <label className="notices-field">Categoria<select value={form.categoria} onChange={(event) => setForm({ ...form, categoria: event.target.value })}>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="notices-field">Prioridade<select value={form.prioridade} onChange={(event) => setForm({ ...form, prioridade: event.target.value })}><option value="normal">Normal</option><option value="importante">Importante</option><option value="urgente">Urgente</option></select></label>
        <label className="notices-field">Publicação<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="rascunho">Salvar como rascunho</option><option value="publicado">Publicar agora</option>{form.status === 'arquivado' && <option value="arquivado">Manter arquivado</option>}</select></label>
        <label className="notices-field notices-field-content">Comunicado<textarea required minLength={5} maxLength={10000} rows={5} value={form.conteudo} onChange={(event) => setForm({ ...form, conteudo: event.target.value })} placeholder="Escreva as informações que os funcionários precisam receber…" /><small>{form.conteudo.length}/10.000 caracteres</small></label>
        {error && <div className="form-error notices-feedback"><Bell size={15} />{error}</div>}
        {message && <div className="form-success notices-feedback"><Check size={15} />{message}</div>}
        <div className="notices-form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? <><RefreshCw size={15} className="spin" /> Salvando…</> : <>{form.status === 'publicado' ? <Send size={15} /> : <PenLine size={15} />}{form.id ? 'Salvar alterações' : form.status === 'publicado' ? 'Publicar aviso' : 'Salvar rascunho'}</>}</button><span>As publicações e alterações ficam registradas na auditoria.</span></div>
      </form>
    </section>

    <section className="notices-management card-surface">
      <div className="notices-section-heading notices-history-heading"><div><span className="eyebrow">Arquivo e acompanhamento</span><h2>Histórico de avisos</h2><p>{page.total} resultado(s) · {summary.funcionarios_ativos} destinatários ativos por publicação</p></div><CalendarDays size={20} /></div>
      <div className="notices-filter-row">
        <label>Status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setOffset(0) }}><option value="todos">Todos os estados</option><option value="publicado">Publicados</option><option value="rascunho">Rascunhos e pausados</option><option value="arquivado">Arquivados</option></select></label>
        <label>Categoria<select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setOffset(0) }}><option value="">Todas as categorias</option>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="secondary-button" type="button" onClick={() => { setForm(initialForm); setMessage(''); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Plus size={15} /> Novo aviso</button>
      </div>
      {loading ? <div className="notices-loading"><RefreshCw size={18} className="spin" /> Carregando histórico…</div> : error && page.avisos.length === 0 ? <ErrorState message={error} /> : page.avisos.length === 0 ? <EmptyState title="Nenhum aviso neste filtro" description="Crie um comunicado ou escolha outro estado/categoria." /> : <div className="notices-list">
        {page.avisos.map((row) => <article className={`notice-admin-card state-${row.status}`} key={row.id}>
          <div className="notice-admin-topline"><div className="notice-admin-tags"><StatusPill value={row.status} /><StatusPill value={row.prioridade} /><span className="notice-category-tag">{categoryOptions.find(([value]) => value === row.categoria)?.[1] || 'Informativo'}</span></div><span className="notice-date-label">{row.publicado_em ? `Publicado ${formatDate(row.publicado_em)}` : `Atualizado ${formatDate(row.updated_at || row.created_at)}`}</span></div>
          <h3>{row.titulo}</h3><p className="notice-admin-content">{row.conteudo}</p>
          <div className="notice-read-stats"><span><Eye size={15} /><strong>{row.lidos}</strong> de {row.funcionarios_ativos} lidos</span>{row.status === 'publicado' && <span className={row.nao_lidos > 0 ? 'has-unread' : 'all-read'}>{row.nao_lidos > 0 ? `${row.nao_lidos} não lido(s)` : 'Todos leram'}</span>}</div>
          <div className="notice-admin-actions"><button className="secondary-button" type="button" onClick={() => edit(row)}><PenLine size={14} /> Editar</button>{row.status === 'publicado' ? <button className="secondary-button" type="button" onClick={() => void changeStatus(row, 'rascunho')} disabled={busyId === row.id}><Pause size={14} /> Pausar</button> : row.status === 'arquivado' ? <button className="secondary-button" type="button" onClick={() => void changeStatus(row, 'rascunho')} disabled={busyId === row.id}><PenLine size={14} /> Restaurar</button> : <button className="primary-button" type="button" onClick={() => void changeStatus(row, 'publicado')} disabled={busyId === row.id}><Send size={14} /> Publicar</button>}{row.status !== 'arquivado' && <button className="secondary-button is-archive" type="button" onClick={() => void changeStatus(row, 'arquivado')} disabled={busyId === row.id}><Archive size={14} /> Arquivar</button>}{row.status === 'publicado' && <button className="secondary-button" type="button" onClick={() => void toggleReaders(row)}>{readerOpenId === row.id ? 'Ocultar leituras' : 'Ver funcionários'}</button>}</div>
          {readerOpenId === row.id && <div className="notice-readers-panel"><h4><UsersRound size={15} /> Recibos por funcionário</h4>{readerBusyId === row.id ? <span>Consultando…</span> : <div className="notice-readers-list">{(readerRows[row.id] || []).map((reader) => <div className="notice-reader-row" key={reader.funcionario_id}><span>{reader.nome}</span><span className={reader.lido ? 'reader-done' : 'reader-pending'}>{reader.lido ? `Lido ${dateTime(reader.lido_em)}` : 'Ainda não lido'}</span></div>)}</div>}</div>}
          {row.auditoria?.length > 0 && <details className="notice-audit"><summary>Auditoria · {row.auditoria.length} evento(s)</summary><div className="notice-audit-list">{row.auditoria.map((event, index) => <div className="notice-audit-event" key={`${event.created_at}-${index}`}><strong>{auditLabel(event.evento)}</strong><span>{event.responsavel} · {dateTime(event.created_at)}</span><small>Antes: {snapshotLine(event.antes)}</small><small>Depois: {snapshotLine(event.depois)}</small></div>)}</div></details>}
        </article>)}
      </div>}
      {page.total > PAGE_SIZE && <div className="notices-pagination"><button className="secondary-button" type="button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>Anterior</button><span>{offset + 1}–{Math.min(offset + PAGE_SIZE, page.total)} de {page.total}</span><button className="secondary-button" type="button" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= page.total}>Próxima</button></div>}
    </section>
  </div>
}
