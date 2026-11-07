import { validateDrinkEntry } from './entries'
import { calculateNutrition } from './nutrition'
import type { NutritionCalculationField } from './nutrition'
import type { CurrencyCode, DrinkEntry, DrinkEntryValidationField } from './types'

/** Known spending and missing-price information for one currency, without conversion. */
export interface CurrencySpending {
  readonly currency: CurrencyCode
  readonly knownAmountMinor: number
  /** Counts log records with unknown prices, not the number of servings in those records. */
  readonly unknownPriceEntryCount: number
}

/** Totals for exactly the records supplied by the caller, with no date filtering. */
export interface ConsumptionTotals {
  readonly entryCount: number
  /** Sum of quantities; an entry containing two cans contributes two drinks. */
  readonly drinkCount: number
  readonly volumeMl: number
  readonly sugarGrams: number
  /** Actual, unrounded Coke-only calorie estimate; independent of daily volume goals. */
  readonly kcal: number
  readonly spendingByCurrency: readonly CurrencySpending[]
  readonly unknownPriceEntryCount: number
}

export type TotalsIssueField =
  | DrinkEntryValidationField
  | NutritionCalculationField
  | 'entries'
  | 'entryCount'
  | 'drinkCount'
  | 'volumeMl'
  | 'knownAmountMinor'
  | 'unknownPriceEntryCount'

export interface TotalsIssue {
  readonly field: TotalsIssueField
  readonly message: string
  /** Zero-based index for a collection issue; null for a standalone entry or bad array. */
  readonly entryIndex: number | null
  readonly currency?: CurrencyCode
}

export type TotalsResult =
  | { readonly valid: true; readonly totals: ConsumptionTotals }
  | { readonly valid: false; readonly issues: readonly TotalsIssue[] }

function failure(issues: readonly TotalsIssue[]): TotalsResult {
  return Object.freeze({
    valid: false,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
  })
}

function success(totals: ConsumptionTotals): TotalsResult {
  return Object.freeze({
    valid: true,
    totals: Object.freeze({
      ...totals,
      spendingByCurrency: Object.freeze(
        totals.spendingByCurrency.map(row => Object.freeze({ ...row })),
      ),
    }),
  })
}

/**
 * Validate and calculate one record using its saved nutrition snapshot.
 * The stored price already covers all servings, so it is never multiplied by quantity.
 */
export function calculateEntryTotals(entry: DrinkEntry): TotalsResult {
  const validation = validateDrinkEntry(entry)
  if (validation.valid === false) {
    return failure(validation.issues.map(issue => ({ ...issue, entryIndex: null })))
  }

  const savedEntry = validation.entry
  const nutrition = calculateNutrition(savedEntry)
  if (nutrition.valid === false) {
    return failure(nutrition.issues.map(issue => ({ ...issue, entryIndex: null })))
  }

  const unknownPriceEntryCount = savedEntry.totalPriceMinor === null ? 1 : 0
  return success({
    entryCount: 1,
    drinkCount: savedEntry.quantity,
    // calculateNutrition has already checked that this product is a safe integer.
    volumeMl: savedEntry.quantity * savedEntry.servingMl,
    sugarGrams: nutrition.estimate.sugarGrams,
    kcal: nutrition.estimate.kcal,
    spendingByCurrency: [{
      currency: savedEntry.currency,
      knownAmountMinor: savedEntry.totalPriceMinor === null ? 0 : savedEntry.totalPriceMinor,
      unknownPriceEntryCount,
    }],
    unknownPriceEntryCount,
  })
}

/**
 * Add the supplied records exactly once each, without deduplication or clock access.
 * Reject the whole calculation at the first invalid record or unsafe accumulation;
 * a failure never exposes partial totals.
 */
