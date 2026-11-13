// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NutritionProvenance, SessionEntryRecord } from '../../app/session/sessionState'
import { createDrinkEntry } from '../../domain/entries'
import { createNutritionReference } from '../../domain/nutrition'
import type { CurrencyCode } from '../../domain/types'
import HistoryPage from './HistoryPage'

afterEach(cleanup)

// Fictional values and URLs are test fixtures only; production data is never inferred from them.
function makeRecord(id: string, options: {
  description?: string
  source?: string
  currency?: CurrencyCode
  price?: number | null
  timestamp?: string
  quantity?: number
  servingMl?: number
  version?: number
  sugar?: number
  kcal?: number
  kind?: NutritionProvenance['kind']
} = {}): SessionEntryRecord {
  const version = options.version ?? 1
  const referenceResult = createNutritionReference({
    id: `fixture-reference-${id}`,
    version,
    productDescription: options.description ?? `Illustrative product ${id}`,
    sugarGramsPer100Ml: options.sugar ?? 10.5,
    kcalPer100Ml: options.kcal ?? 42,
    source: {
      label: options.source ?? `Illustrative package label ${id}`,
      url: `https://example.invalid/label/${id}`,
    },
  })
  if (referenceResult.valid === false) throw new Error('Expected a valid illustrative reference.')

  const entryResult = createDrinkEntry({
    id,
    consumedAt: options.timestamp ?? '2026-11-08T09:30:00.000Z',
    quantity: options.quantity ?? 2,
    servingMl: options.servingMl ?? 330,
    totalPriceMinor: options.price === undefined ? 300 : options.price,
    currency: options.currency ?? 'JPY',
  }, referenceResult.reference)
  if (entryResult.valid === false) throw new Error('Expected a valid illustrative entry.')

  return Object.freeze({
    entry: entryResult.entry,
    nutritionProvenance: Object.freeze({
      kind: options.kind ?? 'user-provided',
      reference: referenceResult.reference,
    }),
  })
}

function renderHistory(entries: readonly SessionEntryRecord[], timeZone = 'Asia/Tokyo') {
  return render(<HistoryPage entries={entries} timeZone={timeZone} />)
}

function historyList() {
  return screen.getByRole('region', { name: 'All entries' })
}

function summary() {
  return screen.getByRole('region', { name: 'Session summary' })
}

function metric(container: HTMLElement, label: string) {
  return within(container).getByText(label, { selector: 'dt' })
    .nextElementSibling?.textContent?.replace(/\s+/g, ' ')
}

function normalizedText(element: HTMLElement) {
  return element.textContent?.replace(/\s+/g, ' ') ?? ''
}

