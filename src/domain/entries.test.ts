import { describe, expect, it } from 'vitest'
import { createDrinkEntry, validateDrinkEntry } from './entries'
import type {
  CreateDrinkEntryInput,
  DrinkEntry,
  DrinkEntryValidationField,
  DrinkEntryValidationResult,
  NutritionReference,
} from './types'

// These nutrition rates are test data, not a verified product reference.
function makeReference() {
  return {
    id: 'example-nutrition',
    version: 1,
    sugarGramsPer100Ml: 10.5,
    kcalPer100Ml: 42,
  } satisfies NutritionReference
}

function makeInput() {
  return {
    id: 'example-entry-1',
    consumedAt: '2026-11-07T12:00:00Z',
    quantity: 2,
    servingMl: 330,
    totalPriceMinor: 10000,
    currency: 'BDT',
  } satisfies CreateDrinkEntryInput
}

function makeRecord() {
  const reference = makeReference()
  return {
    ...makeInput(),
    nutrition: {
      referenceId: reference.id,
      referenceVersion: reference.version,
      sugarGramsPer100Ml: reference.sugarGramsPer100Ml,
      kcalPer100Ml: reference.kcalPer100Ml,
    },
  } satisfies DrinkEntry
}

function expectValidEntry(result: DrinkEntryValidationResult): DrinkEntry {
  expect(result.valid).toBe(true)
  if (!('entry' in result)) throw new Error('Expected a valid drink entry.')
  return result.entry
}

function expectIssueFields(
  result: DrinkEntryValidationResult,
  fields: readonly DrinkEntryValidationField[],
) {
  expect(result.valid).toBe(false)
  if (!('issues' in result)) throw new Error('Expected validation issues.')

  // Check the exact fields without depending on message wording or issue order.
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  for (const issue of result.issues) {
    expect(issue.message).toEqual(expect.any(String))
    expect(issue.message.trim()).not.toBe('')
  }
}

