import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, CheckCircle2, Clock3, Plus, RefreshCw, Scale, Search, Trash2, UserRound } from 'lucide-react'
import { createAgreement, listAgreements, updateAgreementInstallmentStatus } from '../lib/api'
import type { AgreementInstallment, CreateAgreementPayload } from '../lib/types'
import { EmptyState, ErrorState, PageHeading, SectionCard, formatDate, formatMoney } from '../components/ui'
import './agreements.css'

type Filter = 'todos' | 'pendente' | 'atrasada' | 'quitada'
type DraftInstallment = { key: string; tipo: 'entrada' | 'parcela'; numero: string; valor: string; vencimento: string }
type AgreementGroup = {
  id: string
  processo: string
  funcionario_nome: string | null
  funcionario_cpf: string | null
  acordo_observacoes: string | null
  parcelas: AgreementInstallment[]
  parcelasVisiveis: AgreementInstallment[]
}

let draftSequence = 0
function newDraftKey() {
  draftSequence += 1
  return `item-${draftSequence}`
}
function blankDraft(): DraftInstallment[] {
  return [{ key: newDraftKey(), tipo: 'parcela', numero: '1', valor: '', vencimento: '' }]
}
function cpfDigits(value: string) {
  return value.replace(/\D/g, '').slice(0, 11)
}
function formatCpf(value: string) {
  const digits = cpfDigits(value)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}
function validCpf(value: string) {
  const cpf = cpfDigits(value)
  if (cpf.length !== 11 || /^([0-9])\1{10}$/.test(cpf)) return false
  const digit = (length: number, initialWeight: number) => {
    let sum = 0
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (initialWeight - index)
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }
  return digit(9, 10) === Number(cpf[9]) && digit(10, 11) === Number(cpf[10])
}
function localToday() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
function dayDifference(dateValue: string) {
  const today = new Date(`${localToday()}T00:00:00`)
  const date = new Date(`${dateValue.slice(0, 10)}T00:00:00`)
  return Math.round((date.getTime() - today.getTime()) / 86400000)
}
function statusLabel(status: AgreementInstallment['status']) {
  if (status === 'quitada') return 'Quitada'
  if (status === 'atrasada') return 'Vencida'
  return 'Pendente'
}
function displayCpf(value: string | null) {
  return value && value.length === 11 ? formatCpf(value) : value || ''
}

