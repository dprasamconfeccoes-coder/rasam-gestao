import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, Download, FileText, LockKeyhole, Plus, RefreshCw, Save, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { adminFolhaOficialReabrir, adminFolhaOficialSalvar, getPayslipDocumentUrl, uploadPayslip } from '../lib/api'
import type { PayrollOfficialCompetenceResponse, PayrollOfficialEmployee, PayrollOfficialPayload, PayrollOfficialRubric } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, MetricCard, SectionCard, formatMoney } from '../components/ui'
import './payroll-official.css'

type Props = { token: string; competencia: string; data: PayrollOfficialCompetenceResponse | null; loading: boolean; onRefresh: () => Promise<void>; employeePhotos?: Record<string, string> }
type FormData = Omit<PayrollOfficialPayload, 'itens'> & { itens: PayrollOfficialRubric[] }
const blankItem = (): PayrollOfficialRubric => ({ ordem: 1, codigo: '', descricao: '', referencia: '', tipo: 'provento', valor: 0 })
const currency = (value: number | null | undefined) => formatMoney(value ?? 0)
const monthLabel = (value: string) => { const d = new Date(`${value}-01T12:00:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) }
const moneyInput = (value: number | null) => value == null ? '' : String(value).replace('.', ',')
function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').includes(',') ? value.trim().replace(/\./g, '').replace(',', '.') : value.trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}
function initialForm(person: PayrollOfficialEmployee): FormData {
  return { holerite_id: person.holerite_id, salario_base: person.salario_base, base_inss: person.base_inss, base_fgts: person.base_fgts, fgts_mes: person.fgts_mes, base_irrf: person.base_irrf, faixa_irrf: person.faixa_irrf, total_vencimentos: person.total_vencimentos ?? 0, total_descontos: person.total_descontos ?? 0, valor_liquido: person.valor_liquido ?? 0, itens: person.itens?.length ? person.itens.map((item) => ({ ...item })) : [blankItem()] }
}
function Status({ status }: { status: PayrollOfficialEmployee['status'] }) {
  return <span className={`po-status is-${status}`}>{status === 'confirmado' ? 'Confirmado' : status === 'rascunho' ? 'Rascunho' : 'Pendente'}</span>
}

export function PayrollOfficialDashboard({ token, competencia, data, loading, onRefresh, employeePhotos = {} }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState<FormData | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState('')
  const [reopenReason, setReopenReason] = useState('')
  const [busy, setBusy] = useState('')
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const people = data?.funcionarios ?? []
  const employee = people.find((person) => person.funcionario_id === selectedId) ?? null
  const locked = employee?.status === 'confirmado'
  const rubricEarnings = useMemo(() => (form?.itens || []).filter((item) => item.tipo === 'provento').reduce((sum, item) => sum + (Number(item.valor) || 0), 0), [form])
  const rubricDiscounts = useMemo(() => (form?.itens || []).filter((item) => item.tipo === 'desconto').reduce((sum, item) => sum + (Number(item.valor) || 0), 0), [form])
  const discrepancy = form ? (rubricEarnings - form.total_vencimentos !== 0 || rubricDiscounts - form.total_descontos !== 0 || form.total_vencimentos - form.total_descontos - form.valor_liquido !== 0) : false

  useEffect(() => {
    setSelectedId(''); setForm(null); setFile(null); setUploadedFileName(''); setError(''); setMessage(''); setReopenReason('')
  }, [competencia])
  useEffect(() => {
    if (!selectedId || !data) return
    const refreshed = data.funcionarios.find((person) => person.funcionario_id === selectedId)
    if (refreshed) setForm(initialForm(refreshed))
    else { setSelectedId(''); setForm(null) }
  }, [data, selectedId])
  function select(person: PayrollOfficialEmployee) {
    setSelectedId(person.funcionario_id); setForm(initialForm(person)); setFile(null); setUploadedFileName(''); setError(''); setMessage(''); setReopenReason('')
  }
  function setField<K extends keyof FormData>(key: K, value: FormData[K]) { setForm((current) => current ? { ...current, [key]: value } : current) }
  function setRubric(index: number, patch: Partial<PayrollOfficialRubric>) {
    setForm((current) => current ? { ...current, itens: current.itens.map((item, i) => i === index ? { ...item, ...patch } : item) } : current)
  }
  function addRubric() { setForm((current) => current ? { ...current, itens: [...current.itens, { ...blankItem(), ordem: current.itens.length + 1 }] } : current) }
  function removeRubric(index: number) { setForm((current) => current ? { ...current, itens: current.itens.filter((_, i) => i !== index).map((item, i) => ({ ...item, ordem: i + 1 })) } : current) }
  async function attachFile() {
    if (!employee || !file) return
    const name = file.name.toLowerCase()
    const valid = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || /\.(pdf|jpe?g|png)$/.test(name)
    if (!valid) { setError('Selecione um arquivo PDF, JPG, JPEG ou PNG.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('O arquivo deve ter no máximo 10 MB.'); return }
    setBusy('upload'); setError(''); setMessage('')
    try {
      const result = await uploadPayslip(token, employee.funcionario_id, competencia, file)
      setForm((current) => current ? { ...current, holerite_id: result.holerite_id } : current)
      setUploadedFileName(file.name); setFile(null); setMessage('Documento privado anexado e disponibilizado no portal do funcionário.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível anexar o documento.') }
    finally { setBusy('') }
  }
  async function openDocument() {
    const documentId = form?.holerite_id || employee?.holerite_id
    if (!documentId) return
    setOpening(true); setError('')
    const popup = window.open('about:blank', '_blank')
    try { const result = await getPayslipDocumentUrl(token, documentId); if (!result.url) throw new Error('URL do documento não encontrada'); if (popup) popup.location.href = result.url; else window.open(result.url, '_blank', 'noopener,noreferrer') }
    catch (cause) { popup?.close(); setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o documento.') }
    finally { setOpening(false) }
  }
  async function save(event: FormEvent | undefined, confirm: boolean) {
    event?.preventDefault(); if (!employee || !form) return
    setError(''); setMessage('')
    if (confirm && !employee.holerite_id && !form.holerite_id) { setError('Anexe o holerite individual antes de confirmar.'); return }
    if (form.itens.some((item) => !item.descricao.trim() || !Number.isFinite(Number(item.valor)) || Number(item.valor) < 0)) { setError('Confira a descrição e o valor não negativo de cada rubrica.'); return }
    if ([form.salario_base, form.base_inss, form.base_fgts, form.fgts_mes, form.base_irrf].some((value) => value != null && (!Number.isFinite(Number(value)) || Number(value) < 0))) { setError('Os campos de valores-base devem ser números não negativos.'); return }
    setBusy(confirm ? 'confirm' : 'save')
    const payload: PayrollOfficialPayload = { ...form, holerite_id: form.holerite_id || employee.holerite_id, itens: form.itens.map((item, index) => ({ ...item, ordem: index + 1, codigo: item.codigo || null, referencia: item.referencia || null, valor: Number(item.valor) })) }
    try {
      const result = await adminFolhaOficialSalvar(token, employee.funcionario_id, competencia, payload, confirm)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível salvar os valores oficiais.')
      setMessage(confirm ? 'Valores oficiais confirmados para este funcionário.' : 'Rascunho salvo. A prévia interna permanece preservada para auditoria.')
      setUploadedFileName('')
      await onRefresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao salvar os valores oficiais.') }
    finally { setBusy('') }
  }
  async function reopen() {
    if (!employee?.registro_id) return
    if (reopenReason.trim().length < 5) { setError('Informe o motivo da reabertura (mínimo de 5 caracteres).'); return }
    setBusy('reopen'); setError(''); setMessage('')
    try {
      const result = await adminFolhaOficialReabrir(token, employee.registro_id, reopenReason.trim())
      if ('sucesso' in result && !result.sucesso) throw new Error(result.erro || 'Não foi possível reabrir o registro.')
      setMessage('Registro reaberto para edição.'); setReopenReason(''); await onRefresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao reabrir o registro.') }
    finally { setBusy('') }
  }
  const statusLabel: Record<string, string> = { sem_vinculos: 'Sem vínculos elegíveis', sem_oficiais: 'Sem registros oficiais', parcial: 'Cobertura parcial', completa: 'Cobertura completa' }

  return <div className="payroll-official-page">
    {error && <ErrorState message={error} />}{message && <div className="po-message is-success" role="status"><Check size={16} />{message}</div>}
    <div className="po-privacy-note"><LockKeyhole size={19} /><div><strong>Documento individual e privado</strong><p>O recibo anexado fica privado e é disponibilizado imediatamente ao funcionário no portal existente. Anexar um arquivo, por si só, não confirma os valores oficiais.</p></div></div>
    <SectionCard title={`Resumo oficial · ${monthLabel(competencia)}`} caption="Totais consideram somente registros confirmados; rascunhos e pendências não entram nos valores oficiais.">
      <div className="po-summary-body">
      {loading && !data ? <LoadingState label="Carregando situação da competência…" /> : data ? <>
        <div className="po-summary-head"><span className={`po-competence-state is-${data.status_competencia}`}><span />{statusLabel[data.status_competencia] || data.status_competencia}</span><span>{data.confirmados} de {data.funcionarios_elegiveis} confirmados</span><button className="secondary-button" type="button" onClick={() => void onRefresh()} disabled={loading || !!busy}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Atualizar</button></div>
        <div className="metric-grid overview-metrics po-official-kpis">
          <MetricCard label="Elegíveis" value={data.funcionarios_elegiveis} detail="Vínculos na competência" tone="blue" />
          <MetricCard label="Confirmados" value={data.confirmados} detail="Valores oficiais registrados" tone={data.confirmados > 0 ? 'green' : 'blue'} />
          <MetricCard label="Rascunhos" value={data.rascunhos} detail="Ainda não entram nos totais" tone={data.rascunhos > 0 ? 'gold' : 'blue'} />
          <MetricCard label="Pendentes" value={data.pendentes} detail={data.pendentes > 0 ? 'Aguardam conclusão' : 'Sem pendências'} tone={data.pendentes > 0 ? 'pink' : 'green'} />
        </div>
        <div className="metric-grid overview-metrics po-official-amounts">
          <MetricCard label="Vencimentos oficiais" value={currency(data.total_vencimentos_oficiais)} detail="Somente registros confirmados" tone="blue" />
          <MetricCard label="Descontos oficiais" value={currency(data.total_descontos_oficiais)} detail="Somente registros confirmados" tone="pink" />
          <MetricCard label="Líquido oficial" value={currency(data.valor_liquido_oficial)} detail="Somente registros confirmados" tone={data.valor_liquido_oficial >= 0 ? 'green' : 'pink'} />
        </div>
        {data.status_competencia === 'parcial' && <p className="po-partial-note"><AlertTriangle size={15} />A competência segue parcial/mista até que todos os funcionários elegíveis tenham registros confirmados.</p>}
      </> : <EmptyState title="Resumo indisponível" description="Atualize a tela para consultar os valores oficiais da competência." />}
      </div>
    </SectionCard>
    <div className="po-workspace">
      <SectionCard title="Funcionários" caption="Selecione uma pessoa para cadastrar ou revisar os valores recebidos.">
      {loading && !data ? <LoadingState label="Carregando funcionários…" /> : people.length === 0 ? <EmptyState title="Nenhum funcionário elegível" description="Não há vínculos elegíveis nesta competência." /> : <div className="po-employee-list">{people.map((person) => <button type="button" key={person.funcionario_id} className={`po-employee ${selectedId === person.funcionario_id ? 'is-selected' : ''}`} onClick={() => select(person)}><span className="po-avatar">{employeePhotos[person.funcionario_id] ? <img src={employeePhotos[person.funcionario_id]} alt="" /> : person.nome.trim().charAt(0).toUpperCase()}</span><span className="po-employee-info"><strong>{person.nome}</strong><small>{person.cargo || 'Cargo não informado'}</small></span><Status status={person.status} />{person.status === 'confirmado' && <span className="po-net">{currency(person.valor_liquido)}</span>}</button>)}</div>}
      </SectionCard>
      <SectionCard title={employee ? `Valores oficiais · ${employee.nome}` : 'Cadastro manual'} caption={employee ? `${monthLabel(competencia)} · valores transcritos do documento do escritório` : 'Escolha um funcionário na lista para começar.'}>
        {!employee || !form ? <div className="po-placeholder"><FileText size={24} /><span>O formulário individual aparecerá aqui após selecionar um funcionário.</span></div> : <form className="po-form" onSubmit={(event) => void save(event, false)}>
          <div className="po-edit-banner"><ShieldCheck size={17} /><span>{locked ? 'Registro confirmado e bloqueado para edição.' : employee.status === 'rascunho' ? 'Rascunho editável; ainda não compõe os totais oficiais.' : 'Informe os valores exatamente como recebidos do escritório.'}</span></div>
          {employee.status === 'confirmado' && <div className="po-reopen"><label>Motivo para reabrir o registro<input value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Descreva por que precisa corrigir" disabled={!!busy} /></label><button className="secondary-button" type="button" onClick={() => void reopen()} disabled={!!busy}><RefreshCw size={15} />{busy === 'reopen' ? 'Reabrindo…' : 'Reabrir para edição'}</button></div>}
          <div className="po-fields">
            {([['salario_base','Salário-base'],['base_inss','Base INSS'],['base_fgts','Base FGTS'],['fgts_mes','FGTS do mês'],['base_irrf','Base IRRF']] as const).map(([key, label]) => <label key={key}>{label} (R$)<input inputMode="decimal" value={moneyInput(form[key])} onChange={(event) => setField(key, parseMoney(event.target.value))} placeholder="Não informado" disabled={!!locked || !!busy} /></label>)}
            <label>Faixa IRRF<input value={form.faixa_irrf || ''} onChange={(event) => setField('faixa_irrf', event.target.value || null)} placeholder="Conforme documento" disabled={!!locked || !!busy} /></label>
          </div>
          <div className="po-rubric-heading"><div><strong>Rubricas</strong><small>Transcreva os itens do recibo; nenhum tributo é calculado aqui.</small></div><button type="button" className="secondary-button" onClick={addRubric} disabled={!!locked || !!busy}><Plus size={15} /> Adicionar rubrica</button></div>
          <div className="po-rubrics">{form.itens.map((item, index) => <div className="po-rubric" key={`${index}-${item.ordem}`}><label>Código<input value={item.codigo || ''} onChange={(event) => setRubric(index, { codigo: event.target.value || null })} placeholder="Opcional" disabled={!!locked || !!busy} /></label><label className="po-description">Descrição<input value={item.descricao} onChange={(event) => setRubric(index, { descricao: event.target.value })} placeholder="Ex.: salário, INSS" disabled={!!locked || !!busy} /></label><label>Referência<input value={item.referencia || ''} onChange={(event) => setRubric(index, { referencia: event.target.value || null })} placeholder="Ex.: 30 dias" disabled={!!locked || !!busy} /></label><label>Tipo<select value={item.tipo} onChange={(event) => setRubric(index, { tipo: event.target.value as PayrollOfficialRubric['tipo'] })} disabled={!!locked || !!busy}><option value="provento">Provento</option><option value="desconto">Desconto</option><option value="informativo">Informativo</option></select></label><label>Valor (R$)<input inputMode="decimal" value={moneyInput(item.valor)} onChange={(event) => setRubric(index, { valor: parseMoney(event.target.value) ?? 0 })} disabled={!!locked || !!busy} /></label><button className="po-remove" type="button" onClick={() => removeRubric(index)} disabled={!!locked || !!busy} aria-label="Remover rubrica"><Trash2 size={16} /></button></div>)}</div>
          <div className="po-fields po-totals-fields"><label>Total de vencimentos (R$)<input inputMode="decimal" value={moneyInput(form.total_vencimentos)} onChange={(event) => setField('total_vencimentos', parseMoney(event.target.value) ?? 0)} disabled={!!locked || !!busy} /></label><label>Total de descontos (R$)<input inputMode="decimal" value={moneyInput(form.total_descontos)} onChange={(event) => setField('total_descontos', parseMoney(event.target.value) ?? 0)} disabled={!!locked || !!busy} /></label><label>Valor líquido (R$)<input inputMode="decimal" value={moneyInput(form.valor_liquido)} onChange={(event) => setField('valor_liquido', parseMoney(event.target.value) ?? 0)} disabled={!!locked || !!busy} /></label></div>
          <div className="po-reconciliation"><div><small>Soma das rubricas de provento</small><strong>{currency(rubricEarnings)}</strong></div><div><small>Soma das rubricas de desconto</small><strong>{currency(rubricDiscounts)}</strong></div></div>
          {discrepancy && <div className="po-warning"><AlertTriangle size={16} /><span>Os totais informados não conciliam com as rubricas e/ou o líquido (vencimentos menos descontos). Confira com o documento do escritório; o sistema não altera os valores informados.</span></div>}
          <div className="po-document-box"><div className="po-document-top"><span className="po-document-icon"><FileText size={18} /></span><div><strong>{uploadedFileName || employee.arquivo_nome || (form.holerite_id ? 'Documento privado anexado' : 'Holerite individual')}</strong><small><LockKeyhole size={12} /> Privado · disponível no portal do funcionário</small></div>{(form.holerite_id || employee.holerite_id) && <button className="secondary-button" type="button" onClick={() => void openDocument()} disabled={opening}><Download size={15} />{opening ? 'Abrindo…' : 'Abrir'}</button>}</div>
            {!locked && <div className="po-upload"><label className="po-file-picker"><Upload size={16} />{file ? file.name : 'Selecionar PDF, JPG ou PNG'}<input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(event) => { setFile(event.target.files?.[0] || null); setError('') }} disabled={!!busy} /></label><small>Máximo de 10 MB. O envio fica disponível imediatamente ao funcionário.</small><button type="button" className="secondary-button" onClick={() => void attachFile()} disabled={!file || !!busy}><Upload size={15} />{busy === 'upload' ? 'Enviando…' : 'Anexar documento'}</button></div>}
          </div>
          {!locked && <div className="po-form-actions"><span><AlertTriangle size={14} />Salvar rascunho não requer arquivo; confirmar exige holerite anexado.</span><div><button className="secondary-button" type="submit" disabled={!!busy}><Save size={15} />{busy === 'save' ? 'Salvando…' : 'Salvar rascunho'}</button><button className="primary-button" type="button" onClick={() => void save(undefined, true)} disabled={!!busy}><Check size={15} />{busy === 'confirm' ? 'Confirmando…' : 'Confirmar valores oficiais'}</button></div></div>}
        </form>}
      </SectionCard>
    </div>
    <div className="po-audit-note"><ShieldCheck size={17} /><span>Os valores oficiais confirmados substituem a prévia interna somente para a pessoa confirmada. A competência permanece parcial/mista enquanto houver funcionário elegível sem confirmação. A estimativa original permanece retida para auditoria.</span></div>
  </div>
}
