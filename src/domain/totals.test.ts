import { describe, expect, it } from 'vitest'
import { calculateConsumptionTotals, calculateEntryTotals } from './totals'
import type { TotalsResult } from './totals'
import type { DrinkEntry } from './types'

// These saved nutrition rates are illustrative test data, not a product reference.
function makeEntry(overrides: Partial<DrinkEntry> = {}) {
  return {
    id: 'example-entry',
    consumedAt: '2026-11-07T12:00:00.000Z',
    quantity: 2,
    servingMl: 330,
    nutrition: {
      referenceId: 'example-nutrition',
      referenceVersion: 1,
      sugarGramsPer100Ml: 10.5,
      kcalPer100Ml: 42,
    },
    totalPriceMinor: 10000,
    currency: 'BDT',
    ...overrides,
  } satisfies DrinkEntry
}

function totalsFrom(result: TotalsResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected valid consumption totals.')
  return result.totals
}

function expectIssueFields(result: TotalsResult, fields: readonly string[], entryIndex: number | null) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected totals validation issues.')

  // A failed calculation must not expose apparently complete partial totals.
  expect('totals' in result).toBe(false)
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  for (const issue of result.issues) {
    expect(issue.entryIndex).toBe(entryIndex)
    expect(issue.message.trim()).not.toBe('')
  }
}

// Reflect.apply represents malformed JavaScript callers without weakening the public types.
function calculateUnknownEntry(input: unknown): TotalsResult {
  return Reflect.apply(calculateEntryTotals, undefined, [input])
}

function calculateUnknownEntries(input: unknown): TotalsResult {
  return Reflect.apply(calculateConsumptionTotals, undefined, [input])
}

describe('single-entry consumption totals', () => {
  it('counts one record containing two 330 ml drinks and adds its total price only once', () => {
    const totals = totalsFrom(calculateEntryTotals(makeEntry()))

    expect(totals.entryCount).toBe(1)
    expect(totals.drinkCount).toBe(2)
    expect(totals.volumeMl).toBe(660)
    expect(totals.sugarGrams).toBeCloseTo(69.3, 10)
    expect(totals.kcal).toBeCloseTo(277.2, 10)
    expect(totals.spendingByCurrency).toEqual([
      { currency: 'BDT', knownAmountMinor: 10000, unknownPriceEntryCount: 0 },
    ])
    expect(totals.unknownPriceEntryCount).toBe(0)
  })

  it('keeps fractional nutrition estimates without rounding them for display', () => {
    const entry = makeEntry({
      quantity: 1,
      servingMl: 375,
      nutrition: {
        ...makeEntry().nutrition,
        sugarGramsPer100Ml: 0.01,
        kcalPer100Ml: 0.02,
      },
    })
    const totals = totalsFrom(calculateEntryTotals(entry))

    expect(totals.volumeMl).toBe(375)
    expect(totals.sugarGrams).toBeCloseTo(0.0375, 12)
    expect(totals.kcal).toBeCloseTo(0.075, 12)
  })

  it('counts an unknown price once for an entry containing several drinks', () => {
    const totals = totalsFrom(calculateEntryTotals(makeEntry({ quantity: 5, totalPriceMinor: null })))

    expect(totals.entryCount).toBe(1)
    expect(totals.drinkCount).toBe(5)
    expect(totals.unknownPriceEntryCount).toBe(1)
    expect(totals.spendingByCurrency).toEqual([
      { currency: 'BDT', knownAmountMinor: 0, unknownPriceEntryCount: 1 },
    ])
  })

  it('keeps a known free price complete rather than counting it as unknown', () => {
    const totals = totalsFrom(calculateEntryTotals(makeEntry({ totalPriceMinor: 0 })))

    expect(totals.unknownPriceEntryCount).toBe(0)
    expect(totals.spendingByCurrency).toEqual([
      { currency: 'BDT', knownAmountMinor: 0, unknownPriceEntryCount: 0 },
    ])
  })

  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'an array', value: [] },
    { label: 'a string', value: 'entry' },
    { label: 'a number', value: 42 },
  ])('rejects $label as a malformed entry', ({ value }) => {
    expectIssueFields(calculateUnknownEntry(value), ['entry'], null)
  })

  it('returns the existing validation field for a missing price', () => {
    const entry: Record<string, unknown> = { ...makeEntry() }
    delete entry.totalPriceMinor

    expectIssueFields(calculateUnknownEntry(entry), ['totalPriceMinor'], null)
  })

  it('rejects an unsafe quantity using the existing quantity issue field', () => {
    expectIssueFields(calculateEntryTotals(makeEntry({ quantity: Number.MAX_SAFE_INTEGER + 1 })), [
      'quantity',
    ], null)
  })

  it('rejects an unsafe volume product even when each input integer is safe', () => {
    expectIssueFields(calculateEntryTotals(makeEntry({
      quantity: Number.MAX_SAFE_INTEGER,
      servingMl: 2,
    })), ['totalMl'], null)
  })

  it('rejects invalid saved nutrition with its existing field name', () => {
    expectIssueFields(calculateEntryTotals(makeEntry({
      nutrition: { ...makeEntry().nutrition, sugarGramsPer100Ml: NaN },
    })), ['nutrition.sugarGramsPer100Ml'], null)
  })

  it.each([
    { rate: 'sugarGramsPer100Ml', field: 'sugarGrams' },
    { rate: 'kcalPer100Ml', field: 'kcal' },
  ] as const)('rejects a nonfinite $field estimate', ({ rate, field }) => {
    expectIssueFields(calculateEntryTotals(makeEntry({
      quantity: 1,
      servingMl: 1000,
      nutrition: { ...makeEntry().nutrition, [rate]: Number.MAX_VALUE },
    })), [field], null)
  })

  it('accepts the largest safe count and volume when its estimates remain finite', () => {
    const totals = totalsFrom(calculateEntryTotals(makeEntry({
      quantity: Number.MAX_SAFE_INTEGER,
      servingMl: 1,
      totalPriceMinor: 0,
    })))

    expect(totals.drinkCount).toBe(Number.MAX_SAFE_INTEGER)
    expect(totals.volumeMl).toBe(Number.MAX_SAFE_INTEGER)
    expect(Number.isFinite(totals.sugarGrams)).toBe(true)
    expect(Number.isFinite(totals.kcal)).toBe(true)
  })
})

