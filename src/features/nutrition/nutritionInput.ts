import { createNutritionReference } from '../../domain/nutrition'
import type { NutritionReferenceField } from '../../domain/nutrition'
import type { NutritionCatalogReference } from '../../domain/types'
import { isRecord } from '../../domain/validation'

/** Preserve editable form text until the user applies their personal label values. */
export interface PersonalNutritionDraft {
  readonly productDescription: string
  readonly sugarGramsPer100MlText: string
  readonly kcalPer100MlText: string
  readonly sourceDescription: string
  readonly sourceUrl?: string
}

/** IDs come from the application boundary; the session supplies the version. */
export interface NutritionInputIdentity {
  readonly id: string
  readonly version: number
}

export type NutritionInputField =
  | 'input'
  | 'id'
  | 'version'
  | keyof PersonalNutritionDraft

export interface NutritionInputIssue {
  readonly field: NutritionInputField
  readonly message: string
}

export type NutritionInputResult =
  | { readonly valid: true; readonly reference: NutritionCatalogReference }
  | { readonly valid: false; readonly issues: readonly NutritionInputIssue[] }

function failure(issues: readonly NutritionInputIssue[]): NutritionInputResult {
  return Object.freeze({
    valid: false,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
  })
}

function inputField(field: NutritionReferenceField): NutritionInputField {
  switch (field) {
    case 'reference': return 'input'
    case 'source':
    case 'source.label': return 'sourceDescription'
    case 'source.url': return 'sourceUrl'
    case 'sugarGramsPer100Ml': return 'sugarGramsPer100MlText'
    case 'kcalPer100Ml': return 'kcalPer100MlText'
    default: return field
  }
}

/** Ordinary dot decimals only: never interpret a blank field as zero. */
function parseRate(
  input: unknown,
  field: 'sugarGramsPer100MlText' | 'kcalPer100MlText',
  issues: NutritionInputIssue[],
): number | undefined {
  const text = typeof input === 'string' ? input.trim() : ''
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    issues.push({ field, message: 'Enter a nonnegative value using digits and an optional decimal point.' })
    return undefined
  }

  const value = Number(text)
  if (!Number.isFinite(value)) {
    issues.push({ field, message: 'The value exceeds the supported numeric range.' })
    return undefined
  }
  // A tiny nonzero decimal must not silently become an explicit zero estimate.
  if (value === 0 && /[1-9]/.test(text)) {
    issues.push({ field, message: 'The nonzero value is too small for the supported numeric range.' })
    return undefined
  }
  return value
}

/**
 * Normalize user-entered label values, then reuse domain reference validation.
 * Success validates structure and numeric range; it does not independently verify
 * the label's accuracy or assign reviewed provenance. No nutrition defaults exist.
 */
export function preparePersonalNutrition(
  input: unknown,
  identity: NutritionInputIdentity,
): NutritionInputResult {
  if (!isRecord(input)) {
    return failure([{ field: 'input', message: 'Provide personal nutrition fields as editable text.' }])
  }

  const issues: NutritionInputIssue[] = []
  const sugarGramsPer100Ml = parseRate(input.sugarGramsPer100MlText, 'sugarGramsPer100MlText', issues)
  const kcalPer100Ml = parseRate(input.kcalPer100MlText, 'kcalPer100MlText', issues)
  const productDescription = typeof input.productDescription === 'string'
    ? input.productDescription.trim() : input.productDescription
  const label = typeof input.sourceDescription === 'string'
    ? input.sourceDescription.trim() : input.sourceDescription
  const url = typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() || undefined : input.sourceUrl
  const suppliedIdentity: Record<string, unknown> = isRecord(identity) ? identity : {}

  const checked = createNutritionReference({
    id: suppliedIdentity.id,
    version: suppliedIdentity.version,
    productDescription,
    sugarGramsPer100Ml,
    kcalPer100Ml,
    source: { label, ...(url === undefined ? {} : { url }) },
  })
  if (checked.valid === false) {
    for (const issue of checked.issues) {
      const field = inputField(issue.field)
      if (!issues.some(existing => existing.field === field)) {
        issues.push({ field, message: issue.message })
      }
    }
  }
  if (checked.valid === false || issues.length > 0) return failure(issues)
  return Object.freeze({ valid: true, reference: checked.reference })
}
