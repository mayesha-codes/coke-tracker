import { createNutritionReference } from '../../domain/nutrition'
import type { NutritionReferenceField } from '../../domain/nutrition'
import type { NutritionCatalogReference } from '../../domain/types'
import { isIdentifier, isRecord, normalizeUtcTimestamp } from '../../domain/validation'

/** Evidence is retained separately: the core reference validator copies only its known fields. */
export interface ReviewedProduct {
  readonly productKey: string
  readonly productName: string
  readonly market: { readonly code: string; readonly label: string }
  readonly evidence: {
    readonly kind: 'manufacturer-page' | 'package-label'
    /** A manufacturer URL, or the location of an archived package-label image. */
    readonly location: string
    readonly section: string
    readonly reviewedOn: string
    readonly basis: { readonly value: 100; readonly unit: 'ml' }
    readonly sugars: { readonly nutrient: 'sugars'; readonly label: string; readonly value: number; readonly unit: 'g' }
    readonly energy: { readonly label: string; readonly value: number; readonly unit: 'kcal' }
  }
  readonly reference: NutritionCatalogReference
}

export type ReviewedProductField =
  | 'product' | 'productKey' | 'productName' | 'market.code' | 'market.label'
  | 'evidence.kind' | 'evidence.location' | 'evidence.section' | 'evidence.reviewedOn'
  | 'evidence.basis' | 'evidence.sugars' | 'evidence.energy'
  | `reference.${NutritionReferenceField}` | 'registry'

export interface ReviewedProductIssue {
  readonly field: ReviewedProductField
  readonly message: string
  readonly productIndex?: number
}

export type ReviewedProductResult =
  | { readonly valid: true; readonly product: ReviewedProduct }
  | { readonly valid: false; readonly issues: readonly ReviewedProductIssue[] }

export type ReviewedProductRegistryResult =
  | {
    readonly valid: true
    readonly products: readonly ReviewedProduct[]
    readonly references: readonly NutritionCatalogReference[]
  }
  | { readonly valid: false; readonly issues: readonly ReviewedProductIssue[] }

function failure(issues: readonly ReviewedProductIssue[]) {
  return Object.freeze({
    valid: false as const,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
  })
}

