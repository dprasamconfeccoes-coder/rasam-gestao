import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Bot, CheckCircle2, LoaderCircle, MessageCircle, Send, ShieldCheck, Sparkles, Wifi, WifiOff } from 'lucide-react'
import { PageHeading } from '../components/ui'
import { listPoint } from '../lib/api'
import { durationToMinutes, formatDuration } from '../lib/point-schedules'
import type { PointRow } from '../lib/types'
import './intelligent-view.css'

type QueryKind = 'absence' | 'overtime'
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

type QueryDetail = {
  name: string
  status?: string
  extra50?: string
  extra100?: string
  total?: string
}

type QueryResult = {
  kind: QueryKind
  date: string
  dateLabel: string
  count: number
  details: QueryDetail[]
  justified?: number
  pendingReview?: number
  total50Minutes?: number
  total100Minutes?: number
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  result?: QueryResult
  localFallback?: boolean
}

type OllamaModel = { name?: string }
type OllamaTagsResponse = { models?: OllamaModel[] }
type OllamaChatResponse = { message?: { content?: string }; error?: string }

const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
const QUICK_QUESTIONS = ['Quem faltou hoje?', 'Quem fez hora extra ontem?', 'Houve extra 50% ou 100% ontem?']

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function businessDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

function formatDatePt(date: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(`${date}T00:00:00.000Z`))
}

function explicitDate(value: string) {
  const iso = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  const br = value.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})\b/)
  const year = Number(iso?.[1] || br?.[3])
  const month = Number(iso?.[2] || br?.[2])
  const day = Number(iso?.[3] || br?.[1])
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseQuestion(question: string): { kind: QueryKind; date: string } | null {
  const text = normalizeText(question)
  const absence = /\b(falta|faltas|faltou|faltaram|ausencia|ausencias|ausente|ausentes)\b/.test(text)
  const overtime = /\b(extra|extras|hora extra|horas extras?)\b/.test(text)
  if (absence === overtime) return null
  if (/\b(semana|mes passado|ultimos dias|periodo|entre)\b/.test(text)) return null
  const hasYesterday = /\bontem\b/.test(text)
  const hasToday = /\bhoje\b/.test(text)
  const hasTomorrow = /\bamanha\b/.test(text)
  if (Number(hasYesterday) + Number(hasToday) + Number(hasTomorrow) > 1) return null
  const date = explicitDate(text) || (hasYesterday ? addDays(businessDate(), -1) : hasTomorrow ? addDays(businessDate(), 1) : businessDate())
  return { kind: absence ? 'absence' : 'overtime', date }
}

function isPositiveFlag(value: string | null | undefined) {
  const text = normalizeText(String(value || ''))
  return Boolean(text) && !['nao', 'n', '0', '0.0', 'false', 'falso', '-', '—'].includes(text)
}

function isAbsence(row: PointRow) {
  return isPositiveFlag(row.dia_falta)
    || normalizeText(row.inconsistencia_tipo || '') === 'falta'
    || normalizeText(row.status || '').includes('falta')
}

function minutes(value: string | null | undefined) {
  return Math.max(0, durationToMinutes(value) || 0)
}

function formatMinutes(value: number) {
  return value > 0 ? formatDuration(value) : '—'
}

function absenceStatus(row: PointRow) {
  if (row.justificativa_status === 'aceita' || row.inconsistencia_status === 'justificada') return 'Justificada'
  if (row.justificativa_status === 'pendente' || (row.inconsistencia_tipo === 'falta' && row.inconsistencia_status === 'pendente')) return 'Aguardando revisão'
  if (row.justificativa_status === 'recusada' || row.inconsistencia_status === 'recusada') return 'Revisão recusada'
  return 'Registrada'
}

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

function safeFallback(result: QueryResult) {
  if (result.kind === 'absence') {
    return result.count === 0
      ? `Não encontrei faltas registradas em ${result.dateLabel}.`
      : `Encontrei ${result.count} registro${result.count === 1 ? '' : 's'} de falta em ${result.dateLabel}.`
  }
  return result.count === 0
    ? `Não encontrei horas extras registradas em ${result.dateLabel}.`
    : `Encontrei ${result.count} funcionário${result.count === 1 ? '' : 's'} com horas extras em ${result.dateLabel}.`
}

