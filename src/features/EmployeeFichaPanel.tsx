import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { FileDown, X } from 'lucide-react'
import { adminAtualizarFichaFuncionario, adminProntuario } from '../lib/api'
import type { EmployeeFichaPayload, EmployeeFichaRecord } from '../lib/types'

export type FieldKind = 'text' | 'date' | 'number' | 'textarea'
export type FieldDefinition = {
  key: string
  label: string
  kind?: FieldKind
  required?: boolean
  maxLength?: number
}
export type FieldGroup = { title: string; fields: FieldDefinition[] }

export const fieldGroups: FieldGroup[] = [
  {
    title: 'Identificação do empregador',
    fields: [
      { key: 'empregador_razao_social', label: 'Razão social', maxLength: 200 },
      { key: 'empregador_cnpj', label: 'CNPJ', maxLength: 18 },
      { key: 'empregador_endereco', label: 'Endereço do empregador', kind: 'textarea' },
    ],
  },
  {
    title: 'Identificação e dados pessoais',
    fields: [
      { key: 'nome', label: 'Nome completo', required: true, maxLength: 100 },
      { key: 'cpf', label: 'CPF', required: true, maxLength: 14 },
      { key: 'data_nascimento', label: 'Data de nascimento', kind: 'date', required: true },
      { key: 'matricula_esocial', label: 'Matrícula eSocial', maxLength: 20 },
      { key: 'numero_registro', label: 'Número de registro', maxLength: 20 },
      { key: 'local_nascimento', label: 'Local de nascimento', maxLength: 100 },
      { key: 'pais_nacionalidade', label: 'País / nacionalidade', maxLength: 50 },
      { key: 'estado_civil', label: 'Estado civil', maxLength: 20 },
      { key: 'sexo', label: 'Sexo', maxLength: 10 },
      { key: 'cor_raca', label: 'Cor / raça', maxLength: 20 },
      { key: 'grau_instrucao', label: 'Grau de instrução', maxLength: 30 },
      { key: 'deficiencia', label: 'Deficiência', maxLength: 10 },
      { key: 'nome_pai', label: 'Nome do pai', maxLength: 100 },
      { key: 'nome_mae', label: 'Nome da mãe', maxLength: 100 },
      { key: 'beneficiarios', label: 'Beneficiários', kind: 'textarea' },
    ],
  },
  {
    title: 'Documentos',
    fields: [
      { key: 'rg', label: 'RG', maxLength: 20 },
      { key: 'rg_data_emissao', label: 'Data de emissão do RG', kind: 'date' },
      { key: 'rg_orgao_emissor', label: 'Órgão emissor do RG', maxLength: 20 },
      { key: 'titulo_eleitor', label: 'Título de eleitor', maxLength: 20 },
      { key: 'titulo_zona', label: 'Zona eleitoral', maxLength: 10 },
      { key: 'titulo_secao', label: 'Seção eleitoral', maxLength: 10 },
      { key: 'inscricao_orgao_classe', label: 'Inscrição em órgão de classe', maxLength: 30 },
      { key: 'ctps', label: 'CTPS', maxLength: 20 },
      { key: 'ctps_serie', label: 'Série da CTPS', maxLength: 10 },
      { key: 'ctps_data_expedicao', label: 'Expedição da CTPS', kind: 'date' },
      { key: 'ctps_uf', label: 'UF da CTPS', maxLength: 2 },
      { key: 'cnh', label: 'CNH', maxLength: 20 },
      { key: 'cnh_categoria', label: 'Categoria da CNH', maxLength: 5 },
      { key: 'doc_militar', label: 'Documento militar', maxLength: 20 },
      { key: 'doc_militar_categoria', label: 'Categoria do documento militar', maxLength: 10 },
    ],
  },
  {
    title: 'Endereço e contato',
    fields: [
      { key: 'endereco', label: 'Endereço residencial', kind: 'textarea' },
      { key: 'cep', label: 'CEP', maxLength: 9 },
      { key: 'telefone_residencial', label: 'Telefone residencial', maxLength: 20 },
      { key: 'telefone_celular', label: 'Telefone celular', maxLength: 20 },
    ],
  },
  {
    title: 'Vínculo, função e remuneração',
    fields: [
      { key: 'cargo', label: 'Cargo', maxLength: 50 },
      { key: 'funcao', label: 'Função', maxLength: 50 },
      { key: 'cbo', label: 'CBO', maxLength: 10 },
      { key: 'data_admissao', label: 'Data de admissão', kind: 'date' },
      { key: 'salario', label: 'Salário atual (R$)', kind: 'number' },
      { key: 'salario_admissao', label: 'Salário na admissão (R$)', kind: 'number' },
      { key: 'salario_periodo', label: 'Período salarial', maxLength: 10 },
      { key: 'horario_trabalho', label: 'Horário de trabalho', maxLength: 50 },
      { key: 'horario_intervalo', label: 'Horário de intervalo', maxLength: 50 },
      { key: 'data_saida', label: 'Data de saída', kind: 'date' },
      { key: 'tipo_desligamento', label: 'Tipo de desligamento', maxLength: 100 },
    ],
  },
  {
    title: 'FGTS, PIS e dados bancários',
    fields: [
      { key: 'fgts_opcao', label: 'Data de opção pelo FGTS', kind: 'date' },
      { key: 'fgts_conta_banco', label: 'Banco / conta do FGTS', maxLength: 30 },
      { key: 'fgts_data_retificacao', label: 'Data de retificação do FGTS', kind: 'date' },
      { key: 'pis_numero', label: 'Número do PIS', maxLength: 20 },
      { key: 'pis_cadastro', label: 'Data de cadastro do PIS', kind: 'date' },
      { key: 'banco_domicilio', label: 'Banco de domicílio', maxLength: 50 },
      { key: 'banco_numero', label: 'Número do banco', maxLength: 10 },
      { key: 'banco_agencia', label: 'Agência bancária', maxLength: 10 },
      { key: 'banco_endereco', label: 'Endereço bancário', kind: 'textarea' },
    ],
  },
  {
    title: 'Históricos e observações',
    fields: [
      { key: 'alteracoes', label: 'Alterações salariais / funcionais', kind: 'textarea' },
      { key: 'ferias_periodo_aquisitivo', label: 'Férias — período aquisitivo', kind: 'textarea' },
      { key: 'ferias_periodo_gozo', label: 'Férias — período de gozo', kind: 'textarea' },
      { key: 'ferias_periodo_abono', label: 'Férias — abono', kind: 'textarea' },
      { key: 'acidentes_doencas', label: 'Acidentes e doenças', kind: 'textarea' },
      { key: 'contribuicao_sindical', label: 'Contribuição sindical', kind: 'textarea' },
      { key: 'observacoes', label: 'Observações', kind: 'textarea' },
    ],
  },
]

