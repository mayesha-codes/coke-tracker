import { validateMoney } from './money'
import { createNutritionSnapshot, validateNutritionSnapshot } from './nutrition'
import type { NutritionSnapshotResult } from './nutrition'
import type {
  CreateDrinkEntryInput,
  DrinkEntry,
  DrinkEntryValidationIssue,
  DrinkEntryValidationResult,
  NutritionReference,
} from './types'
import { isIdentifier, isPositiveSafeInteger, isRecord, normalizeUtcTimestamp } from './validation'

/**
 * Validate an unknown record and return a normalized, frozen defensive copy.
 * This does not check collection-wide ID uniqueness or read the current time.
 */
export function validateDrinkEntry(input: unknown): DrinkEntryValidationResult {
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ field: 'entry', message: 'Provide a drink record object.' }],
    }
  }

  return validateRecord(input, validateNutritionSnapshot(input.nutrition))
}

/** Both public entry functions share record checks and the same issue-field mapping. */
function validateRecord(
  input: Record<string, unknown>,
  nutrition: NutritionSnapshotResult,
): DrinkEntryValidationResult {
  const { id, consumedAt, quantity, servingMl, totalPriceMinor, currency } = input

  const validId = isIdentifier(id)
  const timestamp = normalizeUtcTimestamp(consumedAt)
  const validQuantity = isPositiveSafeInteger(quantity)
  const validServing = isPositiveSafeInteger(servingMl)
  const money = validateMoney({ amountMinor: totalPriceMinor, currency })

  const issues: DrinkEntryValidationIssue[] = []
  if (!validId) {
    issues.push({ field: 'id', message: 'Provide a non-empty ID without surrounding whitespace.' })
  }
  if (timestamp === null) {
    issues.push({
      field: 'consumedAt',
      message: 'Provide a valid UTC ISO timestamp with seconds and Z or +00:00.',
    })
  }
  if (!validQuantity) {
    issues.push({ field: 'quantity', message: 'Quantity must be a positive safe integer.' })
  }
  if (!validServing) {
    issues.push({ field: 'servingMl', message: 'Serving size must be a positive safe integer in ml.' })
  }
  if (money.valid === false) {
    for (const issue of money.issues) {
      // The supplied money pair is always an object; amount errors belong to totalPriceMinor.
      issues.push({
        field: issue.field === 'currency' ? 'currency' : 'totalPriceMinor',
        message: issue.message,
      })
    }
  }
  if (nutrition.valid === false) {
    for (const issue of nutrition.issues) {
      issues.push({
        field: issue.field === 'snapshot' ? 'nutrition' : `nutrition.${issue.field}`,
        message: issue.message,
      })
    }
  }

  if (
    !validId || timestamp === null || !validQuantity || !validServing ||
    money.valid === false || nutrition.valid === false
  ) {
    return { valid: false, issues }
  }

  const entry: DrinkEntry = Object.freeze({
    id,
    consumedAt: timestamp,
    quantity,
    servingMl,
    nutrition: nutrition.snapshot,
    totalPriceMinor: money.money.amountMinor,
    currency: money.money.currency,
  })

  return { valid: true, entry }
}

/**
 * Create a record from caller-supplied details and a separate nutrition reference.
 * ID generation, clock access, and collection-wide uniqueness remain with the caller.
 * No provided object is changed or frozen; the result owns its copied snapshot.
 */
export function createDrinkEntry(
  input: CreateDrinkEntryInput,
  reference: NutritionReference,
): DrinkEntryValidationResult {
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ field: 'entry', message: 'Provide drink entry details.' }],
    }
  }
  if (!isRecord(reference)) {
    return {
      valid: false,
      issues: [{ field: 'nutrition', message: 'Provide a separate nutrition reference.' }],
    }
  }

  return validateRecord(input, createNutritionSnapshot(reference))
}