describe('multiple-entry consumption totals', () => {
  it('combines quantities and serving sizes using each entry’s own saved nutrition rates', () => {
    const entries = [
      makeEntry({ id: 'two-cans' }),
      makeEntry({
        id: 'one-bottle',
        quantity: 1,
        servingMl: 500,
        totalPriceMinor: null,
        nutrition: {
          referenceId: 'different-example-nutrition',
          referenceVersion: 2,
          sugarGramsPer100Ml: 8,
          kcalPer100Ml: 32,
        },
      }),
    ]
    const totals = totalsFrom(calculateConsumptionTotals(entries))

    expect(totals.entryCount).toBe(2)
    expect(totals.drinkCount).toBe(3)
    expect(totals.volumeMl).toBe(1160)
    expect(totals.sugarGrams).toBeCloseTo(109.3, 10)
    expect(totals.kcal).toBeCloseTo(437.2, 10)
    expect(totals.unknownPriceEntryCount).toBe(1)
    expect(totals.spendingByCurrency).toEqual([
      { currency: 'BDT', knownAmountMinor: 10000, unknownPriceEntryCount: 1 },
    ])
  })

  it('keeps BDT, USD, JPY, and KWD integer subtotals separate and sorts currency rows', () => {
    const entries = [
      makeEntry({ id: 'kwd', currency: 'KWD', totalPriceMinor: 1000 }),
      makeEntry({ id: 'usd', currency: 'USD', totalPriceMinor: 200 }),
      makeEntry({ id: 'jpy', currency: 'JPY', totalPriceMinor: 300 }),
      makeEntry({ id: 'bdt', currency: 'BDT', totalPriceMinor: 400 }),
    ]
    const totals = totalsFrom(calculateConsumptionTotals(entries))

    expect(totals.spendingByCurrency).toEqual([
      { currency: 'BDT', knownAmountMinor: 400, unknownPriceEntryCount: 0 },
      { currency: 'JPY', knownAmountMinor: 300, unknownPriceEntryCount: 0 },
      { currency: 'KWD', knownAmountMinor: 1000, unknownPriceEntryCount: 0 },
      { currency: 'USD', knownAmountMinor: 200, unknownPriceEntryCount: 0 },
    ])
    expect(entries.map(entry => entry.currency)).toEqual(['KWD', 'USD', 'JPY', 'BDT'])
  })

  it('reports unknown-only currencies separately from known free entries', () => {
    const totals = totalsFrom(calculateConsumptionTotals([
      makeEntry({ id: 'unknown-bdt-1', quantity: 5, totalPriceMinor: null }),
      makeEntry({ id: 'unknown-bdt-2', quantity: 2, totalPriceMinor: null }),
      makeEntry({ id: 'unknown-jpy', currency: 'JPY', totalPriceMinor: null }),
      makeEntry({ id: 'free-usd', currency: 'USD', totalPriceMinor: 0 }),
    ]))

    expect(totals.unknownPriceEntryCount).toBe(3)
    expect(totals.spendingByCurrency).toEqual([
      { currency: 'BDT', knownAmountMinor: 0, unknownPriceEntryCount: 2 },
      { currency: 'JPY', knownAmountMinor: 0, unknownPriceEntryCount: 1 },
      { currency: 'USD', knownAmountMinor: 0, unknownPriceEntryCount: 0 },
    ])
  })

  it('returns zero totals and no currency rows for an empty selection', () => {
    expect(totalsFrom(calculateConsumptionTotals([]))).toEqual({
      entryCount: 0,
      drinkCount: 0,
      volumeMl: 0,
      sugarGrams: 0,
      kcal: 0,
      spendingByCurrency: [],
      unknownPriceEntryCount: 0,
    })
  })

  it('counts the supplied records without filtering dates or silently deduplicating IDs', () => {
    const totals = totalsFrom(calculateConsumptionTotals([
      makeEntry({ consumedAt: '1970-01-01T00:00:00Z' }),
      makeEntry({ consumedAt: '2099-01-01T00:00:00Z' }),
    ]))

    expect(totals.entryCount).toBe(2)
    expect(totals.drinkCount).toBe(4)
  })

  it.each([null, undefined, {}, 'entries', 42])('rejects the malformed entry collection %s', entries => {
    expectIssueFields(calculateUnknownEntries(entries), ['entries'], null)
  })

  it('rejects a sparse-array hole instead of silently omitting an entry', () => {
    const entries: unknown[] = new Array(3)
    entries[0] = makeEntry({ id: 'first' })
    entries[2] = makeEntry({ id: 'third' })
    expectIssueFields(calculateUnknownEntries(entries), ['entry'], 1)
  })

  it('reports the first invalid entry’s fields and index without exposing partial totals', () => {
    const entries = [
      makeEntry({ id: 'first' }),
      { ...makeEntry({ id: 'invalid' }), quantity: 0, totalPriceMinor: undefined, currency: 'AAA' },
      { ...makeEntry({ id: 'later-invalid' }), servingMl: 0 },
    ]

    expectIssueFields(calculateUnknownEntries(entries), ['quantity', 'totalPriceMinor', 'currency'], 1)
  })

  it('keeps valid earlier entries private when a later entry has invalid saved nutrition', () => {
    expectIssueFields(calculateConsumptionTotals([
      makeEntry({ id: 'valid' }),
      makeEntry({ id: 'invalid', nutrition: { ...makeEntry().nutrition, kcalPer100Ml: Infinity } }),
    ]), ['nutrition.kcalPer100Ml'], 1)
  })

  it('rejects drink-count overflow while combining individually valid entries', () => {
    expectIssueFields(calculateConsumptionTotals([
      makeEntry({ id: 'maximum', quantity: Number.MAX_SAFE_INTEGER, servingMl: 1, totalPriceMinor: 0 }),
      makeEntry({ id: 'one-more', quantity: 1, servingMl: 1, totalPriceMinor: 0 }),
    ]), ['drinkCount'], 1)
  })

  it('rejects volume overflow even when the total drink count remains safe', () => {
    expectIssueFields(calculateConsumptionTotals([
      makeEntry({ id: 'maximum', quantity: 1, servingMl: Number.MAX_SAFE_INTEGER, totalPriceMinor: 0 }),
      makeEntry({ id: 'one-more', quantity: 1, servingMl: 1, totalPriceMinor: 0 }),
    ]), ['volumeMl'], 1)
  })

  it('rejects overflow in one currency subtotal and identifies that currency', () => {
    const result = calculateConsumptionTotals([
      makeEntry({ id: 'maximum-price', totalPriceMinor: Number.MAX_SAFE_INTEGER }),
      makeEntry({ id: 'one-more-minor-unit', totalPriceMinor: 1 }),
    ])

    expectIssueFields(result, ['knownAmountMinor'], 1)
    if (result.valid === true) throw new Error('Expected currency subtotal overflow.')
    expect(result.issues[0].currency).toBe('BDT')
  })

  it('accepts largest-safe-integer spending in different currencies without adding them together', () => {
    const totals = totalsFrom(calculateConsumptionTotals([
      makeEntry({ id: 'bdt', currency: 'BDT', totalPriceMinor: Number.MAX_SAFE_INTEGER }),
      makeEntry({ id: 'usd', currency: 'USD', totalPriceMinor: Number.MAX_SAFE_INTEGER }),
    ]))

    expect(totals.spendingByCurrency).toEqual([
      { currency: 'BDT', knownAmountMinor: Number.MAX_SAFE_INTEGER, unknownPriceEntryCount: 0 },
      { currency: 'USD', knownAmountMinor: Number.MAX_SAFE_INTEGER, unknownPriceEntryCount: 0 },
    ])
  })

  it.each([
    { rate: 'sugarGramsPer100Ml', field: 'sugarGrams' },
    { rate: 'kcalPer100Ml', field: 'kcal' },
  ] as const)('rejects $field sum overflow when both entry estimates are individually finite', ({ rate, field }) => {
    const nutrition = {
      ...makeEntry().nutrition,
      sugarGramsPer100Ml: 0,
      kcalPer100Ml: 0,
      [rate]: Number.MAX_VALUE,
    }
    expectIssueFields(calculateConsumptionTotals([
      makeEntry({ id: 'first', quantity: 1, servingMl: 100, nutrition }),
      makeEntry({ id: 'second', quantity: 1, servingMl: 100, nutrition }),
    ]), [field], 1)
  })

  it('leaves supplied arrays, entries, and snapshots unchanged and unfrozen', () => {
    const entries = [makeEntry({ id: 'first' }), makeEntry({ id: 'second', totalPriceMinor: null })]
    const before = structuredClone(entries)
    const totals = totalsFrom(calculateConsumptionTotals(entries))

    expect(entries).toEqual(before)
    expect(Object.isFrozen(entries)).toBe(false)
    for (const entry of entries) {
      expect(Object.isFrozen(entry)).toBe(false)
      expect(Object.isFrozen(entry.nutrition)).toBe(false)
    }

    Reflect.set(entries[0], 'quantity', 99)
    Reflect.set(entries[0].nutrition, 'kcalPer100Ml', 0)
    expect(totals.drinkCount).toBe(4)
    expect(totals.kcal).toBeCloseTo(554.4, 10)
  })

  it('freezes single-entry and aggregate totals, currency arrays, and each currency row', () => {
    const entry = makeEntry()
    for (const result of [calculateEntryTotals(entry), calculateConsumptionTotals([entry])]) {
      const totals = totalsFrom(result)
      expect(Object.isFrozen(totals)).toBe(true)
      expect(Object.isFrozen(totals.spendingByCurrency)).toBe(true)
      expect(Object.isFrozen(totals.spendingByCurrency[0])).toBe(true)
      expect(Reflect.set(totals, 'volumeMl', 0)).toBe(false)
      expect(Reflect.set(totals.spendingByCurrency, 'length', 0)).toBe(false)
      expect(Reflect.set(totals.spendingByCurrency[0], 'knownAmountMinor', 0)).toBe(false)
    }
  })

  it('returns the same totals when called repeatedly with the same selection', () => {
    const entries = [makeEntry({ id: 'first' }), makeEntry({ id: 'second', currency: 'USD' })]
    expect(calculateConsumptionTotals(entries)).toEqual(calculateConsumptionTotals(entries))
  })
})
