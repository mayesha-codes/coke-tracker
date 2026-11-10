import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSession } from '../../app/session/sessionContext'
import type { SessionTransitionResult } from '../../app/session/sessionState'
import Icon from '../../components/ui/Icon'
import type { NutritionCatalogReference } from '../../domain/types'
import { ENGLISH_DISPLAY_LOCALE } from '../preferences/preferences'
import { preparePersonalNutrition } from './nutritionInput'
import type { NutritionInputField, NutritionInputIssue, PersonalNutritionDraft } from './nutritionInput'
import './PersonalNutritionSetup.css'

type EditableField = keyof PersonalNutritionDraft

const fieldDetails: readonly { field: EditableField; label: string; help: string; decimal?: boolean }[] = [
  { field: 'productDescription', label: 'Product description', help: 'Identify the Coke bottle or can these values describe.' },
  { field: 'sugarGramsPer100MlText', label: 'Sugar (g per 100 ml)', help: 'Use the sugar value per 100 ml, in grams. Enter 0 only if the label explicitly states zero.', decimal: true },
  { field: 'kcalPer100MlText', label: 'Calories (kcal per 100 ml)', help: 'Use the energy value per 100 ml in kcal, not kJ or the value for the whole container.', decimal: true },
  { field: 'sourceDescription', label: 'Source description', help: 'Describe where you read the values, such as the package label and its market.' },
  { field: 'sourceUrl', label: 'Source URL (optional)', help: 'Add an HTTP or HTTPS source link, or leave this blank.' },
]

type PendingApplication = {
  reference: NutritionCatalogReference
  previousResult: SessionTransitionResult | null
}

// The adapter accepts plain decimals. Avoid exponent notation when restoring
// very small or large validated rates, without rounding them to zero.
const editableRate = new Intl.NumberFormat(ENGLISH_DISPLAY_LOCALE, {
  notation: 'standard', useGrouping: false, maximumSignificantDigits: 21,
})

function initialDraft(reference: NutritionCatalogReference | undefined): PersonalNutritionDraft {
  return {
    productDescription: reference?.productDescription ?? '',
    sugarGramsPer100MlText: reference === undefined ? '' : editableRate.format(reference.sugarGramsPer100Ml),
    kcalPer100MlText: reference === undefined ? '' : editableRate.format(reference.kcalPer100Ml),
    sourceDescription: reference?.source.label ?? '',
    sourceUrl: reference?.source.url ?? '',
  }
}

function sameContent(first: NutritionCatalogReference, second: NutritionCatalogReference): boolean {
  return first.productDescription === second.productDescription
    && first.sugarGramsPer100Ml === second.sugarGramsPer100Ml
    && first.kcalPer100Ml === second.kcalPer100Ml
    && first.source.label === second.source.label
    && first.source.url === second.source.url
}

function applicationField(field: string): NutritionInputField {
  const name = field.replace(/^personalNutrition\./, '')
  if (name === 'id' || name === 'version' || name === 'input') return name
  return fieldDetails.find(detail => detail.field === name)?.field ?? 'input'
}

function fieldSelector(field: NutritionInputField): string {
  return fieldDetails.some(detail => detail.field === field)
    ? `#personal-nutrition-${field}` : '#personal-nutrition-error-summary'
}