async function summarizeWithOllama(baseUrl: string, model: string, result: QueryResult) {
  const stats = result.kind === 'absence'
    ? { tipo: 'faltas registradas', data: result.dateLabel, total: result.count, justificadas: result.justified || 0, aguardando_revisao: result.pendingReview || 0 }
    : { tipo: 'horas extras registradas', data: result.dateLabel, funcionarios: result.count, extra_50_total_minutos: result.total50Minutes || 0, extra_100_total_minutos: result.total100Minutes || 0 }
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: 'Responda em português brasileiro com uma frase curta, usando somente as estatísticas agregadas fornecidas. Não invente fatos e não cite nomes, CPFs, justificativas ou informações pessoais. Não recomende decisões de RH.' },
        { role: 'user', content: JSON.stringify(stats) },
      ],
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(90000),
  })
  const payload = await response.json() as OllamaChatResponse
  if (!response.ok) throw new Error(payload.error || 'O modelo local não respondeu.')
  const text = payload.message?.content?.trim()
  if (!text) throw new Error('O modelo local retornou uma resposta vazia.')
  return text
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
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
    { id: 'welcome', role: 'assistant', text: 'Posso consultar faltas registradas e horas extras por data. Conecte o Ollama instalado neste computador e experimente uma das perguntas sugeridas.' },
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

  function buildResult(kind: QueryKind, date: string, rows: PointRow[]): QueryResult {
    const dateLabel = formatDatePt(date)
    if (kind === 'absence') {
      const matching = rows.filter(isAbsence)
      const details = matching.map((row) => ({ name: row.nome || 'Funcionário sem nome', status: absenceStatus(row) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      return {
        kind,
        date,
        dateLabel,
        count: details.length,
        details,
        justified: details.filter((item) => item.status === 'Justificada').length,
        pendingReview: details.filter((item) => item.status === 'Aguardando revisão').length,
      }
    }
    const matching = rows.map((row) => ({ row, extra50: minutes(row.extra_50), extra100: minutes(row.extra_100) }))
      .filter((item) => item.extra50 > 0 || item.extra100 > 0)
    const details = matching.map(({ row, extra50, extra100 }) => ({
      name: row.nome || 'Funcionário sem nome',
      extra50: formatMinutes(extra50),
      extra100: formatMinutes(extra100),
      total: formatMinutes(extra50 + extra100),
    })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    return {
      kind,
      date,
      dateLabel,
      count: details.length,
      details,
      total50Minutes: matching.reduce((total, item) => total + item.extra50, 0),
      total100Minutes: matching.reduce((total, item) => total + item.extra100, 0),
    }
  }

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy || connection !== 'connected' || !selectedModel) return
    setDraft('')
    setMessages((current) => [...current, { id: makeId(), role: 'user', text }])
    const request = parseQuestion(text)
    if (!request) {
      setMessages((current) => [...current, {
        id: makeId(),
        role: 'assistant',
        text: 'Nesta primeira versão, respondo consultas de faltas registradas e horas extras para hoje, ontem ou uma data específica. Exemplos: “Quem faltou hoje?” e “Quem fez hora extra ontem?”.',
      }])
      return
    }
    setBusy(true)
    try {
      const response = await listPoint(token, { inicio: request.date, fim: request.date, limite: 1000 })
      if (!response.sucesso) throw new Error(response.erro || 'Não foi possível consultar os registros de ponto.')
      const rows = (response.registros || []).filter((row) => row.data?.slice(0, 10) === request.date)
      const result = buildResult(request.kind, request.date, rows)
      let reply = ''
      let localFallback = false
      try {
        reply = await summarizeWithOllama(baseUrl, selectedModel, result)
      } catch {
        reply = safeFallback(result)
        localFallback = true
      }
      setMessages((current) => [...current, { id: makeId(), role: 'assistant', text: reply, result, localFallback }])
    } catch (error) {
      setMessages((current) => [...current, {
        id: makeId(),
        role: 'assistant',
        text: error instanceof Error ? error.message : 'Não consegui consultar o ponto no Supabase. Tente novamente.',
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
      <PageHeading eyebrow="Operação · consultas em linguagem natural" title="Visão inteligente" description="Pergunte sobre faltas registradas e horas extras; os dados vêm do Supabase e a resposta é formulada pelo Ollama neste computador." />
      <div className="intelligent-layout">
        <section className="intelligent-chat-card" aria-label="Conversa com a Visão inteligente">
          <header className="intelligent-chat-header">
            <div className="intelligent-chat-title"><span className="intelligent-avatar"><Bot size={19} /></span><div><strong>Assistente RF</strong><small>{connection === 'connected' && selectedModel ? `Modelo local · ${selectedModel}` : 'Conecte seu Ollama para começar'}</small></div></div>
            <span className={`intelligent-connection connection-${connection}`}><span />{connection === 'connected' ? 'Conectado' : connection === 'connecting' ? 'Conectando' : connection === 'error' ? 'Verifique a conexão' : 'Desconectado'}</span>
          </header>
          <div className="intelligent-privacy-note"><ShieldCheck size={16} /><span>Nomes e CPFs são exibidos pelo sistema, mas não são enviados ao modelo. O Ollama recebe apenas estatísticas agregadas; a conversa fica somente nesta sessão.</span></div>
          <div className="intelligent-messages" ref={messageList} aria-live="polite">
            {messages.map((message) => (
              <article className={`intelligent-message message-${message.role}`} key={message.id}>
                <div className="intelligent-message-icon">{message.role === 'assistant' ? <Sparkles size={15} /> : <MessageCircle size={15} />}</div>
                <div className="intelligent-message-content">
                  <p>{message.text}</p>
                  {message.localFallback && <small className="intelligent-fallback-note">O resumo foi montado pelo sistema; o Ollama não respondeu desta vez.</small>}
                  {message.result && <div className="intelligent-result-card">
                    <div className="intelligent-result-heading"><div><strong>{message.result.kind === 'absence' ? 'Faltas registradas' : 'Horas extras registradas'}</strong><small>{message.result.dateLabel} · fonte: registros de ponto</small></div><span>{message.result.count}</span></div>
                    {message.result.details.length === 0 ? <p className="intelligent-empty-result">Nenhum registro encontrado para esse critério e data.</p> : <ul className="intelligent-result-list">
                      {message.result.details.map((detail, index) => <li key={`${detail.name}-${index}`}>
                        <strong>{detail.name}</strong>
                        {message.result?.kind === 'absence' ? <span className={`absence-status status-${normalizeText(detail.status || '').replace(/\s/g, '-')}`}>{detail.status}</span> : <span className="overtime-detail">50% <b>{detail.extra50}</b><i>·</i> 100% <b>{detail.extra100}</b><i>·</i> Total <b>{detail.total}</b></span>}
                      </li>)}
                    </ul>}
                  </div>}
                </div>
              </article>
            ))}
            {busy && <div className="intelligent-thinking"><LoaderCircle className="spin" size={17} /> Consultando o Supabase e preparando a resposta local…</div>}
          </div>
          <form className="intelligent-composer" onSubmit={submitQuestion}>
            <label className="sr-only" htmlFor="intelligent-question">Sua pergunta</label>
            <textarea id="intelligent-question" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={500} placeholder={connection === 'connected' && selectedModel ? 'Ex.: Quem fez hora extra ontem?' : 'Conecte o Ollama para fazer uma consulta'} disabled={connection !== 'connected' || !selectedModel || busy} />
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
            <div className="intelligent-origin-note"><small>Origem deste site</small><code>{typeof window !== 'undefined' ? window.location.origin : ''}</code><small>Se necessário, inclua essa origem exata em <code>OLLAMA_ORIGINS</code>. Não use <code>*</code> nem exponha o serviço na rede.</small></div>
          </section>

          <section className="intelligent-side-card intelligent-questions-card">
            <div className="intelligent-side-heading"><div><span className="eyebrow">Perguntas rápidas</span><h2>Experimente</h2></div><MessageCircle size={19} /></div>
            <div className="intelligent-quick-questions">{QUICK_QUESTIONS.map((question) => <button type="button" key={question} onClick={() => void ask(question)} disabled={connection !== 'connected' || !selectedModel || busy}>{question}</button>)}</div>
            <div className="intelligent-scope-note"><AlertCircle size={15} /><span>A tela lista apenas faltas explicitamente registradas. Uma batida ausente, sem lançamento de falta, não é presumida como ausência.</span></div>
          </section>
        </aside>
      </div>
    </div>
  )
}
