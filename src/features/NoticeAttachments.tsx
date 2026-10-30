import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, Image as ImageIcon, LoaderCircle, Trash2 } from 'lucide-react'
import { getNoticeAttachmentUrl } from '../lib/api'
import type { NoticeAttachmentRow } from '../lib/types'

type Props = {
  token: string
  noticeId: string
  attachments: NoticeAttachmentRow[]
  canRemove?: boolean
  removingId?: string
  onRemove?: (attachmentId: string) => Promise<void>
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

export function NoticeAttachments({ token, noticeId, attachments, canRemove = false, removingId = '', onRemove }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    let cancelled = false
    const activeIds = new Set(attachments.map((item) => item.id))
    setUrls((current) => Object.fromEntries(Object.entries(current).filter(([id]) => activeIds.has(id))))
    setErrors({})
    void Promise.all(attachments.map(async (item) => {
      try {
        const result = await getNoticeAttachmentUrl(token, item.id, false)
        if (!cancelled) setUrls((current) => ({ ...current, [item.id]: result.url || '' }))
      } catch (error) {
        if (!cancelled) setErrors((current) => ({ ...current, [item.id]: error instanceof Error ? error.message : 'Anexo indisponível' }))
      }
    }))
    return () => { cancelled = true }
  }, [token, noticeId, attachments])

  async function download(item: NoticeAttachmentRow) {
    setBusyId(item.id)
    try {
      const result = await getNoticeAttachmentUrl(token, item.id, true)
      const link = document.createElement('a')
      link.href = result.url || ''
      link.download = item.nome_arquivo
      link.rel = 'noreferrer'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (error) {
      setErrors((current) => ({ ...current, [item.id]: error instanceof Error ? error.message : 'Falha ao baixar arquivo' }))
    } finally {
      setBusyId('')
    }
  }

  if (!attachments.length) return null
  return <div className={`notice-attachments ${canRemove ? 'is-admin' : ''}`} aria-label="Anexos do aviso">
    {attachments.map((item) => {
      const isImage = item.mime_type.startsWith('image/')
      const url = urls[item.id]
      return <div className={`notice-attachment ${isImage ? 'is-image' : 'is-pdf'}`} key={item.id}>
        {isImage && url ? <a className="notice-image-preview" href={url} target="_blank" rel="noreferrer" aria-label={`Abrir imagem ${item.nome_arquivo}`}>
          <img src={url} alt={item.nome_arquivo} loading="lazy" />
        </a> : <div className="notice-file-icon">{isImage ? <ImageIcon size={21} /> : <FileText size={21} />}</div>}
        <div className="notice-attachment-meta">
          <strong title={item.nome_arquivo}>{item.nome_arquivo}</strong>
          <small>{isImage ? 'Imagem' : 'PDF'} · {formatBytes(item.tamanho_bytes)}</small>
          {errors[item.id] && <small className="notice-attachment-error">{errors[item.id]}</small>}
        </div>
        <div className="notice-attachment-actions">
          {url && !isImage && <a className="notice-attachment-open" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Abrir</a>}
          <button type="button" className="notice-attachment-download" onClick={() => void download(item)} disabled={busyId === item.id} aria-label={`Baixar ${item.nome_arquivo}`}>
            {busyId === item.id ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}<span>Baixar</span>
          </button>
          {canRemove && onRemove && <button type="button" className="notice-attachment-remove" onClick={() => void onRemove(item.id)} disabled={busyId === item.id || removingId === item.id} aria-label={`Remover ${item.nome_arquivo}`}><Trash2 size={15} /><span>{removingId === item.id ? 'Removendo…' : 'Remover'}</span></button>}
        </div>
      </div>
    })}
  </div>
}
