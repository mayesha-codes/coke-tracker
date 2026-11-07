import { describe, expect, it } from 'vitest'
import { formatMoney, getCurrencyFractionDigits, validateMoney } from './money'
import type {
  CurrencyFractionDigitsResult,
  MoneyFormattingResult,
  MoneyValidationResult,
} from './money'

function expectIssueFields(
  result: MoneyValidationResult | CurrencyFractionDigitsResult | MoneyFormattingResult,
  expected: readonly string[],
) {
  expect(result.valid).toBe(false)
  if (!('issues' in result)) throw new Error('Expected validation issues.')

  expect(result.issues.map(issue => issue.field).sort()).toEqual([...expected].sort())
  for (const issue of result.issues) expect(issue.message.trim()).not.toBe('')
}

function formattedMoney(amountMinor: number | null, currency: string, locale = 'en-US') {
  const result = formatMoney({ amountMinor, currency }, locale)
  expect(result.valid).toBe(true)
  if (!('formatted' in result)) throw new Error('Expected formatted money.')

  // Intl may use nonbreaking spaces between the currency code and the number.
  return result.formatted?.replace(/\s/g, ' ') ?? null
}

describe('validateMoney', () => {
  it.each([0, 1, 10000, Number.MAX_SAFE_INTEGER])(
    'accepts the known nonnegative safe integer amount %s',
    amountMinor => {
      expect(validateMoney({ amountMinor, currency: 'BDT' })).toEqual({
        valid: true,
        money: { amountMinor, currency: 'BDT' },
      })
    },
  )

  it('keeps a known zero price distinct from an explicitly unknown price', () => {
    expect(validateMoney({ amountMinor: 0, currency: 'BDT' })).toEqual({
      valid: true, money: { amountMinor: 0, currency: 'BDT' },
    })
    expect(validateMoney({ amountMinor: null, currency: 'BDT' })).toEqual({
      valid: true, money: { amountMinor: null, currency: 'BDT' },
    })
  })

  it.each([
    { label: 'a negative amount', value: -1 },
    { label: 'a fractional minor unit', value: 0.5 },
    { label: 'an unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
    { label: 'NaN', value: NaN },
    { label: 'positive infinity', value: Infinity },
    { label: 'negative infinity', value: -Infinity },
    { label: 'a numeric string', value: '100' },
    { label: 'an empty string', value: '' },
    { label: 'a boolean', value: false },
    { label: 'undefined', value: undefined },
  ])('rejects $label and identifies amountMinor', ({ value }) => {
    expectIssueFields(validateMoney({ amountMinor: value, currency: 'BDT' }), ['amountMinor'])
  })

  it('rejects a missing amount instead of treating it as a free drink', () => {
    expectIssueFields(validateMoney({ currency: 'BDT' }), ['amountMinor'])
  })

  it.each(['BDT', 'USD', 'JPY', 'KWD'])('preserves the supported currency %s', currency => {
    expect(validateMoney({ amountMinor: 100, currency })).toEqual({
      valid: true, money: { amountMinor: 100, currency },
    })
  })

  it.each(['bdt', ' BDT', 'BDT ', 'US', '123', 'AAA', 'ZZZ', '', 123, null, undefined])(
    'rejects the unsupported or malformed currency %s',
    currency => {
      expectIssueFields(validateMoney({ amountMinor: 100, currency }), ['currency'])
    },
  )

  it('requires a valid currency even when the amount is unknown', () => {
    expectIssueFields(validateMoney({ amountMinor: null, currency: 'AAA' }), ['currency'])
  })

  it.each([null, undefined, [], 100, '100 BDT', true])(
    'rejects the malformed money record %s',
    value => {
      expectIssueFields(validateMoney(value), ['money'])
    },
  )

  it('reports both missing fields for an empty money object', () => {
    expectIssueFields(validateMoney({}), ['amountMinor', 'currency'])
  })

  it('returns a frozen independent copy without modifying or freezing the input', () => {
    const input = { amountMinor: 100, currency: 'BDT' }
    const result = validateMoney(input)
    expect(result.valid).toBe(true)
    if (!('money' in result)) throw new Error('Expected valid money.')

    expect(result.money).not.toBe(input)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(result.money)).toBe(true)
    expect(Reflect.set(result.money, 'amountMinor', 999)).toBe(false)
    expect(input).toEqual({ amountMinor: 100, currency: 'BDT' })

    input.currency = 'USD'
    input.amountMinor = 999
    expect(result.money).toEqual({ amountMinor: 100, currency: 'BDT' })
  })
})

