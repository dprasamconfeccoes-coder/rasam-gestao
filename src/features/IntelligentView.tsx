import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Bot, CheckCircle2, LoaderCircle, MessageCircle, Send, ShieldCheck, Sparkles, Wifi, WifiOff } from 'lucide-react'
import { PageHeading } from '../components/ui'
import {
  blockedIntentMessage,
  classifyInsightQuestion,
  INSIGHT_MODULES,
  loadInsightData,
  moduleLabel,
  parseInsightPeriod,
  safeFallbackAnswer,
  summarizeInsight,
} from './intelligent-insights'
import type { InsightIntent, InsightPeriod, InsightRoute, SafeInsightResult } from './intelligent-insights'
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
  'Faça um resumo geral deste mês.',
  'Quantas faltas e horas extras foram registradas neste mês?',
  'Quais são as pendências agregadas de RH?',
  'Como está o fluxo de produção nos últimos 30 dias?',
  'Resuma receitas e despesas deste mês.',
  'Qual a cobertura de holerites desta competência?',
  'Como está a posição agregada de dívidas?',
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

function formatMetric(value: number, unit?: string) {
  if (unit === 'R$') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value)
  if (unit === '%') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`
  if (unit === 'horas') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)} h`
  if (unit === 'dias') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)} dias`
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)
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
    { id: 'welcome', role: 'assistant', text: 'Posso explicar os módulos do RF Gestão e resumir indicadores agregados de Pessoas, Ponto, RH, Produção, Financeiro, Dívidas, Acordos, Folha, Holerites, Avisos e Documentos. Conecte o Ollama instalado neste computador para começar.' },
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

      const period = parseInsightPeriod(text)
      const data = route.intent === 'help'
        ? helpResult(route, period)
        : await loadInsightData(token, route, period)
      let answer = ''
      let localFallback = false
      try {
        answer = await summarizeInsight(baseUrl, selectedModel, data, route)
      } catch {
        answer = safeFallbackAnswer(data, route.intent as InsightIntent)
        localFallback = true
      }
      setMessages((current) => [...current, {
        id: makeId(), role: 'assistant', text: answer,
        result: { data, mode: route.intent === 'help' ? 'help' : 'aggregate' },
        localFallback,
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
      <PageHeading eyebrow="Inteligência · consultas agregadas" title="Visão inteligente" description="Faça perguntas sobre os módulos do RF Gestão. A IA interpreta a intenção, consulta somente indicadores autorizados e resume os resultados com o Ollama local." />
      <div className="intelligent-layout">
        <section className="intelligent-chat-card" aria-label="Conversa com a Visão inteligente">
          <header className="intelligent-chat-header">
            <div className="intelligent-chat-title"><span className="intelligent-avatar"><Bot size={19} /></span><div><strong>Assistente RF</strong><small>{connection === 'connected' && selectedModel ? `Ollama local · ${selectedModel}` : 'Conecte seu Ollama para começar'}</small></div></div>
            <span className={`intelligent-connection connection-${connection}`}><span />{connection === 'connected' ? 'Conectado' : connection === 'connecting' ? 'Conectando' : connection === 'error' ? 'Verifique a conexão' : 'Desconectado'}</span>
          </header>
          <div className="intelligent-privacy-note"><ShieldCheck size={16} /><span>A pergunta (com CPFs, e-mails e credenciais detectáveis redigidos) é enviada apenas ao Ollama local para classificação, não ao Supabase. Nas consultas de dados, a síntese recebe somente indicadores agregados permitidos; a ajuda usa um guia estático. Evite incluir nomes ou detalhes pessoais. Nenhuma alteração é executada.</span></div>
          <div className="intelligent-messages" ref={messageList} aria-live="polite">
            {messages.map((message) => (
              <article className={`intelligent-message message-${message.role}`} key={message.id}>
                <div className="intelligent-message-icon">{message.role === 'assistant' ? <Sparkles size={15} /> : <MessageCircle size={15} />}</div>
                <div className="intelligent-message-content">
                  <p>{message.text}</p>
                  {message.localFallback && <small className="intelligent-fallback-note">Resposta de contingência: o Ollama local não passou na validação ou não respondeu.</small>}
                  {message.result && <div className="intelligent-result-card">
                    <div className="intelligent-result-heading"><div><strong>{message.result.mode === 'help' ? `Ajuda · ${message.result.data.moduleLabel}` : `Indicadores · ${message.result.data.moduleLabel}`}</strong><small>{message.result.mode === 'help' ? 'Guia do sistema · sem consulta a registros' : `Período de referência: ${message.result.data.period.label}`}</small></div><span><ShieldCheck size={16} /></span></div>
                    {message.result.mode === 'aggregate' && (message.result.data.metrics.length
                      ? <div className="intelligent-metric-grid">{message.result.data.metrics.map((metric, index) => <div className="intelligent-metric" key={`${metric.label}-${index}`}><span>{metric.label}</span><strong>{formatMetric(metric.value, metric.unit)}</strong></div>)}</div>
                      : <p className="intelligent-empty-result">Não há métricas numéricas disponíveis para este recorte.</p>)}
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
            <textarea id="intelligent-question" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={500} placeholder={connection === 'connected' && selectedModel ? 'Ex.: Resuma o Financeiro e as pendências deste mês.' : 'Conecte o Ollama para fazer uma consulta'} disabled={connection !== 'connected' || !selectedModel || busy} />
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
            <div className="intelligent-scope-note"><AlertCircle size={15} /><span>Consultas de equipe retornam somente indicadores agregados. Para consultar pessoas, documentos ou executar operações, use a tela autorizada do módulo.</span></div>
          </section>

          <section className="intelligent-side-card intelligent-coverage-card">
            <div className="intelligent-side-heading"><div><span className="eyebrow">Cobertura de consulta</span><h2>Módulos</h2></div><ShieldCheck size={19} /></div>
            <div className="intelligent-module-grid">{INSIGHT_MODULES.filter((item) => item.key !== 'sistema').map((item) => <span key={item.key}>{item.label}</span>)}</div>
            <p className="intelligent-coverage-caption">A disponibilidade dos dados segue as permissões já configuradas no RF Gestão. A IA responde apenas com o resumo que cada consulta autorizada devolver.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
