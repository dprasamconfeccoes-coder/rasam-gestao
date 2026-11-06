export type ReportCell = string | number | boolean | null | undefined
export type ReportExportColumn = { key: string; label: string }

function safeCell(value: ReportCell): string | number | boolean {
  if (typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(value)) return `'${value}`
  if (value === null || value === undefined) return ''
  return value
}

function csvCell(value: ReportCell) {
  return `"${String(safeCell(value)).replaceAll('"', '""')}"`
}

function safeFilename(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'relatorio'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadReportCsv(title: string, columns: ReportExportColumn[], rows: Array<Record<string, ReportCell>>, metadata: Array<[string, string]> = []) {
  const csvRows: ReportCell[][] = [
    [title],
    ...metadata.map(([label, value]) => [label, value]),
    [],
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => row[column.key])),
  ]
  const content = csvRows.map((row) => row.map(csvCell).join(';')).join('\r\n')
  downloadBlob(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }), `${safeFilename(title)}.csv`)
}

export async function downloadReportXlsx(title: string, columns: ReportExportColumn[], rows: Array<Record<string, ReportCell>>, metadata: Array<[string, string]> = []) {
  const XLSX = await import('xlsx')
  const worksheetRows: ReportCell[][] = [
    [title],
    ...metadata.map(([label, value]) => [label, value]),
    [],
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => row[column.key])),
  ]
  const safeRows = worksheetRows.map((row) => row.map(safeCell))
  const worksheet = XLSX.utils.aoa_to_sheet(safeRows)
  worksheet['!cols'] = columns.map((column) => ({ wch: Math.max(14, Math.min(36, column.label.length + 3)) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Relatório')
  const name = safeFilename(title)
  XLSX.writeFile(workbook, `${name}.xlsx`)
}

function escapeHtml(value: unknown) {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(safeCell(value as ReportCell)).replace(/[&<>"']/g, (character) => entities[character])
}

export function printReport(title: string, columns: ReportExportColumn[], rows: Array<Record<string, ReportCell>>, metadata: Array<[string, string]> = []) {
  const safeTitle = escapeHtml(title)
  const metadataHtml = metadata.map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join('')
  const html = `<html><head><meta charset="utf-8"><title>${safeTitle}</title><style>body{font:12px Arial,sans-serif;padding:28px;color:#252b28}h1{font-size:21px;margin-bottom:8px}.meta{display:flex;gap:16px;flex-wrap:wrap;color:#66736b;font-size:11px}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #d9ded9;padding:7px;text-align:left;vertical-align:top}th{background:#eef3ed}tr:nth-child(even){background:#fafbf9}@media print{body{padding:0}}</style></head><body><h1>${safeTitle}</h1><div class="meta">${metadataHtml}</div><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`
  const windowRef = window.open('', '_blank')
  if (!windowRef) throw new Error('O navegador bloqueou a janela de impressão. Permita pop-ups para gerar PDF.')
  windowRef.document.write(html)
  windowRef.document.close()
}

export async function downloadReportPdf(title: string, columns: ReportExportColumn[], rows: Array<Record<string, ReportCell>>, metadata: Array<[string, string]> = []) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: columns.length > 5 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const safeTitle = String(safeCell(title))
  doc.setProperties({ title: safeTitle, subject: 'Relatório de gestão RF Gestão', author: 'RF Gestão', creator: 'RF Gestão' })
  const metadataText = metadata.map(([label, value]) => `${label}: ${value}`).join('   ·   ')
  autoTable(doc, {
    head: [columns.map((column) => column.label)],
    body: rows.map((row) => columns.map((column) => String(safeCell(row[column.key])))),
    startY: 37,
    margin: { top: 37, right: 12, bottom: 14, left: 12 },
    styles: { font: 'helvetica', fontSize: columns.length > 7 ? 6.5 : 8, cellPadding: 2.2, overflow: 'linebreak', textColor: [43, 57, 48], lineColor: [226, 233, 226], lineWidth: .15, valign: 'top' },
    headStyles: { fillColor: [38, 91, 61], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 250, 247] },
    horizontalPageBreak: columns.length > 7,
    horizontalPageBreakRepeat: columns.length > 7 ? [0] : undefined,
    didDrawPage: () => {
      doc.setFillColor(35, 69, 49)
      doc.rect(0, 0, pageWidth, 29, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(15)
      doc.text(safeTitle.slice(0, 110), 12, 13)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(224, 235, 226)
      doc.text(metadataText.slice(0, 220) || `RF Gestão · ${new Date().toLocaleString('pt-BR')}`, 12, 21)
      doc.setTextColor(100, 112, 103)
      doc.setFontSize(7)
      doc.text(`RF Gestão · ${doc.getNumberOfPages()}`, pageWidth - 12, doc.internal.pageSize.getHeight() - 6, { align: 'right' })
    },
  })
  doc.save(`${safeFilename(title)}.pdf`)
}

export async function downloadReportImage(title: string, columns: ReportExportColumn[], rows: Array<Record<string, ReportCell>>, metadata: Array<[string, string]> = [], format: 'png' | 'jpg' = 'png') {
  const width = Math.max(1200, Math.min(1800, columns.length * 250))
  const rowLimit = 60
  const visibleRows = rows.slice(0, rowLimit)
  const rowHeight = columns.length > 8 ? 46 : 40
  const top = 188
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = top + Math.max(1, visibleRows.length) * rowHeight + (rows.length > rowLimit ? 112 : 68)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível preparar a imagem do relatório.')

  ctx.fillStyle = '#f4f7f4'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#245b3d'
  ctx.fillRect(0, 0, canvas.width, 12)
  ctx.fillStyle = '#20352a'
  ctx.font = '700 34px system-ui, sans-serif'
  ctx.fillText(String(safeCell(title)).slice(0, 90), 56, 72)
  ctx.fillStyle = '#718078'
  ctx.font = '500 16px system-ui, sans-serif'
  const metadataLine = metadata.map(([label, value]) => `${label}: ${value}`).join('   ·   ')
  ctx.fillText(metadataLine.slice(0, 190) || `RF Gestão · ${new Date().toLocaleString('pt-BR')}`, 58, 108)
  ctx.fillStyle = '#87948b'
  ctx.font = '500 13px system-ui, sans-serif'
  ctx.fillText(`${rows.length.toLocaleString('pt-BR')} linha(s) · exibindo ${visibleRows.length.toLocaleString('pt-BR')}`, 58, 138)

  const tableX = 48
  const tableY = 164
  const tableWidth = width - 96
  const colWidth = tableWidth / Math.max(1, columns.length)
  ctx.fillStyle = '#e8efe8'
  ctx.fillRect(tableX, tableY, tableWidth, rowHeight)
  ctx.font = '700 13px system-ui, sans-serif'
  ctx.fillStyle = '#365342'
  columns.forEach((column, index) => {
    const x = tableX + index * colWidth + 12
    ctx.fillText(column.label.slice(0, 28), x, tableY + rowHeight / 2 + 5, colWidth - 20)
  })
  visibleRows.forEach((row, rowIndex) => {
    const y = tableY + rowHeight + rowIndex * rowHeight
    ctx.fillStyle = rowIndex % 2 === 0 ? '#ffffff' : '#f9fbf9'
    ctx.fillRect(tableX, y, tableWidth, rowHeight)
    ctx.strokeStyle = '#e8ede8'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(tableX, y + rowHeight); ctx.lineTo(tableX + tableWidth, y + rowHeight); ctx.stroke()
    ctx.font = '500 12px system-ui, sans-serif'
    ctx.fillStyle = '#4d5d52'
    columns.forEach((column, columnIndex) => {
      const value = String(safeCell(row[column.key]))
      const x = tableX + columnIndex * colWidth + 12
      let visible = value
      while (visible.length > 3 && ctx.measureText(visible).width > colWidth - 22) visible = `${visible.slice(0, -2)}…`
      ctx.fillText(visible, x, y + rowHeight / 2 + 4)
    })
  })
  const footerY = tableY + rowHeight + visibleRows.length * rowHeight + 34
  ctx.fillStyle = '#7f8d83'
  ctx.font = '500 12px system-ui, sans-serif'
  const footer = rows.length > rowLimit ? `Imagem limitada às primeiras ${rowLimit} linhas. Use Excel ou PDF para exportar o relatório completo.` : 'RF Gestão · Relatório gerencial'
  ctx.fillText(footer, tableX, footerY)

  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Não foi possível gerar a imagem do relatório.')), mime, .94))
  downloadBlob(blob, `${safeFilename(title)}.${format}`)
}
