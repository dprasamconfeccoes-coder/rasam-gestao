import { AlertTriangle, CalendarDays, CheckCircle2, ExternalLink, FileWarning, WalletCards } from 'lucide-react'
import type { AdminVacationManagementRow, EmployeeRow, VacationImportBatch, VacationReconciliationSummary } from '../lib/types'
import { SectionCard, formatDate, formatMoney } from '../components/ui'
import { HRVacationPanel } from './HRVacationPanel'

function sameOrBefore(value: string | null, reference: string) { return Boolean(value && value <= reference) }
function sameOrAfter(value: string | null, reference: string) { return Boolean(value && value >= reference) }

export function HRVacationManagementPanel({ token, employees, vacations, imports, reconciliation, onDone }: { token: string; employees: EmployeeRow[]; vacations: AdminVacationManagementRow[]; imports: VacationImportBatch[]; reconciliation: VacationReconciliationSummary; onDone: () => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10)
  const activeNow = vacations.filter((row) => sameOrBefore(row.inicio, today) && sameOrAfter(row.fim, today) && row.status !== 'cancelada').length
  const upcoming = vacations.filter((row) => sameOrAfter(row.inicio, today) && row.status !== 'cancelada').length
  const pendingEmployees = imports.flatMap((batch) => batch.linhas).filter((line) => line.status === 'divergente').length
  const attention = reconciliation.avisos_sem_recibo + reconciliation.recibos_sem_aviso

  return <div className="hr-vacation-management">
    <div className="vacation-page-intro"><div><span className="eyebrow">Recursos humanos · planejamento</span><h2>Gestão de férias</h2><p>Controle períodos aquisitivos, gozo, avisos e recibos em uma única visão operacional.</p></div><div className="vacation-intro-mark"><CalendarDays size={25} /><span>Competência atual</span><strong>{new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong></div></div>
    <div className="vacation-kpi-grid">
      <div className="vacation-kpi is-gold"><span>Períodos cadastrados</span><strong>{vacations.length}</strong><small>Histórico disponível no RH</small></div>
      <div className="vacation-kpi is-pink"><span>Próximas férias</span><strong>{upcoming}</strong><small>Programadas a partir de hoje</small></div>
      <div className="vacation-kpi is-blue"><span>Em gozo hoje</span><strong>{activeNow}</strong><small>Status calculado pelo período</small></div>
      <div className={`vacation-kpi ${pendingEmployees ? 'is-danger' : 'is-green'}`}><span>Cadastros pendentes</span><strong>{pendingEmployees}</strong><small>{pendingEmployees ? 'Funcionários dos avisos ainda não cadastrados' : 'Nenhum cadastro pendente'}</small></div>
    </div>
    <SectionCard title="Reconciliação documental" caption="Avisos de férias × recibos de férias"><div className="vacation-reconciliation-grid">
      <div className={`reconciliation-card ${reconciliation.avisos_sem_recibo ? 'is-alert' : 'is-ok'}`}><span className="reconciliation-icon">{reconciliation.avisos_sem_recibo ? <FileWarning size={18} /> : <CheckCircle2 size={18} />}</span><div><strong>{reconciliation.avisos_sem_recibo}</strong><b>Aviso(s) sem recibo</b><small>{reconciliation.avisos_sem_recibo ? 'Atenção necessária após o pagamento' : 'Todos os avisos possuem recibo'}</small></div></div>
      <div className={`reconciliation-card ${reconciliation.recibos_sem_aviso ? 'is-alert' : 'is-ok'}`}><span className="reconciliation-icon">{reconciliation.recibos_sem_aviso ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}</span><div><strong>{reconciliation.recibos_sem_aviso}</strong><b>Recibo(s) sem aviso</b><small>{reconciliation.recibos_sem_aviso ? 'Verifique o vínculo do documento' : 'Nenhum recibo órfão encontrado'}</small></div></div>
      <div className="reconciliation-card is-neutral"><span className="reconciliation-icon"><CalendarDays size={18} /></span><div><strong>{reconciliation.avisos_total}</strong><b>Avisos registrados</b><small>{reconciliation.recibos_total} recibo(s) registrado(s)</small></div></div>
    </div>{attention > 0 && <div className="reconciliation-footnote"><AlertTriangle size={15} /> Existem {attention} pendência(s) documentais para acompanhar.</div>}</SectionCard>
    <HRVacationPanel token={token} employees={employees} vacations={vacations} onDone={onDone} />
    {vacations.length > 0 && <SectionCard title="Resumo financeiro preparado" caption="Os valores aparecerão quando os recibos forem registrados"><div className="vacation-finance-preview">{vacations.slice(0, 8).map((row) => <div key={row.id}><div><strong>{row.nome}</strong><small>{formatDate(row.inicio)} até {formatDate(row.fim)} · {row.recibos_count} recibo(s)</small></div><span>{row.calculo ? formatMoney(Number(row.calculo.total_liquido || 0)) : 'Aguardando recibo'}</span>{row.calculo ? <WalletCards size={14} /> : <ExternalLink size={14} />}</div>)}</div></SectionCard>}
  </div>
}
