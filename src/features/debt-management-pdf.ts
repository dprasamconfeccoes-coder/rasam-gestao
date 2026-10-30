import rfLogoUrl from '../assets/rf-logo.png'
import type { DebtInstallment, ManagedDebt } from '../lib/types'

const margin = 14
const pageTop = 34
const pageBottom = 21
const brand = { plum: [145, 36, 111] as [number, number, number], ink: [37, 38, 43] as [number, number, number], muted: [103, 106, 112] as [number, number, number], line: [226, 228, 231] as [number, number, number], pale: [249, 246, 249] as [number, number, number], green: [41, 111, 78] as [number, number, number], red: [169, 64, 59] as [number, number, number] }
const money = (value: number | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
const safeText = (value: unknown, fallback = 'Não informado') => value === null || value === undefined || String(value).trim() === '' ? fallback : String(value).trim()
const date = (value?: string | null) => {
  if (!value) return 'Não informado'
  const raw = value.slice(0, 10)
  const parsed = new Date(`${raw}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('pt-BR')
}
const dateTime = (value: string) => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR')
}
const safeFilename = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'divida'

async function loadLogo() {
  try {
    const response = await fetch(rfLogoUrl)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function statusLabel(debt: ManagedDebt) {
  return ({ ativa: 'Ativa', quitada: 'Quitada', renegociada: 'Renegociada', inativa: 'Inativa' } as const)[debt.status]
}
function categoryLabel(category: ManagedDebt['categoria']) {
  return ({ trabalhista: 'Trabalhista', previdenciaria: 'Previdenciária', emprestimo_pessoal: 'Empréstimo particular', consignado: 'Empréstimo consignado', outros: 'Outros / revisar' } as const)[category]
}
function methodLabel(method: DebtInstallment['forma_pagamento']) {
  return ({ pix: 'Pix', transferencia: 'Transferência bancária', boleto: 'Boleto', outro: 'Outro meio' } as const)[method]
}
function itemLabel(item: DebtInstallment) {
  if (item.tipo_item === 'entrada') return 'Entrada'
  if (item.tipo_item === 'saldo_legado') return 'Saldo legado'
  return `Parcela ${item.numero}`
}
function installmentStatus(item: DebtInstallment) {
  if (!item.ativo) return 'Inativa'
  if (item.status === 'paga') return 'Paga'
  if (item.vencimento && item.vencimento < new Date().toISOString().slice(0, 10)) return 'Vencida'
  return 'Pendente'
}
function attachmentNames(item: DebtInstallment) {
  const names = (item.arquivos || []).map((file) => `${file.tipo === 'comprovante' ? 'Comprovante' : 'Instrução'}: ${file.arquivo_nome}`)
  if (item.legacy_comprovante_nome) names.push(`Comprovante legado: ${item.legacy_comprovante_nome}`)
  return names
}
function paymentDetails(item: DebtInstallment) {
  const details: string[] = []
  if (item.forma_pagamento === 'pix' && item.chave_pix) details.push(`Chave Pix: ${item.chave_pix}`)
  if (item.forma_pagamento === 'transferencia' && item.dados_transferencia) details.push(`Dados bancários: ${item.dados_transferencia}`)
  details.push(...attachmentNames(item))
  return details.length ? details.join('\n') : 'Sem instruções ou anexos registrados'
}
function auditDetails(details: Record<string, unknown>) {
  return Object.entries(details || {}).map(([key, value]) => {
    const label = key.replaceAll('_', ' ')
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return `${label}: ${text}`
  }).join(' | ') || 'Sem detalhes complementares'
}
function auditEvent(value: string) {
  const labels: Record<string, string> = {
    divida_migrada: 'Registro legado preservado', divida_criada: 'Dívida cadastrada', dados_divida_atualizados: 'Dados da dívida atualizados',
    parcela_adicionada: 'Parcela adicionada', parcela_atualizada: 'Parcela atualizada', parcela_inativar: 'Parcela inativada',
    parcela_restaurar: 'Parcela restaurada', parcela_reabrir: 'Quitação reaberta', parcela_quitada: 'Parcela quitada',
    documento_pagamento_anexado: 'Documento de pagamento anexado', divida_inativar: 'Dívida inativada', divida_restaurar: 'Dívida restaurada',
  }
  return labels[value] || value.replaceAll('_', ' ')
}

export async function downloadManagedDebtPdf(debt: ManagedDebt) {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable'), loadLogo()])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const generated = new Date()
  const generatedLabel = generated.toLocaleString('pt-BR')
  const paidValue = debt.parcelas.filter((item) => item.status === 'paga').reduce((sum, item) => sum + Number(item.valor || 0), 0)
  const pendingItems = debt.parcelas.filter((item) => item.ativo && item.status === 'pendente')
  const overdueItems = pendingItems.filter((item) => item.vencimento && item.vencimento < generated.toISOString().slice(0, 10))
  const inactiveItems = debt.parcelas.filter((item) => !item.ativo)
  const nextDue = pendingItems.filter((item) => item.vencimento).sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''))[0]

  doc.setProperties({
    title: `Relatório detalhado de dívida - ${debt.credor}`,
    subject: `Acompanhamento administrativo da dívida ${debt.id}`,
    author: 'RF Gestão',
    creator: 'RF Gestão - Gestão de dívidas',
    keywords: 'gestão de dívidas, parcelas, auditoria, relatório administrativo',
  })

  let y = 37
  doc.setTextColor(...brand.ink)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Relatório detalhado de dívida', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...brand.muted)
  doc.setFontSize(8.5)
  doc.text('Acompanhamento financeiro individual · documento gerencial administrativo', margin, y)
  doc.setTextColor(...brand.plum)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text(statusLabel(debt).toLocaleUpperCase('pt-BR'), pageWidth - margin, 42, { align: 'right' })
  y += 8

  const cardGap = 3
  const cardWidth = (pageWidth - margin * 2 - cardGap * 3) / 4
  const cardHeight = 19
  const cards = [
    ['VALOR ORIGINAL', money(debt.valor_original)],
    ['SALDO DEVEDOR', money(debt.saldo_devedor)],
    ['TOTAL QUITADO', money(paidValue)],
    ['PRÓXIMO VENCIMENTO', nextDue ? date(nextDue.vencimento) : '—'],
  ]
  cards.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + cardGap)
    doc.setFillColor(...brand.pale)
    doc.setDrawColor(...brand.line)
    doc.setLineWidth(0.2)
    doc.roundedRect(x, y, cardWidth, cardHeight, 1.6, 1.6, 'FD')
    doc.setTextColor(...brand.muted)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.3)
    doc.text(label, x + 2.5, y + 5)
    doc.setTextColor(...brand.ink)
    doc.setFontSize(index === 3 ? 8 : 9)
    doc.text(doc.splitTextToSize(value, cardWidth - 5).slice(0, 2), x + 2.5, y + 12)
  })
  y += cardHeight + 6

  const section = (title: string) => {
    if (y + 12 > pageHeight - pageBottom) {
      doc.addPage()
      y = pageTop + 3
    }
    doc.setFillColor(247, 242, 247)
    doc.roundedRect(margin, y, pageWidth - margin * 2, 7.5, 1.2, 1.2, 'F')
    doc.setFillColor(...brand.plum)
    doc.roundedRect(margin, y, 1.2, 7.5, 0.5, 0.5, 'F')
    doc.setTextColor(...brand.ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(title, margin + 4.5, y + 5.1)
    y += 10
  }
  const table = (head: string[][], body: string[][], options: Record<string, unknown> = {}) => {
    autoTable(doc, {
      head,
      body,
      startY: y,
      theme: 'grid',
      margin: { left: margin, right: margin, top: pageTop, bottom: pageBottom },
      styles: { font: 'helvetica', fontSize: 7.3, textColor: brand.ink, lineColor: brand.line, lineWidth: 0.15, cellPadding: 2.4, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: brand.plum, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.2, cellPadding: 2.7 },
      alternateRowStyles: { fillColor: [250, 250, 251] },
      rowPageBreak: 'avoid',
      ...options,
    })
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 12) + 4
  }

  section('1. Identificação e condições de cadastro')
  table([], [
    ['Credor / beneficiário', safeText(debt.credor), 'Natureza', categoryLabel(debt.categoria)],
    ['Descrição', safeText(debt.descricao), 'Situação atual', statusLabel(debt)],
    ['Data de contratação / origem', date(debt.data_contratacao), 'Data de atualização', dateTime(debt.updated_at)],
    ['Origem do registro', debt.origem_legada ? `Migrado do módulo legado: ${debt.origem_legada}` : 'Cadastro da Gestão de dívidas', 'Agenda', debt.modelo_agenda === 'novo' ? 'Agenda detalhada' : debt.modelo_agenda === 'migrado' ? 'Agenda financeira migrada' : 'Saldo legado'],
    ['Revisão cadastral', debt.revisao_pendente ? 'Pendente - conferir natureza e condições do registro legado' : 'Sem revisão pendente', 'Identificador do registro', debt.id],
  ], { columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold', fillColor: brand.pale }, 1: { cellWidth: 55 }, 2: { cellWidth: 34, fontStyle: 'bold', fillColor: brand.pale }, 3: { cellWidth: 'auto' } } })

  section('2. Posição financeira e situação das parcelas')
  table([], [
    ['Parcelas cadastradas', String(debt.parcelas.length), 'Pendentes ativas', `${pendingItems.length} · ${money(pendingItems.reduce((sum, item) => sum + Number(item.valor || 0), 0))}`],
    ['Parcelas quitadas', `${debt.parcelas.filter((item) => item.status === 'paga').length} · ${money(paidValue)}`, 'Parcelas vencidas', `${overdueItems.length} · ${money(overdueItems.reduce((sum, item) => sum + Number(item.valor || 0), 0))}`],
    ['Parcelas inativadas', `${inactiveItems.length} · ${money(inactiveItems.reduce((sum, item) => sum + Number(item.valor || 0), 0))}`, 'Próximo vencimento', nextDue ? `${date(nextDue.vencimento)} · ${money(nextDue.valor)}` : 'Não há vencimento futuro registrado'],
  ], { columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold', fillColor: brand.pale }, 1: { cellWidth: 55 }, 2: { cellWidth: 34, fontStyle: 'bold', fillColor: brand.pale }, 3: { cellWidth: 'auto' } } })

  section('3. Agenda detalhada de parcelas e pagamentos')
  const installmentRows = [...debt.parcelas].sort((a, b) => {
    const da = a.vencimento || '9999-12-31'
    const db = b.vencimento || '9999-12-31'
    return da.localeCompare(db) || a.numero - b.numero
  }).map((item) => [
    itemLabel(item),
    date(item.vencimento),
    money(item.valor),
    installmentStatus(item),
    `${methodLabel(item.forma_pagamento)}${item.status === 'paga' ? `\nQuitada em: ${date(item.pago_em)}` : ''}`,
    paymentDetails(item),
  ])
  if (installmentRows.length) {
    table([['Item', 'Vencimento', 'Valor', 'Situação', 'Pagamento / baixa', 'Instruções de pagamento e documentos anexos']], installmentRows, {
      styles: { font: 'helvetica', fontSize: 6.8, textColor: brand.ink, lineColor: brand.line, lineWidth: 0.15, cellPadding: 2.1, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: brand.plum, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.8, cellPadding: 2.3 },
      columnStyles: { 0: { cellWidth: 21 }, 1: { cellWidth: 21 }, 2: { cellWidth: 23, halign: 'right' }, 3: { cellWidth: 19 }, 4: { cellWidth: 29 }, 5: { cellWidth: 'auto' } },
    })
  } else {
    table([], [['Não existem parcelas detalhadas associadas a este registro. O saldo legado foi preservado sem criar vencimentos ou condições não informadas.']])
  }

  section('4. Observações administrativas')
  const observation = safeText(debt.observacoes, 'Não há observações registradas para esta dívida.')
  table([], [[observation]], { styles: { font: 'helvetica', fontSize: 8, textColor: brand.ink, lineColor: brand.line, lineWidth: 0.15, cellPadding: 3.2, overflow: 'linebreak', valign: 'top' } })
  if (debt.inativada_em) {
    table([], [['Registro inativado em', dateTime(debt.inativada_em), 'O saldo e o histórico foram preservados; itens inativos não compõem os totais de obrigações ativas.']], {
      columnStyles: { 0: { cellWidth: 34, fontStyle: 'bold', fillColor: brand.pale }, 1: { cellWidth: 34 }, 2: { cellWidth: 'auto' } },
    })
  }

  section('5. Trilha de auditoria')
  const history = [...(debt.auditoria || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
  if (history.length) {
    table([['Data e hora', 'Operador', 'Evento auditado', 'Detalhes registrados']], history.map((entry) => [dateTime(entry.created_at), safeText(entry.usuario_nome, 'Administrador'), auditEvent(entry.evento), auditDetails(entry.detalhes || {})]), {
      styles: { font: 'helvetica', fontSize: 6.9, textColor: brand.ink, lineColor: brand.line, lineWidth: 0.15, cellPadding: 2.2, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: brand.plum, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 31 }, 2: { cellWidth: 39 }, 3: { cellWidth: 'auto' } },
    })
  } else {
    table([], [['Nenhum evento de auditoria foi retornado para este registro.']])
  }

  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page)
    doc.setFillColor(250, 249, 250)
    doc.rect(0, 0, pageWidth, 31, 'F')
    doc.setDrawColor(...brand.line)
    doc.setLineWidth(0.25)
    doc.line(margin, 31, pageWidth - margin, 31)
    if (logo) doc.addImage(logo, 'PNG', margin, 6, 21, 15.4, undefined, 'FAST')
    else {
      doc.setFillColor(...brand.plum)
      doc.roundedRect(margin, 7, 20, 14, 1.4, 1.4, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text('RF', margin + 6, 16)
    }
    doc.setTextColor(...brand.ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('RF Gestão', margin + 26, 11)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...brand.muted)
    doc.text('Controle financeiro · gestão administrativa de obrigações', margin + 26, 16)
    doc.setTextColor(...brand.plum)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text('RELATÓRIO INDIVIDUAL', pageWidth - margin, 11, { align: 'right' })
    doc.setTextColor(...brand.muted)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
    doc.text(`Emitido em ${generatedLabel}`, pageWidth - margin, 16, { align: 'right' })

    doc.setDrawColor(...brand.line)
    doc.setLineWidth(0.25)
    doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...brand.muted)
    doc.text('Documento gerencial · uso administrativo confidencial · consulte os comprovantes originais no sistema', margin, pageHeight - 10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...brand.plum)
    doc.text(`Página ${page} de ${totalPages}`, pageWidth - margin, pageHeight - 10, { align: 'right' })
  }

  doc.save(`Relatorio-detalhado-divida-${safeFilename(debt.credor)}.pdf`)
}
