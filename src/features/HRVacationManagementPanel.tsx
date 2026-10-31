import { CalendarDays, ExternalLink, WalletCards } from 'lucide-react'
import type { AdminVacationManagementRow, EmployeeRow, VacationImportBatch } from '../lib/types'
import { SectionCard, formatDate, formatMoney } from '../components/ui'
import { HRVacationPanel } from './HRVacationPanel'

function sameOrBefore(value: string | null, reference: string) {
  return Boolean(value && value <= reference)
}

function sameOrAfter(value: string | null, reference: string) {
  return Boolean(value && value >= reference)
}

export function HRVacationManagementPanel({ token, employees, vacations, imports, onDone }: { token: string; employees: EmployeeRow[]; vacations: AdminVacationManagementRow[]; imports: VacationImportBatch[]; onDone: () => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10)
  const activeNow = vacations.filter((row) => sameOrBefore(row.inicio, today) && sameOrAfter(row.fim, today) && row.status !== 'cancelada').length
  const upcoming = vacations.filter((row) => sameOrAfter(row.inicio, today) && row.status !== 'cancelada').length
  const pendingEmployees = imports.flatMap((batch) => batch.linhas).filter((line) => line.status === 'divergente').length
  const pendingReview = vacations.filter((row) => row.importacao_status === 'pendente_conferencia').length

  return <div className="hr-vacation-management">
    <div className="vacation-page-intro"><div><span className="eyebrow">Recursos humanos · planejamento</span><h2>Gestão de férias</h2><p>Organize períodos aquisitivos, programe o gozo e acompanhe os documentos e cálculos de cada funcionário.</p></div><div className="vacation-intro-mark"><CalendarDays size={25} /><span>Competência atual</span><strong>{new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong></div></div>
    <div className="vacation-kpi-grid">
      <div className="vacation-kpi is-gold"><span>Períodos cadastrados</span><strong>{vacations.length}</strong><small>Histórico disponível no RH</small></div>
      <div className="vacation-kpi is-pink"><span>Próximas férias</span><strong>{upcoming}</strong><small>Programadas a partir de hoje</small></div>
      <div className="vacation-kpi is-blue"><span>Em férias hoje</span><strong>{activeNow}</strong><small>Funcionários em gozo</small></div>
      <div className={`vacation-kpi ${pendingEmployees ? 'is-danger' : 'is-green'}`}><span>Cadastros pendentes</span><strong>{pendingEmployees}</strong><small>{pendingEmployees ? 'Funcionários dos avisos ainda não cadastrados' : 'Nenhum cadastro pendente'}</small></div>
    </div>
    <HRVacationPanel token={token} employees={employees} vacations={vacations} onDone={onDone} />
    {pendingReview > 0 && <div className="vacation-review-note"><CalendarDays size={17} /><span><strong>{pendingReview} período(s) importado(s) aguardando conferência</strong><small>O lançamento já está disponível na lista acima. A conferência documental poderá ser retomada quando o fluxo de recibos for implementado.</small></span></div>}
    {vacations.length > 0 && <SectionCard title="Resumo financeiro preparado" caption="Os valores aparecerão quando os recibos forem registrados"><div className="vacation-finance-preview">{vacations.slice(0, 8).map((row) => <div key={row.id}><div><strong>{row.nome}</strong><small>{formatDate(row.inicio)} até {formatDate(row.fim)} · {row.documentos_count} documento(s)</small></div><span>{row.calculo ? formatMoney(Number(row.calculo.total_liquido || 0)) : 'Aguardando recibo'}</span>{row.calculo ? <WalletCards size={14} /> : <ExternalLink size={14} />}</div>)}</div></SectionCard>}
  </div>
}