describe('getCurrencyFractionDigits', () => {
  it.each([
    ['BDT', 2], ['USD', 2], ['JPY', 0], ['KWD', 3],
  ] as const)('uses %s currency precision of %s decimal places', (currency, fractionDigits) => {
    expect(getCurrencyFractionDigits(currency)).toEqual({ valid: true, fractionDigits })
  })

  it.each(['AAA', 'bdt', '', 'USD '])('rejects invalid currency %s before resolving precision', currency => {
    expectIssueFields(getCurrencyFractionDigits(currency), ['currency'])
  })
})

describe('formatMoney', () => {
  it.each([
    ['BDT', 10000, 'BDT 100.00'],
    ['USD', 10000, 'USD 100.00'],
    ['JPY', 10000, 'JPY 10,000'],
    ['KWD', 10000, 'KWD 10.000'],
    ['BDT', 1, 'BDT 0.01'],
    ['USD', 1, 'USD 0.01'],
    ['JPY', 1, 'JPY 1'],
    ['KWD', 1, 'KWD 0.001'],
  ] as const)('formats %s amount %s using its own minor units', (currency, amountMinor, expected) => {
    expect(formattedMoney(amountMinor, currency)).toBe(expected)
  })

  it.each([
    ['BDT', 'BDT 0.00'], ['USD', 'USD 0.00'], ['JPY', 'JPY 0'], ['KWD', 'KWD 0.000'],
  ] as const)('formats a known zero price in %s', (currency, expected) => {
    expect(formattedMoney(0, currency)).toBe(expected)
  })

  it('returns null for an unknown price instead of formatting zero', () => {
    expect(formatMoney({ amountMinor: null, currency: 'BDT' })).toEqual({
      valid: true, formatted: null,
    })
  })

  it.each([
    ['BDT', 'BDT 90,071,992,547,409.91'],
    ['USD', 'USD 90,071,992,547,409.91'],
    ['JPY', 'JPY 9,007,199,254,740,991'],
    ['KWD', 'KWD 9,007,199,254,740.991'],
  ] as const)('preserves every minor unit of the largest safe integer in %s', (currency, expected) => {
    expect(formattedMoney(Number.MAX_SAFE_INTEGER, currency)).toBe(expected)
  })

  it('uses an explicitly supplied locale for grouping and decimal separators', () => {
    expect(formattedMoney(123456, 'USD', 'de-DE')).toBe('1.234,56 USD')
  })

  it('defaults to the explicit en-BD locale instead of the machine locale', () => {
    expect(formatMoney({ amountMinor: 10000, currency: 'BDT' })).toEqual(
      formatMoney({ amountMinor: 10000, currency: 'BDT' }, 'en-BD'),
    )
  })

  it('keeps otherwise equal BDT and USD amounts in their original currencies', () => {
    expect(formattedMoney(10000, 'BDT')).toBe('BDT 100.00')
    expect(formattedMoney(10000, 'USD')).toBe('USD 100.00')
  })

  it.each(['', 'en_US', 'not a locale', 'zz-ZZ'])('reports unsupported or malformed locale %s', locale => {
    expectIssueFields(formatMoney({ amountMinor: 100, currency: 'BDT' }, locale), ['locale'])
  })

  it('validates the locale even when the price is unknown', () => {
    expectIssueFields(formatMoney({ amountMinor: null, currency: 'BDT' }, 'en_US'), ['locale'])
  })

  it('validates money again instead of trusting a malformed JavaScript caller', () => {
    const result = Reflect.apply(formatMoney, undefined, [{ currency: 'BDT' }, 'en-US'])
    expectIssueFields(result, ['amountMinor'])
  })

  it('returns amount, currency, and locale issues together when they are all invalid', () => {
    const result = formatMoney({ amountMinor: -1, currency: 'AAA' }, 'en_US')
    expectIssueFields(result, ['amountMinor', 'currency', 'locale'])
  })

  it('does not mutate or freeze the money supplied for formatting', () => {
    const money = { amountMinor: 10000, currency: 'BDT' }
    formatMoney(money)
    expect(money).toEqual({ amountMinor: 10000, currency: 'BDT' })
    expect(Object.isFrozen(money)).toBe(false)
  })
})
