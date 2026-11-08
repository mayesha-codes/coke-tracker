import { createDrinkEntry } from '../../domain/entries'
import { createNutritionReference } from '../../domain/nutrition'
import type { NutritionReferenceField } from '../../domain/nutrition'
import { calculateEntryTotals } from '../../domain/totals'
import type { ConsumptionTotals, TotalsIssueField } from '../../domain/totals'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type { CurrencyCode, DrinkEntry, NutritionCatalogReference } from '../../domain/types'
import { isIdentifier, isPositiveSafeInteger, isRecord } from '../../domain/validation'
import { resolveLocalDateTime } from './localDateTime'
import type { LocalTimeCandidate, LocalTimeChoice } from './localDateTime'
import { parsePriceInput } from './priceInput'
import type { PriceInput } from './priceInput'

/** Keep editable text as text until validation, including temporarily blank fields. */
export interface DrinkDraft {
  readonly servingMlText: string
  readonly quantityText: string
  readonly price: PriceInput
  readonly localDateTime: string
  readonly timeZone?: string
  readonly disambiguation?: LocalTimeChoice
}

export interface DrinkDraftOptions {
  /** The caller supplies an ID; this adapter never generates one or reads a clock. */
  readonly id: string
  readonly currency?: CurrencyCode
}

export type DrinkDraftIssueField =
  | 'draft'
  | 'id'
  | 'currency'
  | 'servingMlText'
  | 'quantityText'
  | 'priceMode'
  | 'priceText'
  | 'localDateTime'
  | 'timeZone'
  | 'disambiguation'
  | 'nutritionReference'
  | `nutritionReference.${Exclude<NutritionReferenceField, 'reference'>}`

export interface DrinkDraftIssue {
  readonly field: DrinkDraftIssueField
  readonly message: string
}

export type DrinkDraftResult =
  | { readonly valid: true; readonly entry: DrinkEntry; readonly totals: ConsumptionTotals }
  | {
    readonly valid: false
    readonly issues: readonly DrinkDraftIssue[]
    readonly timeCandidates?: readonly LocalTimeCandidate[]
  }

function failure(
  issues: readonly DrinkDraftIssue[],
  timeCandidates?: readonly LocalTimeCandidate[],
): DrinkDraftResult {
  return Object.freeze({
    valid: false,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
    ...(timeCandidates === undefined ? {} : {
      timeCandidates: Object.freeze(timeCandidates.map(candidate => Object.freeze({ ...candidate }))),
    }),
  })
}

/** Normalize integer text without accepting fractions, exponent syntax, or fallback values. */
export function positiveIntegerFromText(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value.trim())
  return isPositiveSafeInteger(parsed) ? parsed : null
}

/** Map existing record/calculation fields to the control that can explain the error. */
function formField(field: TotalsIssueField): DrinkDraftIssueField {
  switch (field) {
    case 'id': return 'id'
    case 'currency': return 'currency'
    case 'quantity': return 'quantityText'
    case 'servingMl':
    case 'totalMl':
    case 'volumeMl': return 'servingMlText'
    case 'consumedAt': return 'localDateTime'
    case 'totalPriceMinor':
    case 'knownAmountMinor': return 'priceText'
    case 'nutrition': return 'nutritionReference'
    case 'nutrition.referenceId': return 'nutritionReference.id'
    case 'nutrition.referenceVersion': return 'nutritionReference.version'
    case 'nutrition.sugarGramsPer100Ml':
    case 'sugarGrams': return 'nutritionReference.sugarGramsPer100Ml'
    case 'nutrition.kcalPer100Ml':
    case 'kcal': return 'nutritionReference.kcalPer100Ml'
    default: return 'draft'
  }
}

/**
 * Convert a form draft into a validated, frozen entry and its calculated totals.
 * The caller must review the product-label/source accuracy of the supplied reference;
 * catalog validation checks its structure and numbers, not the truth of its source.
 * Custom positive integer sizes remain supported by the domain; a UI may offer presets.
 */
export function prepareDrinkEntry(
  draft: DrinkDraft,
  reference: NutritionCatalogReference,
  options: DrinkDraftOptions,
): DrinkDraftResult {
  if (!isRecord(draft)) {
    return failure([{ field: 'draft', message: 'Provide a drink form draft.' }])
  }
  if (!isRecord(options)) {
    return failure([{ field: 'id', message: 'Provide options containing a caller-supplied entry ID.' }])
  }

  const issues: DrinkDraftIssue[] = []
  const validId = isIdentifier(options.id)
  const quantity = positiveIntegerFromText(draft.quantityText)
  const servingMl = positiveIntegerFromText(draft.servingMlText)
  const currency = options.currency === undefined ? DEFAULT_TRACKING_SETTINGS.currency : options.currency
  const price = parsePriceInput(draft.price, currency)
  const time = resolveLocalDateTime(draft.localDateTime, draft.timeZone, draft.disambiguation)
  const nutrition = createNutritionReference(reference)

  if (!validId) {
    issues.push({ field: 'id', message: 'Provide a nonempty entry ID without surrounding whitespace.' })
  }
  if (quantity === null) {
    issues.push({ field: 'quantityText', message: 'Enter a positive whole-number quantity within the safe integer range.' })
  }
  if (servingMl === null) {
    issues.push({ field: 'servingMlText', message: 'Enter a positive whole-number serving size in ml within the safe integer range.' })
  }
  if (price.valid === false) issues.push(...price.issues)
  if (time.valid === false) {
    for (const issue of time.issues) {
      issues.push({
        field: issue.field === 'consumedAt' ? 'localDateTime' : issue.field,
        message: issue.message,
      })
    }
  }
  if (nutrition.valid === false) {
    for (const issue of nutrition.issues) {
      issues.push({
        field: issue.field === 'reference' ? 'nutritionReference' : `nutritionReference.${issue.field}`,
        message: issue.message,
      })
    }
  }

  if (!validId || quantity === null || servingMl === null || price.valid === false ||
      time.valid === false || nutrition.valid === false) {
    return failure(issues, time.valid === false ? time.candidates : undefined)
  }

  const created = createDrinkEntry({
    id: options.id,
    consumedAt: time.consumedAt,
    quantity,
    servingMl,
    totalPriceMinor: price.money.amountMinor,
    currency: price.money.currency,
  }, nutrition.reference)
  if (created.valid === false) {
    return failure(created.issues.map(issue => ({ field: formField(issue.field), message: issue.message })))
  }

  const calculated = calculateEntryTotals(created.entry)
  if (calculated.valid === false) {
    return failure(calculated.issues.map(issue => ({ field: formField(issue.field), message: issue.message })))
  }
  return Object.freeze({ valid: true, entry: created.entry, totals: calculated.totals })
}
