import type {
  NutritionCatalogReference,
  NutritionEstimate,
  NutritionReference,
  NutritionSnapshot,
  NutritionSource,
} from './types'
import { isIdentifier, isPositiveSafeInteger, isRecord } from './validation'

export type NutritionSnapshotField =
  | 'snapshot'
  | 'referenceId'
  | 'referenceVersion'
  | 'sugarGramsPer100Ml'
  | 'kcalPer100Ml'

export interface NutritionSnapshotIssue {
  readonly field: NutritionSnapshotField
  readonly message: string
}

export type NutritionSnapshotResult =
  | { readonly valid: true; readonly snapshot: NutritionSnapshot }
  | { readonly valid: false; readonly issues: readonly NutritionSnapshotIssue[] }

export type NutritionReferenceField =
  | 'reference'
  | 'id'
  | 'version'
  | 'sugarGramsPer100Ml'
  | 'kcalPer100Ml'
  | 'productDescription'
  | 'source'
  | 'source.label'
  | 'source.url'

export interface NutritionReferenceIssue {
  readonly field: NutritionReferenceField
  readonly message: string
}

export type NutritionReferenceResult =
  | { readonly valid: true; readonly reference: NutritionCatalogReference }
  | { readonly valid: false; readonly issues: readonly NutritionReferenceIssue[] }

export interface NutritionCalculationInput {
  readonly quantity: number
  readonly servingMl: number
  readonly nutrition: NutritionSnapshot
}

export type NutritionCalculationField =
  | 'calculation'
  | 'quantity'
  | 'servingMl'
  | 'totalMl'
  | 'nutrition'
  | `nutrition.${Exclude<NutritionSnapshotField, 'snapshot'>}`
  | 'sugarGrams'
  | 'kcal'

export interface NutritionCalculationIssue {
  readonly field: NutritionCalculationField
  readonly message: string
}

export type NutritionCalculationResult =
  | { readonly valid: true; readonly estimate: NutritionEstimate }
  | { readonly valid: false; readonly issues: readonly NutritionCalculationIssue[] }

function isNutritionRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isSourceUrl(value: unknown): value is string {
  if (!isIdentifier(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Validate saved rates and provenance IDs, returning a frozen copy of known fields. */
export function validateNutritionSnapshot(input: unknown): NutritionSnapshotResult {
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ field: 'snapshot', message: 'Provide a nutrition snapshot object.' }],
    }
  }

  const { referenceId, referenceVersion, sugarGramsPer100Ml, kcalPer100Ml } = input
  const validId = isIdentifier(referenceId)
  const validVersion = isPositiveSafeInteger(referenceVersion)
  const validSugar = isNutritionRate(sugarGramsPer100Ml)
  const validCalories = isNutritionRate(kcalPer100Ml)
  const issues: NutritionSnapshotIssue[] = []

  if (!validId) {
    issues.push({
      field: 'referenceId',
      message: 'Provide a non-empty nutrition reference ID without surrounding whitespace.',
    })
  }
  if (!validVersion) {
    issues.push({
      field: 'referenceVersion',
      message: 'Nutrition reference version must be a positive safe integer.',
    })
  }
  if (!validSugar) {
    issues.push({
      field: 'sugarGramsPer100Ml',
      message: 'Sugar per 100 ml must be a finite, nonnegative number.',
    })
  }
  if (!validCalories) {
    issues.push({
      field: 'kcalPer100Ml',
      message: 'Calories per 100 ml must be a finite, nonnegative number.',
    })
  }

  if (!validId || !validVersion || !validSugar || !validCalories) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    snapshot: Object.freeze({ referenceId, referenceVersion, sugarGramsPer100Ml, kcalPer100Ml }),
  }
}

function snapshotFromReference(reference: Record<string, unknown>): NutritionSnapshotResult {
  return validateNutritionSnapshot({
    referenceId: reference.id,
    referenceVersion: reference.version,
    sugarGramsPer100Ml: reference.sugarGramsPer100Ml,
    kcalPer100Ml: reference.kcalPer100Ml,
  })
}

/** Copy rates into historical data; later changes to the reference cannot affect the copy. */
export function createNutritionSnapshot(reference: NutritionReference): NutritionSnapshotResult {
  if (!isRecord(reference)) {
    return {
      valid: false,
      issues: [{ field: 'snapshot', message: 'Provide a separate nutrition reference.' }],
    }
  }
  return snapshotFromReference(reference)
}

