export interface PointImportInputRow {
  [key: string]: unknown
  cpf: string
  cpf_arquivo: string
  import_validation_errors: string[]
  nome: string
  data: string
  previsto: string
  entrada_1: string
  saida_1: string
  entrada_2: string
  saida_2: string
  total_normais: string
  total_noturno: string
  dia_falta: string
  horas_atraso: string
  abono: string
  extra_50: string
  extra_100: string
  desconta_dsr: string
  justificativas: string
}

export interface PointFileParseResult {
  rows: PointImportInputRow[]
  headerFound: boolean
  kind?: PointFileKind
  summaryRows?: PointSummaryInputRow[]
}

export type PointFileKind = 'cartao_diario' | 'cartao_mensal' | 'extrato_diario' | 'extrato_mensal'

export interface PointSummaryInputRow {
  [key: string]: unknown
  nome: string
  total_normais: string
  total_noturno: string
  dia_falta: string
  horas_atraso: string
  abono: string
  extra_50: string
  desconta_dsr: string
}

interface MatrixOptions {
  numericCpfRows?: ReadonlySet<number>
  excelDate1904?: boolean
}

interface HeaderMatch {
  index: number
  headers: string[]
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`
  }
  return String(value).replace(/\u00a0/g, ' ').trim()
}

function normalizeHeader(value: unknown): string {
  return textValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false
  const checkDigit = (source: string, firstWeight: number) => {
    const sum = [...source].reduce((total, digit, index) => total + Number(digit) * (firstWeight - index), 0)
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }
  return checkDigit(digits.slice(0, 9), 10) === Number(digits[9])
    && checkDigit(digits.slice(0, 10), 11) === Number(digits[10])
}

function cpfDigits(value: unknown): { source: string; digits: string; scientific: boolean } {
  const source = textValue(value)
  const scientific = source.match(/^\s*(\d+(?:\.\d+)?)e\+?(\d+)\s*$/i)
  const decimalInteger = source.match(/^\s*(\d+)\.0+\s*$/)
  const expanded = scientific ? Number(source).toFixed(0) : decimalInteger ? decimalInteger[1] : source
  return { source, digits: expanded.replace(/\D/g, ''), scientific: Boolean(scientific) }
}

function normalizeCpf(value: unknown, numericExcelCell: boolean): { cpf: string; cpfArquivo: string; errors: string[] } {
  const normalized = cpfDigits(value)
  const cpfArquivo = normalized.digits || normalized.source
  if (!normalized.source) return { cpf: '', cpfArquivo: '', errors: ['CPF não informado no arquivo.'] }
  if (!normalized.digits) return { cpf: '', cpfArquivo, errors: ['O campo de CPF não contém dígitos válidos.'] }

  const hasNumericEvidence = numericExcelCell || typeof value === 'number' || normalized.scientific
  let candidate = normalized.digits
  if (candidate.length === 10 && hasNumericEvidence) {
    const withLeadingZero = candidate.padStart(11, '0')
    if (isValidCpf(withLeadingZero)) candidate = withLeadingZero
  }

  if (!isValidCpf(candidate)) {
    const error = candidate.length === 11
      ? 'CPF inválido: confira os dígitos verificadores.'
      : 'CPF inválido: informe os 11 dígitos; zeros só são recuperados de célula numérica Excel quando o CPF resultante é válido.'
    return { cpf: '', cpfArquivo, errors: [error] }
  }
  return { cpf: candidate, cpfArquivo, errors: [] }
}

function validIsoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function normalizePointDate(value: unknown, excelDate1904 = false): string {
  const raw = textValue(value).split(/\s+/)[0]
  if (!raw) return ''

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/)
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const brazilian = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (brazilian) {
    const year = Number(brazilian[3]) < 100 ? 2000 + Number(brazilian[3]) : Number(brazilian[3])
    return validIsoDate(year, Number(brazilian[2]), Number(brazilian[1]))
  }

  if (/^\d{4,5}(?:\.\d+)?$/.test(raw)) {
    const serial = Number(raw)
    if (serial >= 20000 && serial <= 90000) {
      const epoch = excelDate1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
      const date = new Date(epoch + Math.floor(serial) * 86_400_000)
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    }
  }
  return ''
}

const headerAliases = {
  date: ['dia', 'data', 'data do ponto', 'dia do ponto'],
  cpf: ['cpf do funcionario', 'cpf funcionario', 'cpf'],
  name: ['nome do funcionario', 'nome funcionario', 'funcionario', 'colaborador', 'nome'],
}

const durationHeaderAliases = {
  previsto: ['previsto'],
  totalNormais: ['total normais', 'total normal', 'horas normais'],
  totalNoturno: ['total noturno', 'horas noturnas'],
  horasAtraso: ['horas atraso', 'atraso'],
  extra50: ['extra 50%d', 'extra 50% d', 'extra 50%', 'hora extra 50%'],
  extra100: ['extra 100%d', 'extra 100% d', 'extra 100%', 'hora extra 100%'],
}

const summaryHeaderAliases = {
  name: ['nome do funcionario', 'nome funcionario', 'funcionario', 'colaborador', 'nome'],
  totalNormais: ['total normais', 'total normal', 'horas normais'],
  totalNoturno: ['total noturno', 'horas noturnas'],
  diaFalta: ['dia falta', 'faltas', 'falta'],
  horasAtraso: ['horas atraso', 'atraso'],
  abono: ['abono'],
  extra50: ['extra 50%d', 'extra 50% d', 'extra 50%', 'hora extra 50%'],
  descontaDsr: ['desconta dsr', 'dsr'],
}

function isExcelDurationFormat(format: unknown): boolean {
  const source = String(format || '').replace(/"[^"]*"/g, '')
  const hasElapsedUnit = /\[(?:h+|m+|s+)\]/i.test(source)
  const withoutBrackets = source.replace(/\[[^\]]+\]/g, '')
  if (/[dy]/i.test(withoutBrackets)) return false
  return hasElapsedUnit || /[hms]+\s*:\s*[hms]+/i.test(withoutBrackets)
}

function excelDurationText(serial: number): string {
  const totalMinutes = Math.round(serial * 24 * 60)
  const sign = totalMinutes < 0 ? '-' : ''
  const absolute = Math.abs(totalMinutes)
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`
}

