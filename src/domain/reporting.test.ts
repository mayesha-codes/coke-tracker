import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  getCalendarDayPeriod,
  getCalendarMonthPeriod,
  getCalendarWeekPeriod,
} from './periods'
import type { PeriodResult, ReportingPeriod } from './periods'
import {
  calculateDailySummary,
  calculatePeriodTotals,
  filterEntriesForPeriod,
} from './reporting'
import type {
  DailySummaryResult,
  PeriodTotalsResult,
  ReportingFailure,
  SelectionResult,
} from './reporting'
import type { DrinkEntry } from './types'

// Product rates in these fixtures are illustrative, not verified nutrition defaults.
function makeEntry(overrides: Partial<DrinkEntry> = {}) {
  return {
    id: 'example-entry',
    consumedAt: '2026-11-07T12:00:00.000Z',
    quantity: 1,
    servingMl: 330,
    nutrition: {
      referenceId: 'example-nutrition',
      referenceVersion: 1,
      sugarGramsPer100Ml: 10.5,
      kcalPer100Ml: 42,
    },
    totalPriceMinor: 5000,
    currency: 'BDT',
    ...overrides,
  } satisfies DrinkEntry
}

function periodFrom(result: PeriodResult): ReportingPeriod {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid reporting period.')
  return result.period
}

function dhakaDay() {
  return periodFrom(getCalendarDayPeriod('2026-11-07T12:00:00Z'))
}

function selectionFrom(result: SelectionResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid entry selection.')
  return result
}

function reportFrom(result: PeriodTotalsResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected valid reporting totals.')
  return result
}

function summaryFrom(result: DailySummaryResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid daily summary.')
  return result
}

function expectIssues(
  result: SelectionResult | PeriodTotalsResult | DailySummaryResult,
  source: ReportingFailure['issues'][number]['source'],
  fields: readonly string[],
  entryIndex: number | null = null,
) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected reporting issues.')
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  for (const issue of result.issues) {
    expect(issue.source).toBe(source)
    expect(issue.entryIndex).toBe(entryIndex)
    expect(issue.message.trim()).not.toBe('')
  }
  expect(result).not.toHaveProperty('entries')
  expect(result).not.toHaveProperty('totals')
  expect(result).not.toHaveProperty('goal')
}

function filterUnknown(entries: unknown, period: unknown): SelectionResult {
  return Reflect.apply(filterEntriesForPeriod, undefined, [entries, period])
}

