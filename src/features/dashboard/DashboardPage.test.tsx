// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createDrinkEntry } from '../../domain/entries'
import { createNutritionReference } from '../../domain/nutrition'
import type { CurrencyCode } from '../../domain/types'
import type { SessionEntryRecord } from '../../app/session/sessionState'
import DashboardPage from './DashboardPage'

const referenceTime = '2026-11-08T09:30:00.000Z'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
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
    totalPriceMinor: 0,
    currency: 'JPY' satisfies CurrencyCode,
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
  return render(<DashboardPage
    entries={entries}
    timeZone={options.timeZone ?? 'Asia/Tokyo'}
    dailyLimitMl={options.dailyLimitMl === undefined ? null : options.dailyLimitMl}
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
})
