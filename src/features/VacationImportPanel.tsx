import { useState } from 'react'
import { Check, FileUp, Link2, RefreshCw, X } from 'lucide-react'
import type { EmployeeRow, VacationImportBatch, VacationImportLine } from '../lib/types'
import { confirmVacationImport, linkVacationImportLine, rejectVacationImport, uploadVacationBatch } from '../lib/api'
import { SectionCard } from '../components/ui'

type Props = { token: string; employees: EmployeeRow[]; imports: VacationImportBatch[]; onDone: () => Promise<void> }
type DocType = 'aviso' | 'recibo' | 'comprovante_pagamento'
type Draft = { funcionarioId: string; periodoInicio: string; periodoFim: string; inicio: string; fim: string; retorno: string; tipo: DocType; observacoes: string }
const emptyDraft: Draft = { funcionarioId: '', periodoInicio: '', periodoFim: '', inicio: '', fim: '', retorno: '', tipo: 'aviso', observacoes: '' }

export function VacationImportPanel({ token, employees, imports, onDone }: Props) {
  const [tipo, setTipo] = useState<DocType>('aviso')
  const [files, setFiles] = useState<File[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const getDraft = (line: VacationImportLine) => drafts[line.id] || { ...emptyDraft, tipo }
  const patchDraft = (line: VacationImportLine, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [line.id]: { ...getDraft(line), ...patch } }))

  async function upload() {
    if (!files.length) return
    setBusy('upload'); setError(''); setMessage('')
    try { const count = files.length; const result = await uploadVacationBatch(token, tipo, files); setFiles([]); setMessage(`Lote criado com ${result.total_linhas || count} arquivo(s); faça a conferência manual das linhas.`); await onDone() } catch (err) { setError(err instanceof Error ? err.message : 'Falha no upload do lote') } finally { setBusy('') }
  }
  async function link(line: VacationImportLine) {
    const d = getDraft(line)
    if (!d.funcionarioId || !d.periodoInicio || !d.periodoFim || !d.inicio || !d.fim) { setError('Preencha funcionário, período aquisitivo e período de gozo antes de vincular.'); return }
    setBusy(line.id); setError(''); setMessage('')
    try { const result = await linkVacationImportLine(token, { linhaId: line.id, funcionarioId: d.funcionarioId, periodoInicio: d.periodoInicio, periodoFim: d.periodoFim, inicio: d.inicio, fim: d.fim, retorno: d.retorno, tipo: d.tipo, observacoes: d.observacoes }); if (!result.sucesso) throw new Error(result.erro || 'Linha não vinculada'); setMessage(result.duplicidade ? 'Duplicidade detectada e enviada para revisão.' : 'Linha vinculada; confirme após revisar os dados.'); await onDone() } catch (err) { setError(err instanceof Error ? err.message : 'Falha na vinculação') } finally { setBusy('') }
  }
  async function reject(line: VacationImportLine) {
    setBusy(line.id); setError(''); setMessage('')
    try { const result = await rejectVacationImport(token, line.id, getDraft(line).observacoes || 'Rejeitada pelo RH após conferência'); if (!result.sucesso) throw new Error(result.erro || 'Linha não rejeitada'); setMessage('Linha rejeitada com registro auditado.'); await onDone() } catch (err) { setError(err instanceof Error ? err.message : 'Falha na rejeição') } finally { setBusy('') }
  }
  async function confirm(line: VacationImportLine) {
    setBusy(line.id); setError(''); setMessage('')
    try { const result = await confirmVacationImport(token, line.id, getDraft(line).observacoes); if (!result.sucesso) throw new Error(result.erro || 'Linha não confirmada'); setMessage('Linha conferida e confirmada com auditoria.'); await onDone() } catch (err) { setError(err instanceof Error ? err.message : 'Falha na confirmação') } finally { setBusy('') }
  }
  function renderLine(line: VacationImportLine) {
    const d = getDraft(line); const lineBusy = busy === line.id; const editable = !['rejeitada', 'conferida'].includes(line.status)
    return <div className={`vacation-import-line status-${line.status}`} key={line.id}>
      <div className="vacation-import-file-name"><strong>{line.arquivo_nome}</strong><small>{line.status}{line.divergencia ? ` · ${line.divergencia}` : ''}</small></div>
      {editable && <div className="vacation-import-fields"><select aria-label="Funcionário da linha" value={d.funcionarioId} onChange={(e) => patchDraft(line, { funcionarioId: e.target.value })}><option value="">Funcionário</option>{employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.nome} · {employee.cpf}</option>)}</select><input aria-label="Início aquisitivo" type="date" value={d.periodoInicio} onChange={(e) => patchDraft(line, { periodoInicio: e.target.value })} /><input aria-label="Fim aquisitivo" type="date" value={d.periodoFim} onChange={(e) => patchDraft(line, { periodoFim: e.target.value })} /><input aria-label="Início do gozo" type="date" value={d.inicio} onChange={(e) => patchDraft(line, { inicio: e.target.value })} /><input aria-label="Fim do gozo" type="date" value={d.fim} onChange={(e) => patchDraft(line, { fim: e.target.value })} /><input aria-label="Retorno ao trabalho" type="date" value={d.retorno} onChange={(e) => patchDraft(line, { retorno: e.target.value })} /><select aria-label="Tipo da linha" value={d.tipo} onChange={(e) => patchDraft(line, { tipo: e.target.value as DocType })}><option value="aviso">Aviso</option><option value="recibo">Recibo</option><option value="comprovante_pagamento">Pagamento</option></select><input aria-label="Observação da linha" placeholder="Observação" value={d.observacoes} onChange={(e) => patchDraft(line, { observacoes: e.target.value })} /></div>}
      <div className="vacation-import-actions">{line.status === 'vinculada' && <button className="primary-button" type="button" disabled={lineBusy} onClick={() => void confirm(line)}><Check size={13} /> Confirmar</button>}{['pendente', 'divergente'].includes(line.status) && <button className="primary-button" type="button" disabled={lineBusy} onClick={() => void link(line)}><Link2 size={13} /> Vincular</button>}{editable && <button className="secondary-button" type="button" disabled={lineBusy} onClick={() => void reject(line)}><X size={13} /> Rejeitar</button>}</div>
    </div>
  }
  return <SectionCard title="Importação em lote de férias" caption="Envie PDFs diretamente pelo aplicativo; nenhum arquivo é lido ou vinculado ao Google Drive.">
    <div className="vacation-import-upload"><label>Tipo de documento<select value={tipo} onChange={(e) => setTipo(e.target.value as DocType)}><option value="aviso">Aviso</option><option value="recibo">Recibo</option><option value="comprovante_pagamento">Comprovante de pagamento</option></select></label><label className="vacation-import-file">PDFs (até 100 arquivos)<input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /><small>{files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Selecione vários PDFs para criar um lote pendente.'}</small></label><button className="primary-button" type="button" disabled={!files.length || busy === 'upload'} onClick={() => void upload()}>{busy === 'upload' ? <RefreshCw className="spin" size={15} /> : <FileUp size={15} />} Enviar lote</button></div>
    {error && <div className="form-error"><X size={15} />{error}</div>}{message && <div className="form-success"><Check size={15} />{message}</div>}
    {imports.length === 0 ? <p className="vacation-import-empty">Nenhum lote de importação encontrado.</p> : <div className="vacation-import-batches">{imports.map((batch) => <div className="vacation-import-batch" key={batch.id}><div className="vacation-import-batch-head"><strong>{batch.origem === 'app_upload' ? 'Upload pelo aplicativo' : batch.origem} · {batch.tipo}</strong><span>{batch.status} · {batch.linhas_pendentes} pendente(s)</span></div>{batch.linhas.map(renderLine)}</div>)}</div>}
  </SectionCard>
}
