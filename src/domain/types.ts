/** Uppercase currency code, checked against Intl's supported currencies at runtime. */
export type CurrencyCode = string

/** UTC ISO timestamp; validation normalizes it to YYYY-MM-DDTHH:mm:ss.sssZ. */
export type UtcTimestamp = string

/** Catalog values for a particular nutrition reference and version. */
export interface NutritionReference {
  readonly id: string
  readonly version: number
  readonly sugarGramsPer100Ml: number
  readonly kcalPer100Ml: number
}

/** A package label or publication that supplied the reference values. No URL is required. */
export interface NutritionSource {
  readonly label: string
  /** An optional HTTP/HTTPS link; utilities validate it without making network requests. */
  readonly url?: string
}

/** Rich catalog metadata is additive, so existing four-field references remain valid. */
export interface NutritionCatalogReference extends NutritionReference {
  readonly productDescription: string
  readonly source: NutritionSource
}

/** Copied nutrition values: historical records never depend on a live catalog lookup. */
export interface NutritionSnapshot {
  readonly referenceId: string
  readonly referenceVersion: number
  readonly sugarGramsPer100Ml: number
  readonly kcalPer100Ml: number
}

/** Unrounded estimates for the supplied servings, calculated from a saved snapshot. */
export interface NutritionEstimate {
  readonly sugarGrams: number
  readonly kcal: number
}

/** A price stays paired with its own currency, independently of current user preferences. */
export interface MoneyAmount {
  /** Nonnegative safe integer; null explicitly means unknown, while zero means known free. */
  readonly amountMinor: number | null
  readonly currency: CurrencyCode
}

/** One log record, which may describe several equal-sized servings. */
export interface DrinkEntry {
  /** Supplied by the caller, which is responsible for uniqueness (for example, a UUID). */
  readonly id: string
  readonly consumedAt: UtcTimestamp
  /** Positive safe integer; this is the number of servings, not the number of records. */
  readonly quantity: number
  /** Actual volume per serving, independent of any preset; custom sizes can use this too. */
  readonly servingMl: number
  readonly nutrition: NutritionSnapshot
  /** Total for ALL servings: a nonnegative safe integer, or null for an explicitly unknown price. */
  readonly totalPriceMinor: number | null
  readonly currency: CurrencyCode
}

/** The caller supplies record details; creation adds a copied nutrition snapshot. */
export type CreateDrinkEntryInput = Omit<DrinkEntry, 'nutrition'>

export type ServingPresetId = '200ml' | '330ml' | '500ml' | '1000ml'

/** Size only: prices and nutrition belong to separate data. */
export interface ServingPreset {
  readonly id: ServingPresetId
  readonly label: string
  readonly servingMl: number
}

/** Preferences only; goal evaluation and reporting logic are outside Phase A. */
export interface TrackingSettings {
  /** null disables the goal; zero is a distinct, valid zero-consumption target. */
  readonly dailyLimitMl: number | null
  readonly currency: CurrencyCode
  /** IANA reporting timezone, independent of the device's timezone. */
  readonly reportingTimeZone: string
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = Object.freeze({
  dailyLimitMl: null,
  currency: 'BDT',
  reportingTimeZone: 'Asia/Dhaka',
})

export type DrinkEntryValidationField =
  | keyof DrinkEntry
  | 'entry'
  | 'nutrition.referenceId'
  | 'nutrition.referenceVersion'
  | 'nutrition.sugarGramsPer100Ml'
  | 'nutrition.kcalPer100Ml'

export interface DrinkEntryValidationIssue {
  readonly field: DrinkEntryValidationField
  readonly message: string
}

/** Check valid before accessing entry; invalid results explain which fields need attention. */
export type DrinkEntryValidationResult =
  | { readonly valid: true; readonly entry: DrinkEntry }
  | { readonly valid: false; readonly issues: readonly DrinkEntryValidationIssue[] }
