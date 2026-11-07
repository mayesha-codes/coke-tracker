import type { CurrencyCode, MoneyAmount } from './types'
import { isRecord } from './validation'

export type MoneyValidationField = 'money' | 'amountMinor' | 'currency'

export interface MoneyValidationIssue {
  readonly field: MoneyValidationField
  readonly message: string
}

export type MoneyValidationResult =
  | { readonly valid: true; readonly money: MoneyAmount }
  | { readonly valid: false; readonly issues: readonly MoneyValidationIssue[] }

export type CurrencyFractionDigitsResult =
  | { readonly valid: true; readonly fractionDigits: number }
  | { readonly valid: false; readonly issues: readonly MoneyValidationIssue[] }

export interface MoneyFormattingIssue {
  readonly field: MoneyValidationField | 'locale'
  readonly message: string
}

export type MoneyFormattingResult =
  | { readonly valid: true; readonly formatted: string | null }
  | { readonly valid: false; readonly issues: readonly MoneyFormattingIssue[] }

function isMinorUnitAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) &&
    Intl.supportedValuesOf('currency').includes(value)
}

function isSupportedLocale(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false

  try {
    return Intl.NumberFormat.supportedLocalesOf([value]).length === 1
  } catch {
    return false
  }
}

/** Validate one amount/currency pair and return a frozen defensive copy. */
export function validateMoney(input: unknown): MoneyValidationResult {
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ field: 'money', message: 'Provide a money amount and currency object.' }],
    }
  }

  const { amountMinor, currency } = input
  const validAmount = amountMinor === null || isMinorUnitAmount(amountMinor)
  const validCurrency = isCurrencyCode(currency)
  const issues: MoneyValidationIssue[] = []

  if (!validAmount) {
    issues.push({
      field: 'amountMinor',
      message: 'Amount must be a nonnegative safe integer, or null for an explicitly unknown price.',
    })
  }
  if (!validCurrency) {
    issues.push({ field: 'currency', message: 'Provide an uppercase, supported currency code.' })
  }
  if (!validAmount || !validCurrency) return { valid: false, issues }

  return { valid: true, money: Object.freeze({ amountMinor, currency }) }
}

/** Resolve currency precision through Intl; currencies do not all use two decimal places. */
export function getCurrencyFractionDigits(currency: CurrencyCode): CurrencyFractionDigitsResult {
  if (!isCurrencyCode(currency)) {
    return {
      valid: false,
      issues: [{ field: 'currency', message: 'Provide an uppercase, supported currency code.' }],
    }
  }

  const fractionDigits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits

  if (fractionDigits === undefined) {
    return {
      valid: false,
      issues: [{ field: 'currency', message: 'Currency decimal precision is unavailable.' }],
    }
  }

  return { valid: true, fractionDigits }
}

/**
 * Insert a decimal point into the integer's exact digits instead of dividing a Number.
 * For example, 9007199254740991 BDT minor units must retain its final .91.
 */
function toExactDecimal(amountMinor: number, fractionDigits: number): Intl.StringNumericLiteral {
  const digits = String(amountMinor).padStart(fractionDigits + 1, '0')
  const decimal = fractionDigits === 0
    ? digits
    : `${digits.slice(0, -fractionDigits)}.${digits.slice(-fractionDigits)}`

  // The input has already been checked as a nonnegative safe integer.
  return decimal as Intl.StringNumericLiteral
}

/**
 * Format one currency without conversion. null stays unknown; zero formats as zero.
 * The explicit default locale prevents dependence on the machine's default locale.
 */
export function formatMoney(money: MoneyAmount, locale = 'en-BD'): MoneyFormattingResult {
  const result = validateMoney(money)
  const validLocale = isSupportedLocale(locale)
  const issues: MoneyFormattingIssue[] = []

  if (result.valid === false) issues.push(...result.issues)
  if (!validLocale) {
    issues.push({ field: 'locale', message: 'Provide a valid, supported number-formatting locale.' })
  }
  if (result.valid === false || !validLocale) return { valid: false, issues }

  const { amountMinor, currency } = result.money
  if (amountMinor === null) return { valid: true, formatted: null }

  const precision = getCurrencyFractionDigits(currency)
  if (precision.valid === false) return precision

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  })

  return {
    valid: true,
    formatted: formatter.format(toExactDecimal(amountMinor, precision.fractionDigits)),
  }
}
