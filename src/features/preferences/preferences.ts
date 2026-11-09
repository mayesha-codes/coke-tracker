import { getCurrencyFractionDigits } from '../../domain/money'
import type { CurrencyCode, TrackingSettings } from '../../domain/types'
import { isNamedTimeZone, isRecord } from '../../domain/validation'

/** Display formatting stays English, independently of currency or reporting timezone. */
export const ENGLISH_DISPLAY_LOCALE = 'en'

export interface PreferenceCurrencyOption {
  readonly code: CurrencyCode
  readonly label: string
}

/** Initial menu choices, not a restriction on the currencies supported by the domain. */
export const PREFERENCE_CURRENCIES: readonly PreferenceCurrencyOption[] = Object.freeze([
  Object.freeze({ code: 'JPY', label: 'Japanese yen' }),
  Object.freeze({ code: 'USD', label: 'US dollar' }),
  Object.freeze({ code: 'EUR', label: 'Euro' }),
  Object.freeze({ code: 'BDT', label: 'Bangladeshi taka' }),
])

/** Editable application setup suggestion; existing domain defaults remain unchanged. */
export const INITIAL_USER_PREFERENCES: TrackingSettings = Object.freeze({
  currency: 'JPY',
  reportingTimeZone: 'Asia/Tokyo',
  dailyLimitMl: null,
})

export type PreferenceIssueField = 'preferences' | keyof TrackingSettings

export interface PreferenceIssue {
  readonly field: PreferenceIssueField
  readonly message: string
}

export type PreferencesResult =
  | { readonly valid: true; readonly preferences: TrackingSettings }
  | { readonly valid: false; readonly issues: readonly PreferenceIssue[] }

function failure(issues: readonly PreferenceIssue[]): PreferencesResult {
  return Object.freeze({
    valid: false,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
  })
}

function isDailyLimit(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
}

/**
 * Validate a complete preference object and return an independent, frozen copy.
 * Missing values are errors, never implicit choices. Callers explicitly choose
 * whether to begin with INITIAL_USER_PREFERENCES or another supported setup.
 */
export function validatePreferences(input: unknown): PreferencesResult {
  if (!isRecord(input)) {
    return failure([{ field: 'preferences', message: 'Provide a preferences object.' }])
  }

  const { currency, reportingTimeZone, dailyLimitMl } = input
  const precision = typeof currency === 'string' ? getCurrencyFractionDigits(currency) : null
  const validZone = isNamedTimeZone(reportingTimeZone)
  const validLimit = isDailyLimit(dailyLimitMl)
  const issues: PreferenceIssue[] = []

  if (precision?.valid !== true) {
    issues.push({ field: 'currency', message: 'Choose an uppercase, supported currency code.' })
  }
  if (!validZone) {
    issues.push({ field: 'reportingTimeZone', message: 'Choose a valid, supported IANA timezone name.' })
  }
  if (!validLimit) {
    issues.push({ field: 'dailyLimitMl', message: 'Daily limit must be a nonnegative safe integer in ml, or null to disable it.' })
  }
  if (typeof currency !== 'string' || precision?.valid !== true || !validZone || !validLimit) {
    return failure(issues)
  }

  return Object.freeze({
    valid: true,
    preferences: Object.freeze({ currency, reportingTimeZone, dailyLimitMl }),
  })
}