const invalidPositiveIntegers = [
  { label: 'zero', value: 0 },
  { label: 'a negative integer', value: -1 },
  { label: 'a fraction', value: 1.5 },
  { label: 'NaN', value: NaN },
  { label: 'positive infinity', value: Infinity },
  { label: 'negative infinity', value: -Infinity },
  { label: 'an unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
  { label: 'a numeric string', value: '2' },
  { label: 'a boolean', value: true },
  { label: 'null', value: null },
  { label: 'a missing value', value: undefined },
]

describe('createDrinkEntry', () => {
  it.each([
    { label: 'an explicitly unknown price', totalPriceMinor: null },
    { label: 'a known free price', totalPriceMinor: 0 },
  ])('preserves $label without substituting another amount', ({ totalPriceMinor }) => {
    const entry = expectValidEntry(createDrinkEntry({ ...makeInput(), totalPriceMinor }, makeReference()))
    expect(entry.totalPriceMinor).toBe(totalPriceMinor)
  })

  it('logs two 330 ml servings with the supplied ID, total price, and nutrition snapshot', () => {
    const entry = expectValidEntry(createDrinkEntry(makeInput(), makeReference()))

    expect(entry).toEqual({
      id: 'example-entry-1',
      consumedAt: '2026-11-07T12:00:00.000Z',
      quantity: 2,
      servingMl: 330,
      totalPriceMinor: 10000,
      currency: 'BDT',
      nutrition: {
        referenceId: 'example-nutrition',
        referenceVersion: 1,
        sugarGramsPer100Ml: 10.5,
        kcalPer100Ml: 42,
      },
    })
  })

  it('leaves the supplied entry details and nutrition reference unchanged and unfrozen', () => {
    const input = makeInput()
    const reference = makeReference()
    const before = structuredClone({ input, reference })

    expectValidEntry(createDrinkEntry(input, reference))

    expect({ input, reference }).toEqual(before)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(reference)).toBe(false)
  })

  it('preserves historical nutrition when the source reference changes later', () => {
    const input = makeInput()
    const reference = makeReference()
    const entry = expectValidEntry(createDrinkEntry(input, reference))

    input.quantity = 3
    reference.id = 'updated-nutrition'
    reference.version = 2
    reference.sugarGramsPer100Ml = 8
    reference.kcalPer100Ml = 32

    expect(entry.quantity).toBe(2)
    expect(entry.nutrition).toEqual({
      referenceId: 'example-nutrition',
      referenceVersion: 1,
      sugarGramsPer100Ml: 10.5,
      kcalPer100Ml: 42,
    })
    expect(entry.nutrition).not.toBe(reference)
  })

  it('freezes both the returned entry and its nutrition snapshot', () => {
    const entry = expectValidEntry(createDrinkEntry(makeInput(), makeReference()))

    expect(Object.isFrozen(entry)).toBe(true)
    expect(Object.isFrozen(entry.nutrition)).toBe(true)
    expect(Reflect.set(entry, 'quantity', 99)).toBe(false)
    expect(Reflect.set(entry.nutrition, 'sugarGramsPer100Ml', 99)).toBe(false)
    expect(entry.quantity).toBe(2)
    expect(entry.nutrition.sugarGramsPer100Ml).toBe(10.5)
  })

  it.each([
    { field: 'id', value: '' },
    { field: 'quantity', value: 0 },
    { field: 'servingMl', value: -1 },
    { field: 'consumedAt', value: '2026-11-07T12:00:00' },
    { field: 'totalPriceMinor', value: 1.5 },
    { field: 'currency', value: 'AAA' },
  ] as const)('returns the $field issue when entry details are invalid', ({ field, value }) => {
    const result = createDrinkEntry({ ...makeInput(), [field]: value }, makeReference())
    expectIssueFields(result, [field])
  })

  it.each([
    { field: 'id', value: '', issue: 'nutrition.referenceId' },
    { field: 'version', value: 0, issue: 'nutrition.referenceVersion' },
    { field: 'sugarGramsPer100Ml', value: -1, issue: 'nutrition.sugarGramsPer100Ml' },
    { field: 'kcalPer100Ml', value: Infinity, issue: 'nutrition.kcalPer100Ml' },
  ] as const)('identifies an invalid nutrition reference $field', ({ field, value, issue }) => {
    const result = createDrinkEntry(makeInput(), { ...makeReference(), [field]: value })
    expectIssueFields(result, [issue])
  })

  it('returns an entry issue for a malformed JavaScript caller instead of throwing', () => {
    // JavaScript callers can bypass the compile-time input type.
    const result = Reflect.apply(createDrinkEntry, undefined, [null, makeReference()])
    expectIssueFields(result, ['entry'])
  })

  it('returns a nutrition issue when a JavaScript caller supplies no reference', () => {
    const result = Reflect.apply(createDrinkEntry, undefined, [makeInput(), null])
    expectIssueFields(result, ['nutrition'])
  })

  it('rejects a missing price rather than assuming the drink was free', () => {
    const withoutPrice: Record<string, unknown> = { ...makeInput() }
    delete withoutPrice.totalPriceMinor
    const result = Reflect.apply(createDrinkEntry, undefined, [withoutPrice, makeReference()])
    expectIssueFields(result, ['totalPriceMinor'])
  })

  it('collects both entry and reference issues when creation fails', () => {
    const result = Reflect.apply(createDrinkEntry, undefined, [
      { ...makeInput(), quantity: 0, totalPriceMinor: undefined },
      { ...makeReference(), version: 0, kcalPer100Ml: -1 },
    ])
    expectIssueFields(result, [
      'quantity', 'totalPriceMinor', 'nutrition.referenceVersion', 'nutrition.kcalPer100Ml',
    ])
  })
})

