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
