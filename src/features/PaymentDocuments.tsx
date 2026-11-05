import { useId, useRef, useState, type ChangeEvent } from 'react'
import { Download, FileText, LoaderCircle, Paperclip } from 'lucide-react'
import './payment-documents.css'

export type PaymentDocumentType = 'documento_pagamento' | 'comprovante'

export type PaymentDocument = {
  id: string
  tipo: PaymentDocumentType
  arquivo_nome: string
  mime_type: string
  tamanho_bytes: number
  created_at: string
}

export type PaymentDocumentsProps = {
  token?: string
  documents: PaymentDocument[]
  canAttachInstruction: boolean
  onUploadInstruction: (file: File) => Promise<void>
  onDownload: (documentId: string) => Promise<{ url: string; arquivo_nome?: string }>
  disabled?: boolean
}

type Feedback = {
  kind: 'error' | 'success'
  message: string
} | null

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const ACCEPTED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp'])

function formatBytes(bytes: number) {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  if (safeBytes < 1024) return `${Math.round(safeBytes)} B`
  if (safeBytes < 1024 * 1024) return `${Math.max(1, Math.round(safeBytes / 1024))} KB`
  return `${(safeBytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data não informada'
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function isAcceptedFile(file: File) {
  const extension = file.name.toLowerCase().split('.').pop() || ''
  return ACCEPTED_MIME_TYPES.has(file.type) || ACCEPTED_EXTENSIONS.has(extension)
}

function isSafeDocumentUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:'
  } catch {
    return false
  }
}

export function PaymentDocuments({
  documents,
  canAttachInstruction,
  onUploadInstruction,
  onDownload,
  disabled = false,
}: PaymentDocumentsProps) {
  const instanceId = useId()
  const inputId = `payment-documents-file-${instanceId}`
  const titleId = `payment-documents-title-${instanceId}`
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [downloadingId, setDownloadingId] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)

  const isBusy = uploading || Boolean(downloadingId)
  const actionsDisabled = disabled || isBusy

  async function uploadInstruction(file: File) {
    if (disabled || isBusy) return

    setFeedback(null)
    if (!isAcceptedFile(file)) {
      setFeedback({ kind: 'error', message: 'Selecione um arquivo PDF, JPG, PNG ou WEBP.' })
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setFeedback({ kind: 'error', message: 'O arquivo deve ter no máximo 10 MB.' })
      return
    }

    setUploading(true)
    try {
      await onUploadInstruction(file)
      setFeedback({ kind: 'success', message: 'Boleto anexado com sucesso.' })
    } catch {
      setFeedback({ kind: 'error', message: 'Não foi possível anexar o boleto. Tente novamente.' })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void uploadInstruction(file)
  }

  async function downloadDocument(document: PaymentDocument) {
    if (disabled || isBusy) return

    setFeedback(null)
    setDownloadingId(document.id)
    try {
      const result = await onDownload(document.id)
      const url = result.url.trim()
      if (!url || !isSafeDocumentUrl(url)) throw new Error('URL inválida')

      const openedWindow = window.open(url, '_blank', 'noopener,noreferrer')
      if (!openedWindow) throw new Error('A nova aba foi bloqueada')
      setFeedback({ kind: 'success', message: 'Download iniciado em uma nova aba.' })
    } catch {
      setFeedback({ kind: 'error', message: 'Não foi possível baixar o documento. Tente novamente.' })
    } finally {
      setDownloadingId('')
    }
  }

  return (
    <section
      className="payment-documents"
      aria-labelledby={titleId}
      aria-busy={isBusy}
    >
      <header className="payment-documents-header">
        <div className="payment-documents-heading">
          <span className="payment-documents-eyebrow">Documentos</span>
          <h3 id={titleId}>Arquivos do pagamento</h3>
          <p>Boleto e arquivos relacionados à baixa deste pagamento.</p>
        </div>

        {canAttachInstruction && (
          <div className="payment-documents-upload">
            <button
              type="button"
              className="payment-documents-upload-button"
              onClick={() => inputRef.current?.click()}
              disabled={actionsDisabled}
              aria-controls={inputId}
            >
              {uploading ? <LoaderCircle className="payment-documents-spin" size={16} aria-hidden="true" /> : <Paperclip size={16} aria-hidden="true" />}
              <span>{uploading ? 'Anexando…' : 'Anexar boleto'}</span>
            </button>
            <input
              ref={inputRef}
              id={inputId}
              className="payment-documents-file-input"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              disabled={actionsDisabled}
              aria-label="Selecionar boleto ou instrução de pagamento"
            />
          </div>
        )}
      </header>

      {feedback && (
        <p
          className={`payment-documents-feedback is-${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          aria-live={feedback.kind === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {feedback.message}
        </p>
      )}

      {documents.length > 0 ? (
        <ul className="payment-document-list" aria-label="Documentos disponíveis">
          {documents.map((document) => {
            const isInstruction = document.tipo === 'documento_pagamento'
            const isDownloading = downloadingId === document.id

            return (
              <li className="payment-document-item" key={document.id}>
                <span className="payment-document-icon" aria-hidden="true">
                  <FileText size={18} />
                </span>
                <div className="payment-document-details">
                  <strong title={document.arquivo_nome}>{document.arquivo_nome}</strong>
                  <span className="payment-document-kind">{isInstruction ? 'Boleto / instrução' : 'Comprovante'}</span>
                  <small>{formatBytes(document.tamanho_bytes)} · {formatDate(document.created_at)}</small>
                </div>
                <button
                  type="button"
                  className="payment-document-download"
                  onClick={() => void downloadDocument(document)}
                  disabled={actionsDisabled}
                  aria-label={`Baixar ${document.arquivo_nome}`}
                >
                  {isDownloading ? <LoaderCircle className="payment-documents-spin" size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
                  <span>{isDownloading ? 'Baixando…' : 'Baixar'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="payment-documents-empty" role="status">
          <FileText size={18} aria-hidden="true" />
          <span>Nenhum documento anexado a este pagamento.</span>
        </div>
      )}
    </section>
  )
}
