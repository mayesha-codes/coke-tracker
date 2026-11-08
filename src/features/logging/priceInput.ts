import { getCurrencyFractionDigits, validateMoney } from '../../domain/money'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type { CurrencyCode, MoneyAmount } from '../../domain/types'
import { isRecord } from '../../domain/validation'

/** Only an explicit unknown choice creates an unknown price. */
export type PriceInput =
  | { readonly mode: 'known'; readonly amountText: string }
  | { readonly mode: 'unknown' }

export interface PriceInputIssue {
  readonly field: 'priceMode' | 'priceText' | 'currency'
  readonly message: string
}

export type PriceInputResult =
  | { readonly valid: true; readonly money: MoneyAmount }
  | { readonly valid: false; readonly issues: readonly PriceInputIssue[] }

function failure(issues: readonly PriceInputIssue[]): PriceInputResult {
  return Object.freeze({
    valid: false,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
  })
}

/**
 * Parse a total price for the entire entry, never a price per serving.
 * Known prices use decimal digits with an optional dot and fractional digits.
 * Surrounding whitespace is trimmed; grouping separators, signs, and exponents
 * are rejected. No floating-point multiplication or currency conversion occurs.
 */
export function parsePriceInput(
  input: PriceInput,
  currency: CurrencyCode = DEFAULT_TRACKING_SETTINGS.currency,
): PriceInputResult {
  const precision = getCurrencyFractionDigits(currency)
  const issues: PriceInputIssue[] = []
  if (precision.valid === false) {
    issues.push(...precision.issues.map(issue => ({ field: 'currency' as const, message: issue.message })))
  }

  if (!isRecord(input) || (input.mode !== 'known' && input.mode !== 'unknown')) {
    issues.push({ field: 'priceMode', message: 'Choose whether the total price is known or unknown.' })
    return failure(issues)
  }

  let amountMinor: number | null = null
  if (input.mode === 'known') {
    const text = typeof input.amountText === 'string' ? input.amountText.trim() : ''
    if (!/^\d+(?:\.\d+)?$/.test(text)) {
      issues.push({
        field: 'priceText',
        message: 'Enter a nonnegative total price using digits and an optional decimal point.',
      })
    } else if (precision.valid === true) {
      const [whole, fraction = ''] = text.split('.')
      if (fraction.length > precision.fractionDigits) {
        issues.push({
          field: 'priceText',
          message: `This currency allows at most ${precision.fractionDigits} decimal places.`,
        })
      } else {
        // Concatenation preserves every decimal digit; BigInt checks the exact amount
        // before converting to the domain's safe-integer Number representation.
        const minor = BigInt(whole + fraction.padEnd(precision.fractionDigits, '0'))
        if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
          issues.push({ field: 'priceText', message: 'The total price exceeds the safe integer range.' })
        } else {
          amountMinor = Number(minor)
        }
      }
    }
  }

  if (issues.length > 0) return failure(issues)

  const validated = validateMoney({ amountMinor, currency })
  if (validated.valid === false) {
    return failure(validated.issues.map(issue => ({
      field: issue.field === 'currency' ? 'currency' : 'priceText',
      message: issue.message,
    })))
  }
  return Object.freeze({ valid: true, money: validated.money })
}
