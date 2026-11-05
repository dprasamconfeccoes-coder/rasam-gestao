import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, Download, FileText, RefreshCw, Receipt, Upload, Users } from 'lucide-react'
import { adminPayslipCompetence, adminPayslips, getPayslipDocumentUrl, listEmployees, uploadPayslip } from '../lib/api'
import type { AdminPayslipRow, EmployeeRow, PayslipCompetenceOverview } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, formatDate } from '../components/ui'
import './payslip-import.css'

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function monthLabel(month: number, year: number) {
  return `${String(month).padStart(2, '0')}/${year}`
}

function competenceLabel(value: string) {
  const [year, month] = value.split('-').map(Number)
  return monthLabel(month, year)
}

export function PayslipImportDashboard({ token }: { token: string }) {
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [rows, setRows] = useState<AdminPayslipRow[]>([])
  const [overview, setOverview] = useState<PayslipCompetenceOverview | null>(null)
  const [employeeId, setEmployeeId] = useState('')
  const [competencia, setCompetencia] = useState(new Date().toISOString().slice(0, 7))
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openingId, setOpeningId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [employeeRows, payslipData, competenceData] = await Promise.all([
        listEmployees(token), adminPayslips(token), adminPayslipCompetence(token, competencia),
      ])
      if (!payslipData.sucesso) throw new Error(payslipData.erro || 'Falha ao consultar holerites')
      if (!competenceData.sucesso) throw new Error(competenceData.erro || 'Falha ao calcular a cobertura da competência')
      setEmployees(employeeRows.filter((employee) => employee.ativo && employee.elegivel_holerite !== false))
      setRows(payslipData.holerites || [])
      setOverview(competenceData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar a importação de holerites')
      setOverview(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [token, competencia])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (!employeeId) { setError('Selecione o funcionário.'); return }
    if (!competencia) { setError('Selecione a competência.'); return }
    if (!file) { setError('Selecione o PDF do holerite.'); return }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('O arquivo precisa ser um PDF.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('O PDF deve ter no máximo 10 MB.'); return }

    setSaving(true)
    try {
      await uploadPayslip(token, employeeId, competencia, file)
      setMessage('PDF privado importado e disponibilizado no portal do funcionário. Isso não altera nem confirma o processamento da folha.')
      setFile(null)
      setEmployeeId('')
      const input = document.getElementById('payslip-file') as HTMLInputElement | null
      if (input) input.value = ''
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível importar o holerite')
    } finally {
      setSaving(false)
    }
  }

  async function openDocument(row: AdminPayslipRow, download = false) {
    setOpeningId(row.id)
    setError('')
    if (!row.tem_arquivo_privado || !row.disponivel) {
      setOpeningId('')
      setError(row.disponivel
        ? 'Este registro é legado e não tem cópia no Storage privado. Reenvie o PDF antes de disponibilizá-lo.'
        : 'Este holerite não está disponível para abertura.')
      return
    }
    const popup = window.open('about:blank', '_blank')
    try {
      const signed = await getPayslipDocumentUrl(token, row.id, download)
      if (!signed.url) throw new Error('URL do documento não encontrada')
      if (popup) popup.location.href = signed.url
      else window.open(signed.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      popup?.close()
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o holerite')
    } finally {
      setOpeningId('')
    }
  }

  const pending = overview?.pendencias || []

  return <>
    <PageHeading
      eyebrow="Controle · documentos"
      title="Holerites e folha"
      description="Acompanhe a cobertura dos PDFs recebidos do escritório por competência. Estes indicadores documentais não confirmam processamento ou pagamento da folha."
      action={<button className="secondary-button" type="button" onClick={() => void reload()} disabled={loading || saving}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>}
    />
    {error && <ErrorState message={error} />}
    {message && <div className="form-success inline-message"><Check size={16} />{message}</div>}

    <SectionCard title="Cobertura de holerites" caption="Competência e cobertura são calculadas no servidor, dentro da empresa da sessão.">
      <div className="payslip-competence-toolbar">
        <label>Competência<input type="month" value={competencia} onChange={(event) => setCompetencia(event.target.value)} required /></label>
        {overview && <span>{competenceLabel(competencia)} · {overview.cobertura_percentual == null ? 'Sem vínculos elegíveis' : `${overview.cobertura_percentual}% com PDF privado`}</span>}
      </div>
      {loading ? <LoadingState label="Calculando a cobertura da competência…" /> : overview && <>
        <div className="payslip-overview-grid">
          <article><Users size={17} /><span>Elegíveis no período</span><strong>{overview.funcionarios_elegiveis ?? 0}</strong></article>
          <article><Check size={17} /><span>PDFs privados recebidos</span><strong>{overview.holerites_privados_recebidos ?? 0}</strong></article>
          <article><AlertTriangle size={17} /><span>Sem holerite</span><strong>{overview.holerites_ausentes ?? 0}</strong></article>
          <article><RefreshCw size={17} /><span>Reenvio necessário</span><strong>{overview.holerites_reenvio ?? 0}</strong></article>
        </div>
        <p className="payslip-scope-note"><AlertTriangle size={15} />{overview.escopo || 'Conta somente PDF privado disponível; não é indicador de folha oficial processada ou paga.'}</p>
      </>}
    </SectionCard>

    <SectionCard title={`Fila de holerites · ${competenceLabel(competencia)}`} caption="Ausentes e registros legados sem PDF privado disponível.">
      {loading ? <LoadingState label="Carregando pendências…" /> : !overview ? <EmptyState title="Fila indisponível" description="Atualize a tela ou tente novamente mais tarde." /> : pending.length === 0 ? <EmptyState title="Nenhuma pendência de documento" description={overview.funcionarios_elegiveis ? 'Todos os vínculos elegíveis desta competência têm PDF privado disponível.' : 'Não há vínculos elegíveis para a competência selecionada.'} /> : <>
        <div className="payslip-pending-list">{pending.map((item) => <article key={item.funcionario_id}>
          <span className={`payslip-pending-status ${item.status === 'ausente' ? 'is-missing' : 'is-reupload'}`}>{item.status === 'ausente' ? 'Ausente' : 'Reenviar PDF'}</span>
          <strong>{item.nome}</strong>
          <small>{item.status === 'ausente' ? 'Nenhum registro de holerite para esta competência.' : 'Há registro, mas não há PDF privado disponível no portal.'}</small>
          <button className="secondary-button" type="button" onClick={() => { setEmployeeId(item.funcionario_id); document.getElementById('payslip-new-upload')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>Preparar envio</button>
        </article>)}</div>
        {overview.pendencias_limitadas && <p className="payslip-scope-note"><AlertTriangle size={15} />A fila exibe as primeiras 1.000 pendências; há {overview.pendencias_total} no total.</p>}
      </>}
    </SectionCard>

    <div className="two-column payslip-import-layout">
      <SectionCard title="Novo holerite" caption="O PDF fica privado e só é aberto com uma URL temporária">
        <form id="payslip-new-upload" className="form-stack payslip-import-form" onSubmit={submit}>
          <label>Funcionário<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required><option value="">Selecione um funcionário elegível</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome} · {employee.cpf}</option>)}</select></label>
          <label>Competência<input type="month" value={competencia} onChange={(event) => setCompetencia(event.target.value)} required /></label>
          <label className="payslip-file-picker">Arquivo PDF<input id="payslip-file" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label>
          {file ? <div className="selected-file"><FileText size={18} /><div><strong>{file.name}</strong><small>{fileSize(file.size)} · PDF selecionado</small></div></div> : <div className="payslip-upload-hint"><Upload size={18} /><div><strong>Selecione o PDF recebido do escritório</strong><small>Somente PDF · limite de 10 MB</small></div></div>}
          <button className="primary-button" type="submit" disabled={saving}>{saving ? <><RefreshCw size={16} className="spin" /> Importando…</> : <><Upload size={16} /> Importar PDF privado</>}</button>
        </form>
      </SectionCard>
      <SectionCard title="O que esses indicadores significam" caption="Documento recebido não é sinônimo de folha processada">
        <div className="payslip-process"><div><span>01</span><p><strong>Universo da competência</strong><small>O servidor considera vínculos elegíveis que coincidem com o mês selecionado, dentro da empresa da sessão.</small></p></div><div><span>02</span><p><strong>PDF recebido</strong><small>Só conta como recebido quando existe PDF privado disponível no portal; registros legados exigem reenvio.</small></p></div><div><span>03</span><p><strong>Processamento externo</strong><small>A tela não presume que o escritório processou ou pagou a folha. INSS, IRRF, sindicato e DSR não são recalculados aqui.</small></p></div></div>
      </SectionCard>
    </div>

    <SectionCard title="Holerites importados" caption={`${rows.length} registro(s) no ambiente`}>
      {loading ? <LoadingState label="Consultando holerites…" /> : rows.length === 0 ? <EmptyState title="Nenhum holerite importado" description="Os documentos enviados aparecerão aqui para conferência." /> : <div className="document-list payslip-history">{rows.map((row) => <div className="document-row" key={row.id}><span className="document-icon"><Receipt size={18} /></span><div><strong>{row.nome} · {monthLabel(row.mes, row.ano)}</strong><small>{row.arquivo_nome || 'Holerite'} · importado {formatDate(row.created_at)}</small></div>{row.tem_arquivo_privado && row.disponivel ? <button className="icon-button" type="button" onClick={() => void openDocument(row)} disabled={openingId === row.id} aria-label={`Abrir holerite de ${row.nome}`} title="Abrir PDF privado">{openingId === row.id ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}</button> : <small className="table-note">{row.disponivel ? 'Legado · reenviar PDF' : 'Indisponível'}</small>}</div>)}</div>}
    </SectionCard>
  </>
}
