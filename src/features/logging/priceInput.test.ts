import { describe, expect, expectTypeOf, it } from 'vitest'
import { parsePriceInput } from './priceInput'
import type { PriceInput, PriceInputResult } from './priceInput'

function moneyFrom(result: PriceInputResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid price input.')
  return result.money
}

function expectIssues(result: PriceInputResult, fields: readonly string[]) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected price input issues.')
  expect(result).not.toHaveProperty('money')
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  for (const issue of result.issues) expect(issue.message.trim()).not.toBe('')
}

function parseUnknown(input: unknown, currency: unknown = 'BDT'): PriceInputResult {
  return Reflect.apply(parsePriceInput, undefined, [input, currency])
}

describe('parsePriceInput', () => {
  it.each([
    { currency: 'BDT', text: '100.50', amountMinor: 10050 },
    { currency: 'USD', text: '12.34', amountMinor: 1234 },
    { currency: 'JPY', text: '100', amountMinor: 100 },
    { currency: 'KWD', text: '1.234', amountMinor: 1234 },
    { currency: 'BDT', text: '1', amountMinor: 100 },
    { currency: 'USD', text: '1.2', amountMinor: 120 },
    { currency: 'KWD', text: '1.2', amountMinor: 1200 },
    { currency: 'KWD', text: '0.001', amountMinor: 1 },
  ])('converts $text in $currency into exactly $amountMinor minor units', ({ currency, text, amountMinor }) => {
    expect(moneyFrom(parsePriceInput({ mode: 'known', amountText: text }, currency)))
      .toEqual({ amountMinor, currency })
  })

  it('defaults to BDT when no currency is supplied', () => {
    expect(moneyFrom(parsePriceInput({ mode: 'known', amountText: '100.50' })))
      .toEqual({ amountMinor: 10050, currency: 'BDT' })
  })

  it.each(['0', '0.00', '000.00'])('preserves the known zero price %s instead of making it unknown', amountText => {
    expect(moneyFrom(parsePriceInput({ mode: 'known', amountText })))
      .toEqual({ amountMinor: 0, currency: 'BDT' })
  })

  it('normalizes surrounding whitespace and leading zeroes without changing the input', () => {
    const input = { mode: 'known', amountText: '  00100.50  ' } as const
    expect(moneyFrom(parsePriceInput(input))).toEqual({ amountMinor: 10050, currency: 'BDT' })
    expect(input).toEqual({ mode: 'known', amountText: '  00100.50  ' })
    expect(Object.isFrozen(input)).toBe(false)
  })

  it('creates null only when the user explicitly chooses an unknown price', () => {
    expect(moneyFrom(parsePriceInput({ mode: 'unknown' })))
      .toEqual({ amountMinor: null, currency: 'BDT' })
  })

  it('ignores a stale price field after the user explicitly chooses unknown', () => {
    expect(moneyFrom(parseUnknown({ mode: 'unknown', amountText: '12.34' })))
      .toEqual({ amountMinor: null, currency: 'BDT' })
  })

  it.each([
    { label: 'a blank price', value: '' },
    { label: 'whitespace', value: '   ' },
    { label: 'a negative price', value: '-1' },
    { label: 'a plus sign', value: '+1' },
    { label: 'an exponent', value: '1e2' },
    { label: 'a grouping comma', value: '1,000.00' },
    { label: 'an internal space', value: '1 000' },
    { label: 'a leading decimal point', value: '.50' },
    { label: 'a trailing decimal point', value: '1.' },
    { label: 'a nonfinite text value', value: 'Infinity' },
    { label: 'a number instead of price text', value: 100 },
    { label: 'null price text', value: null },
    { label: 'missing price text', value: undefined },
  ])('rejects $label without substituting zero', ({ value }) => {
    expectIssues(parseUnknown({ mode: 'known', amountText: value }), ['priceText'])
  })

  it.each([
    { currency: 'BDT', text: '1.001' },
    { currency: 'USD', text: '1.000' },
    { currency: 'JPY', text: '1.0' },
    { currency: 'KWD', text: '1.0001' },
  ])('rejects excessive precision in $currency price $text, including trailing zeroes', ({ currency, text }) => {
    expectIssues(parsePriceInput({ mode: 'known', amountText: text }, currency), ['priceText'])
  })

  it.each([
    { currency: 'BDT', text: '90071992547409.91' },
    { currency: 'USD', text: '90071992547409.91' },
    { currency: 'JPY', text: '9007199254740991' },
    { currency: 'KWD', text: '9007199254740.991' },
  ])('preserves every minor unit at the largest safe amount in $currency', ({ currency, text }) => {
    expect(moneyFrom(parsePriceInput({ mode: 'known', amountText: text }, currency)).amountMinor)
      .toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each([
    { currency: 'BDT', text: '90071992547409.92' },
    { currency: 'USD', text: '90071992547409.92' },
    { currency: 'JPY', text: '9007199254740992' },
    { currency: 'KWD', text: '9007199254740.992' },
    { currency: 'BDT', text: '999999999999999999999999999999' },
  ])('rejects the unsafe amount $text in $currency before Number conversion', ({ currency, text }) => {
    expectIssues(parsePriceInput({ mode: 'known', amountText: text }, currency), ['priceText'])
  })

  it.each(['bdt', 'AAA', 'ZZZ', ' BDT', 'US', '', null, 123])(
    'rejects invalid currency %s even when the price is explicitly unknown',
    currency => {
      expectIssues(parseUnknown({ mode: 'unknown' }, currency), ['currency'])
    },
  )

  it('reports both an invalid currency and blank known-price text', () => {
    expectIssues(parsePriceInput({ mode: 'known', amountText: '' }, 'AAA'), ['currency', 'priceText'])
  })

  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'an array', value: [] },
    { label: 'an empty object', value: {} },
    { label: 'a null mode', value: { mode: null } },
    { label: 'an unsupported mode', value: { mode: 'free' } },
    { label: 'a bare zero', value: 0 },
  ])('rejects $label rather than inferring known or unknown price', ({ value }) => {
    expectIssues(parseUnknown(value), ['priceMode'])
  })

  it('rejects missing arguments instead of creating a free or unknown price', () => {
    const result = Reflect.apply(parsePriceInput, undefined, [])
    expectIssues(result, ['priceMode'])
  })

  it('returns a frozen independent money value and leaves the draft untouched', () => {
    const input: PriceInput = { mode: 'known', amountText: '10.50' }
    const before = structuredClone(input)
    const money = moneyFrom(parsePriceInput(input))
    expect(input).toEqual(before)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(money)).toBe(true)
    expect(Reflect.set(money, 'amountMinor', 0)).toBe(false)
    expect(money.amountMinor).toBe(1050)
  })

  it('does not multiply an already-total price by an unrelated quantity field', () => {
    const money = moneyFrom(parseUnknown({ mode: 'known', amountText: '100.50', quantity: 5 }))
    expect(money.amountMinor).toBe(10050)
  })

  it('keeps price modes and returned money readonly in TypeScript', () => {
    const checkContracts = (input: PriceInput, result: PriceInputResult) => {
      // @ts-expect-error The caller's selected price mode is readonly.
      input.mode = 'unknown'
      if (result.valid === true) {
        // @ts-expect-error Validated money is readonly.
        result.money.amountMinor = 0
      }
    }
    expectTypeOf(checkContracts).toBeFunction()
  })
})