describe('read-only session history', () => {
  it('shows a clear empty state, zeroed session summary, and temporary-data notice', () => {
    renderHistory(Object.freeze([]))

    expect(screen.getByRole('heading', { name: 'History', level: 1 })).toBeDefined()
    expect(within(historyList()).getByText('No drinks saved this session yet. Log a drink to start your history.')).toBeDefined()
    expect(within(historyList()).queryAllByRole('listitem')).toHaveLength(0)
    expect(metric(summary(), 'Total volume')).toBe('0 ml')
    expect(metric(summary(), 'Estimated sugar')).toBe('0 g')
    expect(metric(summary(), 'Coke-only calories')).toBe('0 kcal')
    expect(metric(summary(), 'Entries with unknown prices')).toBe('0')
    expect(within(summary()).getByText('No prices recorded yet.')).toBeDefined()
    expect(screen.getByText(/Refreshing or closing the application clears this session’s history/)).toBeDefined()
  })

  it('shows a single entry with its saved nutrition estimate, original price, and source disclosure', async () => {
    const user = userEvent.setup()
    const record = makeRecord('one', { kind: 'reviewed', price: 0, version: 4, sugar: 10.6, kcal: 42 })
    renderHistory(Object.freeze([record]))

    const rows = within(historyList()).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByRole('heading', { name: 'Illustrative product one', level: 2 })).toBeDefined()
    expect(within(rows[0]).getByText('Reviewed reference.')).toBeDefined()
    expect(within(rows[0]).getByText('Nutrition version 4')).toBeDefined()
    expect(metric(rows[0], 'Quantity')).toBe('2')
    expect(metric(rows[0], 'Serving size')).toBe('330 ml')
    expect(metric(rows[0], 'Total volume')).toBe('660 ml')
    expect(metric(rows[0], 'Estimated sugar')).toBe('69.96 g')
    expect(metric(rows[0], 'Coke-only calories')).toBe('277.2 kcal')
    expect(metric(rows[0], 'Total price')).toBe('JPY 0')
    expect(rows[0].querySelector('time')?.dateTime).toBe(record.entry.consumedAt)

    const disclosure = within(rows[0]).getByText('Nutrition source details', { selector: 'summary' })
    expect(disclosure.closest('details')?.open).toBe(false)
    await user.tab()
    expect(document.activeElement).toBe(disclosure)
    // jsdom does not implement the browser's native Enter action on <summary>.
    await user.click(disclosure)
    expect(disclosure.closest('details')?.open).toBe(true)
    expect(within(rows[0]).getByText('Reference fixture-reference-one · Version 4')).toBeDefined()
    expect(within(rows[0]).getByRole('link', { name: 'Illustrative package label one' }).getAttribute('href'))
      .toBe('https://example.invalid/label/one')
  })

  it('displays every record newest saved first, even when the newest save is backdated', () => {
    const entries = Object.freeze([
      makeRecord('first', { timestamp: '2026-12-01T12:00:00Z' }),
      makeRecord('second', { timestamp: '2026-12-02T12:00:00Z' }),
      makeRecord('backdated', { timestamp: '2020-01-01T00:00:00Z' }),
      makeRecord('fourth'),
      makeRecord('fifth'),
      makeRecord('sixth'),
      makeRecord('seventh'),
    ])
    const before = structuredClone(entries)
    renderHistory(entries)

    const names = within(historyList()).getAllByRole('listitem').map(item =>
      within(item).getByRole('heading', { level: 2 }).textContent,
    )
    expect(names).toEqual([
      'Illustrative product seventh', 'Illustrative product sixth', 'Illustrative product fifth',
      'Illustrative product fourth', 'Illustrative product backdated', 'Illustrative product second',
      'Illustrative product first',
    ])
    expect(within(historyList()).getAllByRole('listitem')).toHaveLength(7)
    expect(within(historyList()).getByText('7 entries')).toBeDefined()
    expect(within(summary()).getByText('7 entries · 14 drinks')).toBeDefined()
    expect(entries).toEqual(before)
    expect(Object.isFrozen(entries)).toBe(true)
  })

  it('keeps mixed currencies separate and labels zero and unknown prices distinctly', () => {
    const entries = Object.freeze([
      makeRecord('jpy-zero', { currency: 'JPY', price: 0 }),
      makeRecord('usd', { currency: 'USD', price: 125 }),
      makeRecord('eur', { currency: 'EUR', price: 399 }),
      makeRecord('bdt', { currency: 'BDT', price: 12050 }),
      makeRecord('usd-unknown', { currency: 'USD', price: null }),
    ])
    renderHistory(entries)

    const entryRows = within(historyList()).getAllByRole('listitem')
    expect(metric(entryRows[0], 'Total price')).toBe('Unknown (USD)')
    const rows = within(summary()).getByRole('list').querySelectorAll('li')
    expect([...rows].map(row => normalizedText(row))).toEqual([
      'BDT Known subtotal: BDT 120.50',
      'EUR Known subtotal: EUR 3.99',
      'JPY Known subtotal: JPY 0',
      'USD Known subtotal: USD 1.25 · incomplete 1 entry has unknown price',
    ])
    expect(metric(summary(), 'Entries with unknown prices')).toBe('1')
    expect(within(summary()).queryByText(/Total spending:/)).toBeNull()
  })

  it('formats in the reporting timezone and includes offsets for repeated DST clock times', () => {
    const entries = Object.freeze([
      makeRecord('earlier-save', { timestamp: '2024-11-03T05:30:00Z' }),
      makeRecord('later-save', { timestamp: '2024-11-03T06:30:00Z' }),
    ])
    const before = structuredClone(entries)
    const view = renderHistory(entries, 'America/New_York')

    expect(screen.getByText('Times shown in America/New_York')).toBeDefined()
    const times = within(historyList()).getAllByRole('listitem').map(row => row.querySelector('time'))
    expect(times.map(time => time?.textContent)).toEqual([
      'Nov 3, 2024, 1:30 AM', 'Nov 3, 2024, 1:30 AM',
    ])
    expect(within(historyList()).getAllByText('UTC offset: GMT-4')).toHaveLength(1)
    expect(within(historyList()).getAllByText('UTC offset: GMT-5')).toHaveLength(1)
    expect(times.map(time => time?.dateTime)).toEqual([
      '2024-11-03T06:30:00.000Z', '2024-11-03T05:30:00.000Z',
    ])

    view.rerender(<HistoryPage entries={entries} timeZone="Asia/Dhaka" />)
    expect(screen.getByText('Times shown in Asia/Dhaka')).toBeDefined()
    expect(within(historyList()).getAllByRole('listitem').map(row => row.querySelector('time')?.dateTime)).toEqual(
      entries.slice().reverse().map(record => record.entry.consumedAt),
    )
    expect(entries).toEqual(before)
  })

  it('retains historical nutrition versions and their source metadata instead of resolving the latest reference', () => {
    const old = makeRecord('old-version', { version: 1, source: 'Original saved package label', sugar: 10.5 })
    const latest = makeRecord('latest-version', { version: 2, source: 'Newer illustrative label', sugar: 12 })
    const entries = Object.freeze([old, latest])
    const before = structuredClone(entries)
    renderHistory(entries)

    const rows = within(historyList()).getAllByRole('listitem')
    expect(within(rows[0]).getByText('Nutrition version 2')).toBeDefined()
    expect(within(rows[1]).getByText('Nutrition version 1')).toBeDefined()
    expect(within(rows[1]).getByText('User-provided — not independently verified.')).toBeDefined()
    expect(within(rows[1]).getByText('Estimated sugar').nextElementSibling?.textContent).toBe('69.3 g')
    expect(rows[1].querySelector('details')?.textContent).toContain('Original saved package label')
    expect(rows[1].querySelector('details')?.textContent).not.toContain('Newer illustrative label')
    expect(entries).toEqual(before)
    expect(Object.isFrozen(old.entry.nutrition)).toBe(true)
    expect(Object.isFrozen(old.nutritionProvenance.reference.source)).toBe(true)
  })
})