describe('validateDrinkEntry', () => {
  it('returns a normalized defensive copy without changing or freezing the input', () => {
    const record = makeRecord()
    const before = structuredClone(record)
    const entry = expectValidEntry(validateDrinkEntry(record))

    expect(record).toEqual(before)
    expect(entry).not.toBe(record)
    expect(entry.nutrition).not.toBe(record.nutrition)
    expect(Object.isFrozen(record)).toBe(false)
    expect(Object.isFrozen(record.nutrition)).toBe(false)
    expect(Object.isFrozen(entry)).toBe(true)
    expect(Object.isFrozen(entry.nutrition)).toBe(true)

    record.nutrition.kcalPer100Ml = 1
    expect(entry.nutrition.kcalPer100Ml).toBe(42)
  })

  it('accepts a custom serving size without requiring a preset', () => {
    const entry = expectValidEntry(validateDrinkEntry({ ...makeRecord(), servingMl: 375 }))
    expect(entry.servingMl).toBe(375)
  })

  describe.each(['quantity', 'servingMl'] as const)('%s', field => {
    it.each([1, 330, Number.MAX_SAFE_INTEGER])('accepts the positive safe integer %s', value => {
      const entry = expectValidEntry(validateDrinkEntry({ ...makeRecord(), [field]: value }))
      expect(entry[field]).toBe(value)
    })

    it.each(invalidPositiveIntegers)('rejects $label and identifies the field', ({ value }) => {
      expectIssueFields(validateDrinkEntry({ ...makeRecord(), [field]: value }), [field])
    })
  })

  describe.each(['sugarGramsPer100Ml', 'kcalPer100Ml'] as const)('nutrition.%s', field => {
    it.each([0, 0.5, 10.75])('accepts the finite nonnegative rate %s', value => {
      const record = makeRecord()
      const entry = expectValidEntry(validateDrinkEntry({
        ...record,
        nutrition: { ...record.nutrition, [field]: value },
      }))
      expect(entry.nutrition[field]).toBe(value)
    })

    it.each([
      { label: 'a negative rate', value: -0.1 },
      { label: 'NaN', value: NaN },
      { label: 'positive infinity', value: Infinity },
      { label: 'negative infinity', value: -Infinity },
      { label: 'a numeric string', value: '10' },
      { label: 'a boolean', value: false },
      { label: 'null', value: null },
      { label: 'a missing rate', value: undefined },
    ])('rejects $label and identifies the nutrition field', ({ value }) => {
      const record = makeRecord()
      expectIssueFields(validateDrinkEntry({
        ...record,
        nutrition: { ...record.nutrition, [field]: value },
      }), [`nutrition.${field}`])
    })
  })

  describe('total price in minor currency units', () => {
    it('preserves null as an explicitly unknown price', () => {
      const entry = expectValidEntry(validateDrinkEntry({ ...makeRecord(), totalPriceMinor: null }))
      expect(entry.totalPriceMinor).toBeNull()
    })

    it('rejects an omitted price with the existing totalPriceMinor issue field', () => {
      const withoutPrice: Record<string, unknown> = { ...makeRecord() }
      delete withoutPrice.totalPriceMinor
      expectIssueFields(validateDrinkEntry(withoutPrice), ['totalPriceMinor'])
    })

    it.each([0, 10000, Number.MAX_SAFE_INTEGER])('accepts the safe integer price %s', value => {
      const entry = expectValidEntry(validateDrinkEntry({ ...makeRecord(), totalPriceMinor: value }))
      expect(entry.totalPriceMinor).toBe(value)
    })

    it.each(invalidPositiveIntegers.filter(({ value }) => value !== 0 && value !== null))(
      'rejects $label and identifies totalPriceMinor',
      ({ value }) => {
        expectIssueFields(validateDrinkEntry({ ...makeRecord(), totalPriceMinor: value }), [
          'totalPriceMinor',
        ])
      },
    )
  })

  describe('currency codes', () => {
    it.each(['BDT', 'USD', 'JPY', 'KWD'])('accepts the supported uppercase code %s', currency => {
      const entry = expectValidEntry(validateDrinkEntry({ ...makeRecord(), currency }))
      expect(entry.currency).toBe(currency)
    })

    it.each(['bdt', ' BDT', 'BDT ', 'US', '123', 'AAA', 'ZZZ', '', 123, null, undefined])(
      'rejects the unsupported or malformed code %s and identifies currency',
      currency => {
        expectIssueFields(validateDrinkEntry({ ...makeRecord(), currency }), ['currency'])
      },
    )
  })

  describe('UTC timestamps', () => {
    it.each([
      ['2026-11-07T12:00:00Z', '2026-11-07T12:00:00.000Z'],
      ['2026-11-07T12:00:00+00:00', '2026-11-07T12:00:00.000Z'],
      ['2026-11-07T12:00:00.1Z', '2026-11-07T12:00:00.100Z'],
      ['2026-11-07T12:00:00.12Z', '2026-11-07T12:00:00.120Z'],
      ['2026-11-07T12:00:00.123Z', '2026-11-07T12:00:00.123Z'],
      ['1970-01-01T00:00:00Z', '1970-01-01T00:00:00.000Z'],
      ['0099-01-01T00:00:00Z', '0099-01-01T00:00:00.000Z'],
      ['2024-02-29T12:00:00Z', '2024-02-29T12:00:00.000Z'],
      ['2000-02-29T12:00:00Z', '2000-02-29T12:00:00.000Z'],
    ])('normalizes the valid timestamp %s to %s', (consumedAt, expected) => {
      const entry = expectValidEntry(validateDrinkEntry({ ...makeRecord(), consumedAt }))
      expect(entry.consumedAt).toBe(expected)
    })

    it.each([
      { label: 'February 29 in a non-leap year', value: '2026-02-29T00:00:00Z' },
      { label: 'February 29 in the non-leap century 1900', value: '1900-02-29T00:00:00Z' },
      { label: 'February 30', value: '2024-02-30T00:00:00Z' },
      { label: 'April 31', value: '2026-04-31T00:00:00Z' },
      { label: 'month 13', value: '2026-13-01T00:00:00Z' },
      { label: 'month zero', value: '2026-00-01T00:00:00Z' },
      { label: 'day zero', value: '2026-11-00T00:00:00Z' },
      { label: 'hour 24', value: '2026-11-07T24:00:00Z' },
      { label: 'minute 60', value: '2026-11-07T12:60:00Z' },
      { label: 'a leap second', value: '2026-11-07T12:00:60Z' },
      { label: 'a date without a time', value: '2026-11-07' },
      { label: 'a time without a timezone', value: '2026-11-07T12:00:00' },
      { label: 'a non-UTC timezone offset', value: '2026-11-07T12:00:00+06:00' },
      { label: 'an unknown offset marked -00:00', value: '2026-11-07T12:00:00-00:00' },
      { label: 'a time without seconds', value: '2026-11-07T12:00Z' },
      { label: 'more than three fractional digits', value: '2026-11-07T12:00:00.1234Z' },
      { label: 'surrounding whitespace', value: ' 2026-11-07T12:00:00Z ' },
      { label: 'an empty timestamp', value: '' },
      { label: 'a numeric timestamp', value: 0 },
      { label: 'null', value: null },
      { label: 'a missing timestamp', value: undefined },
    ])('rejects $label and identifies consumedAt', ({ value }) => {
      expectIssueFields(validateDrinkEntry({ ...makeRecord(), consumedAt: value }), ['consumedAt'])
    })
  })

  describe.each(['id', 'nutrition.referenceId'] as const)('%s', field => {
    it.each(['', ' ', ' id', 'id ', 42, null, undefined])(
      'rejects the missing or malformed identifier %s',
      value => {
        const record = makeRecord()
        const candidate = field === 'id'
          ? { ...record, id: value }
          : { ...record, nutrition: { ...record.nutrition, referenceId: value } }
        expectIssueFields(validateDrinkEntry(candidate), [field])
      },
    )
  })

  it.each(invalidPositiveIntegers)('rejects $label as a nutrition reference version', ({ value }) => {
    const record = makeRecord()
    expectIssueFields(validateDrinkEntry({
      ...record,
      nutrition: { ...record.nutrition, referenceVersion: value },
    }), ['nutrition.referenceVersion'])
  })

  it.each([null, undefined, [], 'record', 42, true])(
    'rejects a non-record input %s with an entry issue',
    value => {
      expectIssueFields(validateDrinkEntry(value), ['entry'])
    },
  )

  it.each([null, undefined, [], 'nutrition', 42, true])(
    'rejects a malformed or missing snapshot %s with a nutrition issue',
    nutrition => {
      expectIssueFields(validateDrinkEntry({ ...makeRecord(), nutrition }), ['nutrition'])
    },
  )

  it('reports all required fields for an empty record', () => {
    expectIssueFields(validateDrinkEntry({}), [
      'id', 'consumedAt', 'quantity', 'servingMl', 'totalPriceMinor', 'currency', 'nutrition',
    ])
  })

  it('reports all missing fields in an empty nutrition snapshot', () => {
    expectIssueFields(validateDrinkEntry({ ...makeRecord(), nutrition: {} }), [
      'nutrition.referenceId', 'nutrition.referenceVersion',
      'nutrition.sugarGramsPer100Ml', 'nutrition.kcalPer100Ml',
    ])
  })

  it('collects several field issues from one invalid record', () => {
    expectIssueFields(validateDrinkEntry({
      ...makeRecord(),
      quantity: 0,
      consumedAt: '2026-02-30T12:00:00Z',
      currency: 'bdt',
    }), ['quantity', 'consumedAt', 'currency'])
  })
})
