import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Bot, CheckCircle2, LoaderCircle, MessageCircle, Send, ShieldCheck, Sparkles, Wifi, WifiOff } from 'lucide-react'
import { PageHeading } from '../components/ui'
import {
  blockedIntentMessage,
  classifyInsightQuestion,
  INSIGHT_MODULES,
  moduleLabel,
  parseInsightPeriod,
  safeFallbackAnswer,
  summarizeInsight,
} from './intelligent-insights'
import type { InsightIntent, InsightPeriod, InsightRoute, SafeInsightResult } from './intelligent-insights'
import { queryInsightWithOllama, queryIntentAllowed } from './intelligent-query'
import './intelligent-view.css'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'
type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  result?: { data: SafeInsightResult; mode: 'help' | 'aggregate' }
  localFallback?: boolean
}
type OllamaModel = { name?: string }
type OllamaTagsResponse = { models?: OllamaModel[] }
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
const QUICK_QUESTIONS = [
  'Quem teve faltas registradas nos últimos 30 dias? Inclua nome e datas.',
  'Quais contas a pagar estão vencidas? Liste fornecedor, valor e vencimento.',
  'Quais atestados têm CID registrado? Inclua funcionário, data e CID.',
  'Resuma receitas e despesas deste mês por categoria.',
  'Quais ordens de produção estão atrasadas? Inclua número, cliente e prazo.',
  'Quais parcelas de dívidas vencem nos próximos 30 dias? Inclua credor e valor.',
]

function localEndpoint(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Informe um endereço válido, como http://localhost:11434.')
  }
  const hostname = url.hostname.toLowerCase()
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Por segurança, a conexão deve permanecer neste computador: use localhost, 127.0.0.1 ou ::1.')
  }
  return url.origin.replace(/\/$/, '')
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const sensitiveDisplayField = /(^|_)(cpf|cnpj|documento|email|telefone|phone|contato|endereco|cep|banco|agencia|pix|senha|password|token|secret|url|path|arquivo|anexo|comprovante|storage|usuario_id|data_nascimento)(_|$)|(_por|_by)$/i

function redactDisplayText(value: string) {
  return value
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{14}\b/g, '[CNPJ removido]')
    .replace(/\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}\b|\b\d{11}\b/g, '[CPF removido]')
    .replace(/\b(?:rg|cnh|ctps|pis|pasep)\s*(?:n[ºo.]?\s*)?[:#-]?\s*[\w.-]{4,20}\b/gi, '[identificador removido]')
    .replace(/\bcep\s*[:#-]?\s*\d{5}-?\d{3}\b/gi, '[CEP removido]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[e-mail removido]')
    .replace(/(?:https?|ftp|s3|file|mailto):\/\/[^\s<>"']+|www\.[^\s<>"']+/gi, '[link removido]')
    .replace(/(?:\+?55\s*)?\(?\d{2}\)?[\s.-]?\d{4,5}[-\s]?\d{4}/g, '[telefone removido]')
    .replace(/\b(?:rua|r\.|avenida|av\.|travessa|alameda|rodovia|estrada|logradouro|endere[cç]o)\b[^;\n]{0,160}/gi, '[endereço removido]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[identificador removido]')
}

function formatMetric(value: number, unit?: string) {
  if (unit === 'R$') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value)
  if (unit === '%') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`
  if (unit === 'horas') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)} h`
  if (unit === 'dias') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)} dias`
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)
}

function flattenEvidenceRow(value: unknown, prefix = ''): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? { [prefix]: value } : {}
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'id' || key === 'empresa_id' || key.endsWith('_id') || key.startsWith('scope_') || sensitiveDisplayField.test(key)) continue
    const label = prefix ? `${prefix}.${key}` : key
    if (item && typeof item === 'object' && !Array.isArray(item)) Object.assign(result, flattenEvidenceRow(item, label))
    else if (!Array.isArray(item)) result[label] = typeof item === 'string' ? redactDisplayText(item) : item
  }
  return result
}

function columnLabel(value: string) {
  if (value.toLowerCase().endsWith('.cid') || value.toLowerCase() === 'cid') return 'CID'
  const aggregate = value.match(/^(sum|avg|min|max)_(.+)$/)
  if (aggregate) {
    const operation = { sum: 'Total', avg: 'Média', min: 'Mínimo', max: 'Máximo' }[aggregate[1]]
    return `${operation} · ${aggregate[2].replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}`
  }
  return value.replace(/^funcionario\./, 'Funcionário · ').replace(/^cliente\./, 'Cliente · ')
    .replace(/^ordem\./, 'Ordem · ').replace(/^acordo\./, 'Acordo · ').replace(/^fechamento\./, 'Fechamento · ')
    .replace(/^registro\./, 'Registro · ').replace(/_/g, ' ').replace(/\./g, ' · ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatEvidenceValue(value: unknown, column: string) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') {
    if (/valor|saldo|salario|preco|custo|receita|despesa|liquido|vencimento|desconto|beneficio/i.test(column)) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value)
    }
    if (/minuto/i.test(column)) return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)} min`
    if (/hora/i.test(column)) return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)} h`
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)
  }
  if (typeof value === 'string') {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (dateOnly) return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`))
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(date)
    }
    return value.length > 180 ? `${value.slice(0, 177)}…` : value
  }
  return String(value).slice(0, 180)
}

