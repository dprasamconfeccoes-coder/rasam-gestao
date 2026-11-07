import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowRight, CalendarDays, Check, Download, Eye, FileSpreadsheet, FileText, LockKeyhole, RefreshCw, Receipt, Search, Upload, Users } from 'lucide-react'
import { adminPayslipCompetence, adminPayslips, getPayslipDocumentUrl, listEmployees, uploadPayslip } from '../lib/api'
import type { AdminPayslipRow, EmployeeRow, PayslipCompetenceOverview } from '../lib/types'
import { EmptyState, LoadingState, PageHeading, SectionCard, formatDate } from '../components/ui'
import './payslip-import.css'

type PayslipStatusFilter = 'todos' | 'disponivel' | 'reenvio' | 'indisponivel'
type PendingStatusFilter = 'todas' | 'ausente' | 'reenvio'

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function monthLabel(month: number, year: number) {
  return `${String(month).padStart(2, '0')}/${year}`
}

function competenceLabel(value: string) {
  const [year, month] = value.split('-').map(Number)
  return month && year ? monthLabel(month, year) : value
}

function currentCompetence() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function payslipStatus(row: AdminPayslipRow): { key: Exclude<PayslipStatusFilter, 'todos'>; label: string; canOpen: boolean } {
  if (row.tem_arquivo_privado && row.disponivel) return { key: 'disponivel', label: 'Privado · disponível', canOpen: true }
  if (row.disponivel) return { key: 'reenvio', label: 'Legado · reenviar arquivo', canOpen: false }
  return { key: 'indisponivel', label: 'Indisponível', canOpen: false }
}

