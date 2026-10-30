import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeCheck, BookOpen, CalendarDays, Check, Download, FilePlus2, FileText, History, LockKeyhole, Pencil, Plus, RefreshCw, Search, ShieldCheck, Upload, UsersRound, X } from 'lucide-react'
import { getInternalDocumentDownloadUrl, listCompanyDocuments, updateInternalDocument, uploadInternalDocument, type InternalDocumentCategory } from '../lib/api'
import type { CompanyDocument } from '../lib/types'
import { ConfirmationModal, EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, formatDate } from '../components/ui'
import './internal-documents.css'

type DocumentFamily = { id: string; versions: CompanyDocument[]; latest: CompanyDocument }
type DocumentForm = { groupId: string | null; title: string; category: InternalDocumentCategory; description: string; available: boolean; file: File | null }
type PendingAction =
  | { kind: 'upload'; draft: DocumentForm }
  | { kind: 'update'; groupId: string; draft: Omit<DocumentForm, 'groupId' | 'file'> }

const categoryLabels: Record<InternalDocumentCategory, string> = {
  cct: 'Convenção coletiva', regimento: 'Regimento interno', campanha: 'Campanhas', comunicado: 'Comunicados',
  politica: 'Políticas e procedimentos', ponto: 'Ponto e jornada', outro: 'Outros documentos',
}
const categoryOptions = Object.entries(categoryLabels) as Array<[InternalDocumentCategory, string]>
const blankForm = (): DocumentForm => ({ groupId: null, title: '', category: 'outro', description: '', available: true, file: null })

