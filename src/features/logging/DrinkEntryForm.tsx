import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, FormEvent } from 'react'
import { createNutritionReference } from '../../domain/nutrition'
import { SERVING_PRESETS } from '../../domain/servings'
import type { CurrencyCode, NutritionCatalogReference } from '../../domain/types'
import { isIdentifier } from '../../domain/validation'
import ConsumptionTimeField from './ConsumptionTimeField'
import DrinkPreview from './DrinkPreview.tsx'
import { positiveIntegerFromText, prepareDrinkEntry } from './drinkDraft'
import type { DrinkDraft, DrinkDraftIssue, DrinkDraftIssueField } from './drinkDraft'
import { deriveDrinkPreview } from './drinkPreview.ts'
import { resolveLocalDateTime } from './localDateTime'
import type { LocalTimeChoice } from './localDateTime'
import NutritionReferenceField from './NutritionReferenceField'
import PriceField from './PriceField'
import QuantityField from './QuantityField'
import ServingSizeField from './ServingSizeField'
import type { ServingSizeSelection } from './ServingSizeField'

type DrinkEntryFormProps = {
  references: readonly NutritionCatalogReference[]
  currency: CurrencyCode
  timeZone: string
  initialLocalDateTime: string
  draftId: string
}

type ControlField = 'serving' | 'quantity' | 'price' | 'time' | 'reference'

function controlField(field: DrinkDraftIssueField): ControlField | null {
  if (field === 'servingMlText') return 'serving'
  if (field === 'quantityText') return 'quantity'
  if (field === 'priceText' || field === 'priceMode' || field === 'currency') return 'price'
  if (field === 'localDateTime' || field === 'timeZone' || field === 'disambiguation') return 'time'
  if (field.startsWith('nutritionReference')) return 'reference'
  return null
}

function selectorForIssue(field: DrinkDraftIssueField, servingSelection: ServingSizeSelection): string {
  if (field === 'disambiguation') return '[name="logging-time-choice"]'
  switch (controlField(field)) {
    case 'serving': return servingSelection === 'custom' ? '#logging-custom-serving' : '[name="serving-size"]:checked'
    case 'quantity': return '#logging-quantity'
    case 'price': return '#logging-price'
    case 'time': return '#logging-time'
    case 'reference': return '#logging-reference'
    default: return '#logging-error-summary'
  }
}