function helpResult(route: InsightRoute, period: InsightPeriod): SafeInsightResult {
  return {
    module: route.module,
    moduleLabel: moduleLabel(route.module),
    period,
    metrics: [],
    sources: ['Guia estático dos módulos'],
    limitations: ['Esta orientação geral não consultou registros do banco.'],
  }
}

export function IntelligentView({ token }: { token: string }) {
  const [endpoint, setEndpoint] = useState(DEFAULT_OLLAMA_URL)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_OLLAMA_URL)
  const [connection, setConnection] = useState<ConnectionState>('disconnected')
  const [connectionMessage, setConnectionMessage] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', text: 'Posso consultar, em modo somente leitura, dados de operação, RH e finanças disponíveis para sua empresa — inclusive registros individuais quando pertinentes — e explicar os módulos do RF Gestão. Conecte o Ollama instalado neste computador para começar.' },
  ])
  const messageList = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function connectOllama() {
    setConnection('connecting')
    setConnectionMessage('Verificando o serviço local…')
    try {
      const safeBase = localEndpoint(endpoint)
      const response = await fetch(`${safeBase}/api/tags`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      if (!response.ok) throw new Error(`Ollama respondeu com status ${response.status}.`)
      const payload = await response.json() as OllamaTagsResponse
      const foundModels = Array.from(new Set((payload.models || [])
        .map((item) => item.name?.trim() || '')
        .filter((name) => Boolean(name) && !/cloud/i.test(name))))
      setBaseUrl(safeBase)
      setEndpoint(safeBase)
      setModels(foundModels)
      setSelectedModel((current) => foundModels.includes(current) ? current : foundModels[0] || '')
      setConnection('connected')
      setConnectionMessage(foundModels.length
        ? `Conectado. ${foundModels.length} modelo${foundModels.length === 1 ? '' : 's'} local${foundModels.length === 1 ? '' : 'is'} disponível${foundModels.length === 1 ? '' : 'is'}.`
        : 'Ollama está acessível, mas não encontrei modelos locais instalados. Instale um modelo no Ollama e tente novamente.')
    } catch (error) {
      setConnection('error')
      setModels([])
      setSelectedModel('')
      setConnectionMessage(error instanceof Error && error.message.startsWith('Por segurança')
        ? error.message
        : `Não consegui conectar ao Ollama. Confirme que ele está aberto e autorize a origem ${window.location.origin} em OLLAMA_ORIGINS. No Chrome, permita o acesso à rede local se solicitado. Não use a origem curinga (*).`)
    }
  }

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy || connection !== 'connected' || !selectedModel) return
    setDraft('')
    setMessages((current) => [...current, { id: makeId(), role: 'user', text }])
    setBusy(true)
    try {
      const route = await classifyInsightQuestion(baseUrl, selectedModel, text)
      const blocked = blockedIntentMessage(route.intent)
      if (blocked) {
        setMessages((current) => [...current, { id: makeId(), role: 'assistant', text: blocked }])
        return
      }

      if (route.intent === 'help') {
        const data = helpResult(route, parseInsightPeriod(''))
        let answer: string
        let localFallback = false
        try {
          answer = await summarizeInsight(baseUrl, selectedModel, data, route)
        } catch {
          answer = safeFallbackAnswer(data, route.intent as InsightIntent)
          localFallback = true
        }
        setMessages((current) => [...current, { id: makeId(), role: 'assistant', text: answer, result: { data, mode: 'help' }, localFallback }])
        return
      }
      if (!queryIntentAllowed(route.intent)) throw new Error('A pergunta não é uma consulta somente leitura permitida.')
      const period = parseInsightPeriod(text)
      const query = await queryInsightWithOllama(token, baseUrl, selectedModel, text, route, period)
      setMessages((current) => [...current, {
        id: makeId(), role: 'assistant', text: query.answer,
        result: { data: query.result, mode: 'aggregate' },
        localFallback: query.localFallback,
      }])
    } catch (error) {
      setMessages((current) => [...current, {
        id: makeId(), role: 'assistant',
        text: error instanceof Error ? error.message : 'Não consegui completar a consulta. Tente novamente com um módulo e período mais específicos.',
      }])
    } finally {
      setBusy(false)
    }
  }

  function submitQuestion(event: FormEvent) {
    event.preventDefault()
    void ask(draft)
  }

  return (
    <div className="intelligent-view">
      <PageHeading eyebrow="Inteligência · consulta somente leitura" title="Visão inteligente" description="Pergunte em linguagem natural sobre os módulos do RF Gestão. O Ollama local planeja a consulta e resume evidências filtradas no servidor pela empresa da sessão administrativa." />
      <div className="intelligent-layout">
        <section className="intelligent-chat-card" aria-label="Conversa com a Visão inteligente">
          <header className="intelligent-chat-header">
            <div className="intelligent-chat-title"><span className="intelligent-avatar"><Bot size={19} /></span><div><strong>Assistente RF</strong><small>{connection === 'connected' && selectedModel ? `Ollama local · ${selectedModel}` : 'Conecte seu Ollama para começar'}</small></div></div>
            <span className={`intelligent-connection connection-${connection}`}><span />{connection === 'connected' ? 'Conectado' : connection === 'connecting' ? 'Conectando' : connection === 'error' ? 'Verifique a conexão' : 'Desconectado'}</span>
          </header>
          <div className="intelligent-privacy-note"><ShieldCheck size={16} /><span>A pergunta e a síntese são processadas pelo Ollama instalado neste computador. O Supabase recebe apenas o plano estruturado e os filtros necessários — nunca a pergunta em texto. O gateway exige sessão administrativa, filtra a empresa no servidor e executa somente SELECT. No fluxo da tela, nomes, CID/dados médicos e remuneração só entram no catálogo quando a pergunta indicar necessidade; observações e outros textos livres também exigem pedido explícito, são redigidos preventivamente e limitados a 320 caracteres. Esses gates minimizam o envio, mas a autorização real é sempre a sessão de administrador e o escopo da empresa. A redação heurística não garante identificar todo dado pessoal em texto livre; revise antes de compartilhar. CPF, documentos, contatos, credenciais, dados bancários, IDs internos e links são bloqueados ou redigidos. Nenhuma alteração é executada.</span></div>
          <div className="intelligent-messages" ref={messageList} aria-live="polite">
            {messages.map((message) => (
              <article className={`intelligent-message message-${message.role}`} key={message.id}>
                <div className="intelligent-message-icon">{message.role === 'assistant' ? <Sparkles size={15} /> : <MessageCircle size={15} />}</div>
                <div className="intelligent-message-content">
                  <p>{message.text}</p>
                  {message.localFallback && <small className="intelligent-fallback-note">Resposta de contingência: o Ollama local não passou na validação ou não respondeu.</small>}
                  {message.result && <div className="intelligent-result-card">
                    <div className="intelligent-result-heading"><div><strong>{message.result.mode === 'help' ? `Ajuda · ${message.result.data.moduleLabel}` : message.result.data.queryEvidence?.length ? `Evidências consultadas · ${message.result.data.moduleLabel}` : `Indicadores · ${message.result.data.moduleLabel}`}</strong><small>{message.result.mode === 'help' ? 'Guia do sistema · sem consulta a registros' : message.result.data.queryEvidence?.length ? 'Somente leitura · escopo da empresa validado no servidor' : `Período de referência: ${message.result.data.period.label}`}</small></div><span><ShieldCheck size={16} /></span></div>
                    {message.result.mode === 'aggregate' && (message.result.data.queryEvidence?.length
                      ? <div className="intelligent-evidence-list">{message.result.data.queryEvidence.map((evidence, evidenceIndex) => {
                        const records = evidence.mode === 'rows' ? (evidence.rows || []) : (evidence.aggregate || []).map((item) => evidence.aggregateOperation === 'count'
                          ? { ...item.group, registros: item.count }
                          : { ...item.group, [`${evidence.aggregateOperation || 'sum'}_${evidence.aggregateColumn || 'valor'}`]: item.value, registros: item.count })
                        const flattened = records.map((record) => flattenEvidenceRow(record))
                        const columns = Array.from(new Set(flattened.flatMap((record) => Object.keys(record)))).slice(0, 9)
                        const visibleRows = flattened.slice(0, 100)
                        return <section className="intelligent-evidence" key={`${evidence.table}-${evidenceIndex}`}>
                          <div className="intelligent-evidence-title"><strong>{evidence.table.replace(/_/g, ' ')}</strong><small>{evidence.mode === 'aggregate' ? `${evidence.scanned ?? 0} registros analisados${evidence.complete ? '' : ' · parcial'}` : `${evidence.returned ?? 0} de ${evidence.totalCount ?? evidence.returned ?? 0} registros`}</small></div>
                          {columns.length > 0 && <div className="intelligent-evidence-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{columnLabel(column)}</th>)}</tr></thead><tbody>{visibleRows.map((record, rowIndex) => <tr key={rowIndex}>{columns.map((column) => <td key={column}>{formatEvidenceValue(record[column], column)}</td>)}</tr>)}</tbody></table></div>}
                          {evidence.hasMore && <p className="intelligent-evidence-warning">A lista está parcial: foram retornadas até 100 linhas. Refine o período ou o critério da consulta; a tela não retoma páginas automaticamente.</p>}
                          {records.length > visibleRows.length && <p className="intelligent-evidence-warning">A tabela visualiza {visibleRows.length} de {records.length} linhas retornadas.</p>}
                          {Array.from(new Set(flattened.flatMap((record) => Object.keys(record)))).length > columns.length && <p className="intelligent-evidence-warning">A tabela exibe as primeiras 9 colunas. Peça uma pergunta mais específica para consultar outros campos.</p>}
                          {evidence.complete === false && evidence.mode === 'aggregate' && <p className="intelligent-evidence-warning">A agregação atingiu o limite de leitura e pode estar parcial.</p>}
                        </section>
                      })}</div>
                      : message.result.data.metrics.length
                        ? <div className="intelligent-metric-grid">{message.result.data.metrics.map((metric, index) => <div className="intelligent-metric" key={`${metric.label}-${index}`}><span>{metric.label}</span><strong>{formatMetric(metric.value, metric.unit)}</strong></div>)}</div>
                        : <p className="intelligent-empty-result">Não há evidências disponíveis para este recorte.</p>)}
                    {message.result.data.sources.length > 0 && <div className="intelligent-source-note"><strong>Fontes:</strong> {message.result.data.sources.join(' · ')}</div>}
                    {message.result.data.limitations.map((note) => <p className="intelligent-limit-note" key={note}><AlertCircle size={14} /><span>{note}</span></p>)}
                  </div>}
                </div>
              </article>
            ))}
            {busy && <div className="intelligent-thinking"><LoaderCircle className="spin" size={17} /> Interpretando a pergunta, consultando o Supabase e preparando uma síntese local…</div>}
          </div>
          <form className="intelligent-composer" onSubmit={submitQuestion}>
            <label className="sr-only" htmlFor="intelligent-question">Sua pergunta</label>
            <textarea id="intelligent-question" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={500} placeholder={connection === 'connected' && selectedModel ? 'Ex.: Quais contas a pagar estão vencidas? Inclua fornecedor, valor e vencimento.' : 'Conecte o Ollama para fazer uma consulta'} disabled={connection !== 'connected' || !selectedModel || busy} />
            <button className="primary-button" type="submit" disabled={!draft.trim() || connection !== 'connected' || !selectedModel || busy} aria-label="Enviar pergunta"><Send size={17} /> Perguntar</button>
          </form>
        </section>

        <aside className="intelligent-sidebar">
          <section className="intelligent-side-card">
            <div className="intelligent-side-heading"><div><span className="eyebrow">Conexão local</span><h2>Ollama</h2></div>{connection === 'connected' ? <Wifi size={19} /> : <WifiOff size={19} />}</div>
            <label className="intelligent-field-label" htmlFor="ollama-endpoint">Endereço neste computador</label>
            <input id="ollama-endpoint" className="intelligent-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} disabled={connection === 'connecting'} spellCheck={false} />
            <button type="button" className="secondary-button intelligent-connect-button" onClick={() => void connectOllama()} disabled={connection === 'connecting'}>{connection === 'connecting' ? <><LoaderCircle className="spin" size={15} /> Conectando…</> : connection === 'connected' ? <><CheckCircle2 size={15} /> Atualizar conexão</> : 'Conectar ao Ollama'}</button>
            {connectionMessage && <p className={`intelligent-connection-message ${connection === 'error' ? 'is-error' : ''}`}>{connectionMessage}</p>}
            {connection === 'connected' && models.length > 0 && <label className="intelligent-field-label" htmlFor="ollama-model">Modelo local<select id="ollama-model" className="intelligent-model-select" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>{models.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
            <div className="intelligent-origin-note"><small>Origem deste site</small><code>{typeof window !== 'undefined' ? window.location.origin : ''}</code><small>O Ollama deve continuar acessível apenas neste computador. Inclua somente esta origem em <code>OLLAMA_ORIGINS</code>; não use <code>*</code> nem exponha o serviço na rede.</small></div>
          </section>

          <section className="intelligent-side-card intelligent-questions-card">
            <div className="intelligent-side-heading"><div><span className="eyebrow">Perguntas rápidas</span><h2>Experimente</h2></div><MessageCircle size={19} /></div>
            <div className="intelligent-quick-questions">{QUICK_QUESTIONS.map((question) => <button type="button" key={question} onClick={() => void ask(question)} disabled={connection !== 'connected' || !selectedModel || busy}>{question}</button>)}</div>
            <div className="intelligent-scope-note"><AlertCircle size={15} /><span>Administradores podem consultar registros e indicadores em modo somente leitura, dentro da própria empresa. O gateway limita campos sensíveis e sinaliza resultados parciais; para alterar dados, use a tela do módulo.</span></div>
          </section>

          <section className="intelligent-side-card intelligent-coverage-card">
            <div className="intelligent-side-heading"><div><span className="eyebrow">Cobertura de consulta</span><h2>Módulos</h2></div><ShieldCheck size={19} /></div>
            <div className="intelligent-module-grid">{INSIGHT_MODULES.filter((item) => item.key !== 'sistema').map((item) => <span key={item.key}>{item.label}</span>)}</div>
            <p className="intelligent-coverage-caption">A disponibilidade segue os dados e permissões já configurados no RF Gestão. O gateway permite consultas estruturadas em leitura e retorna evidências selecionadas, sempre no escopo da empresa da sessão.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