describe('filterEntriesForPeriod', () => {
  it('includes the exact UTC start and excludes the exact UTC end of the Dhaka day', () => {
    const period = dhakaDay()
    const entries = [
      makeEntry({ id: 'before', consumedAt: '2026-11-06T17:59:59.999Z' }),
      makeEntry({ id: 'at-start', consumedAt: period.startUtc }),
      makeEntry({ id: 'before-end', consumedAt: '2026-11-07T17:59:59.999Z' }),
      makeEntry({ id: 'at-end', consumedAt: period.endUtc }),
    ]
    const result = selectionFrom(filterEntriesForPeriod(entries, period))
    expect(result.entries.map(entry => entry.id)).toEqual(['at-start', 'before-end'])
    expect(result.originalIndices).toEqual([1, 2])
  })

  it('assigns drinks on opposite sides of Dhaka midnight to separate calendar days', () => {
    const entries = [
      makeEntry({ id: 'before-midnight', consumedAt: '2026-11-07T17:59:59.999Z' }),
      makeEntry({ id: 'after-midnight', consumedAt: '2026-11-07T18:00:00.000Z' }),
    ]
    const firstDay = dhakaDay()
    const nextDay = periodFrom(getCalendarDayPeriod('2026-11-07T18:00:00Z'))
    expect(selectionFrom(filterEntriesForPeriod(entries, firstDay)).entries.map(entry => entry.id))
      .toEqual(['before-midnight'])
    expect(selectionFrom(filterEntriesForPeriod(entries, nextDay)).entries.map(entry => entry.id))
      .toEqual(['after-midnight'])
  })

  it('normalizes explicit +00:00 timestamps before comparing and returning records', () => {
    const result = selectionFrom(filterEntriesForPeriod([
      makeEntry({ consumedAt: '2026-11-07T12:00:00+00:00' }),
    ], dhakaDay()))
    expect(result.entries[0].consumedAt).toBe('2026-11-07T12:00:00.000Z')
  })

  it('accepts equivalent UTC spellings on supplied period boundaries and returns canonical reports', () => {
    const period = { ...dhakaDay(), startUtc: '2026-11-06T18:00:00+00:00', endUtc: '2026-11-07T18:00:00+00:00' }
    const report = reportFrom(calculatePeriodTotals([makeEntry()], period))
    expect(report.period).toEqual(dhakaDay())
  })

  it('returns an empty frozen selection when no records match', () => {
    const result = selectionFrom(filterEntriesForPeriod([
      makeEntry({ consumedAt: '2026-11-08T12:00:00Z' }),
    ], dhakaDay()))
    expect(result.entries).toEqual([])
    expect(result.originalIndices).toEqual([])
    expect(Object.isFrozen(result.entries)).toBe(true)
    expect(Object.isFrozen(result.originalIndices)).toBe(true)
  })

  it('leaves inputs untouched and returns frozen independent entries and snapshots', () => {
    const entries = [makeEntry()]
    const period = { ...dhakaDay() }
    const before = structuredClone({ entries, period })
    const selection = selectionFrom(filterEntriesForPeriod(entries, period))
    expect({ entries, period }).toEqual(before)
    expect(Object.isFrozen(entries)).toBe(false)
    expect(Object.isFrozen(entries[0])).toBe(false)
    expect(Object.isFrozen(entries[0].nutrition)).toBe(false)
    expect(Object.isFrozen(period)).toBe(false)
    expect(selection.entries[0]).not.toBe(entries[0])
    expect(selection.entries[0].nutrition).not.toBe(entries[0].nutrition)
    expect(Object.isFrozen(selection)).toBe(true)
    expect(Object.isFrozen(selection.entries)).toBe(true)
    expect(Object.isFrozen(selection.originalIndices)).toBe(true)
    expect(Object.isFrozen(selection.entries[0])).toBe(true)
    expect(Object.isFrozen(selection.entries[0].nutrition)).toBe(true)
    expect(Reflect.set(selection.entries[0], 'quantity', 99)).toBe(false)
    expect(Reflect.set(selection.originalIndices, 'length', 0)).toBe(false)
  })

  it.each([
    { label: 'a missing price', change: { totalPriceMinor: undefined }, field: 'totalPriceMinor' },
    { label: 'a negative nutrition rate', change: { nutrition: { ...makeEntry().nutrition, kcalPer100Ml: -1 } }, field: 'nutrition.kcalPer100Ml' },
    { label: 'an invalid UTC timestamp', change: { consumedAt: '2026-02-30T00:00:00Z' }, field: 'consumedAt' },
    { label: 'an unsupported currency', change: { currency: 'AAA' }, field: 'currency' },
  ])('reports $label even on a record outside the selected period', ({ change, field }) => {
    const entries = [
      makeEntry({ id: 'selected' }),
      { ...makeEntry({ id: 'outside', consumedAt: '2020-01-01T00:00:00Z' }), ...change },
    ]
    expectIssues(filterUnknown(entries, dhakaDay()), 'entry', [field], 1)
  })

  it('rejects an array hole at its original index instead of silently skipping it', () => {
    const entries: unknown[] = new Array(3)
    entries[0] = makeEntry({ consumedAt: '2020-01-01T00:00:00Z' })
    entries[2] = makeEntry()
    expectIssues(filterUnknown(entries, dhakaDay()), 'entry', ['entry'], 1)
  })

  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'an object', value: {} },
    { label: 'a string', value: 'records' },
  ])('rejects $label instead of an entry array', ({ value }) => {
    expectIssues(filterUnknown(value, dhakaDay()), 'entry', ['entries'])
  })

  it('rejects a malformed record with its original input index', () => {
    expectIssues(filterUnknown([makeEntry(), null], dhakaDay()), 'entry', ['entry'], 1)
  })

  it('does not trust a missing period object', () => {
    expectIssues(filterUnknown([], null), 'period', ['period'])
  })

  it.each([
    { label: 'an invalid kind', change: { kind: 'year' }, field: 'kind' },
    { label: 'a missing timezone', change: { timeZone: undefined }, field: 'timeZone' },
    { label: 'an unsupported timezone', change: { timeZone: 'Not/A_Zone' }, field: 'timeZone' },
    { label: 'an ambiguous start', change: { startUtc: '2026-11-06T18:00:00' }, field: 'startUtc' },
    { label: 'an impossible end date', change: { endUtc: '2026-02-30T18:00:00Z' }, field: 'endUtc' },
    { label: 'an incorrect calendar start', change: { startUtc: '2026-11-06T19:00:00Z' }, field: 'startUtc' },
    { label: 'an incorrect calendar end', change: { endUtc: '2026-11-07T19:00:00Z' }, field: 'endUtc' },
    { label: 'a reversed range', change: { endUtc: '2026-11-06T17:00:00Z' }, field: 'endUtc' },
  ])('rejects a forged period with $label', ({ change, field }) => {
    expectIssues(filterUnknown([], { ...dhakaDay(), ...change }), 'period', [field])
  })
})