/** Editable label values stay local until the session accepts a separate nutrition application. */
function PersonalNutritionSetup() {
  const { state, applyPersonalNutrition, lastNutritionResult } = useSession()
  const [draft, setDraft] = useState<PersonalNutritionDraft>(() => initialDraft(state.personalNutrition?.reference))
  const [touched, setTouched] = useState<Partial<Record<EditableField, boolean>>>({})
  const [submissionCount, setSubmissionCount] = useState(0)
  const [pending, setPending] = useState<PendingApplication | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const pendingFocus = useRef<NutritionInputField | null>(null)
  const setup = state.personalNutrition
  const submitted = submissionCount > 0

  // This ID is only for draft validation. The provider supplies the real setup
  // UUID at application time, and the session owns all version increments.
  const checked = preparePersonalNutrition(draft, {
    id: setup?.reference.id ?? 'personal-nutrition-draft',
    version: setup?.reference.version ?? 1,
  })
  const applicationResult = pending !== null && lastNutritionResult !== pending.previousResult
    ? lastNutritionResult : null
  const applicationIssues: readonly NutritionInputIssue[] = applicationResult?.outcome === 'invalid'
    ? applicationResult.issues.map(issue => ({ field: applicationField(issue.field), message: issue.message })) : []
  const issues = checked.valid === false ? checked.issues : applicationIssues
  const appliedReference = applicationResult?.outcome === 'accepted'
    ? applicationResult.state.personalNutrition?.reference : undefined
  const applied = pending !== null && appliedReference !== undefined && sameContent(pending.reference, appliedReference)

  useEffect(() => {
    const field = pendingFocus.current
    if (field === null) return
    pendingFocus.current = null
    formRef.current?.querySelector<HTMLElement>(fieldSelector(field))?.focus()
  })

  useEffect(() => {
    if (applicationResult?.outcome !== 'invalid') return
    const fields = applicationResult.issues.map(issue => applicationField(issue.field))
    const field = fieldDetails.find(detail => fields.includes(detail.field))?.field ?? fields[0] ?? 'input'
    formRef.current?.querySelector<HTMLElement>(fieldSelector(field))?.focus()
  }, [applicationResult])

  function fieldError(field: EditableField): string | undefined {
    if (!submitted && !touched[field]) return undefined
    return issues.filter(issue => issue.field === field).map(issue => issue.message).join(' ') || undefined
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Every submission needs a commit, including a repeated invalid Enter press
    // with unchanged fields, so the focus effect can run again.
    setSubmissionCount(count => count + 1)
    setPending(null)
    if (checked.valid === false) {
      pendingFocus.current = fieldDetails.find(detail => checked.issues.some(issue => issue.field === detail.field))?.field
        ?? checked.issues[0]?.field ?? 'input'
      return
    }
    setPending({ reference: checked.reference, previousResult: lastNutritionResult })
    applyPersonalNutrition(draft)
  }

  return (
    <section className="personal-nutrition" aria-labelledby="personal-nutrition-heading">
      <div className="personal-nutrition-heading">
        <span className="personal-nutrition-icon"><Icon name="cup" size={23} /></span>
        <div>
          <p className="personal-nutrition-eyebrow">From your label</p>
          <h2 id="personal-nutrition-heading">Personal nutrition setup</h2>
        </div>
      </div>
      <p className="personal-nutrition-introduction">Copy the per-100-ml values from your Coke bottle or can. Check the units carefully; no nutrition values are filled in for you.</p>
      <p className="personal-nutrition-disclosure">User-provided — not independently verified.</p>

      <form ref={formRef} className="personal-nutrition-form" noValidate onSubmit={handleSubmit}
        aria-labelledby="personal-nutrition-heading">
        {submitted && issues.length > 0 && (
          <div className="personal-nutrition-error-summary" id="personal-nutrition-error-summary" tabIndex={-1}
            aria-labelledby="personal-nutrition-error-title">
            <h3 id="personal-nutrition-error-title">Check your nutrition setup</h3>
            <ul>{issues.map(issue => <li key={issue.field}>{issue.message}</li>)}</ul>
          </div>
        )}
        <div className="personal-nutrition-fields">
          {fieldDetails.map(({ field, label, help, decimal }) => {
            const error = fieldError(field)
            const id = `personal-nutrition-${field}`
            return (
              <div key={field} className={`personal-nutrition-field${decimal ? ' personal-nutrition-field--rate' : ''}`}>
                <label htmlFor={id}>{label}</label>
                <input id={id} type="text" className="personal-nutrition-input" value={draft[field] ?? ''}
                  inputMode={decimal ? 'decimal' : field === 'sourceUrl' ? 'url' : undefined}
                  required={field !== 'sourceUrl'} autoComplete="off"
                  aria-invalid={Boolean(error)} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
                  onBlur={() => setTouched(previous => ({ ...previous, [field]: true }))}
                  onChange={event => {
                    const value = event.currentTarget.value
                    setDraft(previous => ({ ...previous, [field]: value }))
                    setPending(null)
                  }} />
                <p className="personal-nutrition-help" id={`${id}-help`}>{help}</p>
                {error && <p className="personal-nutrition-error" id={`${id}-error`}>{error}</p>}
              </div>
            )
          })}
        </div>
        <p className="personal-nutrition-help">Use a decimal point for fractions. Blank values mean missing information; explicit zero values are accepted.</p>
        <button className="personal-nutrition-apply" type="submit">Apply personal nutrition</button>
        <div className="personal-nutrition-confirmation" role="status" aria-label="Nutrition application status">
          {applied && <p>Personal nutrition applied for this session. Version {appliedReference.version}.</p>}
        </div>
      </form>

      {setup !== null && (
        <section className="personal-nutrition-applied" aria-labelledby="personal-nutrition-applied-heading">
          <div className="personal-nutrition-applied-heading">
            <h3 id="personal-nutrition-applied-heading">Applied for this session</h3>
            <span>Version {setup.reference.version}</span>
          </div>
          <p className="personal-nutrition-disclosure">User-provided — not independently verified.</p>
          <dl>
            <div><dt>Product</dt><dd>{setup.reference.productDescription}</dd></div>
            <div><dt>Sugar per 100 ml</dt><dd>{setup.reference.sugarGramsPer100Ml} g</dd></div>
            <div><dt>Calories per 100 ml</dt><dd>{setup.reference.kcalPer100Ml} kcal</dd></div>
            <div><dt>Source</dt><dd>{setup.reference.source.label}</dd></div>
          </dl>
          {setup.reference.source.url !== undefined && (
            <a href={setup.reference.source.url} target="_blank" rel="noopener noreferrer">View source (opens in a new tab)</a>
          )}
          <p className="personal-nutrition-help">Edits create a new version when values or source details change. Existing drink records keep their original snapshots.</p>
        </section>
      )}
      <p className="personal-nutrition-session-note">This reusable setup is temporary and clears on refresh. Choose it explicitly in Log to preview estimates. Existing drafts keep their selected version until you choose newer values; saving drinks is still unavailable.</p>
    </section>
  )
}

export default PersonalNutritionSetup