export function PayslipImportDashboard({ token, onNavigateToPayroll }: { token: string; onNavigateToPayroll?: () => void }) {
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [rows, setRows] = useState<AdminPayslipRow[]>([])
  const [overview, setOverview] = useState<PayslipCompetenceOverview | null>(null)
  const [employeeId, setEmployeeId] = useState('')
  const [competencia, setCompetencia] = useState(currentCompetence)
  const [file, setFile] = useState<File | null>(null)
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [pendingSearch, setPendingSearch] = useState('')
  const [pendingStatus, setPendingStatus] = useState<PendingStatusFilter>('todas')
  const [historySearch, setHistorySearch] = useState('')
  const [historyCompetence, setHistoryCompetence] = useState('todas')
  const [historyStatus, setHistoryStatus] = useState<PayslipStatusFilter>('todos')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openingId, setOpeningId] = useState('')
  const [downloadingId, setDownloadingId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const requestRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function reload() {
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    setRows([])
    setOverview(null)
    try {
      const [employeeRows, payslipData, competenceData] = await Promise.all([
        listEmployees(token), adminPayslips(token), adminPayslipCompetence(token, competencia),
      ])
      if (requestId !== requestRef.current) return
      if (!payslipData.sucesso) throw new Error(payslipData.erro || 'Falha ao consultar holerites')
      if (!competenceData.sucesso) throw new Error(competenceData.erro || 'Falha ao calcular a cobertura da competência')
      setEmployees(employeeRows.filter((employee) => employee.ativo && employee.elegivel_holerite !== false))
      setRows(payslipData.holerites || [])
      setOverview(competenceData)
    } catch (err) {
      if (requestId === requestRef.current) setError(err instanceof Error ? err.message : 'Falha ao carregar a gestão de holerites')
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    return () => { requestRef.current += 1 }
  }, [token, competencia])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (!employeeId) { setError('Selecione o funcionário.'); return }
    if (!competencia) { setError('Selecione a competência.'); return }
    if (!file) { setError('Selecione o PDF ou a foto/scan do holerite.'); return }
    const supportedMime = ['application/pdf', 'image/jpeg', 'image/png']
    const supportedExtension = /\.(pdf|jpe?g|png)$/i.test(file.name)
    if (!supportedExtension || (file.type && file.type !== 'application/octet-stream' && !supportedMime.includes(file.type))) { setError('Use somente PDF, JPG/JPEG ou PNG.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('O arquivo deve ter no máximo 10 MB.'); return }

    setSaving(true)
    try {
      await uploadPayslip(token, employeeId, competencia, file)
      setMessage('Documento privado enviado/atualizado. O envio não confirma os valores oficiais da folha.')
      setFile(null)
      setEmployeeId('')
      setEmployeeSearch('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o holerite')
    } finally {
      setSaving(false)
    }
  }

  async function openDocument(row: AdminPayslipRow, download = false) {
    const status = payslipStatus(row)
    if (!status.canOpen) {
      setError(status.key === 'reenvio'
        ? 'Este registro legado não possui cópia privada. Selecione Reenviar e anexe novamente o documento.'
        : 'Este holerite está indisponível para abertura.')
      return
    }
    if (download) setDownloadingId(row.id)
    else setOpeningId(row.id)
    setError('')
    const popup = window.open('about:blank', '_blank')
    try {
      const signed = await getPayslipDocumentUrl(token, row.id, download)
      if (!signed.url) throw new Error('URL do documento não encontrada')
      if (popup) popup.location.href = signed.url
      else window.open(signed.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      popup?.close()
      setError(err instanceof Error ? err.message : `Não foi possível ${download ? 'baixar' : 'abrir'} o holerite`)
    } finally {
      if (download) setDownloadingId('')
      else setOpeningId('')
    }
  }

  function prepareUpload(funcionarioId: string, targetCompetencia = competencia) {
    setEmployeeId(funcionarioId)
    setEmployeeSearch('')
    setCompetencia(targetCompetencia)
    setFile(null)
    setError('')
    setMessage('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    window.setTimeout(() => {
      document.getElementById('payslip-upload-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      document.getElementById('payslip-employee-search')?.focus({ preventScroll: true })
    }, 0)
  }

  const pending = overview?.pendencias || []
  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLocaleLowerCase('pt-BR')
    const digits = employeeSearch.replace(/\D/g, '')
    if (!query) return employees
    return employees.filter((employee) => employee.id === employeeId
      || employee.nome.toLocaleLowerCase('pt-BR').includes(query)
      || Boolean(digits && employee.cpf.replace(/\D/g, '').includes(digits)))
  }, [employees, employeeSearch, employeeId])
  const filteredPending = useMemo(() => {
    const query = pendingSearch.trim().toLocaleLowerCase('pt-BR')
    return pending.filter((item) => (pendingStatus === 'todas' || item.status === pendingStatus)
      && (!query || item.nome.toLocaleLowerCase('pt-BR').includes(query)))
  }, [pending, pendingSearch, pendingStatus])
  const historyCompetences = useMemo(() => [...new Set(rows.map((row) => `${row.ano}-${String(row.mes).padStart(2, '0')}`))].sort().reverse(), [rows])
  const filteredRows = useMemo(() => {
    const query = historySearch.trim().toLocaleLowerCase('pt-BR')
    return rows.filter((row) => {
      const status = payslipStatus(row)
      const employeeMatches = !query || row.nome.toLocaleLowerCase('pt-BR').includes(query)
        || (row.arquivo_nome || '').toLocaleLowerCase('pt-BR').includes(query)
      const competenceMatches = historyCompetence === 'todas' || `${row.ano}-${String(row.mes).padStart(2, '0')}` === historyCompetence
      return employeeMatches && competenceMatches && (historyStatus === 'todos' || status.key === historyStatus)
    })
  }, [rows, historySearch, historyCompetence, historyStatus])
  const coverage = overview?.cobertura_percentual
  const coverageWidth = coverage == null || !Number.isFinite(coverage) ? 0 : Math.max(0, Math.min(100, coverage))

  return <div className="payslip-management-page">
    <PageHeading title="Gestão de holerites" action={<div className="payslip-header-actions">
      {onNavigateToPayroll && <button className="secondary-button" type="button" onClick={onNavigateToPayroll}><FileSpreadsheet size={15} /> Valores oficiais <ArrowRight size={14} /></button>}
      <button className="secondary-button" type="button" onClick={() => void reload()} disabled={loading || saving}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar</button>
    </div>} />
    {error && <div className="payslip-feedback is-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}
    {message && <div className="payslip-feedback is-success" role="status"><Check size={16} /><span>{message}</span></div>}

    <SectionCard title="Cobertura da competência" action={<label className="payslip-period-picker"><span>Competência</span><input type="month" value={competencia} onChange={(event) => setCompetencia(event.target.value)} disabled={saving} required /></label>}>
      <div className="payslip-section-body">
        {loading ? <LoadingState label="Atualizando cobertura e documentos…" /> : overview ? <>
          <div className="payslip-coverage-meter"><div><strong>{coverage == null ? '—' : `${coverage}%`}</strong><span>{coverage == null ? 'sem vínculos elegíveis' : `cobertura documental · ${competenceLabel(competencia)}`}</span></div><div className="payslip-coverage-track" role="meter" aria-label="Cobertura de documentos privados" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverageWidth}><span style={{ width: `${coverageWidth}%` }} /></div></div>
          <div className="payslip-overview-grid">
            <article className="tone-blue"><Users size={17} /><span>Vínculos elegíveis</span><strong>{overview.funcionarios_elegiveis ?? 0}</strong></article>
            <article className="tone-green"><Check size={17} /><span>Arquivo privado disponível</span><strong>{overview.holerites_privados_recebidos ?? 0}</strong></article>
            <article className="tone-red"><AlertTriangle size={17} /><span>Sem registro</span><strong>{overview.holerites_ausentes ?? 0}</strong></article>
            <article className="tone-amber"><RefreshCw size={17} /><span>Reenvio necessário</span><strong>{overview.holerites_reenvio ?? 0}</strong></article>
          </div>
          <details className="payslip-scope-details"><summary><LockKeyhole size={14} /> Regras e escopo dos indicadores</summary><div><p>{overview.escopo || 'A cobertura considera documentos privados disponíveis para os vínculos elegíveis da competência.'}</p><small>Documento recebido não significa folha oficial processada ou paga. Os valores oficiais são registrados separadamente.</small></div></details>
        </> : <EmptyState title="Cobertura indisponível" description="Atualize a tela ou tente novamente mais tarde." />}
      </div>
    </SectionCard>

    <div className="two-column payslip-management-workspace">
      <SectionCard title={`Pendências de envio · ${competenceLabel(competencia)}`}>
        <div className="payslip-section-body">
          {loading ? <LoadingState label="Consultando pendências…" /> : !overview ? <EmptyState title="Fila indisponível" description="Atualize a tela ou tente novamente mais tarde." /> : <>
            <div className="payslip-list-toolbar"><label className="payslip-search-field"><Search size={15} /><input type="search" value={pendingSearch} onChange={(event) => setPendingSearch(event.target.value)} placeholder="Filtrar por funcionário" aria-label="Filtrar pendências por funcionário" /></label><label className="payslip-select-filter"><span>Status</span><select value={pendingStatus} onChange={(event) => setPendingStatus(event.target.value as PendingStatusFilter)}><option value="todas">Todas</option><option value="ausente">Ausente</option><option value="reenvio">Reenviar</option></select></label><small className="payslip-results-count">{filteredPending.length} de {overview.pendencias_total ?? pending.length}</small></div>
            {filteredPending.length ? <div className="payslip-pending-list">{filteredPending.map((item) => <article key={item.funcionario_id}>
              <span className={`payslip-pending-status ${item.status === 'ausente' ? 'is-missing' : 'is-reupload'}`}>{item.status === 'ausente' ? 'Ausente' : 'Reenviar'}</span>
              <strong>{item.nome}</strong>
              <small>{item.status === 'ausente' ? 'Nenhum documento registrado nesta competência.' : 'Registro sem arquivo privado disponível; envie uma cópia atualizada.'}</small>
              <button className="secondary-button" type="button" onClick={() => prepareUpload(item.funcionario_id)} disabled={saving}><Upload size={14} /> Preparar envio</button>
            </article>)}</div> : pending.length === 0 ? <EmptyState title="Sem pendências de envio" description="Não há ausências ou documentos que precisem de reenvio nesta competência." /> : <EmptyState title="Nenhuma pendência corresponde ao filtro" description="Ajuste a busca ou o status. Os filtros não alteram os registros." />}
            {overview.pendencias_limitadas && <p className="payslip-limit-note"><AlertTriangle size={14} />Exibindo as primeiras 1.000 pendências de {overview.pendencias_total}. Use a busca para localizar funcionários na lista carregada.</p>}
          </>}
        </div>
      </SectionCard>

      <SectionCard title={`Enviar documento · ${competenceLabel(competencia)}`} className="payslip-upload-card">
        <div id="payslip-upload-section" className="payslip-section-body">
          <form id="payslip-new-upload" className="form-stack payslip-import-form" onSubmit={submit}>
            <label>Filtrar funcionário<input id="payslip-employee-search" type="search" value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Nome ou CPF" autoComplete="off" disabled={saving || loading} /></label>
            <label>Funcionário<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} disabled={saving || loading} required><option value="">Selecione um funcionário</option>{filteredEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome}{employee.cargo ? ` · ${employee.cargo}` : ''}</option>)}</select></label>
            {employeeSearch && filteredEmployees.length === 0 ? <small className="payslip-no-employees">Nenhum funcionário corresponde à busca.</small> : null}
            <label className="payslip-file-picker">Documento PDF ou imagem<input ref={fileInputRef} id="payslip-file" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(event) => setFile(event.target.files?.[0] || null)} disabled={saving || loading} required /></label>
            {file ? <div className="selected-file"><FileText size={18} /><div><strong>{file.name}</strong><small>{fileSize(file.size)} · documento selecionado</small></div></div> : <div className="payslip-upload-hint"><Upload size={18} /><div><strong>Selecione o holerite do escritório</strong><small>PDF, JPG/JPEG ou PNG · limite de 10 MB</small></div></div>}
            <div className="payslip-privacy-note"><LockKeyhole size={15} /><span>Arquivo privado. Funcionário e administradores acessam por link temporário; substituir exige reabrir uma folha oficial já confirmada.</span></div>
            <button className="primary-button payslip-submit-button" type="submit" disabled={saving || loading || employees.length === 0}>{saving ? <><RefreshCw size={15} className="spin" /> Enviando…</> : <><Upload size={15} /> Enviar / atualizar documento</>}</button>
          </form>
        </div>
      </SectionCard>
    </div>

    <SectionCard title="Histórico de holerites" caption={`${filteredRows.length} exibido(s) de ${rows.length} registro(s)`}>
      <div className="payslip-section-body payslip-history-body">
        <div className="payslip-list-toolbar payslip-history-toolbar"><label className="payslip-search-field"><Search size={15} /><input type="search" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Funcionário ou nome do arquivo" aria-label="Buscar no histórico por funcionário ou arquivo" /></label><label className="payslip-select-filter"><span>Competência</span><select value={historyCompetence} onChange={(event) => setHistoryCompetence(event.target.value)}><option value="todas">Todas</option>{historyCompetences.map((value) => <option key={value} value={value}>{competenceLabel(value)}</option>)}</select></label><label className="payslip-select-filter"><span>Situação</span><select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value as PayslipStatusFilter)}><option value="todos">Todas</option><option value="disponivel">Privado disponível</option><option value="reenvio">Reenvio necessário</option><option value="indisponivel">Indisponível</option></select></label></div>
        {loading ? <LoadingState label="Consultando histórico…" /> : rows.length === 0 ? <EmptyState title="Nenhum holerite registrado" description="Os documentos enviados aparecerão aqui para conferência e acesso." /> : filteredRows.length === 0 ? <EmptyState title="Nenhum resultado para estes filtros" description="Tente outro nome, competência ou situação." /> : <div className="table-wrap payslip-history-table-wrap"><table><thead><tr><th>Funcionário</th><th>Competência</th><th>Documento</th><th>Situação</th><th>Recebido em</th><th>Ações</th></tr></thead><tbody>{filteredRows.map((row) => {
          const status = payslipStatus(row)
          const month = `${row.ano}-${String(row.mes).padStart(2, '0')}`
          return <tr key={row.id}>
            <td><strong>{row.nome}</strong></td>
            <td>{monthLabel(row.mes, row.ano)}</td>
            <td><span className="payslip-file-name"><Receipt size={14} />{row.arquivo_nome || 'Holerite sem nome de arquivo'}</span></td>
            <td><span className={`payslip-history-status is-${status.key}`}>{status.label}</span></td>
            <td>{formatDate(row.created_at)}</td>
            <td><div className="payslip-row-actions"><button className="secondary-button" type="button" onClick={() => void openDocument(row)} disabled={!status.canOpen || openingId === row.id} title={status.canOpen ? 'Abrir documento privado' : 'Arquivo privado indisponível'}><Eye size={14} />Abrir</button><button className="secondary-button" type="button" onClick={() => void openDocument(row, true)} disabled={!status.canOpen || downloadingId === row.id} title={status.canOpen ? 'Baixar documento privado' : 'Arquivo privado indisponível'}><Download size={14} />Baixar</button><button className="secondary-button" type="button" onClick={() => prepareUpload(row.funcionario_id, month)} disabled={saving} title="Selecionar funcionário e competência para reenviar"><Upload size={14} />Reenviar</button></div></td>
          </tr>
        })}</tbody></table></div>}
        {rows.length >= 1000 ? <p className="payslip-limit-note"><AlertTriangle size={14} />A listagem administrativa retorna até 1.000 registros mais recentes; refine por competência ou funcionário para localizar um documento.</p> : null}
      </div>
    </SectionCard>
  </div>
}
