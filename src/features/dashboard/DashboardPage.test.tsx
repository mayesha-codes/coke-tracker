// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { createDrinkEntry } from '../../domain/entries'
import { createNutritionReference } from '../../domain/nutrition'
import type { CurrencyCode } from '../../domain/types'
import type { SessionEntryRecord } from '../../app/session/sessionState'
import DashboardPage from './DashboardPage'

const referenceTime = '2026-11-08T09:30:00.000Z'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date(referenceTime))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// Test-only illustrative nutrition values are not production defaults.
function record(id: string, options: {
  consumedAt?: string
  quantity?: number
  servingMl?: number
  sugar?: number
  kcal?: number
  price?: number | null
  currency?: CurrencyCode
} = {}): SessionEntryRecord {
  const reference = createNutritionReference({
    id: `test-reference-${id}`,
    version: 1,
    productDescription: `Illustrative drink ${id}`,
    sugarGramsPer100Ml: options.sugar ?? 10,
    kcalPer100Ml: options.kcal ?? 42,
    source: { label: `Illustrative test label ${id}` },
  })
  if (reference.valid === false) throw new Error('Expected valid test nutrition data.')

  const entry = createDrinkEntry({
    id,
    consumedAt: options.consumedAt ?? '2026-11-08T00:00:00.000Z',
    quantity: options.quantity ?? 1,
    servingMl: options.servingMl ?? 330,
    totalPriceMinor: options.price === undefined ? 0 : options.price,
    currency: options.currency ?? 'JPY' satisfies CurrencyCode,
  }, reference.reference)
  if (entry.valid === false) throw new Error('Expected a valid test entry.')

  return Object.freeze({
    entry: entry.entry,
    nutritionProvenance: Object.freeze({ kind: 'user-provided', reference: reference.reference }),
  })
}

function renderDashboard(entries: readonly SessionEntryRecord[], options: {
  timeZone?: string
  dailyLimitMl?: number | null
} = {}) {
  const onViewHistory = vi.fn()
  return render(<DashboardPage
    entries={entries}
    timeZone={options.timeZone ?? 'Asia/Tokyo'}
    dailyLimitMl={options.dailyLimitMl === undefined ? null : options.dailyLimitMl}
    onViewHistory={onViewHistory}
  />)
}

function metric(label: string): string {
  const metrics = screen.getByRole('region', { name: "Today's snapshot" })
  return within(metrics).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent?.replace(/\s+/g, ' ') ?? ''
}

