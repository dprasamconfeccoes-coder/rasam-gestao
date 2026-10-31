import { Check, FileText, Plus, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import type { AdminVacationManagementRow, EmployeeRow } from '../lib/types'
import { EmptyState, SectionCard, StatusPill, formatDate } from '../components/ui'
import { createAdminVacation, updateAdminVacation } from '../lib/api'

const emptyForm = { funcionarioId: '', periodoAquisitivoInicio: '', periodoAquisitivoFim: '', inicio: '', fim: '', status: 'agendada', observacoes: '' }
const statusLabel: Record<string, string> = { agendada: 'Agendada', em_gozo: 'Em gozo', concluida: 'Concluída', cancelada: 'Cancelada' }

function effectiveStatus(row: AdminVacationManagementRow, today = new Date().toISOString().slice(0, 10)) {
  if (row.status === 'cancelada' || row.status === 'concluida') return row.status
  if (!row.inicio || today < row.inicio) return 'agendada'
  if (row.fim && today > row.fim) return 'concluida'
  return 'em_gozo'
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || '?').toUpperCase()
}

function vacationDays(start: string, end: string) {
  return Math.floor((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1
}

export function HRVacationPanel({ token, employees, vacations, onDone }: { token: string; employees: EmployeeRow[]; vacations: AdminVacationManagementRow[]; onDone: () => Promise<void> }) {
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      if (form.inicio > form.fim) throw new Error('O fim das férias não pode ser anterior ao início.')
      const days = vacationDays(form.inicio, form.fim)
      if (days < 5 || days > 30) throw new Error(`O período deve ter entre 5 e 30 dias corridos. Este lançamento tem ${days} dias.`)
      if (form.periodoAquisitivoInicio > form.periodoAquisitivoFim) throw new Error('O período aquisitivo está invertido.')
      const sameAcquisition = vacations.filter((row) => row.funcionario_id === form.funcionarioId && row.periodo_aquisitivo_inicio === form.periodoAquisitivoInicio && row.periodo_aquisitivo_fim === form.periodoAquisitivoFim && row.status !== 'cancelada')
      if (sameAcquisition.length >= 3) throw new Error('A CLT permite no máximo três períodos de gozo para o mesmo período aquisitivo.')
      const existingLongPeriod = sameAcquisition.some((row) => row.inicio && row.fim && vacationDays(row.inicio, row.fim) >= 14)
      if (!existingLongPeriod && sameAcquisition.length === 0 && days < 14) throw new Error('No fracionamento, ao menos um período deve ter 14 dias corridos. Lance primeiro um período de 14 dias ou mais.')
      const result = await createAdminVacation(token, form); if (!result.sucesso) throw new Error(result.erro || 'Não foi possível lançar as férias'); setForm(emptyForm); setShowForm(false); setMessage('Férias lançadas com sucesso.'); await onDone()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível lançar as férias') } finally { setSaving(false) }
  }

  async function update(row: AdminVacationManagementRow, status: string) {
    setBusyId(row.id); setError(''); setMessage('')
    try { const result = await updateAdminVacation(token, row.id, { inicio: row.inicio || '', fim: row.fim || '', status, observacoes: row.observacoes || '' }); if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar as férias'); setMessage('Status de férias atualizado.'); await onDone() } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar as férias') } finally { setBusyId(null) }
  }

  return <>
    <SectionCard title="Gestão de férias" caption={`${vacations.length} período(s) lançado(s)`}>
      <div className="hr-panel-toolbar"><div><strong>Períodos aquisitivos e de gozo</strong><small>O status é sugerido automaticamente pela data atual; cancelamentos e conclusões manuais são preservados.</small></div><button className="primary-button" type="button" onClick={() => { setShowForm(!showForm); setError('') }}>{showForm ? <X size={16} /> : <Plus size={16} />}{showForm ? 'Fechar lançamento' : 'Lançar férias'}</button></div>
      {showForm && <form className="form-stack hr-vacation-form" onSubmit={submit}><div className="form-row"><label>Funcionário<select required value={form.funcionarioId} onChange={(e) => setForm({ ...form, funcionarioId: e.target.value })}><option value="">Selecione</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome} · {employee.cpf}</option>)}</select></label><label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="agendada">Agendada</option><option value="em_gozo">Em gozo</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option></select></label></div><div className="form-row"><label>Início do período aquisitivo<input required type="date" value={form.periodoAquisitivoInicio} onChange={(e) => setForm({ ...form, periodoAquisitivoInicio: e.target.value })} /></label><label>Fim do período aquisitivo<input required type="date" value={form.periodoAquisitivoFim} onChange={(e) => setForm({ ...form, periodoAquisitivoFim: e.target.value })} /></label></div><div className="form-row"><label>Início das férias<input required type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} /></label><label>Fim das férias<input required type="date" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} /></label></div><label>Observações<textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Abono, programação ou observações do RH" /></label><button className="primary-button" type="submit" disabled={saving}>{saving ? <RefreshCw className="spin" size={16} /> : <Check size={16} />} {saving ? 'Salvando…' : 'Salvar período de férias'}</button></form>}
      {error && <div className="form-error"><X size={16} />{error}</div>}{message && <div className="form-success"><Check size={16} />{message}</div>}
      {vacations.length === 0 ? <EmptyState title="Nenhuma férias lançada" description="Use o botão acima para registrar o primeiro período." /> : <div className="hr-vacation-list">{vacations.map((row) => { const currentStatus = effectiveStatus(row); const employee = employees.find((item) => item.id === row.funcionario_id); return <article className={`hr-vacation-row status-${currentStatus}`} key={row.id}><div className="employee-avatar">{employee?.avatar_url ? <img src={employee.avatar_url} alt={`Foto de ${row.nome}`} /> : initials(row.nome)}</div><div className="hr-vacation-main"><strong>{row.nome}</strong><small>{formatDate(row.inicio)} até {formatDate(row.fim)} · período aquisitivo {formatDate(row.periodo_aquisitivo_inicio)} até {formatDate(row.periodo_aquisitivo_fim)}</small>{row.observacoes && <small>{row.observacoes}</small>}<div className="vacation-document-links"><span>Documentos:</span>{row.aviso_documento ? <a href={row.aviso_documento.url} target="_blank" rel="noreferrer"><FileText size={13} /> Aviso</a> : <span className="document-missing">Aviso pendente</span>}{row.recibo_documento ? <a href={row.recibo_documento.url} target="_blank" rel="noreferrer"><FileText size={13} /> Recibo</a> : <span className="document-missing">Recibo pendente</span>}</div></div><StatusPill value={statusLabel[currentStatus] || currentStatus} /><select className={`vacation-status-select status-${currentStatus}`} value={currentStatus} disabled={busyId === row.id} onChange={(e) => void update(row, e.target.value)} aria-label={`Atualizar férias de ${row.nome}`}><option value="agendada">Agendada</option><option value="em_gozo">Em gozo</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option></select></article> })}</div>}
    </SectionCard>
  </>
}