/**
 * Create an immutable catalog reference with a description and source information.
 * The caller supplies IDs and versions; this function does not look up or replace a catalog.
 */
export function createNutritionReference(input: unknown): NutritionReferenceResult {
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ field: 'reference', message: 'Provide a nutrition reference object.' }],
    }
  }

  const snapshotResult = snapshotFromReference(input)
  const { productDescription } = input
  const validDescription = isIdentifier(productDescription)
  const rawSource = input.source
  const source = isRecord(rawSource) ? rawSource : {}
  const { label, url } = source
  const validLabel = isIdentifier(label)
  const validUrl = url === undefined || isSourceUrl(url)
  const issues: NutritionReferenceIssue[] = []

  if (snapshotResult.valid === false) {
    for (const issue of snapshotResult.issues) {
      const field = issue.field === 'referenceId' ? 'id'
        : issue.field === 'referenceVersion' ? 'version'
          : issue.field === 'snapshot' ? 'reference' : issue.field
      issues.push({ field, message: issue.message })
    }
  }
  if (!validDescription) {
    issues.push({
      field: 'productDescription',
      message: 'Provide a product description without surrounding whitespace.',
    })
  }
  if (!isRecord(rawSource)) {
    issues.push({ field: 'source', message: 'Provide source information for the nutrition values.' })
  } else {
    if (!validLabel) {
      issues.push({ field: 'source.label', message: 'Provide a source label without surrounding whitespace.' })
    }
    if (!validUrl) {
      issues.push({ field: 'source.url', message: 'Provide an HTTP or HTTPS source URL, or omit it.' })
    }
  }

  if (snapshotResult.valid === false || !validDescription || !validLabel || !validUrl) {
    return { valid: false, issues }
  }

  const copiedSource: NutritionSource = Object.freeze({
    label,
    ...(url === undefined ? {} : { url }),
  })
  const snapshot = snapshotResult.snapshot
  return {
    valid: true,
    reference: Object.freeze({
      id: snapshot.referenceId,
      version: snapshot.referenceVersion,
      sugarGramsPer100Ml: snapshot.sugarGramsPer100Ml,
      kcalPer100Ml: snapshot.kcalPer100Ml,
      productDescription,
      source: copiedSource,
    }),
  }
}

/**
 * Estimate nutrition from saved per-100-ml rates, without rounding or reading a live catalog.
 * Quantities and volumes must stay exact integers; the nutrition results are estimates.
 */
export function calculateNutrition(input: NutritionCalculationInput): NutritionCalculationResult {
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ field: 'calculation', message: 'Provide quantity, serving size, and a nutrition snapshot.' }],
    }
  }

  const { quantity, servingMl } = input
  const validQuantity = isPositiveSafeInteger(quantity)
  const validServing = isPositiveSafeInteger(servingMl)
  const snapshotResult = validateNutritionSnapshot(input.nutrition)
  const issues: NutritionCalculationIssue[] = []
  if (!validQuantity) {
    issues.push({ field: 'quantity', message: 'Quantity must be a positive safe integer.' })
  }
  if (!validServing) {
    issues.push({ field: 'servingMl', message: 'Serving size must be a positive safe integer in ml.' })
  }
  if (snapshotResult.valid === false) {
    for (const issue of snapshotResult.issues) {
      const field = issue.field === 'snapshot' ? 'nutrition' : `nutrition.${issue.field}` as const
      issues.push({ field, message: issue.message })
    }
  }
  if (!validQuantity || !validServing || snapshotResult.valid === false) {
    return { valid: false, issues }
  }

  const totalMl = quantity * servingMl
  if (!Number.isSafeInteger(totalMl)) {
    return {
      valid: false,
      issues: [{ field: 'totalMl', message: 'Total volume must remain a safe integer in ml.' }],
    }
  }

  const { sugarGramsPer100Ml, kcalPer100Ml } = snapshotResult.snapshot
  const sugarGrams = totalMl / 100 * sugarGramsPer100Ml
  const kcal = totalMl / 100 * kcalPer100Ml
  if (!Number.isFinite(sugarGrams)) {
    issues.push({ field: 'sugarGrams', message: 'Estimated sugar exceeds the supported numeric range.' })
  }
  if (!Number.isFinite(kcal)) {
    issues.push({ field: 'kcal', message: 'Estimated calories exceed the supported numeric range.' })
  }
  if (issues.length > 0) return { valid: false, issues }

  return { valid: true, estimate: Object.freeze({ sugarGrams, kcal }) }
}