function fileSize(value: number | null) {
  const bytes = Number(value || 0)
  if (!bytes) return 'Tamanho não informado'
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function InternalDocumentsDashboard({ token, canManage }: { token: string; canManage: boolean }) {
  const [documents, setDocuments] = useState<CompanyDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<InternalDocumentCategory | 'todas'>('todas')
  const [showUpload, setShowUpload] = useState(false)
  const [uploadDraft, setUploadDraft] = useState<DocumentForm>(blankForm)
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Omit<DocumentForm, 'groupId' | 'file'> | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)

  const reload = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    setError('')
    try {
      const result = await listCompanyDocuments(token)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar os documentos.')
      setDocuments(result.documentos || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar os documentos internos.')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [token])
  useEffect(() => { void reload(true) }, [reload])

  const families = useMemo<DocumentFamily[]>(() => {
    const grouped = new Map<string, CompanyDocument[]>()
    for (const document of documents) {
      const id = document.grupo_id || document.id
      const current = grouped.get(id) || []
      current.push(document)
      grouped.set(id, current)
    }
    return [...grouped.entries()].map(([id, versions]) => {
      versions.sort((a, b) => Number(b.versao || 1) - Number(a.versao || 1) || b.created_at.localeCompare(a.created_at))
      return { id, versions, latest: versions[0] }
    }).sort((a, b) => b.latest.updated_at.localeCompare(a.latest.updated_at) || a.latest.titulo.localeCompare(b.latest.titulo))
  }, [documents])
  const filteredFamilies = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR')
    return families.filter((family) => {
      const { latest } = family
      const matchesCategory = categoryFilter === 'todas' || latest.categoria === categoryFilter
      const matchesText = !term || family.versions.some((version) =>
        [version.titulo, version.conteudo_texto, version.arquivo_nome, categoryLabels[version.categoria as InternalDocumentCategory] || version.categoria]
          .some((value) => value?.toLocaleLowerCase('pt-BR').includes(term)),
      )
      return matchesCategory && matchesText
    })
  }, [families, query, categoryFilter])
  const employeeVisible = families.filter(({ latest }) => latest.disponivel_funcionarios).length
  const totalVersions = families.reduce((sum, family) => sum + family.versions.length, 0)
  const categoriesCount = new Set(families.map((family) => family.latest.categoria)).size

  function openNewDocument() {
    setUploadDraft(blankForm())
    setShowUpload(true)
    setEditingGroup(null)
    setEditDraft(null)
    setError('')
    setNotice('')
  }
  function openNewVersion(family: DocumentFamily) {
    setUploadDraft({ groupId: family.id, title: family.latest.titulo, category: family.latest.categoria as InternalDocumentCategory, description: family.latest.conteudo_texto || '', available: family.latest.disponivel_funcionarios, file: null })
    setShowUpload(true)
    setEditingGroup(null)
    setEditDraft(null)
    setError('')
    setNotice('')
  }
  function openEdit(family: DocumentFamily) {
    setEditingGroup(family.id)
    setEditDraft({ title: family.latest.titulo, category: family.latest.categoria as InternalDocumentCategory, description: family.latest.conteudo_texto || '', available: family.latest.disponivel_funcionarios })
    setShowUpload(false)
    setError('')
  }
  function queueUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!uploadDraft.title.trim() || !uploadDraft.file) { setError('Informe o título e selecione o arquivo que será armazenado.'); return }
    if (uploadDraft.file.size < 1 || uploadDraft.file.size > 20 * 1024 * 1024) { setError('O arquivo deve ter até 20 MB.'); return }
    setPending({ kind: 'upload', draft: uploadDraft })
  }
  function queueUpdate(event: React.FormEvent<HTMLFormElement>, groupId: string) {
    event.preventDefault()
    if (!editDraft?.title.trim()) { setError('Informe o título do documento.'); return }
    if (editDraft.description.length > 5000) { setError('A descrição pode ter até 5.000 caracteres.'); return }
    setError('')
    setPending({ kind: 'update', groupId, draft: editDraft })
  }
  async function confirmAction() {
    if (!pending) return
    setSaving(true)
    setError('')
    try {
      if (pending.kind === 'upload') {
        if (!pending.draft.file) throw new Error('Selecione um arquivo antes de confirmar.')
        const result = await uploadInternalDocument(token, {
          grupoId: pending.draft.groupId,
          titulo: pending.draft.title.trim(),
          categoria: pending.draft.category,
          descricao: pending.draft.description.trim(),
          disponivelFuncionarios: pending.draft.available,
          arquivo: pending.draft.file,
        })
        setNotice(`Documento armazenado com segurança · versão ${result.versao}.`)
        setShowUpload(false)
        setUploadDraft(blankForm())
      } else {
        const result = await updateInternalDocument(token, pending.groupId, {
          titulo: pending.draft.title.trim(), categoria: pending.draft.category,
          descricao: pending.draft.description.trim(), disponivelFuncionarios: pending.draft.available,
        })
        if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar o documento.')
        setNotice('Dados e disponibilidade do documento atualizados.')
        setEditingGroup(null)
        setEditDraft(null)
      }
      setPending(null)
      await reload(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a alteração.')
    } finally {
      setSaving(false)
    }
  }
  async function download(document: CompanyDocument) {
    setDownloading(document.id)
    setError('')
    const popup = window.open('', '_blank')
    if (popup) popup.opener = null
    try {
      const result = await getInternalDocumentDownloadUrl(token, document.id)
      if (popup) popup.location.href = result.url || ''
      else window.location.href = result.url || ''
    } catch (err) {
      popup?.close()
      setError(err instanceof Error ? err.message : 'Não foi possível preparar o download.')
    } finally {
      setDownloading('')
    }
  }

  const pendingTitle = pending?.kind === 'upload' ? (pending.draft.groupId ? 'Confirmar nova versão' : 'Confirmar inclusão do documento') : 'Confirmar atualização do documento'
  const pendingDescription = pending?.kind === 'upload'
    ? 'O arquivo será armazenado no acervo privado. A disponibilização aos funcionários seguirá a opção selecionada.'
    : 'Os metadados e a permissão de visualização serão atualizados para todas as versões deste documento.'
  const pendingDetails = pending?.kind === 'upload'
    ? `${pending.draft.title.trim()} · ${categoryLabels[pending.draft.category]}\nArquivo: ${pending.draft.file?.name || '—'} · ${fileSize(pending.draft.file?.size || 0)}\nAcesso: ${pending.draft.available ? 'Funcionários e administradores' : 'Somente administradores'}${pending.draft.groupId ? `\nNova versão: ${((families.find((family) => family.id === pending.draft.groupId)?.versions.length || 0) + 1)}` : '\nVersão inicial: 1'}`
    : pending?.kind === 'update' ? `${pending.draft.title.trim()} · ${categoryLabels[pending.draft.category]}\nAcesso: ${pending.draft.available ? 'Funcionários e administradores' : 'Somente administradores'}` : ''

  return <div className="internal-documents-page">
    <PageHeading eyebrow={canManage ? 'Administração · acervo digital' : 'Empresa · acervo digital'} title="Documentos internos" description={canManage ? 'Publique e organize normas, convenções, campanhas e comunicados da empresa com histórico de versões.' : 'Consulte e baixe os documentos disponibilizados pela empresa, incluindo versões anteriores.'} action={<div className="internal-documents-heading-actions"><button className="secondary-button" onClick={() => void reload(true)} disabled={loading || saving}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>{canManage && <button className="primary-button" onClick={openNewDocument}><Plus size={17} /> Adicionar documento</button>}</div>} />
    {notice && <div className="internal-documents-notice" role="status"><Check size={16} /><span>{notice}</span><button aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {error && <div className="internal-documents-error" role="alert"><ErrorState message={error} /><button className="text-button" onClick={() => setError('')}>Fechar</button></div>}

    <section className="internal-documents-metrics" aria-label="Resumo do acervo">
      <article><span className="internal-documents-metric-icon"><BookOpen size={18} /></span><div><small>Documentos no acervo</small><strong>{families.length}</strong><span>Conjuntos documentais</span></div></article>
      <article><span className="internal-documents-metric-icon is-green"><UsersRound size={18} /></span><div><small>Disponíveis à equipe</small><strong>{employeeVisible}</strong><span>Visíveis para funcionários</span></div></article>
      <article><span className="internal-documents-metric-icon is-blue"><History size={18} /></span><div><small>Versões preservadas</small><strong>{totalVersions}</strong><span>Histórico sem sobrescrever arquivos</span></div></article>
      <article><span className="internal-documents-metric-icon is-purple"><ShieldCheck size={18} /></span><div><small>Categorias ativas</small><strong>{categoriesCount}</strong><span>Normas, campanhas e outros</span></div></article>
    </section>

    {showUpload && canManage && <SectionCard title={uploadDraft.groupId ? 'Adicionar versão ao documento' : 'Adicionar documento ao acervo'} caption={uploadDraft.groupId ? 'A versão anterior será mantida no histórico.' : 'O arquivo ficará em armazenamento privado e só será baixado por pessoas autorizadas.'} className="internal-documents-form-card">
      <form className="internal-document-form" onSubmit={queueUpload}>
        <div className="internal-document-form-grid">
          <label>Título do documento<input required maxLength={180} value={uploadDraft.title} onChange={(event) => setUploadDraft((draft) => ({ ...draft, title: event.target.value }))} placeholder="Ex.: Convenção Coletiva de Trabalho 2026/2027" /></label>
          <label>Categoria<select value={uploadDraft.category} onChange={(event) => setUploadDraft((draft) => ({ ...draft, category: event.target.value as InternalDocumentCategory }))}>{categoryOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="internal-document-file-field">Arquivo digital<input required type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(event) => setUploadDraft((draft) => ({ ...draft, file: event.target.files?.[0] || null }))} /><small>PDF, JPG, PNG, WebP, DOCX, XLSX ou PPTX · até 20 MB</small></label>
          <label className="internal-document-description">Descrição / observações<textarea rows={3} maxLength={5000} value={uploadDraft.description} onChange={(event) => setUploadDraft((draft) => ({ ...draft, description: event.target.value }))} placeholder="Vigência, público, campanha ou breve resumo do arquivo." /></label>
        </div>
        {uploadDraft.file && <div className="internal-document-selected-file"><FileText size={17} /><span><strong>{uploadDraft.file.name}</strong><small>{fileSize(uploadDraft.file.size)}</small></span></div>}
        <label className="internal-document-publish-toggle"><input type="checkbox" checked={uploadDraft.available} onChange={(event) => setUploadDraft((draft) => ({ ...draft, available: event.target.checked }))} /><span><strong>Disponibilizar para funcionários</strong><small>Quando desmarcado, somente administradores podem visualizar e baixar.</small></span></label>
        <div className="internal-document-form-actions"><button type="button" className="secondary-button" onClick={() => { setShowUpload(false); setUploadDraft(blankForm()) }}>Cancelar</button><button type="submit" className="primary-button"><Check size={16} /> Revisar e confirmar</button></div>
      </form>
    </SectionCard>}

    <SectionCard title="Acervo digital" caption={canManage ? 'Gerencie documentos, disponibilidade e histórico de versões.' : 'Arquivos e versões liberados pela administração da empresa.'}>
      <div className="internal-documents-toolbar"><label className="internal-documents-search"><Search size={17} /><input aria-label="Buscar documentos por título, descrição ou arquivo" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por título, descrição ou arquivo" /></label><label className="internal-documents-category-filter"><span>Categoria</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as InternalDocumentCategory | 'todas')}><option value="todas">Todas</option>{categoryOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      {loading ? <LoadingState /> : filteredFamilies.length === 0 ? <EmptyState title={families.length ? 'Nenhum documento corresponde à busca' : 'O acervo ainda está vazio'} description={families.length ? 'Tente outro termo ou categoria.' : canManage ? 'Adicione a primeira convenção, norma, política ou campanha.' : 'Os documentos disponibilizados pela empresa aparecerão aqui.'} /> : <div className="internal-document-list">{filteredFamilies.map((family) => {
        const doc = family.latest
        const editing = editingGroup === family.id && editDraft
        return <article className="internal-document-card" key={family.id}>
          <header className="internal-document-card-header"><span className="internal-document-cover"><FileText size={22} /></span><div className="internal-document-card-title"><div className="internal-document-badges"><span className="internal-document-category">{categoryLabels[doc.categoria as InternalDocumentCategory] || doc.categoria}</span><span className={`internal-document-access ${doc.disponivel_funcionarios ? 'is-public' : 'is-admin'}`}>{doc.disponivel_funcionarios ? <><UsersRound size={12} /> Disponível à equipe</> : <><LockKeyhole size={12} /> Somente administradores</>}</span></div><h3>{doc.titulo}</h3>{doc.conteudo_texto && <p>{doc.conteudo_texto}</p>}<small className="internal-document-current-version">Versão atual <strong>v{doc.versao || 1}</strong> · {doc.arquivo_nome || 'Arquivo legado'} · {fileSize(doc.tamanho_bytes)}</small></div><div className="internal-document-card-actions"><button className="primary-button" onClick={() => void download(doc)} disabled={downloading === doc.id}>{downloading === doc.id ? <RefreshCw size={15} className="spin" /> : <Download size={15} />} Baixar versão atual</button></div></header>
          {editing && <form className="internal-document-edit-form" onSubmit={(event) => queueUpdate(event, family.id)}><div className="internal-document-form-grid"><label>Título<input required maxLength={180} value={editDraft.title} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, title: event.target.value } : draft)} /></label><label>Categoria<select value={editDraft.category} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, category: event.target.value as InternalDocumentCategory } : draft)}>{categoryOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="internal-document-description">Descrição / observações<textarea rows={3} maxLength={5000} value={editDraft.description} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, description: event.target.value } : draft)} /></label></div><label className="internal-document-publish-toggle"><input type="checkbox" checked={editDraft.available} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, available: event.target.checked } : draft)} /><span><strong>Disponibilizar para funcionários</strong><small>A alteração vale para todas as versões deste documento.</small></span></label><div className="internal-document-form-actions"><button type="button" className="secondary-button" onClick={() => { setEditingGroup(null); setEditDraft(null) }}>Cancelar</button><button type="submit" className="primary-button"><Check size={15} /> Revisar alteração</button></div></form>}
          {family.versions.length > 1 && <details className="internal-document-history"><summary><span><History size={15} /> Histórico de versões</span><span>{family.versions.length} versões</span></summary><div className="internal-document-version-list">{family.versions.map((version) => <div className="internal-document-version-row" key={version.id}><span className="internal-document-version-badge">v{version.versao || 1}</span><span className="internal-document-version-name"><strong>{version.arquivo_nome || 'Documento'}</strong><small><CalendarDays size={12} /> {formatDate(version.created_at)} · {fileSize(version.tamanho_bytes)}</small></span><button className="secondary-button" onClick={() => void download(version)} disabled={downloading === version.id}>{downloading === version.id ? <RefreshCw size={14} className="spin" /> : <Download size={14} />} Baixar</button></div>)}</div></details>}
          {canManage && <footer className="internal-document-admin-actions"><span><BadgeCheck size={14} /> Alterações restritas a administradores</span><div><button className="secondary-button" onClick={() => openEdit(family)}><Pencil size={14} /> Editar dados e acesso</button><button className="secondary-button" onClick={() => openNewVersion(family)}><FilePlus2 size={14} /> Nova versão</button></div></footer>}
        </article>
      })}</div>}
    </SectionCard>

    <div className="internal-document-security-note"><ShieldCheck size={17} /><span><strong>Arquivos protegidos</strong><small>Os documentos enviados ficam em armazenamento privado. O sistema confere sessão, empresa e permissão antes de gerar cada link temporário de download.</small></span></div>

    {pending && <ConfirmationModal title={pendingTitle || 'Confirmar ação'} description={pendingDescription || ''} confirmLabel={pending.kind === 'upload' ? 'Confirmar e armazenar' : 'Confirmar alteração'} busy={saving} onCancel={() => { if (!saving) setPending(null) }} onConfirm={() => void confirmAction()}><div className="confirmation-summary internal-document-confirmation-summary">{pendingDetails.split('\n').map((line, index) => <p key={index}>{line}</p>)}</div>{error && <p className="confirmation-modal-error" role="alert">{error}</p>}</ConfirmationModal>}
  </div>
}
