import { AlertTriangle, Check, ExternalLink, FileText, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import type { AdminVacationManagementRow, EmployeeRow, VacationImportBatch, VacationImportLine } from '../lib/types'
import { confirmVacationImport, rejectVacationImport } from '../lib/api'
import { EmptyState, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import { HRVacationPanel } from './HRVacationPanel'

function statusLabel(status: string) {
  if (status === 'conferida') return 'Conferida'
  if (status === 'vinculada') return 'Vinculada · conferir'
  if (status === 'divergente') return 'Divergente'
  if (status === 'rejeitada') return 'Rejeitada'
  return 'Pendente'
}

function lineDetail(line: VacationImportLine) {
  return `${formatDate(line.inicio)} até ${formatDate(line.fim)} · aquisitivo ${formatDate(line.periodo_aquisitivo_inicio)} até ${formatDate(line.periodo_aquisitivo_fim)}`
}

export function HRVacationManagementPanel({ token, employees, vacations, imports, onDone }: { token: string; employees: EmployeeRow[]; vacations: AdminVacationManagementRow[]; imports: VacationImportBatch[]; onDone: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const batch = imports[0]
  const linked = vacations.filter((row) => row.importacao_status === 'pendente_conferencia').length
  const reviewed = vacations.filter((row) => row.importacao_status === 'conferida').length
  const divergences = batch?.linhas.filter((line) => line.status === 'divergente').length || 0

  async function review(line: VacationImportLine, action: 'confirm' | 'reject') {
    if (!line.ferias_id) return
    setBusyId(line.id); setError(''); setMessage('')
    try {
      const result = action === 'confirm'
        ? await confirmVacationImport(token, line.id, 'Conferido pelo RH na tela de Gestão de Férias.')
        : await rejectVacationImport(token, line.id, 'Rejeitado pelo RH na tela de Gestão de Férias.')
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar a conferência')
      setMessage(action === 'confirm' ? 'Aviso conferido e mantido no histórico de férias.' : 'Aviso rejeitado e mantido no histórico de importação.')
      await onDone()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar a conferência') } finally { setBusyId(null) }
  }

  return <div className="hr-vacation-management">
    <div className="hr-overview-strip vacation-management-summary">
      <div><span>Períodos cadastrados</span><strong>{vacations.length}</strong><small>Inclui os avisos importados</small></div>
      <div><span>Aguardando conferência</span><strong>{linked}</strong><small>Dados extraídos dos avisos</small></div>
      <div><span>Conferidos</span><strong>{reviewed}</strong><small>Revisão administrativa concluída</small></div>
      <div><span>Divergências</span><strong className={divergences ? 'is-danger-text' : ''}>{divergences}</strong><small>CPF não localizado ou inconsistência</small></div>
    </div>
    {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
    {message && <div className="form-success"><Check size={16} />{message}</div>}
    <SectionCard title="Importação e conferência" caption={batch ? `${batch.pasta_nome || 'Origem externa'} · ${batch.total_linhas} aviso(s) analisado(s)` : 'Nenhuma importação de avisos encontrada'}>
      {!batch ? <EmptyState title="Nenhuma importação disponível" description="Os avisos importados aparecerão aqui para conferência do RH." /> : <>
        <div className="hr-panel-toolbar"><div><strong>Os avisos foram importados por CPF</strong><small>Confira período, funcionário e documento antes de marcar cada linha como conferida. Recibos e valores financeiros ainda não foram importados.</small></div><div className="button-row"><StatusPill value={batch.status === 'parcial' ? 'Revisão pendente' : batch.status} /><button className="secondary-button" type="button" onClick={() => void onDone()}><RefreshCw size={15} /> Atualizar</button></div></div>
        <div className="import-summary vacation-import-summary"><div className="import-stat"><span>Linhas lidas</span><strong>{batch.total_linhas}</strong></div><div className="import-stat valid"><span>Vinculadas</span><strong>{batch.linhas_vinculadas}</strong></div><div className="import-stat invalid"><span>Pendentes/divergentes</span><strong>{batch.linhas_pendentes}</strong></div><div className="import-stat"><span>Origem</span><strong>Google Drive</strong></div></div>
        <div className="vacation-import-list">{batch.linhas.map((line) => <article className={`vacation-import-row ${line.status === 'divergente' ? 'is-divergent' : ''}`} key={line.id}><span className="document-icon"><FileText size={18} /></span><div className="vacation-import-main"><strong>{line.nome_extraido}</strong><small>{line.cpf_extraido || 'CPF não extraído'} · {lineDetail(line)}</small><small>{line.arquivo_nome}{line.abono_solicitado ? ' · abono pecuniário solicitado no aviso' : ''}</small>{line.divergencia && <small className="table-note">{line.divergencia}</small>}</div><StatusPill value={statusLabel(line.status)} /><div className="vacation-import-actions">{line.status === 'vinculada' && <><button className="icon-button" type="button" title="Marcar aviso como conferido" aria-label="Marcar aviso como conferido" disabled={busyId === line.id} onClick={() => void review(line, 'confirm')}>{busyId === line.id ? <RefreshCw className="spin" size={15} /> : <Check size={15} />}</button><button className="icon-button danger" type="button" title="Rejeitar aviso" aria-label="Rejeitar aviso" disabled={busyId === line.id} onClick={() => void review(line, 'reject')}><X size={15} /></button></>}{line.status === 'divergente' && <span className="field-note">Corrija o cadastro pelo CPF antes de conferir</span>}</div></article>)}</div>
        <div className="callout"><ShieldCheck size={18} /><p>A importação está protegida por empresa e perfil administrativo. Os registros ficam com status de conferência e não liberam documentos para funcionários nesta etapa.</p></div>
      </>}
    </SectionCard>
    <HRVacationPanel token={token} employees={employees} vacations={vacations} onDone={onDone} />
    {vacations.length > 0 && <SectionCard title="Leitura financeira preparada" caption="A próxima etapa será importar os recibos e os cálculos"><div className="vacation-finance-preview">{vacations.slice(0, 6).map((row) => <div key={row.id}><div><strong>{row.nome}</strong><small>{formatDate(row.inicio)} até {formatDate(row.fim)} · {row.documentos_count} aviso(s)</small></div><span>{row.calculo ? formatMoney(Number(row.calculo.total_liquido || 0)) : 'Aguardando recibo'}</span>{row.documentos_count > 0 && <ExternalLink size={14} />}</div>)}</div></SectionCard>}
  </div>
}