describe('calculatePeriodTotals', () => {
  it.each([
    { kind: 'day', makePeriod: getCalendarDayPeriod },
    { kind: 'week', makePeriod: getCalendarWeekPeriod },
    { kind: 'month', makePeriod: getCalendarMonthPeriod },
  ])('calculates totals only for the selected calendar $kind', ({ makePeriod }) => {
    const period = periodFrom(makePeriod('2026-11-07T12:00:00Z'))
    const report = reportFrom(calculatePeriodTotals([
      makeEntry({ id: 'at-start', consumedAt: period.startUtc, quantity: 2 }),
      makeEntry({ id: 'at-end', consumedAt: period.endUtc, quantity: 5 }),
    ], period))
    expect(report.period).toEqual(period)
    expect(report.totals.entryCount).toBe(1)
    expect(report.totals.drinkCount).toBe(2)
    expect(report.totals.volumeMl).toBe(660)
    expect(report.totals.sugarGrams).toBeCloseTo(69.3, 10)
    expect(report.totals.kcal).toBeCloseTo(277.2, 10)
  })

  it('preserves separate currency subtotals and unknown-price entry counts', () => {
    const report = reportFrom(calculatePeriodTotals([
      makeEntry({ id: 'bdt', quantity: 2, totalPriceMinor: 10000 }),
      makeEntry({ id: 'usd', currency: 'USD', totalPriceMinor: 200 }),
      makeEntry({ id: 'unknown-bdt', totalPriceMinor: null }),
    ], dhakaDay()))
    expect(report.totals.drinkCount).toBe(4)
    expect(report.totals.unknownPriceEntryCount).toBe(1)
    expect(report.totals.spendingByCurrency).toEqual([
      { currency: 'BDT', knownAmountMinor: 10000, unknownPriceEntryCount: 1 },
      { currency: 'USD', knownAmountMinor: 200, unknownPriceEntryCount: 0 },
    ])
  })

  it('returns zero totals for an empty period selection', () => {
    const report = reportFrom(calculatePeriodTotals([], dhakaDay()))
    expect(report.totals).toEqual({
      entryCount: 0, drinkCount: 0, volumeMl: 0, sugarGrams: 0, kcal: 0,
      spendingByCurrency: [], unknownPriceEntryCount: 0,
    })
  })

  it('remaps a selected spending-overflow index to the original unfiltered input', () => {
    const result = calculatePeriodTotals([
      makeEntry({ id: 'outside', consumedAt: '2020-01-01T00:00:00Z' }),
      makeEntry({ id: 'maximum', totalPriceMinor: Number.MAX_SAFE_INTEGER }),
      makeEntry({ id: 'one-more', totalPriceMinor: 1 }),
    ], dhakaDay())
    expectIssues(result, 'totals', ['knownAmountMinor'], 2)
    if (result.valid === true) throw new Error('Expected spending overflow.')
    expect(result.issues[0]).toHaveProperty('currency', 'BDT')
  })

  it('preserves selected-entry calculation failures without returning partial totals', () => {
    const result = calculatePeriodTotals([
      makeEntry({ id: 'outside', consumedAt: '2020-01-01T00:00:00Z' }),
      makeEntry({ id: 'selected', quantity: Number.MAX_SAFE_INTEGER, servingMl: 2 }),
    ], dhakaDay())
    expectIssues(result, 'totals', ['totalMl'], 1)
  })

  it('keeps input records unchanged and returns an immutable canonical report', () => {
    const entries = [makeEntry()]
    const before = structuredClone(entries)
    const report = reportFrom(calculatePeriodTotals(entries, { ...dhakaDay() }))
    expect(entries).toEqual(before)
    expect(Object.isFrozen(entries[0])).toBe(false)
    expect(Object.isFrozen(report)).toBe(true)
    expect(Object.isFrozen(report.period)).toBe(true)
    expect(Object.isFrozen(report.totals)).toBe(true)
    expect(Object.isFrozen(report.totals.spendingByCurrency)).toBe(true)
    expect(Reflect.set(report.period, 'startUtc', '2000-01-01T00:00:00Z')).toBe(false)
  })
})