function findHeaderIndex(headers: string[], names: string[]): number {
  const exact = headers.findIndex((header) => names.includes(header))
  return exact >= 0 ? exact : headers.findIndex((header) => names.some((name) => header.startsWith(`${name} `) || header.startsWith(`${name}:`)))
}

function findHeaderMatch(matrix: unknown[][]): HeaderMatch | null {
  const index = matrix.slice(0, 20).findIndex((cells) => {
    const headers = cells.map(normalizeHeader)
    return findHeaderIndex(headers, headerAliases.date) >= 0 && findHeaderIndex(headers, headerAliases.cpf) >= 0
  })
  return index < 0 ? null : { index, headers: matrix[index].map(normalizeHeader) }
}

export function pointRowsFromMatrix(matrix: unknown[][], options: MatrixOptions = {}): PointFileParseResult {
  const headerMatch = findHeaderMatch(matrix)
  if (!headerMatch) return { rows: [], headerFound: false }

  const { index: headerIndex, headers } = headerMatch
  const find = (...names: string[]) => findHeaderIndex(headers, names.map(normalizeHeader))
  const columns = {
    date: find(...headerAliases.date),
    cpf: find(...headerAliases.cpf),
    name: find(...headerAliases.name),
    previsto: find(...durationHeaderAliases.previsto),
    entrada1: find('entrada 1', 'entrada'),
    saida1: find('saida 1', 'saida', 'saída 1', 'saída'),
    entrada2: find('entrada 2'),
    saida2: find('saida 2', 'saída 2'),
    totalNormais: find(...durationHeaderAliases.totalNormais),
    totalNoturno: find(...durationHeaderAliases.totalNoturno),
    diaFalta: find('dia falta', 'falta'),
    horasAtraso: find(...durationHeaderAliases.horasAtraso),
    abono: find('abono'),
    extra50: find(...durationHeaderAliases.extra50),
    extra100: find(...durationHeaderAliases.extra100),
    descontaDsr: find('desconta dsr', 'dsr'),
    justificativas: find('justificativas', 'justificativa'),
  }
  const get = (cells: unknown[], column: number) => column < 0 ? '' : textValue(cells[column])
  const rows: PointImportInputRow[] = []

  matrix.slice(headerIndex + 1).forEach((sourceCells, offset) => {
    const cells = sourceCells || []
    if (!cells.some((cell) => textValue(cell) !== '')) return
    const rowIndex = headerIndex + 1 + offset
    const rawCpf = columns.cpf < 0 ? '' : cells[columns.cpf]
    const cpf = normalizeCpf(rawCpf, options.numericCpfRows?.has(rowIndex) || false)
    rows.push({
      cpf: cpf.cpf,
      cpf_arquivo: cpf.cpf ? '' : cpf.cpfArquivo,
      import_validation_errors: cpf.errors,
      nome: get(cells, columns.name),
      data: normalizePointDate(columns.date < 0 ? '' : cells[columns.date], options.excelDate1904),
      previsto: get(cells, columns.previsto),
      entrada_1: get(cells, columns.entrada1),
      saida_1: get(cells, columns.saida1),
      entrada_2: get(cells, columns.entrada2),
      saida_2: get(cells, columns.saida2),
      total_normais: get(cells, columns.totalNormais),
      total_noturno: get(cells, columns.totalNoturno),
      dia_falta: get(cells, columns.diaFalta),
      horas_atraso: get(cells, columns.horasAtraso),
      abono: get(cells, columns.abono),
      extra_50: get(cells, columns.extra50),
      extra_100: get(cells, columns.extra100),
      desconta_dsr: get(cells, columns.descontaDsr),
      justificativas: get(cells, columns.justificativas),
    })
  })

  return { rows, headerFound: true }
}

function countUnquoted(line: string, delimiter: string): number {
  let count = 0
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && quoted && line[index + 1] === '"') index += 1
    else if (char === '"') quoted = !quoted
    else if (!quoted && char === delimiter) count += 1
  }
  return count
}