/** Local, unsaved form state. Reviewing prepares data but never stores an entry. */
function DrinkEntryForm({
  references,
  currency,
  timeZone,
  initialLocalDateTime,
  draftId,
}: DrinkEntryFormProps) {
  const [servingSelection, setServingSelection] = useState<ServingSizeSelection>('330ml')
  const [customMlText, setCustomMlText] = useState('')
  const [quantityText, setQuantityText] = useState('1')
  const [priceMode, setPriceMode] = useState<'known' | 'unknown'>('known')
  const [knownPriceText, setKnownPriceText] = useState('')
  const [localDateTime, setLocalDateTime] = useState(initialLocalDateTime)
  const [choice, setChoice] = useState<LocalTimeChoice>()
  const [referenceId, setReferenceId] = useState('')
  const [touched, setTouched] = useState<Partial<Record<ControlField, boolean>>>({})
  const [reviewCount, setReviewCount] = useState(0)
  const [reviewStatus, setReviewStatus] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const pendingFocus = useRef<string | null>(null)

  // The choice and editable Custom text stay separate, even when Custom equals a preset.
  const selectedPreset = SERVING_PRESETS.find(preset => preset.id === servingSelection)
  const servingMlText = servingSelection === 'custom' ? customMlText
    : selectedPreset === undefined ? '' : String(selectedPreset.servingMl)

  const checkedReferences = references.map(reference => createNutritionReference(reference))
  const validReferences: NutritionCatalogReference[] = []
  let catalogError: string | undefined
  for (const checked of checkedReferences) {
    if (checked.valid === true) validReferences.push(checked.reference)
    else catalogError = 'Nutrition reference data needs review before it can be used.'
  }
  const selectedReference = catalogError === undefined
    ? validReferences.find(reference => reference.id === referenceId)
    : undefined

  const draft: DrinkDraft = {
    servingMlText,
    quantityText,
    price: priceMode === 'known' ? { mode: 'known', amountText: knownPriceText } : { mode: 'unknown' },
    localDateTime,
    timeZone,
    disambiguation: choice,
  }
  const preview = deriveDrinkPreview(draft, selectedReference, currency)
  // Keep both options visible after a choice is selected, so users can change their mind.
  const possibleTime = resolveLocalDateTime(localDateTime, timeZone)
  const resolvedTime = choice === undefined
    ? possibleTime
    : resolveLocalDateTime(localDateTime, timeZone, choice)
  const timeCandidates = possibleTime.valid === false ? possibleTime.candidates : undefined
  const prepared = selectedReference === undefined ? undefined
    : prepareDrinkEntry(draft, selectedReference, { id: draftId, currency })

  const collectedIssues: DrinkDraftIssue[] = []
  if (prepared?.valid === false) collectedIssues.push(...prepared.issues)
  if (prepared === undefined) {
    collectedIssues.push(...preview.issues.filter(issue => issue.field !== 'nutritionReference'))
    if (resolvedTime.valid === false) {
      collectedIssues.push(...resolvedTime.issues.map(issue => ({
        field: issue.field === 'consumedAt' ? 'localDateTime' as const : issue.field,
        message: issue.message,
      })))
    }
    if (!isIdentifier(draftId)) {
      collectedIssues.push({ field: 'id', message: 'This draft needs a valid identifier before it can be reviewed.' })
    }
    collectedIssues.push({
      field: 'nutritionReference',
      message: catalogError ?? (validReferences.length === 0
        ? 'A reviewed nutrition reference is needed before the entry can be ready to save.'
        : 'Choose a reviewed nutrition reference.'),
    })
  }
  const issues = collectedIssues.filter((issue, index, all) =>
    all.findIndex(other => other.field === issue.field) === index,
  )

  // Focus is a response to Review, never to a background preview recalculation.
  useEffect(() => {
    const selector = pendingFocus.current
    if (selector === null) return
    pendingFocus.current = null
    const candidate = formRef.current?.querySelector<HTMLElement>(selector)
    const disabled = candidate instanceof HTMLInputElement || candidate instanceof HTMLSelectElement
      ? candidate.disabled : false
    const target = candidate && !disabled ? candidate
      : formRef.current?.querySelector<HTMLElement>('#logging-error-summary')
    target?.focus()
  })

  function changed() {
    setReviewStatus('')
  }

  function fieldError(field: ControlField): string | undefined {
    if (field === 'reference' && catalogError !== undefined) return catalogError
    if (reviewCount === 0 && !touched[field]) return undefined
    const fieldIssues = issues.filter(issue => controlField(issue.field) === field)
    if (field === 'serving' && servingSelection === 'custom' && fieldIssues.length > 0 &&
        positiveIntegerFromText(customMlText) === null) {
      // Existing adapters decide validity; these messages explain the Custom input issue.
      if (customMlText.trim() === '') return 'Enter a custom serving size in ml.'
      if (Number(customMlText) > Number.MAX_SAFE_INTEGER) {
        return 'That serving size is too large. Enter a smaller whole number of millilitres.'
      }
      return 'Enter a whole number of millilitres greater than zero, using digits only.'
    }
    return fieldIssues.map(issue => issue.message).join(' ') || undefined
  }

  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    // Review reveals errors after its click, so blur feedback cannot move the button mid-click.
    if (event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.type === 'submit') return
    const target = event.target
    let field: ControlField | undefined
    if (target.id === 'logging-quantity') field = 'quantity'
    else if (target.id === 'logging-price' || target.getAttribute('name') === 'price-mode') field = 'price'
    else if (target.id === 'logging-time' || target.getAttribute('name') === 'logging-time-choice') field = 'time'
    else if (target.id === 'logging-reference') field = 'reference'
    else if (target.id === 'logging-custom-serving') field = 'serving'
    else if (target.getAttribute('name') === 'serving-size') {
      // Moving between radios or into Custom is still editing the same field.
      if (event.relatedTarget instanceof Node && target.closest('fieldset')?.contains(event.relatedTarget)) return
      field = 'serving'
    }
    if (field !== undefined) setTouched(previous => ({ ...previous, [field]: true }))
  }

  function handleReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setReviewCount(count => count + 1)
    if (issues.length > 0) {
      setReviewStatus('')
      // Custom appears before Quantity, so focus it first when both fields need attention.
      const firstIssue = servingSelection === 'custom'
        ? issues.find(issue => controlField(issue.field) === 'serving') ?? issues[0] : issues[0]
      pendingFocus.current = selectorForIssue(firstIssue.field, servingSelection)
      return
    }
    setReviewStatus('Ready to save — not saved yet.')
  }

  return (
    <form className="logging-form" ref={formRef} noValidate onSubmit={handleReview} onBlurCapture={handleBlur}>
      <div className="logging-form__layout">
        <div className="logging-form__fields">
          <div className="logging-form__intro">
            <p className="logging-eyebrow">One entry. A little more awareness.</p>
            <h2>Your drink details</h2>
            <p className="logging-help">Build a draft and review its estimates. Your total price covers every drink in this entry.</p>
          </div>

          {reviewCount > 0 && issues.length > 0 && (
            <div className="logging-error-summary" id="logging-error-summary" tabIndex={-1} aria-labelledby="logging-error-summary-title">
              <h3 id="logging-error-summary-title">Check these details</h3>
              <ul>{issues.map(issue => <li key={issue.field}>{issue.message}</li>)}</ul>
            </div>
          )}

          <ServingSizeField selection={servingSelection} customMlText={customMlText} error={fieldError('serving')}
            onSelectionChange={value => { changed(); setServingSelection(value) }}
            onCustomMlChange={value => { changed(); setCustomMlText(value) }} />

          <div className="logging-form__row">
            <QuantityField value={quantityText} error={fieldError('quantity')} onChange={value => {
              changed()
              setQuantityText(value)
            }} />
            <PriceField mode={priceMode} amountText={knownPriceText} currency={currency} error={fieldError('price')}
              onModeChange={mode => { changed(); setPriceMode(mode) }}
              onAmountChange={value => { changed(); setKnownPriceText(value) }} />
          </div>

          <ConsumptionTimeField value={localDateTime} timeZone={timeZone} choice={choice} candidates={timeCandidates}
            error={fieldError('time')} onChange={value => {
              changed()
              setLocalDateTime(value)
              setChoice(undefined)
            }} onChoiceChange={value => { changed(); setChoice(value) }} />

          <NutritionReferenceField references={validReferences} value={referenceId} error={fieldError('reference')}
            onChange={value => { changed(); setReferenceId(value) }} />

          <div className="logging-form__actions">
            <button className="logging-button logging-button--primary" type="submit">Review entry</button>
            <button className="logging-button logging-button--disabled" type="button" disabled
              aria-describedby="logging-save-explanation">Save entry</button>
          </div>
          <p className="logging-help" id="logging-save-explanation">
            Saving is not available yet. Persistence will be added later; reviewing this draft does not save an entry.
          </p>
          <p className="logging-review-status" role="status">{reviewStatus}</p>
        </div>

        <DrinkPreview preview={preview} currency={currency} />
      </div>
    </form>
  )
}

export default DrinkEntryForm
