import {
  calculateNutrition,
  createNutritionReference,
  createNutritionSnapshot,
} from '../../domain/nutrition'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type {
  CurrencyCode,
  MoneyAmount,
  NutritionCatalogReference,
  NutritionEstimate,
} from '../../domain/types'
import { isRecord } from '../../domain/validation'
import { positiveIntegerFromText } from './drinkDraft'
import type { DrinkDraft, DrinkDraftIssue } from './drinkDraft'
import { parsePriceInput } from './priceInput'

/** Unavailable data is distinct from an available zero or an explicitly unknown price. */
export type PreviewValue<T> =
  | { readonly status: 'available'; readonly value: T }
  | { readonly status: 'unavailable'; readonly reason: string }

export interface DrinkPreviewState {
  readonly volume: PreviewValue<number>
  readonly nutrition: PreviewValue<NutritionEstimate>
  readonly spending: PreviewValue<MoneyAmount>
  readonly issues: readonly DrinkDraftIssue[]
}

function unavailable(reason: string): { readonly status: 'unavailable'; readonly reason: string } {
  return Object.freeze({ status: 'unavailable', reason })
}

function available<T>(value: T): PreviewValue<T> {
  return Object.freeze({ status: 'available', value })
}

function previewState(
  volume: PreviewValue<number>,
  nutrition: PreviewValue<NutritionEstimate>,
  spending: PreviewValue<MoneyAmount>,
  issues: readonly DrinkDraftIssue[],
): DrinkPreviewState {
  return Object.freeze({
    volume,
    nutrition,
    spending,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
  })
}

/**
 * Derive independent draft estimates without creating a record, choosing an ID,
 * or reading a clock. A missing time or price does not erase a valid volume.
 * Reference accuracy must be reviewed by the caller; validation checks structure.
 */
export function deriveDrinkPreview(
  draft: DrinkDraft,
  reference: NutritionCatalogReference | undefined,
  currency: CurrencyCode = DEFAULT_TRACKING_SETTINGS.currency,
): DrinkPreviewState {
  if (!isRecord(draft)) {
    const reason = 'Enter drink details to see a draft estimate.'
    return previewState(unavailable(reason), unavailable(reason), unavailable(reason), [
      { field: 'draft', message: 'Provide a drink form draft.' },
    ])
  }

  const issues: DrinkDraftIssue[] = []
  const quantity = positiveIntegerFromText(draft.quantityText)
  const servingMl = positiveIntegerFromText(draft.servingMlText)
  let volume: PreviewValue<number> = unavailable('Enter a valid quantity and serving size.')

  if (quantity === null) {
    issues.push({ field: 'quantityText', message: 'Enter a positive whole-number quantity within the safe integer range.' })
  }
  if (servingMl === null) {
    issues.push({ field: 'servingMlText', message: 'Choose a positive whole-number serving size in ml.' })
  }
  if (quantity !== null && servingMl !== null) {
    const volumeMl = quantity * servingMl
    if (Number.isSafeInteger(volumeMl)) {
      volume = available(volumeMl)
    } else {
      const message = 'The selected total volume exceeds the safe integer range.'
      volume = unavailable(message)
      issues.push({ field: 'servingMlText', message })
    }
  }

  let nutrition: PreviewValue<NutritionEstimate> = unavailable(
    'Choose a nutrition reference to see estimates.',
  )
  if (reference === undefined) {
    issues.push({ field: 'nutritionReference', message: nutrition.reason })
  } else {
    const checkedReference = createNutritionReference(reference)
    if (checkedReference.valid === false) {
      nutrition = unavailable('The selected nutrition reference is unavailable because its details are invalid.')
      for (const issue of checkedReference.issues) {
        issues.push({
          field: issue.field === 'reference' ? 'nutritionReference' : `nutritionReference.${issue.field}`,
          message: issue.message,
        })
      }
    } else if (quantity !== null && servingMl !== null && volume.status === 'available') {
      const snapshot = createNutritionSnapshot(checkedReference.reference)
      if (snapshot.valid === false) {
        nutrition = unavailable('The selected nutrition reference could not provide a valid snapshot.')
        issues.push({ field: 'nutritionReference', message: nutrition.reason })
      } else {
        const estimated = calculateNutrition({ quantity, servingMl, nutrition: snapshot.snapshot })
        if (estimated.valid === true) {
          nutrition = available(estimated.estimate)
        } else {
          nutrition = unavailable('Nutrition estimates are unavailable for these drink details.')
          for (const issue of estimated.issues) {
            const field = issue.field === 'sugarGrams'
              ? 'nutritionReference.sugarGramsPer100Ml'
              : issue.field === 'kcal' ? 'nutritionReference.kcalPer100Ml' : 'nutritionReference'
            issues.push({ field, message: issue.message })
          }
        }
      }
    } else {
      nutrition = unavailable('Enter a valid quantity and serving size to see nutrition estimates.')
    }
  }

  const price = parsePriceInput(draft.price, currency)
  const spending = price.valid === true
    ? available(price.money)
    : unavailable('Enter a valid total price or explicitly choose unknown.')
  if (price.valid === false) issues.push(...price.issues)

  return previewState(volume, nutrition, spending, issues)
}