export function AgreementsDashboard({ token }: { token: string }) {
  const [rows, setRows] = useState<AgreementInstallment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('todos')
  const [showForm, setShowForm] = useState(false)
  const [processo, setProcesso] = useState('')
  const [funcionarioNome, setFuncionarioNome] = useState('')
  const [funcionarioCpf, setFuncionarioCpf] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [installments, setInstallments] = useState<DraftInstallment[]>(blankDraft)

  async function load() {
    setError('')
    setLoading(true)
    try {
      const result = await listAgreements(token)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar os acordos.')
      setRows(result.parcelas || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar acordos e parcelas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [token])

  const groups = useMemo<AgreementGroup[]>(() => {
    const map = new Map<string, AgreementGroup>()
    for (const row of rows) {
      const id = row.acordo_id || row.id
      let group = map.get(id)
      if (!group) {
        group = {
          id,
          processo: row.processo,
          funcionario_nome: row.funcionario_nome,
          funcionario_cpf: row.funcionario_cpf,
          acordo_observacoes: row.acordo_observacoes,
          parcelas: [],
          parcelasVisiveis: [],
        }
        map.set(id, group)
      }
      group.parcelas.push(row)
    }
    return [...map.values()].map((group) => ({
      ...group,
      parcelas: [...group.parcelas].sort((a, b) => a.numero - b.numero),
      parcelasVisiveis: [...group.parcelas].sort((a, b) => a.numero - b.numero),
    }))
  }, [rows])

  const metrics = useMemo(() => {
    const paid = rows.filter((row) => row.status === 'quitada')
    const overdue = rows.filter((row) => row.status === 'atrasada')
    const open = rows.filter((row) => row.status !== 'quitada')
    const dueSoon = open.filter((row) => row.vencimento && dayDifference(row.vencimento) >= 0 && dayDifference(row.vencimento) <= 7)
    return {
      paidCount: paid.length,
      paidValue: paid.reduce((sum, row) => sum + Number(row.valor || 0), 0),
      openCount: open.length,
      openValue: open.reduce((sum, row) => sum + Number(row.valor || 0), 0),
      overdueCount: overdue.length,
      overdueValue: overdue.reduce((sum, row) => sum + Number(row.valor || 0), 0),
      dueSoonCount: dueSoon.length,
      dueSoonValue: dueSoon.reduce((sum, row) => sum + Number(row.valor || 0), 0),
    }
  }, [rows])

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return groups
      .map((group) => {
        const matchesQuery = !query || [group.processo, group.funcionario_nome || '', group.funcionario_cpf || '']
          .join(' ')
          .toLocaleLowerCase('pt-BR')
          .includes(query)
        const parcelasVisiveis = group.parcelas.filter((row) => filter === 'todos' || row.status === filter)
        return matchesQuery && parcelasVisiveis.length ? { ...group, parcelasVisiveis } : null
      })
      .filter((group): group is AgreementGroup => Boolean(group))
      .sort((a, b) => {
        const aDue = a.parcelasVisiveis.map((row) => row.vencimento || '9999-12-31').sort()[0] || '9999-12-31'
        const bDue = b.parcelasVisiveis.map((row) => row.vencimento || '9999-12-31').sort()[0] || '9999-12-31'
        return aDue.localeCompare(bDue) || a.processo.localeCompare(b.processo)
      })
  }, [groups, search, filter])

  function addInstallment() {
    setInstallments((current) => {
      if (current.length >= 120) return current
      const used = new Set(current.filter((item) => item.tipo === 'parcela').map((item) => Number(item.numero)))
      let nextNumber = 1
      while (used.has(nextNumber)) nextNumber += 1
      return [...current, { key: newDraftKey(), tipo: 'parcela', numero: String(nextNumber), valor: '', vencimento: '' }]
    })
  }

  function updateInstallment(key: string, patch: Partial<DraftInstallment>) {
    setInstallments((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item))
  }

  function removeInstallment(key: string) {
    setInstallments((current) => current.length > 1 ? current.filter((item) => item.key !== key) : current)
  }

  function nextInstallmentNumber() {
    const used = new Set(installments.filter((item) => item.tipo === 'parcela').map((item) => Number(item.numero)))
    let number = 1
    while (used.has(number)) number += 1
    return String(number)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setMessage('')
    const cleanProcess = processo.trim()
    if (cleanProcess.length < 3 || cleanProcess.length > 180) {
      setFormError('Informe um número de processo válido, com até 180 caracteres.')
      return
    }
    const cpf = cpfDigits(funcionarioCpf)
    if (cpf && !validCpf(cpf)) {
      setFormError('O CPF informado não passou na validação dos dígitos. Revise ou deixe o campo vazio.')
      return
    }
    if (installments.length < 1 || installments.length > 120) {
      setFormError('Adicione entre 1 e 120 itens de pagamento.')
      return
    }
    const entries = installments.filter((item) => item.tipo === 'entrada')
    if (entries.length > 1) {
      setFormError('Cada acordo pode conter somente uma entrada.')
      return
    }
    const numbers = installments.filter((item) => item.tipo === 'parcela').map((item) => Number(item.numero))
    if (numbers.some((value) => !Number.isInteger(value) || value < 1 || value > 9999) || new Set(numbers).size !== numbers.length) {
      setFormError('Os números das parcelas devem ser positivos e não podem se repetir.')
      return
    }
    if (installments.some((item) => !item.vencimento || !Number.isFinite(Number(item.valor)) || Number(item.valor) <= 0 || Math.round(Number(item.valor) * 100) !== Number(item.valor) * 100)) {
      setFormError('Preencha valor positivo (até duas casas decimais) e vencimento para cada item.')
      return
    }

    const payload: CreateAgreementPayload = {
      processo: cleanProcess,
      funcionarioNome: funcionarioNome.trim(),
      funcionarioCpf: cpf,
      observacoes: observacoes.trim(),
      parcelas: installments.map((item) => ({
        tipo: item.tipo,
        numero: item.tipo === 'entrada' ? 0 : Number(item.numero),
        valor: Number(item.valor),
        vencimento: item.vencimento,
      })),
    }

    setSaving(true)
    try {
      const result = await createAgreement(token, payload)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível criar o acordo.')
      setMessage(`Acordo criado com ${result.quantidade_parcelas || installments.length} itens. A criação foi registrada na auditoria.`)
      setProcesso('')
      setFuncionarioNome('')
      setFuncionarioCpf('')
      setObservacoes('')
      setInstallments(blankDraft())
      setShowForm(false)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao criar o acordo.')
    } finally {
      setSaving(false)
    }
  }

  async function togglePaid(row: AgreementInstallment) {
    let status: 'quitada' | 'pendente'
    let motivo = ''
    if (row.status === 'quitada') {
      const input = window.prompt('Justificativa obrigatória para reabrir esta parcela:')
      if (input === null) return
      motivo = input.trim()
      if (!motivo) {
        setError('A reabertura foi cancelada: informe uma justificativa para continuar.')
        return
      }
      status = 'pendente'
    } else {
      const label = row.tipo === 'entrada' ? 'a entrada' : `a parcela ${row.numero}`
      if (!window.confirm(`Confirmar que ${label} do processo ${row.processo} foi quitada hoje?`)) return
      status = 'quitada'
    }

    setBusyId(row.id)
    setError('')
    setMessage('')
    try {
      const result = await updateAgreementInstallmentStatus(token, row.id, status, motivo)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar o status.')
      setMessage(status === 'quitada' ? 'Parcela marcada como quitada e registrada na auditoria.' : 'Parcela reaberta como pendente; a justificativa foi auditada.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar a parcela.')
    } finally {
      setBusyId('')
    }
  }

  function focusForm() {
    setShowForm(true)
    window.setTimeout(() => document.getElementById('agreement-create-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function printReport() {
    const rowsHtml = filteredGroups.flatMap((group) => group.parcelasVisiveis.map((row) => {
      const itemLabel = row.tipo === 'entrada' ? 'Entrada' : `Parcela ${row.numero}`
      return `<tr><td>${escapeHtml(group.processo)}</td><td>${escapeHtml(group.funcionario_nome || '—')}</td><td>${escapeHtml(displayCpf(group.funcionario_cpf) || '—')}</td><td>${escapeHtml(itemLabel)}</td><td>${escapeHtml(formatMoney(row.valor))}</td><td>${escapeHtml(formatDate(row.vencimento))}</td><td>${escapeHtml(statusLabel(row.status))}</td></tr>`
    })).join('')
    const popup = window.open('', '_blank')
    if (!popup) return
    popup.document.write(`<html><head><title>Acordos e parcelas</title><style>body{font:12px Arial,sans-serif;padding:24px;color:#222}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#f2eee8}</style></head><body><h1>Acordos e parcelas · RF Gestão</h1><table><thead><tr><th>Processo</th><th>Funcionário</th><th>CPF</th><th>Item</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead><tbody>${rowsHtml}</tbody></table><script>onload=()=>print()</script></body></html>`)
    popup.document.close()
  }

  const actions = <div className="agreement-heading-actions">
    <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
      <RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar
    </button>
    <button className="primary-button" type="button" onClick={focusForm}><Plus size={16} /> Novo acordo</button>
  </div>

  return <div className="agreements-dashboard">
    <PageHeading eyebrow="Administração · passivos trabalhistas" title="Acordos e parcelas" description="Acompanhe compromissos por processo, priorize vencimentos e registre cada quitação com trilha de auditoria." action={actions} />

    {error && <ErrorState message={error} />}
    {message && <div className="form-success agreement-feedback"><CheckCircle2 size={16} />{message}</div>}

    <div className="agreement-metrics" aria-label="Indicadores de acordos">
      <article className="agreement-metric metric-total"><span><Scale size={17} /> Acordos registrados</span><strong>{groups.length}</strong><small>{rows.length} itens de pagamento cadastrados</small></article>
      <article className="agreement-metric metric-open"><span><CircleDollarSignIcon /> Em aberto</span><strong>{formatMoney(metrics.openValue)}</strong><small>{metrics.openCount} parcelas ainda não quitadas</small></article>
      <article className="agreement-metric metric-overdue"><span><AlertCircle size={17} /> Vencidas</span><strong>{formatMoney(metrics.overdueValue)}</strong><small>{metrics.overdueCount} parcelas vencidas sem quitação</small></article>
      <article className="agreement-metric metric-paid"><span><CheckCircle2 size={17} /> Quitadas</span><strong>{formatMoney(metrics.paidValue)}</strong><small>{metrics.paidCount} pagamentos concluídos</small></article>
    </div>

    {(metrics.overdueCount > 0 || metrics.dueSoonCount > 0) && <div className={`agreement-alert ${metrics.overdueCount ? 'has-overdue' : 'has-upcoming'}`}>
      <span className="agreement-alert-icon">{metrics.overdueCount ? <AlertCircle size={20} /> : <Clock3 size={20} />}</span>
      <div><strong>{metrics.overdueCount ? `${metrics.overdueCount} parcela${metrics.overdueCount === 1 ? '' : 's'} vencida${metrics.overdueCount === 1 ? '' : 's'} exigem atenção` : `${metrics.dueSoonCount} vencimento${metrics.dueSoonCount === 1 ? '' : 's'} nos próximos 7 dias`}</strong>
        <p>{metrics.overdueCount ? `${formatMoney(metrics.overdueValue)} em atraso. Revise o processo e atualize a situação após a conferência do pagamento.` : `${formatMoney(metrics.dueSoonValue)} programados para os próximos 7 dias.`}</p>
      </div>
      <button type="button" className="text-button" onClick={() => setFilter(metrics.overdueCount ? 'atrasada' : 'pendente')}>Ver parcelas <span aria-hidden="true">→</span></button>
    </div>}

    {showForm && <SectionCard title="Cadastrar novo acordo" caption="Informe o processo e detalhe entrada e parcelas individualmente; cada item pode ter valor e vencimento próprios." className="agreement-create-card">
      <form id="agreement-create-form" className="agreement-create-form" onSubmit={(event) => void submit(event)}>
        <div className="agreement-form-grid">
          <label className="agreement-field agreement-field-process">Número do processo *<input required maxLength={180} value={processo} onChange={(event) => setProcesso(event.target.value)} placeholder="Ex.: 0001234-56.2025.5.02.0001" /></label>
          <label className="agreement-field">Funcionário · nome <span className="field-note">Opcional</span><input maxLength={160} value={funcionarioNome} onChange={(event) => setFuncionarioNome(event.target.value)} placeholder="Nome do beneficiário" /></label>
          <label className="agreement-field">CPF <span className="field-note">Opcional</span><input inputMode="numeric" autoComplete="off" maxLength={14} value={funcionarioCpf} onChange={(event) => setFuncionarioCpf(formatCpf(event.target.value))} placeholder="000.000.000-00" /></label>
          <label className="agreement-field agreement-field-notes">Observações do acordo <span className="field-note">Opcional</span><textarea rows={2} maxLength={5000} value={observacoes} onChange={(event) => setObservacoes(event.target.value)} placeholder="Contexto interno para acompanhamento do acordo" /></label>
        </div>

        <div className="agreement-installment-editor">
          <div className="agreement-editor-heading"><div><h3>Entrada e parcelas</h3><p>Valores e datas são independentes; vencidos são calculados automaticamente pela data.</p></div><button className="secondary-button" type="button" onClick={addInstallment} disabled={installments.length >= 120}><Plus size={15} /> Adicionar item</button></div>
          <div className="agreement-draft-list">
            {installments.map((item, index) => <div className="agreement-draft-row" key={item.key}>
              <label>Tipo<select value={item.tipo} onChange={(event) => {
                const tipo = event.target.value as DraftInstallment['tipo']
                updateInstallment(item.key, { tipo, numero: tipo === 'entrada' ? '0' : item.tipo === 'entrada' ? nextInstallmentNumber() : item.numero })
              }}><option value="parcela">Parcela</option><option value="entrada" disabled={installments.some((other) => other.tipo === 'entrada' && other.key !== item.key)}>Entrada</option></select></label>
              <label>{item.tipo === 'entrada' ? 'Referência' : 'Nº da parcela'}<input type={item.tipo === 'entrada' ? 'text' : 'number'} min={item.tipo === 'entrada' ? 0 : 1} max={9999} value={item.tipo === 'entrada' ? 'Entrada' : item.numero} disabled={item.tipo === 'entrada'} onChange={(event) => updateInstallment(item.key, { numero: event.target.value })} /></label>
              <label>Valor (R$)<input required type="number" min="0.01" step="0.01" value={item.valor} onChange={(event) => updateInstallment(item.key, { valor: event.target.value })} placeholder="0,00" /></label>
              <label>Vencimento<input required type="date" value={item.vencimento} onChange={(event) => updateInstallment(item.key, { vencimento: event.target.value })} /></label>
              <button type="button" className="agreement-remove-item" onClick={() => removeInstallment(item.key)} disabled={installments.length === 1} aria-label={`Remover item ${index + 1}`} title="Remover item"><Trash2 size={16} /></button>
            </div>)}
          </div>
          <small className="agreement-form-note">É permitido cadastrar até 120 itens por acordo. Para incluir uma entrada, selecione “Entrada”; ela será exibida separadamente das parcelas numeradas.</small>
        </div>

        {formError && <div className="form-error agreement-form-feedback"><AlertCircle size={16} />{formError}</div>}
        <div className="agreement-form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? <><RefreshCw className="spin" size={16} /> Salvando…</> : <><Plus size={16} /> Criar acordo e parcelas</>}</button><button className="secondary-button" type="button" onClick={() => { setShowForm(false); setFormError('') }}>Cancelar</button><span>O cadastro é atômico; processo duplicado ou dados inválidos não geram parcelas parciais.</span></div>
      </form>
    </SectionCard>}

    <SectionCard title="Painel de acordos" caption="Acordos agrupados por processo com parcelas individualizadas e situação de pagamento." className="agreement-management-card">
      <div className="agreement-toolbar">
        <label className="agreement-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar processo, funcionário ou CPF" /></label>
        <div className="agreement-filters" role="group" aria-label="Filtrar parcelas por situação">
          {([['todos', 'Todas'], ['pendente', 'Pendentes'], ['atrasada', 'Vencidas'], ['quitada', 'Quitadas']] as Array<[Filter, string]>).map(([value, label]) => <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <button type="button" className="secondary-button agreement-export" onClick={printReport} disabled={!filteredGroups.length}>Imprimir / PDF</button>
      </div>

      {loading ? <div className="agreement-loading"><RefreshCw className="spin" size={18} /> Atualizando acordos e parcelas…</div>
        : filteredGroups.length === 0 ? <EmptyState title={groups.length ? 'Nenhum resultado para esses filtros' : 'Nenhum acordo cadastrado'} description={groups.length ? 'Ajuste a busca ou escolha outra situação.' : 'Cadastre o primeiro acordo para começar a acompanhar valores, vencimentos e pagamentos.'} />
          : <div className="agreement-group-list">{filteredGroups.map((group) => {
            const paid = group.parcelas.filter((row) => row.status === 'quitada')
            const openValue = group.parcelas.filter((row) => row.status !== 'quitada').reduce((sum, row) => sum + Number(row.valor || 0), 0)
            const groupValue = group.parcelas.reduce((sum, row) => sum + Number(row.valor || 0), 0)
            return <article className="agreement-group" key={group.id}>
              <header className="agreement-group-header">
                <div className="agreement-process-icon"><Scale size={18} /></div>
                <div className="agreement-process-copy"><span className="eyebrow">Processo trabalhista</span><h3>{group.processo}</h3>
                  {(group.funcionario_nome || group.funcionario_cpf) && <div className="agreement-employee"><UserRound size={14} /><strong>{group.funcionario_nome || 'Funcionário não informado'}</strong>{group.funcionario_cpf && <span>CPF {displayCpf(group.funcionario_cpf)}</span>}</div>}
                  {group.acordo_observacoes && <p className="agreement-observations">{group.acordo_observacoes}</p>}
                </div>
                <div className="agreement-group-totals"><small>{group.parcelas.length} {group.parcelas.length === 1 ? 'item' : 'itens'} · {paid.length} quitadas</small><strong>{formatMoney(groupValue)}</strong><span>{formatMoney(openValue)} em aberto</span></div>
              </header>
              <div className="agreement-installments">
              {group.parcelasVisiveis.map((row) => <div className="agreement-installment-row" key={row.id}>
                  <div className="agreement-installment-name"><span className={`agreement-kind ${row.tipo === 'entrada' ? 'is-entry' : ''}`}>{row.tipo === 'entrada' ? 'Entrada' : `Parcela ${row.numero}`}</span><small>{row.vencimento ? `Vencimento ${formatDate(row.vencimento)}` : 'Sem vencimento definido'}{row.pago_em ? ` · quitada em ${formatDate(row.pago_em)}` : ''}</small></div>
                  <strong className="agreement-installment-value">{formatMoney(row.valor)}</strong>
                  <span className={`agreement-status status-${row.status}`}><span />{statusLabel(row.status)}</span>
                  <button type="button" className={`agreement-status-action ${row.status === 'quitada' ? 'is-reopen' : ''}`} onClick={() => void togglePaid(row)} disabled={busyId === row.id}>
                    {busyId === row.id ? <RefreshCw size={15} className="spin" /> : row.status === 'quitada' ? <RefreshCw size={15} /> : <CheckCircle2 size={15} />}
                    {busyId === row.id ? 'Salvando…' : row.status === 'quitada' ? 'Reabrir' : 'Marcar quitada'}
                  </button>
                </div>)}
              </div>
            </article>
          })}</div>}
    </SectionCard>
  </div>
}

function CircleDollarSignIcon() {
  return <span className="agreement-currency-icon" aria-hidden="true">R$</span>
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
}