const allFields = fieldGroups.flatMap((group) => group.fields)

function initialDraft(employee: EmployeeFichaRecord): Record<string, string> {
  return Object.fromEntries(
    allFields.map((field) => {
      const raw = employee[field.key]
      const value = raw === null || raw === undefined ? '' : String(raw)
      return [field.key, field.kind === 'date' ? value.slice(0, 10) : value]
    }),
  )
}

export function displayValue(field: FieldDefinition, raw: unknown) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return 'Não informado'
  const value = String(raw)
  if (field.kind === 'number') {
    const amount = Number(value)
    return Number.isFinite(amount)
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
      : value
  }
  if (field.kind === 'date') {
    const date = new Date(`${value.slice(0, 10)}T00:00:00`)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR')
  }
  if (field.key === 'cpf') {
    const digits = value.replace(/\D/g, '')
    if (digits.length === 11) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
  }
  return value
}

function cpfDigit(digits: string, length: number) {
  let sum = 0
  for (let index = 0; index < length; index += 1) {
    sum += Number(digits[index]) * (length + 1 - index)
  }
  const remainder = (sum * 10) % 11
  return remainder === 10 ? 0 : remainder
}

function isValidCpf(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11 || /^([0-9])\1{10}$/.test(digits)) return false
  return cpfDigit(digits, 9) === Number(digits[9]) && cpfDigit(digits, 10) === Number(digits[10])
}

function makePayload(draft: Record<string, string>): EmployeeFichaPayload {
  return Object.fromEntries(
    allFields.map((field) => {
      const value = (draft[field.key] || '').trim()
      if (field.kind === 'number') return [field.key, value ? Number(value) : null]
      return [field.key, value || null]
    }),
  ) as EmployeeFichaPayload
}