describe('calculateDailySummary', () => {
  it.each([
    { quantity: 1, limit: null, state: 'disabled', remainingMl: null, excessMl: null },
    { quantity: 1, limit: 500, state: 'within', remainingMl: 170, excessMl: 0 },
    { quantity: 1, limit: 330, state: 'reached', remainingMl: 0, excessMl: 0 },
    { quantity: 2, limit: 500, state: 'exceeded', remainingMl: 0, excessMl: 160 },
    { quantity: 1, limit: 0, state: 'exceeded', remainingMl: 0, excessMl: 330 },
  ] as const)('composes daily totals with the $state goal status', ({ quantity, limit, state, remainingMl, excessMl }) => {
    const report = summaryFrom(calculateDailySummary([
      makeEntry({ quantity }),
      makeEntry({ id: 'outside', consumedAt: '2020-01-01T00:00:00Z', quantity: 10 }),
    ], '2026-11-07T12:00:00Z', limit))
    expect(report.period).toEqual(dhakaDay())
    expect(report.totals.volumeMl).toBe(quantity * 330)
    expect(report.goal).toEqual({
      state, consumedMl: quantity * 330, limitMl: limit, remainingMl, excessMl,
    })
    expect(report.totals.kcal).toBeCloseTo(quantity * 138.6, 10)
  })

  it('reaches a zero-volume goal when the selected day contains no drinks', () => {
    const report = summaryFrom(calculateDailySummary([], '2026-11-07T12:00:00Z', 0))
    expect(report.goal).toEqual({ state: 'reached', consumedMl: 0, limitMl: 0, remainingMl: 0, excessMl: 0 })
  })

  it('uses an explicitly configured timezone rather than assuming Dhaka', () => {
    const entries = [makeEntry({ consumedAt: '2026-11-07T20:00:00Z' })]
    const utc = summaryFrom(calculateDailySummary(entries, '2026-11-07T12:00:00Z', null, 'UTC'))
    const dhaka = summaryFrom(calculateDailySummary(entries, '2026-11-07T12:00:00Z', null, 'Asia/Dhaka'))
    expect(utc.totals.entryCount).toBe(1)
    expect(dhaka.totals.entryCount).toBe(0)
  })

  it('preserves invalid daily-limit issues even when there are no selected entries', () => {
    expectIssues(calculateDailySummary([], '2026-11-07T12:00:00Z', -1), 'goal', ['dailyLimitMl'])
  })

  it('rejects a missing goal setting rather than treating it as disabled', () => {
    const result = Reflect.apply(calculateDailySummary, undefined, [[], '2026-11-07T12:00:00Z', undefined])
    expectIssues(result, 'goal', ['dailyLimitMl'])
  })

  it('preserves explicit-reference validation instead of reading the current clock', () => {
    expectIssues(calculateDailySummary([], '2026-11-07T12:00:00', null), 'period', ['referenceUtc'])
  })

  it('does not hide an invalid record outside the day in a daily summary', () => {
    const result = Reflect.apply(calculateDailySummary, undefined, [[
      { ...makeEntry({ consumedAt: '2020-01-01T00:00:00Z' }), totalPriceMinor: undefined },
    ], '2026-11-07T12:00:00Z', null])
    expectIssues(result, 'entry', ['totalPriceMinor'], 0)
  })

  it('returns the same frozen summary for the same explicit inputs', () => {
    const entries = [makeEntry()]
    const first = summaryFrom(calculateDailySummary(entries, '2026-11-07T12:00:00Z', 500))
    const second = summaryFrom(calculateDailySummary(entries, '2026-11-07T12:00:00Z', 500))
    expect(first).toEqual(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.goal)).toBe(true)
    expect(Reflect.set(first.goal, 'excessMl', 99)).toBe(false)
  })

  it('keeps selection and summary contracts readonly in TypeScript', () => {
    const checkReadonly = (selection: SelectionResult, summary: DailySummaryResult) => {
      if (selection.valid === true) {
        // @ts-expect-error Selection arrays cannot be appended to.
        selection.entries.push(makeEntry())
        // @ts-expect-error Original index mappings are readonly.
        selection.originalIndices[0] = 99
      }
      if (summary.valid === true) {
        // @ts-expect-error Report periods cannot be replaced.
        summary.period = dhakaDay()
        expectTypeOf(summary.goal.remainingMl).toEqualTypeOf<number | null>()
      }
    }
    expectTypeOf(checkReadonly).toBeFunction()
  })
})
