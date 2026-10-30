import { CalendarOff, Check, Plus, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AdminLeaveRow, EmployeeRow } from '../lib/types'
import { createAdminLeave, updateAdminLeave } from '../lib/api'
import { EmptyState, SectionCard, StatusPill, formatDate } from '../components/ui'

const emptyForm = { funcionarioId: '', tipo: 'Afastamento médico', inicio: '', fim: '', motivo: '', status: 'ativo' }
const statusLabel: Record<string, string> = { ativo: 'Ativo', encerrado: 'Encerrado', cancelado: 'Cancelado' }

export function HRLeavePanel({ token, employees, leaves, onDone }: { token: string; employees: EmployeeRow[]; leaves: AdminLeaveRow[]; onDone: () => Promise<void> }) {
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      const result = await createAdminLeave(token, form)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível lançar o afastamento')
      setForm(emptyForm); setShowForm(false); setMessage('Afastamento lançado com sucesso.'); await onDone()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível lançar o afastamento') } finally { setSaving(false) }
  }

  async function update(row: AdminLeaveRow, status: string) {
    setBusyId(row.id); setError(''); setMessage('')
    try {
      const result = await updateAdminLeave(token, row.id, { fim: row.fim || '', motivo: row.motivo || '', status })
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar o afastamento')
      setMessage('Afastamento atualizado.'); await onDone()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar o afastamento') } finally { setBusyId(null) }
  }

  return <SectionCard title="Gestão de afastamentos" caption={`${leaves.length} registro(s) no histórico`}>
    <div className="hr-panel-toolbar"><div><strong>Períodos que impactam o ponto e o fechamento</strong><small>Registre afastamentos, encerre períodos e mantenha o motivo no prontuário.</small></div><button className="primary-button" type="button" onClick={() => { setShowForm(!showForm); setError('') }}>{showForm ? <X size={16} /> : <Plus size={16} />}{showForm ? 'Fechar lançamento' : 'Lançar afastamento'}</button></div>
    {showForm && <form className="form-stack hr-vacation-form" onSubmit={submit}><div className="form-row"><label>Funcionário<select required value={form.funcionarioId} onChange={(e) => setForm({ ...form, funcionarioId: e.target.value })}><option value="">Selecione</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome} · {employee.cpf}</option>)}</select></label><label>Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option>Afastamento médico</option><option>Licença maternidade</option><option>Licença paternidade</option><option>Acidente de trabalho</option><option>Outros</option></select></label></div><div className="form-row"><label>Início<input required type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} /></label><label>Fim previsto <span className="field-hint">(opcional)</span><input type="date" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} /></label></div><label>Motivo / observação<textarea rows={3} value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="CID, documento ou observação interna do RH" /></label><button className="primary-button" type="submit" disabled={saving}>{saving ? <RefreshCw className="spin" size={16} /> : <Check size={16} />}{saving ? 'Salvando…' : 'Salvar afastamento'}</button></form>}
    {error && <div className="form-error"><X size={16} />{error}</div>}{message && <div className="form-success"><Check size={16} />{message}</div>}
    {leaves.length === 0 ? <EmptyState title="Nenhum afastamento lançado" description="Use o botão acima para registrar o primeiro período." /> : <div className="hr-vacation-list">{leaves.map((row) => <article className="hr-vacation-row" key={row.id}><span className="document-icon"><CalendarOff size={18} /></span><div className="hr-vacation-main"><strong>{row.nome} · {row.tipo}</strong><small>{formatDate(row.inicio)} até {row.fim ? formatDate(row.fim) : 'em aberto'}</small>{row.motivo && <small>{row.motivo}</small>}</div><StatusPill value={statusLabel[row.status] || row.status} /><select value={row.status} disabled={busyId === row.id} onChange={(e) => void update(row, e.target.value)} aria-label={`Atualizar afastamento de ${row.nome}`}><option value="ativo">Ativo</option><option value="encerrado">Encerrado</option><option value="cancelado">Cancelado</option></select></article>)}</div>}
  </SectionCard>
}
