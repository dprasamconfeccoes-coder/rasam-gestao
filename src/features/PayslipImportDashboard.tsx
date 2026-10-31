import { useEffect, useState, type FormEvent } from 'react'
import { Check, Download, FileText, RefreshCw, Receipt, Upload } from 'lucide-react'
import { adminPayslips, getPayslipDocumentUrl, listEmployees, uploadPayslip } from '../lib/api'
import type { AdminPayslipRow, EmployeeRow } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, formatDate } from '../components/ui'
import './payslip-import.css'

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function monthLabel(month: number, year: number) {
  return `${String(month).padStart(2, '0')}/${year}`
}

export function PayslipImportDashboard({ token }: { token: string }) {
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [rows, setRows] = useState<AdminPayslipRow[]>([])
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
      const [employeeRows, payslipData] = await Promise.all([listEmployees(token), adminPayslips(token)])
      if (!payslipData.sucesso) throw new Error(payslipData.erro || 'Falha ao consultar holerites')
      setEmployees(employeeRows.filter((employee) => employee.ativo && employee.elegivel_holerite !== false))
      setRows(payslipData.holerites || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar a importação de holerites')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [token])

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
      setMessage('Holerite importado e disponibilizado no portal do funcionário.')
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
    const popup = window.open('about:blank', '_blank')
    try {
      if (row.arquivo_url?.startsWith('http')) {
        if (popup) popup.location.href = row.arquivo_url
        else window.open(row.arquivo_url, '_blank', 'noopener,noreferrer')
        return
      }
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

  return <>
    <PageHeading
      eyebrow="Controle · documentos"
      title="Importar holerite"
      description="Associe o PDF recebido do escritório ao funcionário e à competência correta."
      action={<button className="secondary-button" type="button" onClick={() => void reload()} disabled={loading || saving}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>}
    />
    {error && <ErrorState message={error} />}
    {message && <div className="form-success inline-message"><Check size={16} />{message}</div>}
    <div className="two-column payslip-import-layout">
      <SectionCard title="Novo holerite" caption="O arquivo fica privado e só é aberto com uma URL temporária">
        <form className="form-stack payslip-import-form" onSubmit={submit}>
          <label>Funcionário<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required><option value="">Selecione um funcionário elegível</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome} · {employee.cpf}</option>)}</select></label>
          <label>Competência<input type="month" value={competencia} onChange={(event) => setCompetencia(event.target.value)} required /></label>
          <label className="payslip-file-picker">Arquivo PDF<input id="payslip-file" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label>
          {file ? <div className="selected-file"><FileText size={18} /><div><strong>{file.name}</strong><small>{fileSize(file.size)} · PDF selecionado</small></div></div> : <div className="payslip-upload-hint"><Upload size={18} /><div><strong>Selecione o PDF enviado pelo escritório</strong><small>Somente PDF · limite de 10 MB</small></div></div>}
          <button className="primary-button" type="submit" disabled={saving}>{saving ? <><RefreshCw size={16} className="spin" /> Importando…</> : <><Upload size={16} /> Importar e disponibilizar</>}</button>
        </form>
      </SectionCard>
      <SectionCard title="Como funciona" caption="Fluxo seguro para o departamento pessoal"><div className="payslip-process"><div><span>01</span><p><strong>Escolha a pessoa</strong><small>O sistema mostra somente funcionários ativos e elegíveis a holerite.</small></p></div><div><span>02</span><p><strong>Informe a competência</strong><small>Use o mês de referência do documento recebido do escritório.</small></p></div><div><span>03</span><p><strong>Envie o PDF</strong><small>O arquivo é armazenado em área privada e aparece no portal do funcionário.</small></p></div></div></SectionCard>
    </div>
    <SectionCard title="Holerites importados" caption={`${rows.length} registro(s) no ambiente`}>
      {loading ? <LoadingState label="Consultando holerites…" /> : rows.length === 0 ? <EmptyState title="Nenhum holerite importado" description="Os documentos enviados aparecerão aqui para conferência." /> : <div className="document-list payslip-history">{rows.map((row) => <div className="document-row" key={row.id}><span className="document-icon"><Receipt size={18} /></span><div><strong>{row.nome} · {monthLabel(row.mes, row.ano)}</strong><small>{row.arquivo_nome || 'Holerite'} · importado {formatDate(row.created_at)}</small></div><button className="icon-button" type="button" onClick={() => void openDocument(row)} disabled={openingId === row.id} aria-label={`Abrir holerite de ${row.nome}`} title="Abrir PDF">{openingId === row.id ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}</button></div>)}</div>}
    </SectionCard>
  </>
}