export function calculateConsumptionTotals(entries: readonly DrinkEntry[]): TotalsResult {
  if (!Array.isArray(entries)) {
    return failure([{
      field: 'entries',
      message: 'Provide an array of drink records.',
      entryIndex: null,
    }])
  }

  let entryCount = 0
  let drinkCount = 0
  let volumeMl = 0
  let sugarGrams = 0
  let kcal = 0
  let unknownPriceEntryCount = 0
  const spending = new Map<CurrencyCode, CurrencySpending>()

  // Index iteration detects holes that array methods such as forEach would skip.
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    if (!Object.hasOwn(entries, entryIndex)) {
      return failure([{
        field: 'entry',
        message: 'Provide a drink record at this index instead of an empty array slot.',
        entryIndex,
      }])
    }

    const result = calculateEntryTotals(entries[entryIndex])
    if (result.valid === false) {
      return failure(result.issues.map(issue => ({ ...issue, entryIndex })))
    }

    const current = result.totals
    const nextEntryCount = entryCount + current.entryCount
    const nextDrinkCount = drinkCount + current.drinkCount
    const nextVolumeMl = volumeMl + current.volumeMl
    const nextUnknownCount = unknownPriceEntryCount + current.unknownPriceEntryCount
    const integerTotals = [
      ['entryCount', nextEntryCount],
      ['drinkCount', nextDrinkCount],
      ['volumeMl', nextVolumeMl],
      ['unknownPriceEntryCount', nextUnknownCount],
    ] as const
    const unsafeTotal = integerTotals.find(([, value]) => !Number.isSafeInteger(value))
    if (unsafeTotal) {
      return failure([{
        field: unsafeTotal[0],
        message: 'The combined total must remain within the safe integer range.',
        entryIndex,
      }])
    }

    const nextSugarGrams = sugarGrams + current.sugarGrams
    const nextKcal = kcal + current.kcal
    const nutritionIssues: TotalsIssue[] = []
    if (!Number.isFinite(nextSugarGrams)) {
      nutritionIssues.push({
        field: 'sugarGrams',
        message: 'Combined estimated sugar exceeds the supported numeric range.',
        entryIndex,
      })
    }
    if (!Number.isFinite(nextKcal)) {
      nutritionIssues.push({
        field: 'kcal',
        message: 'Combined estimated calories exceed the supported numeric range.',
        entryIndex,
      })
    }
    if (nutritionIssues.length > 0) return failure(nutritionIssues)

    for (const row of current.spendingByCurrency) {
      const previous = spending.get(row.currency)
      const knownAmountMinor = (previous?.knownAmountMinor ?? 0) + row.knownAmountMinor
      const unknownCount = (previous?.unknownPriceEntryCount ?? 0) + row.unknownPriceEntryCount
      if (!Number.isSafeInteger(knownAmountMinor)) {
        return failure([{
          field: 'knownAmountMinor',
          message: 'Known spending for this currency exceeds the safe integer range.',
          entryIndex,
          currency: row.currency,
        }])
      }
      if (!Number.isSafeInteger(unknownCount)) {
        return failure([{
          field: 'unknownPriceEntryCount',
          message: 'The unknown-price entry count exceeds the safe integer range.',
          entryIndex,
          currency: row.currency,
        }])
      }

      spending.set(row.currency, {
        currency: row.currency,
        knownAmountMinor,
        unknownPriceEntryCount: unknownCount,
      })
    }

    entryCount = nextEntryCount
    drinkCount = nextDrinkCount
    volumeMl = nextVolumeMl
    sugarGrams = nextSugarGrams
    kcal = nextKcal
    unknownPriceEntryCount = nextUnknownCount
  }

  const spendingByCurrency = [...spending.values()].sort((a, b) => {
    if (a.currency === b.currency) return 0
    return a.currency < b.currency ? -1 : 1
  })

  return success({
    entryCount,
    drinkCount,
    volumeMl,
    sugarGrams,
    kcal,
    spendingByCurrency,
    unknownPriceEntryCount,
  })
}