function isWebLocation(value: unknown): value is string {
  if (!isIdentifier(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function isReviewDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && normalizeUtcTimestamp(`${value}T00:00:00Z`) !== null
}

function isEvidenceLocation(value: unknown, kind: unknown): value is string {
  if (isWebLocation(value)) return true
  if (kind !== 'package-label' || !isIdentifier(value)) return false
  // Archived labels use a repository-relative image path, never executable URI
  // schemes, absolute paths, backslashes, or parent-directory traversal.
  return /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(value)
    && value.split('/').every(part => part !== '.' && part !== '..')
}

/**
 * Validate an evidence record and own frozen copies. This checks declared facts and
 * consistency, not whether an external source actually says them; source review is manual.
 * This first checkpoint accepts evidence already reported per 100 ml, with g and kcal.
 */
export function createReviewedProduct(input: unknown): ReviewedProductResult {
  if (!isRecord(input)) return failure([{ field: 'product', message: 'Provide a reviewed product and its evidence.' }])
  const { productKey, productName } = input
  const market = isRecord(input.market) ? input.market : {}
  const { code, label } = market
  const evidence = isRecord(input.evidence) ? input.evidence : {}
  const { kind, location, section, reviewedOn } = evidence
  const basis = isRecord(evidence.basis) ? evidence.basis : {}
  const sugars = isRecord(evidence.sugars) ? evidence.sugars : {}
  const energy = isRecord(evidence.energy) ? evidence.energy : {}
  const sugarLabel = sugars.label
  const energyLabel = energy.label
  const checked = createNutritionReference(input.reference)
  const validKey = typeof productKey === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(productKey)
  const validName = isIdentifier(productName)
  const validCode = typeof code === 'string' && /^[A-Z]{2}$/.test(code)
  const validMarketLabel = isIdentifier(label)
  const validKind = kind === 'manufacturer-page' || kind === 'package-label'
  const validLocation = isEvidenceLocation(location, kind)
  const validSection = isIdentifier(section)
  const validDate = isReviewDate(reviewedOn)
  const validBasis = basis.value === 100 && basis.unit === 'ml'
  const validSugars = sugars.nutrient === 'sugars' && sugars.unit === 'g' && isIdentifier(sugarLabel)
    && typeof sugars.value === 'number' && Number.isFinite(sugars.value) && sugars.value >= 0
  const validEnergy = energy.unit === 'kcal' && isIdentifier(energyLabel)
    && typeof energy.value === 'number' && Number.isFinite(energy.value) && energy.value >= 0
  const issues: ReviewedProductIssue[] = []
  if (!validKey) issues.push({ field: 'productKey', message: 'Use a lowercase hyphenated product key.' })
  if (!validName) issues.push({ field: 'productName', message: 'Provide the exact product name without surrounding whitespace.' })
  if (!validCode) issues.push({ field: 'market.code', message: 'Provide a two-letter uppercase market code.' })
  if (!validMarketLabel) issues.push({ field: 'market.label', message: 'Provide the market name in English.' })
  if (!validKind) issues.push({ field: 'evidence.kind', message: 'Identify manufacturer-page or package-label evidence.' })
  if (!validLocation) issues.push({ field: 'evidence.location', message: 'Provide an HTTP/HTTPS evidence URL or a repository-relative package-label image path.' })
  if (!validSection) issues.push({ field: 'evidence.section', message: 'Identify the exact source section or package-label image.' })
  if (!validDate) issues.push({ field: 'evidence.reviewedOn', message: 'Provide a real review date in YYYY-MM-DD format.' })
  if (!validBasis) issues.push({ field: 'evidence.basis', message: 'This registry requires explicitly reported values per 100 ml.' })
  if (!validSugars) issues.push({ field: 'evidence.sugars', message: 'Provide explicit sugars in grams, not carbohydrates or an inferred sugar value.' })
  if (!validEnergy) issues.push({ field: 'evidence.energy', message: 'Provide explicitly reported energy in kcal, not kJ.' })
  if (checked.valid === false) issues.push(...checked.issues.map(issue => ({
    field: `reference.${issue.field}` as const, message: issue.message,
  })))
  if (!validKey || !validName || !validCode || !validMarketLabel || !validKind || !validLocation
      || !validSection || !validDate || !validBasis || !validSugars || !validEnergy || checked.valid === false) {
    return failure(issues)
  }

  const reference = checked.reference
  if (reference.id !== `${productKey}-${code.toLowerCase()}`) {
    issues.push({ field: 'reference.id', message: 'The reference ID must identify this product key and market code.' })
  }
  if (reference.productDescription !== `${productName} — ${label}`) {
    issues.push({ field: 'reference.productDescription', message: 'Preserve both product and market in the reference description.' })
  }
  if (reference.sugarGramsPer100Ml !== sugars.value) {
    issues.push({ field: 'evidence.sugars', message: 'The saved sugar rate must match the explicit per-100-ml source value.' })
  }
  if (reference.kcalPer100Ml !== energy.value) {
    issues.push({ field: 'evidence.energy', message: 'The saved calorie rate must match the explicit per-100-ml source value.' })
  }
  if (kind === 'manufacturer-page' && reference.source.url !== location) {
    issues.push({ field: 'reference.source.url', message: 'Retain the manufacturer evidence URL in the historical source information.' })
  }
  if (issues.length > 0) return failure(issues)
  return Object.freeze({
    valid: true,
    product: Object.freeze({
      productKey, productName,
      market: Object.freeze({ code, label }),
      evidence: Object.freeze({
        kind, location, section, reviewedOn,
        basis: Object.freeze({ value: 100, unit: 'ml' }),
        sugars: Object.freeze({ nutrient: 'sugars', label: sugarLabel, value: reference.sugarGramsPer100Ml, unit: 'g' }),
        energy: Object.freeze({ label: energyLabel, value: reference.kcalPer100Ml, unit: 'kcal' }),
      }),
      reference,
    }),
  })
}

/** Retain every version, expose only the highest version of each product/market for new choices. */
export function createReviewedProductRegistry(input: unknown): ReviewedProductRegistryResult {
  if (!Array.isArray(input)) return failure([{ field: 'registry', message: 'Provide an array of reviewed product versions.' }])
  const products: ReviewedProduct[] = []
  const issues: ReviewedProductIssue[] = []
  const seenVersions = new Set<string>()
  const latest = new Map<string, ReviewedProduct>()
  for (let productIndex = 0; productIndex < input.length; productIndex++) {
    const result = createReviewedProduct(input[productIndex])
    if (result.valid === false) {
      issues.push(...result.issues.map(issue => ({ ...issue, productIndex })))
      continue
    }
    const product = result.product
    const { id, version } = product.reference
    const versionKey = JSON.stringify([id, version])
    if (seenVersions.has(versionKey)) {
      issues.push({ field: 'reference.version', productIndex, message: 'A reference ID/version may appear only once.' })
    }
    seenVersions.add(versionKey)
    const previous = latest.get(id)
    if (previous !== undefined && (previous.productKey !== product.productKey || previous.productName !== product.productName
        || previous.market.code !== product.market.code || previous.market.label !== product.market.label)) {
      issues.push({ field: 'reference.id', productIndex, message: 'Versions of one reference must retain the same product and market identity.' })
    }
    if (previous === undefined || version > previous.reference.version) latest.set(id, product)
    products.push(product)
  }
  if (issues.length > 0) return failure(issues)
  return Object.freeze({
    valid: true,
    products: Object.freeze(products),
    references: Object.freeze([...latest.values()].map(product => product.reference)),
  })
}

// Reviewed directly against the manufacturer on 2026-11-11. Do not overwrite an
// earlier record when adding a revision; append its new version and retain evidence.
const initialRegistry = createReviewedProductRegistry([{
  productKey: 'coca-cola-original-taste',
  productName: 'Coca-Cola Original Taste',
  market: { code: 'GB', label: 'Great Britain' },
  evidence: {
    kind: 'manufacturer-page',
    location: 'https://www.coca-cola.com/gb/en/brands/coca-cola-original-taste',
    section: 'Products > Coca-Cola Original Taste > Nutrition (per 100ml)',
    reviewedOn: '2026-11-11',
    basis: { value: 100, unit: 'ml' },
    sugars: { nutrient: 'sugars', label: 'Of which sugars', value: 10.6, unit: 'g' },
    energy: { label: 'Energy', value: 42, unit: 'kcal' },
  },
  reference: {
    id: 'coca-cola-original-taste-gb', version: 1,
    productDescription: 'Coca-Cola Original Taste — Great Britain',
    sugarGramsPer100Ml: 10.6, kcalPer100Ml: 42,
    source: {
      label: 'Coca-Cola Great Britain — Original Taste manufacturer nutrition, per 100 ml',
      url: 'https://www.coca-cola.com/gb/en/brands/coca-cola-original-taste',
    },
  },
}])
if (initialRegistry.valid === false) throw new Error('The checked-in reviewed product evidence is invalid.')

/** Complete immutable evidence history, keyed by reference ID and version. */
export const REVIEWED_PRODUCTS = initialRegistry.products
/** Validated current references for the Log product selector; no user preferences choose a market. */
export const REVIEWED_REFERENCES = initialRegistry.references