describe('today dashboard and volume goal', () => {
  it('shows zero totals and a clear disabled-goal state for an empty session', () => {
    renderDashboard(Object.freeze([]))

    expect(screen.getByRole('heading', { name: 'Today' })).toBeDefined()
    expect(screen.getByText('Sunday, November 8')).toBeDefined()
    expect(screen.getByText('0 entries · 0 drinks')).toBeDefined()
    expect(metric('Drinks')).toBe('0')
    expect(metric('Total volume')).toContain('0')
    expect(metric('Estimated sugar')).toContain('0')
    expect(metric('Coke-only calories')).toContain('0')
    expect(screen.getByText('Set a daily volume limit in Settings to track progress here.')).toBeDefined()
    expect(screen.getByText(/Coke-only calories are shown separately/)).toBeDefined()
    expect(screen.getByText(/Refreshing or closing the app clears entries and preferences/)).toBeDefined()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('uses Tokyo calendar boundaries, saved nutrition snapshots, and counts drinks separately from entries', () => {
    const includedA = record('a', {
      consumedAt: '2026-11-07T15:00:00.000Z', // Tokyo midnight, inclusive.
      quantity: 2,
      servingMl: 330,
      sugar: 10.5,
      kcal: 42,
    })
    const includedB = record('b', {
      consumedAt: '2026-11-08T14:59:59.999Z', // One millisecond before the next Tokyo day.
      servingMl: 500,
      sugar: 2,
      kcal: 4,
    })
    const previousDay = record('previous', { consumedAt: '2026-11-07T14:59:59.999Z' })
    const nextDay = record('next', { consumedAt: '2026-11-08T15:00:00.000Z' })
    const records = Object.freeze([includedA, includedB, previousDay, nextDay])
    const original = structuredClone(records)

    renderDashboard(records, { timeZone: 'Asia/Tokyo', dailyLimitMl: 2000 })

    expect(screen.getByText('2 entries · 3 drinks')).toBeDefined()
    expect(metric('Drinks')).toBe('3')
    expect(metric('Total volume')).toContain('1,160')
    expect(metric('Estimated sugar')).toContain('79.3')
    expect(metric('Coke-only calories')).toContain('297.2')
    expect(screen.getByText('840 ml remaining of 2,000 ml.')).toBeDefined()
    expect(records).toEqual(original)
    expect(Object.isFrozen(records)).toBe(true)
    expect(Object.isFrozen(includedA.entry.nutrition)).toBe(true)
  })

  it('passes today’s reported volume and saved-snapshot calories to the glass without using the goal', () => {
    const entry = record('glass-summary', {
      consumedAt: '2026-11-08T00:00:00.000Z',
      quantity: 2,
      servingMl: 330,
      kcal: 31.5,
    })
    renderDashboard(Object.freeze([entry]), { dailyLimitMl: 0 })

    const glass = screen.getByRole('region', { name: "Today's Coke glass" })
    const metrics = within(glass)
    expect(metrics.getByText('Consumed today').nextElementSibling?.textContent).toContain('660')
    expect(metrics.getByText('Estimated Coke-only calories').nextElementSibling?.textContent).toContain('207.9')
    expect(screen.getByTestId('glass-fill-level').getAttribute('data-fill-percent')).toBe('100')
    expect(screen.getByText('660 ml over your zero-volume limit.')).toBeDefined()
    expect(entry.entry.nutrition.kcalPer100Ml).toBe(31.5)
  })

  it.each([
    { name: 'within the limit', limit: 1000, volume: 660, message: '340 ml remaining of 1,000 ml.', progress: 660 },
    { name: 'reached exactly', limit: 660, volume: 660, message: 'Daily volume limit reached at 660 ml.', progress: 660 },
    { name: 'exceeded with capped progress', limit: 500, volume: 660, message: '160 ml over your 500 ml limit.', progress: 500 },
    { name: 'zero consumption below a positive limit', limit: 500, volume: 0, message: '500 ml remaining of 500 ml.', progress: 0 },
  ])('shows correct goal state when $name', ({ limit, volume, message, progress }) => {
    const entries = volume === 0 ? Object.freeze([]) : Object.freeze([record(`goal-${limit}`, {
      servingMl: volume,
      kcal: 1000, // Calories must not influence the volume goal.
    })])
    renderDashboard(entries, { dailyLimitMl: limit })

    expect(screen.getByText(message)).toBeDefined()
    expect(screen.getByRole('progressbar')).toHaveProperty('value', progress)
    expect(screen.getByRole('progressbar')).toHaveProperty('max', limit)
  })

  it('handles a zero configured limit without division or a misleading percentage', () => {
    const empty = renderDashboard(Object.freeze([]), { dailyLimitMl: 0 })
    expect(screen.getByText('Your zero-volume limit is reached.')).toBeDefined()
    expect(screen.getByText('Daily limit: 0 ml')).toBeDefined()
    expect(screen.queryByRole('progressbar')).toBeNull()
    empty.unmount()

    renderDashboard(Object.freeze([record('over-zero')]), { dailyLimitMl: 0 })
    expect(screen.getByText('330 ml over your zero-volume limit.')).toBeDefined()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('shows an empty spending state when there are no drinks today', () => {
    renderDashboard(Object.freeze([]))
    expect(screen.getByRole('region', { name: 'Today’s spending' })).toBeDefined()
    expect(screen.getByText('No spending entries recorded today.')).toBeDefined()
  })

  it('formats known zero and positive spending separately by original currency', () => {
    renderDashboard(Object.freeze([
      record('jpy-zero', { currency: 'JPY', price: 0 }),
      record('usd-one', { currency: 'USD', price: 125 }),
      record('usd-two', { currency: 'USD', price: 250 }),
      record('bdt', { currency: 'BDT', price: 12050 }),
    ]))
    const spending = screen.getByRole('region', { name: 'Today’s spending' })
    const rows = within(spending).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByRole('heading', { name: 'BDT' })).toBeDefined()
    expect(rows[0].textContent?.replace(/\u00a0/g, ' ')).toContain('BDT 120.50')
    expect(within(rows[1]).getByRole('heading', { name: 'JPY' })).toBeDefined()
    expect(rows[1].textContent?.replace(/\u00a0/g, ' ')).toContain('JPY 0')
    expect(rows[2].textContent?.replace(/\u00a0/g, ' ')).toContain('USD 3.75')
    expect(within(spending).getAllByText('Complete')).toHaveLength(3)
    expect(spending.textContent).not.toContain('Total spending')
  })

  it('labels known-price subtotals incomplete when entries have unknown prices', () => {
    renderDashboard(Object.freeze([
      record('usd-known', { currency: 'USD', price: 125 }),
      record('usd-unknown', { currency: 'USD', price: null }),
      record('eur-unknown', { currency: 'EUR', price: null }),
    ]))
    const spending = screen.getByRole('region', { name: 'Today’s spending' })
    expect(spending.textContent).toContain('2 entries have an unknown price')
    const rows = within(spending).getAllByRole('listitem')
    expect(rows.find(row => row.textContent?.includes('USD'))?.textContent?.replace(/\u00a0/g, ' ')).toContain('USD 1.25')
    expect(rows.find(row => row.textContent?.includes('USD'))?.textContent).toContain('Incomplete · 1 unknown')
    expect(rows.find(row => row.textContent?.includes('EUR'))?.textContent?.replace(/\u00a0/g, ' ')).toContain('EUR 0.00')
    expect(rows.find(row => row.textContent?.includes('EUR'))?.textContent).toContain('Incomplete · 1 unknown')
  })

  it('shows only today’s spending in the reporting timezone', () => {
    renderDashboard(Object.freeze([
      record('today-tokyo', { consumedAt: '2026-11-07T15:00:00Z', currency: 'JPY', price: 300 }),
      record('yesterday-tokyo', { consumedAt: '2026-11-07T14:59:59.999Z', currency: 'USD', price: 250 }),
    ]), { timeZone: 'Asia/Tokyo' })
    const spending = screen.getByRole('region', { name: 'Today’s spending' })
    expect(spending.textContent?.replace(/\u00a0/g, ' ')).toContain('JPY 300')
    expect(spending.textContent).not.toContain('USD')
  })
})

describe('weekly dashboard context', () => {
  function weeklyRegion() {
    return screen.getByRole('region', { name: 'This Week' })
  }

  function weeklyMetric(label: string): string {
    return within(weeklyRegion()).getByText(label, { selector: 'dt' })
      .nextElementSibling?.textContent?.replace(/\s+/g, ' ') ?? ''
  }

  it('shows an empty week with the Monday-to-Sunday range and reporting timezone', () => {
    renderDashboard(Object.freeze([
      record('last-week', { consumedAt: '2026-11-01T14:59:59.999Z' }),
      record('next-week', { consumedAt: '2026-11-08T15:00:00.000Z' }),
    ]), { timeZone: 'Asia/Tokyo' })

    expect(within(weeklyRegion()).getByText('Nov 2, 2026 – Nov 8, 2026')).toBeDefined()
    expect(within(weeklyRegion()).getByText('Reporting timezone: Asia/Tokyo')).toBeDefined()
    expect(weeklyMetric('Drinks this week')).toBe('0')
    expect(weeklyMetric('Total volume this week')).toContain('0')
    expect(within(weeklyRegion()).getByText('No drinks recorded this week yet.')).toBeDefined()
    expect(within(weeklyRegion()).getByText(/weekly total, not a daily trend/)).toBeDefined()
  })

  it('includes both exact Tokyo week boundaries, excludes outside entries, and counts saved drinks', () => {
    renderDashboard(Object.freeze([
      record('at-start', { consumedAt: '2026-11-01T15:00:00.000Z', quantity: 2, servingMl: 330 }),
      record('middle-backdated', { consumedAt: '2026-11-03T04:00:00.000Z', quantity: 3, servingMl: 500 }),
      record('at-end-minus-one', { consumedAt: '2026-11-08T14:59:59.999Z', quantity: 1, servingMl: 200 }),
      record('before-week', { consumedAt: '2026-11-01T14:59:59.999Z' }),
      record('at-exclusive-end', { consumedAt: '2026-11-08T15:00:00.000Z' }),
    ]), { timeZone: 'Asia/Tokyo' })

    expect(weeklyMetric('Drinks this week')).toBe('6')
    expect(weeklyMetric('Total volume this week')).toContain('2,360')
    expect(within(weeklyRegion()).getByText('Nov 2, 2026 – Nov 8, 2026')).toBeDefined()
    expect(metric('Drinks')).toBe('1') // Only the final in-week entry also falls inside today.
  })

  it('recalculates calendar weeks and today after a reporting timezone change without mutating saved records', () => {
    vi.setSystemTime(new Date('2026-11-02T00:30:00.000Z'))
    const entry = record('zone-boundary', {
      consumedAt: '2026-11-01T20:00:00.000Z', quantity: 2, servingMl: 350,
    })
    const entries = Object.freeze([entry])
    const original = structuredClone(entries)
    const view = renderDashboard(entries, { timeZone: 'Asia/Tokyo' })

    expect(within(weeklyRegion()).getByText('Nov 2, 2026 – Nov 8, 2026')).toBeDefined()
    expect(weeklyMetric('Drinks this week')).toBe('2')
    expect(metric('Drinks')).toBe('2')
    expect(vi.getTimerCount()).toBe(1)
    view.rerender(<DashboardPage
      entries={entries}
      timeZone="UTC"
      dailyLimitMl={null}
      onViewHistory={vi.fn()}
    />)

    expect(within(weeklyRegion()).getByText('Nov 2, 2026 – Nov 8, 2026')).toBeDefined()
    // Tokyo's Monday began before this instant; UTC's Monday begins after it.
    expect(weeklyMetric('Drinks this week')).toBe('0')
    expect(metric('Drinks')).toBe('0')
    expect(vi.getTimerCount()).toBe(1)
    expect(entries).toEqual(original)
    expect(entry.entry.consumedAt).toBe('2026-11-01T20:00:00.000Z')
    expect(Object.isFrozen(entry.entry.nutrition)).toBe(true)
  })

  it('refreshes daily and weekly summaries at the next reporting-day boundary and cleans up its timer', async () => {
    vi.setSystemTime(new Date('2026-11-08T14:59:59.000Z'))
    const entries = Object.freeze([record('before-midnight', {
      consumedAt: '2026-11-08T14:59:59.000Z',
    })])
    const view = renderDashboard(entries, { timeZone: 'Asia/Tokyo' })
    expect(screen.getByText('Sunday, November 8')).toBeDefined()
    expect(metric('Drinks')).toBe('1')
    expect(weeklyMetric('Drinks this week')).toBe('1')

    await act(async () => {
      vi.advanceTimersByTime(1_001)
    })

    expect(screen.getByText('Monday, November 9')).toBeDefined()
    expect(metric('Drinks')).toBe('0')
    expect(weeklyMetric('Drinks this week')).toBe('0')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps exactly one midnight timer under StrictMode and removes it on unmount', () => {
    const view = render(<StrictMode><DashboardPage
      entries={Object.freeze([])}
      timeZone="Asia/Tokyo"
      dailyLimitMl={null}
      onViewHistory={vi.fn()}
    /></StrictMode>)

    expect(screen.getByText('Sunday, November 8')).toBeDefined()
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