function detectDelimiter(source: string): string {
  const candidates = [';', ',', '\t']
  const lines = source.split(/\r?\n/).filter((line) => line.trim()).slice(0, 20)
  return candidates.reduce((best, candidate) => {
    const bestCount = Math.max(0, ...lines.map((line) => countUnquoted(line, best)))
    const candidateCount = Math.max(0, ...lines.map((line) => countUnquoted(line, candidate)))
    return candidateCount > bestCount ? candidate : best
  }, ';')
}

export function parsePointDelimited(text: string): PointFileParseResult {
  const source = text.replace(/^\uFEFF/, '')
  const delimiter = detectDelimiter(source)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) { row.push(cell.trim()); cell = '' }
    else if (char === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else if (char !== '\r') cell += char
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  const matrix = rows.filter((item) => item.some(Boolean))
  const headers = matrix[0]?.map(normalizeHeader) || []
  const summaryFind = (...names: string[]) => findHeaderIndex(headers, names.map(normalizeHeader))
  const summaryName = summaryFind(...summaryHeaderAliases.name)
  const summaryTotal = summaryFind(...summaryHeaderAliases.totalNormais)
  if (summaryName >= 0 && summaryTotal >= 0 && findHeaderIndex(headers, headerAliases.cpf) < 0) {
    const get = (cells: string[], column: number) => column < 0 ? '' : textValue(cells[column])
    const summaryRows = matrix.slice(1).map((cells) => ({
      nome: get(cells, summaryName), total_normais: get(cells, summaryTotal),
      total_noturno: get(cells, summaryFind(...summaryHeaderAliases.totalNoturno)),
      dia_falta: get(cells, summaryFind(...summaryHeaderAliases.diaFalta)),
      horas_atraso: get(cells, summaryFind(...summaryHeaderAliases.horasAtraso)),
      abono: get(cells, summaryFind(...summaryHeaderAliases.abono)),
      extra_50: get(cells, summaryFind(...summaryHeaderAliases.extra50)),
      desconta_dsr: get(cells, summaryFind(...summaryHeaderAliases.descontaDsr)),
    })).filter((item) => item.nome)
    return { rows: [], summaryRows, headerFound: true, kind: 'extrato_mensal' }
  }
  return pointRowsFromMatrix(matrix)
}

export async function pointRowsFromFile(file: File): Promise<PointFileParseResult> {
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, cellNF: true })
    const excelDate1904 = Boolean(workbook.Workbook?.WBProps?.date1904)
    let emptySheetWithHeader: PointFileParseResult | null = null

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: '',
        raw: false,
        blankrows: true,
        dateNF: 'dd/mm/yyyy',
      })
      const headerMatch = findHeaderMatch(matrix)
      if (!headerMatch) continue

      const durationColumns = Object.values(durationHeaderAliases)
        .map((aliases) => findHeaderIndex(headerMatch.headers, aliases.map(normalizeHeader)))
        .filter((column) => column >= 0)
      const durationRef = sheet['!ref']
      if (durationRef && durationColumns.length) {
        const durationRange = XLSX.utils.decode_range(durationRef)
        for (let rowIndex = headerMatch.index + 1; rowIndex < matrix.length; rowIndex += 1) {
          for (const columnIndex of durationColumns) {
            const address = XLSX.utils.encode_cell({ r: durationRange.s.r + rowIndex, c: durationRange.s.c + columnIndex })
            const cell = sheet[address]
            if (cell?.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v) && isExcelDurationFormat(cell.z)) {
              matrix[rowIndex][columnIndex] = excelDurationText(cell.v)
            }
          }
        }
      }

      const numericCpfRows = new Set<number>()
      const cpfColumn = findHeaderIndex(headerMatch.headers, headerAliases.cpf)
      const ref = sheet['!ref']
      if (cpfColumn >= 0 && ref) {
        const range = XLSX.utils.decode_range(ref)
        for (let rowIndex = headerMatch.index + 1; rowIndex < matrix.length; rowIndex += 1) {
          const address = XLSX.utils.encode_cell({ r: range.s.r + rowIndex, c: range.s.c + cpfColumn })
          const cell = sheet[address]
          if (cell?.t === 'n') numericCpfRows.add(rowIndex)
        }
      }

      const parsed = pointRowsFromMatrix(matrix, { numericCpfRows, excelDate1904 })
      if (parsed.rows.length) return parsed
      if (!emptySheetWithHeader) emptySheetWithHeader = parsed
    }
    return emptySheetWithHeader || { rows: [], headerFound: false }
  }
  const parsed = parsePointDelimited(await file.text())
  const fileName = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const monthly = fileName.replace(/[-_]+/g, ' ').includes('mes fechado') || fileName.includes('mensal')
  if (parsed.summaryRows) parsed.kind = monthly ? 'extrato_mensal' : 'extrato_diario'
  else if (parsed.rows.length) parsed.kind = monthly ? 'cartao_mensal' : 'cartao_diario'
  return parsed
}
