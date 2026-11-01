import { useEffect, useState } from 'react'
import { BadgeCheck, BriefcaseBusiness, CalendarDays, FileText, HeartPulse, ShieldCheck, UserRound } from 'lucide-react'
import { myProntuario } from '../lib/api'
import type { OwnProntuarioResponse } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import { EmployeeTimeline } from './EmployeeTimeline'
import './employee-own-dossier.css'

type OwnTab = 'resumo' | 'advertencias' | 'atestados' | 'afastamentos' | 'justificativas' | 'ferias' | 'documentos' | 'timeline'
const tabs: Array<[OwnTab, string, keyof OwnProntuarioResponse | null]> = [
  ['resumo', 'Resumo', null],
  ['timeline', 'Linha do tempo', null],
  ['advertencias', 'Advertências', 'advertencias'],
  ['atestados', 'Atestados', 'atestados'],
  ['afastamentos', 'Afastamentos', 'afastamentos'],
  ['justificativas', 'Justificativas', 'justificativas'],
  ['ferias', 'Férias', 'ferias'],
  ['documentos', 'Documentos', 'documentos'],
]

function value(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = record[key]
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') return String(raw)
  }
  return '—'
}

function dateValue(record: Record<string, unknown>, keys: string[]) {
  return formatDate(value(record, keys))
}

function remunerationLabel(employee: NonNullable<OwnProntuarioResponse['funcionario']>) {
  if (employee.tipo_vinculo === 'diarista') {
    return employee.valor_diaria != null ? `Diária · ${formatMoney(employee.valor_diaria)}` : 'Diária não informada'
  }
  const amount = employee.valor_mensal ?? employee.salario
  return amount == null ? 'Não informada' : `${employee.salario_periodo || 'Mês'} · ${formatMoney(amount)}`
}

function OwnHistory({ items, tab }: { items: Array<Record<string, unknown>>; tab: OwnTab }) {
  if (!items.length) return <EmptyState title="Nenhum registro nesta seção" description="Quando houver novos lançamentos, eles aparecerão aqui no seu prontuário." />
  return (
    <div className="own-history-list">
      {items.map((item, index) => {
        const title = value(item, ['titulo', 'tipo', 'evento', 'categoria', 'arquivo_nome'])
        const description = value(item, ['descricao', 'observacao', 'motivo', 'medida', 'status_label'])
        const date = dateValue(item, ['data_ocorrencia', 'data_atendimento', 'data_registro', 'inicio', 'created_at', 'validade'])
        return (
          <article className="own-history-item" key={String(item.id || `${tab}-${index}`)}>
            <div className="own-history-copy">
              <strong>{title}</strong>
              <span>{date}{description !== '—' ? ` · ${description}` : ''}</span>
              {item.fim ? <small>Até {formatDate(String(item.fim))}</small> : null}
            </div>
            {item.status || item.status_label ? <StatusPill value={String(item.status_label || item.status)} /> : null}
          </article>
        )
      })}
    </div>
  )
}

export function EmployeeOwnDossier({ token }: { token: string }) {
  const [data, setData] = useState<OwnProntuarioResponse | null>(null)
  const [tab, setTab] = useState<OwnTab>('resumo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    myProntuario(token)
      .then((result) => {
        if (cancelled) return
        if (!result.sucesso || !result.funcionario) throw new Error(result.erro || 'Não foi possível carregar seu prontuário.')
        setData(result)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Falha ao consultar seu prontuário.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  const employee = data?.funcionario
  const selectedTab = tabs.find(([key]) => key === tab)
  const items = selectedTab?.[2] && data ? (data[selectedTab[2]] as Array<Record<string, unknown>> | undefined) || [] : []

  return (
    <div className="employee-own-dossier-page">
      <PageHeading
        eyebrow="Minha área · prontuário"
        title="Meu prontuário"
        description="Consulte seus dados funcionais e os registros vinculados ao seu histórico na empresa."
      />
      <div className="own-dossier-privacy-note"><ShieldCheck size={17} /><span>Esta área mostra somente os dados vinculados à sua própria sessão. O acesso é validado pelo servidor.</span></div>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Carregando seu prontuário…" /> : null}
      {employee && !loading ? (
        <>
          <section className="own-dossier-hero">
            <div className="own-dossier-avatar"><UserRound size={24} /></div>
            <div className="own-dossier-identity">
              <span className="eyebrow">Cadastro funcional</span>
              <h2>{employee.nome}</h2>
              <p>{employee.cargo || employee.funcao || 'Cargo não informado'} · {employee.tipo_vinculo || 'Vínculo não informado'}</p>
            </div>
            <StatusPill value={employee.ativo ? 'Ativo' : 'Inativo'} />
          </section>
          <nav className="own-dossier-tabs" aria-label="Seções do prontuário">
            {tabs.map(([key, label, collection]) => {
              const count = collection && data ? ((data[collection] as Array<unknown> | undefined) || []).length : null
              return <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}{count !== null ? <small>{count}</small> : null}</button>
            })}
          </nav>
          {tab === 'resumo' ? (
            <div className="own-dossier-summary">
              <SectionCard title="Vínculo e função" caption="Informações principais do seu cadastro">
                <div className="own-dossier-facts">
                  <div><span><BriefcaseBusiness size={15} /> Cargo / função</span><strong>{employee.cargo || employee.funcao || 'Não informado'}</strong></div>
                  <div><span><CalendarDays size={15} /> Admissão</span><strong>{formatDate(employee.data_admissao)}</strong></div>
                  <div><span><BadgeCheck size={15} /> Tipo de vínculo</span><strong>{employee.tipo_vinculo || 'Não informado'}</strong></div>
                  <div><span><FileText size={15} /> Horário</span><strong>{employee.horario_trabalho || 'Não informado'}</strong></div>
                  <div><span><FileText size={15} /> Remuneração cadastrada</span><strong>{remunerationLabel(employee)}</strong></div>
                </div>
              </SectionCard>
              <SectionCard title="Registros do prontuário" caption="Acesse cada seção para consultar seus próprios históricos">
                <div className="own-dossier-counts">
                  <button type="button" onClick={() => setTab('atestados')}><HeartPulse size={17} /><span><strong>{data?.atestados.length || 0}</strong> atestado(s)</span></button>
                  <button type="button" onClick={() => setTab('ferias')}><CalendarDays size={17} /><span><strong>{data?.ferias.length || 0}</strong> período(s) de férias</span></button>
                  <button type="button" onClick={() => setTab('advertencias')}><FileText size={17} /><span><strong>{data?.advertencias.length || 0}</strong> advertência(s)</span></button>
                </div>
              </SectionCard>
            </div>
          ) : tab === 'timeline' ? (
            <EmployeeTimeline token={token} />
          ) : (
            <SectionCard title={selectedTab?.[1] || 'Histórico'} caption={`${items.length} registro(s) exibido(s) nesta seção`}>
              <OwnHistory items={items} tab={tab} />
            </SectionCard>
          )}
        </>
      ) : null}
    </div>
  )
}