export function EmployeeFichaPanel({
  token,
  employee,
  onSaved,
  onClose,
  onDownloadPdf,
  downloadingPdf = false,
  children,
}: {
  token: string
  employee: EmployeeFichaRecord
  onSaved: (updated: EmployeeFichaRecord) => void
  onClose: () => void
  onDownloadPdf?: () => void
  downloadingPdf?: boolean
  children?: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const baselineDraft = useMemo(() => initialDraft(employee), [employee])
  const [draft, setDraft] = useState<Record<string, string>>(() => initialDraft(employee))
  const visibleGroups = useMemo(() => fieldGroups, [])
  const hasUnsavedChanges = editing && allFields.some((field) => draft[field.key] !== baselineDraft[field.key])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  useEffect(() => {
    setDraft(baselineDraft)
    setEditing(false)
    setError('')
  }, [baselineDraft])

  function beginEditing() {
    setDraft(baselineDraft)
    setError('')
    setNotice('')
    setEditing(true)
  }

  function cancelEditing() {
    setDraft(baselineDraft)
    setError('')
    setEditing(false)
  }

  function requestClose() {
    if (saving) return
    if (hasUnsavedChanges && !window.confirm('Há alterações não salvas. Deseja descartá-las e fechar a ficha?')) return
    onClose()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')

    const cpfDigits = (draft.cpf || '').replace(/\D/g, '')
    if (!isValidCpf(cpfDigits)) {
      setError('Informe um CPF válido com 11 dígitos.')
      return
    }

    const payload = makePayload(draft)
    payload.cpf = cpfDigits
    setSaving(true)
    try {
      const result = await adminAtualizarFichaFuncionario(token, employee.id, payload)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível salvar a ficha.')

      let updated: EmployeeFichaRecord = { ...employee, ...payload, cpf: cpfDigits }
      try {
        const refreshed = await adminProntuario(token, employee.id)
        if (refreshed.sucesso && refreshed.funcionario) updated = refreshed.funcionario
      } catch {
        // A atualização já foi confirmada pela RPC; o payload salvo continua disponível localmente.
      }

      setDraft(initialDraft(updated))
      setEditing(false)
      setNotice('Ficha de Empregado atualizada.')
      onSaved(updated)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar a ficha.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="employee-ficha-dialog"
      aria-labelledby="employee-ficha-title"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <section className="employee-ficha-card">
        <div className="employee-ficha-heading">
          <div className="employee-ficha-title-block">
            <span className="eyebrow">Cadastro trabalhista</span>
            <h4 id="employee-ficha-title">Ficha de Empregado</h4>
            <p>Dados de {String(employee.nome || 'funcionário')} · conforme a ficha funcional.</p>
          </div>
          <div className="employee-ficha-heading-actions">
            {onDownloadPdf ? (
              <button className="secondary-button employee-ficha-pdf-action" type="button" onClick={onDownloadPdf} disabled={saving || downloadingPdf} title="Gerar PDF da ficha" aria-label={downloadingPdf ? 'Gerando PDF da ficha' : 'Gerar PDF da ficha'}>
                {downloadingPdf ? <span className="button-spinner" aria-hidden="true" /> : <FileDown size={16} aria-hidden="true" />}
                <span>{downloadingPdf ? 'Gerando PDF…' : 'Gerar PDF'}</span>
              </button>
            ) : null}
            {!editing ? (
              <button className="secondary-button" type="button" onClick={beginEditing}>
                Editar ficha
              </button>
            ) : null}
            <button
              className="icon-button employee-ficha-close"
              type="button"
              onClick={requestClose}
              aria-label="Fechar ficha"
              disabled={saving}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="employee-ficha-content">
          {notice ? <div className="form-success" role="status">{notice}</div> : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          {children ? <div className="employee-ficha-context">{children}</div> : null}

          {editing ? (
            <form className="employee-ficha-form" onSubmit={submit}>
              <p className="form-hint">Nome, CPF e data de nascimento são obrigatórios. Campos vazios serão salvos como não informados.</p>
              <div className="employee-ficha-groups">
                {visibleGroups.map((group, groupIndex) => (
                  <details className="employee-ficha-group" key={group.title} open={groupIndex === 1 || groupIndex === 4 || groupIndex === 6}>
                    <summary>{group.title}</summary>
                    <div className="employee-ficha-grid">
                      {group.fields.map((field) => (
                        <label className={`employee-ficha-field${field.kind === 'textarea' ? ' is-wide' : ''}`} key={field.key}>
                          <span>{field.label}{field.required ? ' *' : ''}</span>
                          {field.kind === 'textarea' ? (
                            <textarea
                              rows={4}
                              maxLength={field.maxLength}
                              value={draft[field.key] || ''}
                              onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                            />
                          ) : (
                            <input
                              type={field.kind === 'date' || field.kind === 'number' ? field.kind : 'text'}
                              inputMode={field.key === 'cpf' ? 'numeric' : undefined}
                              maxLength={field.kind === undefined || field.kind === 'text' ? field.maxLength : undefined}
                              min={field.kind === 'number' ? 0 : undefined}
                              step={field.kind === 'number' ? '0.01' : undefined}
                              required={field.required}
                              value={draft[field.key] || ''}
                              onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
              <div className="employee-ficha-actions">
                <button className="secondary-button" type="button" onClick={cancelEditing} disabled={saving}>
                  Cancelar
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? 'Salvando…' : 'Salvar ficha'}
                </button>
              </div>
            </form>
          ) : (
            <div className="employee-ficha-groups">
              {visibleGroups.map((group, groupIndex) => (
                <details className="employee-ficha-group" key={group.title} open={groupIndex === 1 || groupIndex === 4 || groupIndex === 6}>
                  <summary>{group.title}</summary>
                  <div className="employee-ficha-grid">
                    {group.fields.map((field) => (
                      <div className={`employee-ficha-value${field.kind === 'textarea' ? ' is-wide' : ''}`} key={field.key}>
                        <span>{field.label}</span>
                        <strong>{displayValue(field, employee[field.key])}</strong>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>
    </dialog>
  )
}
