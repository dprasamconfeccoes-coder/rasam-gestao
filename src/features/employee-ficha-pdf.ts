import rfLogoUrl from '../assets/rf-logo.png'
import type { EmployeeFichaRecord } from '../lib/types'
import { displayValue, fieldGroups } from './EmployeeFichaPanel'

const margin = 16

function cleanText(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function safeFileName(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'funcionario'
}

async function loadLogoDataUrl() {
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

export async function downloadEmployeeFichaPdf(employee: EmployeeFichaRecord) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const name = cleanText(employee.nome) || 'Funcionário'
  const company = cleanText(employee.empregador_razao_social) || 'Empresa'
  const cnpj = cleanText(employee.empregador_cnpj)
  const generatedAt = new Intl.DateTimeFormat('pt-BR').format(new Date())
  const logoDataUrl = await loadLogoDataUrl()

  doc.setProperties({
    title: `Ficha de Empregado - ${name}`,
    subject: 'Ficha cadastral individual',
    author: company,
  })
  doc.setFillColor(250, 248, 244)
  doc.rect(0, 0, pageWidth, 39, 'F')
  doc.setDrawColor(137, 98, 15)
  doc.setLineWidth(0.7)
  doc.line(margin, 39, pageWidth - margin, 39)

  const textX = margin + 29
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', margin, 9, 24, 20, undefined, 'FAST')
  } else {
    doc.setFillColor(137, 98, 15)
    doc.roundedRect(margin, 9, 23, 20, 2, 2, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('RF', margin + 7, 22)
  }

  doc.setTextColor(38, 32, 36)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  const companyLines = doc.splitTextToSize(company, pageWidth - textX - margin - 34).slice(0, 2)
  doc.text(companyLines, textX, 13)
  const companyBottom = 13 + (companyLines.length - 1) * 4.5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  if (cnpj) doc.text(`CNPJ: ${cnpj}`, textX, companyBottom + 5)
  doc.setTextColor(162, 63, 105)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('FICHA DE EMPREGADO', pageWidth - margin, 14, { align: 'right' })
  doc.setTextColor(102, 90, 96)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(`Gerada em ${generatedAt}`, pageWidth - margin, 20, { align: 'right' })

  let y = 48
  for (const group of fieldGroups) {
    if (y > pageHeight - 35) {
      doc.addPage()
      y = 18
    }
    doc.setFillColor(246, 241, 231)
    doc.roundedRect(margin, y, pageWidth - margin * 2, 8, 1.5, 1.5, 'F')
    doc.setFillColor(162, 63, 105)
    doc.roundedRect(margin, y, 1.2, 8, 0.5, 0.5, 'F')
    doc.setTextColor(48, 38, 43)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(group.title, margin + 5, y + 5.3)

    autoTable(doc, {
      startY: y + 9,
      body: group.fields.map((field) => [field.label, displayValue(field, employee[field.key])]),
      theme: 'grid',
      margin: { left: margin, right: margin, top: 14, bottom: 19 },
      styles: {
        font: 'helvetica',
        fontSize: 8,
        textColor: [45, 37, 41],
        lineColor: [230, 224, 216],
        lineWidth: 0.15,
        cellPadding: 2.8,
        overflow: 'linebreak',
        valign: 'top',
      },
      columnStyles: {
        0: { cellWidth: 55, fontStyle: 'bold', textColor: [92, 77, 84], fillColor: [250, 248, 244] },
        1: { cellWidth: 'auto' },
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      rowPageBreak: 'avoid',
    })
    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
    y = (finalY ?? y + 20) + 5
  }

  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(224, 217, 207)
    doc.setLineWidth(0.25)
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13)
    doc.setTextColor(110, 99, 104)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(`${company} · Ficha de Empregado`, margin, pageHeight - 8)
    doc.text(`${page} / ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
  }

  doc.save(`Ficha-de-Empregado-${safeFileName(name)}.pdf`)
}
