import { BriefcaseBusiness, Check, RefreshCw, UserMinus, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { EmployeeRow } from '../lib/types'
import { dismissEmployee, reinstateEmployee, registerAdmission } from '../lib/api'
import { EmptyState, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'

type Action = 'admitir' | 'demitir' | 'reintegrar' | null

function remunerationLabel(row: EmployeeRow) {
  if (row.tipo_vinculo === 'diarista') {
    return row.valor_diaria != null ? `Diária: ${formatMoney(row.valor_diaria)}` : 'Diária não informada'
  }
  const amount = row.valor_mensal ?? row.salario
  return amount == null ? 'Remuneração não informada' : `${row.salario_periodo || 'Mês'}: ${formatMoney(amount)}`
}

export function HRLifecyclePanel({ token, employees, onDone }: { token: string; employees: EmployeeRow[]; onDone: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState('')
  const [action, setAction] = useState<Action>(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const selected = employees.find((employee) => employee.id === selectedId)

  function openAction(id: string, next: Action) {
    setSelectedId(id); setAction(next); setError(''); setMessage(''); setReason('')
    const row = employees.find((employee) => employee.id === id)
    setDate(row?.data_admissao || new Date().toISOString().slice(0, 10))
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!selected || !action) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = action === 'demitir'
        ? await dismissEmployee(token, selected.id, date, reason)
        : action === 'reintegrar'
          ? await reinstateEmployee(token, selected.id, date)
          : await registerAdmission(token, { funcionarioId: selected.id, dataAdmissao: date })
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível concluir a movimentação')
      setMessage(action === 'demitir' ? 'Demissão registrada e acesso encerrado.' : action === 'reintegrar' ? 'Reintegração registrada e acesso reativado.' : 'Admissão registrada com sucesso.')
      setAction(null); await onDone()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível concluir a movimentação') } finally { setBusy(false) }
  }

  return <SectionCard title="Admissão e demissão" caption="Controle do ciclo de vida e dos acessos dos funcionários"><div className="hr-panel-toolbar"><div><strong>{employees.length} vínculo(s) no cadastro</strong><small>Admissões, desligamentos e reintegrações ficam registrados no prontuário e na timeline.</small></div><span className="lifecycle-legend"><span><i className="is-active" /> Ativo</span><span><i className="is-inactive" /> Inativo</span></span></div>{error && <div className="form-error"><X size={16} />{error}</div>}{message && <div className="form-success"><Check size={16} />{message}</div>}{employees.length === 0 ? <EmptyState title="Nenhum funcionário cadastrado" description="Cadastre um vínculo para iniciar o ciclo de vida." /> : <div className="lifecycle-list">{employees.map((row) => <article className={`lifecycle-row ${row.ativo ? 'is-active' : 'is-inactive'}`} key={row.id}><span className="lifecycle-avatar">{row.nome.slice(0, 1).toUpperCase()}</span><div className="lifecycle-main"><strong>{row.nome}</strong><small>{row.cargo || 'Cargo não informado'} · {row.tipo_vinculo || 'vínculo não informado'} · {remunerationLabel(row)}</small><small>Admissão: {formatDate(row.data_admissao)}{row.data_demissao ? ` · Demissão: ${formatDate(row.data_demissao)}` : ''}</small>{row.motivo_demissao && <small>Motivo: {row.motivo_demissao}</small>}</div><StatusPill value={row.ativo ? 'Ativo' : 'Inativo'} /><div className="lifecycle-actions">{row.ativo ? <><button className="icon-button" type="button" title="Registrar admissão" aria-label={`Registrar admissão de ${row.nome}`} onClick={() => openAction(row.id, 'admitir')}><UserPlus size={15} /></button><button className="icon-button danger" type="button" title="Registrar demissão" aria-label={`Registrar demissão de ${row.nome}`} onClick={() => openAction(row.id, 'demitir')}><UserMinus size={15} /></button></> : <button className="icon-button" type="button" title="Reintegrar funcionário" aria-label={`Reintegrar ${row.nome}`} onClick={() => openAction(row.id, 'reintegrar')}><RefreshCw size={15} /></button>}</div></article>)}</div>}{selected && action && <form className="lifecycle-form" onSubmit={submit}><div><strong>{action === 'demitir' ? 'Registrar demissão' : action === 'reintegrar' ? 'Registrar reintegração' : 'Registrar admissão'} · {selected.nome}</strong><button className="icon-button" type="button" onClick={() => setAction(null)} aria-label="Fechar formulário"><X size={15} /></button></div><label>{action === 'demitir' ? 'Data de demissão' : 'Data de admissão'}<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>{action === 'demitir' && <label>Motivo da demissão<textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: pedido do funcionário, término de contrato, justa causa…" /></label>}<button className="primary-button" type="submit" disabled={busy}>{busy ? <RefreshCw className="spin" size={16} /> : <BriefcaseBusiness size={16} />}{busy ? 'Salvando…' : 'Confirmar movimentação'}</button></form>}</SectionCard>
}
