// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NutritionProvenance, SessionEntryRecord } from '../../app/session/sessionState'
import { createDrinkEntry } from '../../domain/entries'
import { createNutritionReference } from '../../domain/nutrition'
import type { CurrencyCode } from '../../domain/types'
import RecentSessionEntries from './RecentSessionEntries'

afterEach(cleanup)

// Product descriptions, sources, and rates here are illustrative fixtures only.
function record(id: string, options: {
  currency?: CurrencyCode
  price?: number | null
  consumedAt?: string
  kind?: NutritionProvenance['kind']
  version?: number
  source?: string
} = {}): SessionEntryRecord {
  const checked = createNutritionReference({
    id: 'illustrative-reference', version: options.version ?? 1,
    productDescription: `Illustrative drink ${id}`,
    sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42,
    source: { label: options.source ?? `Illustrative source ${id}`, url: `https://example.invalid/label/${id}` },
  })
  if (checked.valid === false) throw new Error('Expected an illustrative nutrition reference.')
  const created = createDrinkEntry({
    id, consumedAt: options.consumedAt ?? '2026-11-08T00:30:00Z',
    quantity: 2, servingMl: 375, currency: options.currency ?? 'JPY',
    totalPriceMinor: options.price === undefined ? 300 : options.price,
  }, checked.reference)
  if (created.valid === false) throw new Error('Expected an illustrative drink record.')
  return Object.freeze({
    entry: created.entry,
    nutritionProvenance: Object.freeze({ kind: options.kind ?? 'user-provided', reference: checked.reference }),
  })
}

function region() {
  return screen.getByRole('region', { name: 'Recent session entries' })
}

function metric(row: HTMLElement, label: string) {
  return within(row).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent?.replace(/\s+/g, ' ')
}

describe('recent accepted session records', () => {
  it('shows an honest empty state and temporary-data notice without success announcements', () => {
    render(<RecentSessionEntries entries={Object.freeze([])} timeZone="Asia/Tokyo" />)
    expect(within(region()).getByText('No drinks saved this session yet.')).toBeDefined()
    expect(within(region()).queryByRole('list')).toBeNull()
    expect(within(region()).queryByRole('status')).toBeNull()
    expect(within(region()).queryByRole('button')).toBeNull()
    expect(within(region()).queryByText('Saved for this session only.')).toBeNull()
    expect(within(region()).getByText('Refreshing or closing the app clears session entries and preferences.')).toBeDefined()
  })

  it('shows one saved product, version, custom servings, calculated volume, and original total price', () => {
    render(<RecentSessionEntries entries={Object.freeze([record('one')])} timeZone="Asia/Tokyo" />)
    const rows = within(region()).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByRole('heading', { name: 'Illustrative drink one', level: 3 })).toBeDefined()
    expect(within(rows[0]).getByText('User-provided — not independently verified.')).toBeDefined()
    expect(within(rows[0]).getByText('Nutrition version 1')).toBeDefined()
    expect(metric(rows[0], 'Quantity')).toBe('2')
    expect(metric(rows[0], 'Serving size')).toBe('375 ml')
    expect(metric(rows[0], 'Total volume')).toBe('750 ml')
    expect(metric(rows[0], 'Total price')).toBe('JPY 300')
  })

  it.each([5, 7])('copies the latest five of %i accepted records before reversing save order', count => {
    const entries = Object.freeze(Array.from({ length: count }, (_, index) => record(String(index + 1))))
    const original = structuredClone(entries)
    render(<RecentSessionEntries entries={entries} timeZone="Asia/Tokyo" />)
    expect(within(region()).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(Array.from({ length: 5 }, (_, index) => `Illustrative drink ${count - index}`))
    expect(entries).toEqual(original)
    expect(Object.isFrozen(entries)).toBe(true)
  })

  it('keeps a newly saved backdated drink ahead of older saves with later or identical consumption times', () => {
    const entries = Object.freeze([
      record('first', { consumedAt: '2026-12-01T00:00:00Z' }),
      record('second', { consumedAt: '2026-12-01T00:00:00Z' }),
      record('backdated', { consumedAt: '2025-01-01T00:00:00Z' }),
    ])
    render(<RecentSessionEntries entries={entries} timeZone="UTC" />)
    expect(within(region()).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Illustrative drink backdated', 'Illustrative drink second', 'Illustrative drink first'])
  })

  it('keeps each original currency and distinguishes known zero from unknown without combining spending', () => {
    const entries = Object.freeze([
      record('jpy', { currency: 'JPY', price: 0 }),
      record('usd', { currency: 'USD', price: 125 }),
      record('eur', { currency: 'EUR', price: 399 }),
      record('bdt', { currency: 'BDT', price: 12050 }),
      record('unknown', { currency: 'USD', price: null }),
    ])
    render(<RecentSessionEntries entries={entries} timeZone="Asia/Tokyo" />)
    const rows = within(region()).getAllByRole('listitem')
    expect(rows.map(row => metric(row, 'Total price'))).toEqual([
      'Unknown (USD)', 'BDT 120.50', 'EUR 3.99', 'USD 1.25', 'JPY 0',
    ])
    expect(within(region()).queryByText('Total spending')).toBeNull()
  })

  it('formats a zero price using that saved currency’s decimal precision', () => {
    render(<RecentSessionEntries entries={[record('usd-zero', { currency: 'USD', price: 0 })]} timeZone="UTC" />)
    expect(metric(within(region()).getByRole('listitem'), 'Total price')).toBe('USD 0.00')
  })

  it('uses readable consumption times and a labeled timezone while retaining the saved UTC instant', () => {
    const entries = Object.freeze([record('one')])
    const before = structuredClone(entries)
    const view = render(<RecentSessionEntries entries={entries} timeZone="Asia/Tokyo" />)
    expect(within(region()).getByText('Reporting timezone: Asia/Tokyo')).toBeDefined()
    const time = region().querySelector('time')
    expect(time?.dateTime).toBe(entries[0].entry.consumedAt)
    expect(time?.textContent).toContain('Nov 8, 2026')
    expect(time?.textContent).toContain('9:30 AM')
    expect(within(region()).getByText('UTC offset: GMT+9')).toBeDefined()
    view.rerender(<RecentSessionEntries entries={entries} timeZone="America/New_York" />)
    expect(within(region()).getByText('Reporting timezone: America/New_York')).toBeDefined()
    expect(region().querySelector('time')?.textContent).toContain('Nov 7, 2026')
    expect(region().querySelector('time')?.textContent).toContain('7:30 PM')
    expect(region().querySelector('time')?.dateTime).toBe(entries[0].entry.consumedAt)
    expect(entries).toEqual(before)
  })

  it('distinguishes two repeated daylight-saving clock times with their saved instants and offsets', () => {
    const entries = Object.freeze([
      record('earlier', { consumedAt: '2024-11-03T05:30:00Z' }),
      record('later', { consumedAt: '2024-11-03T06:30:00Z' }),
    ])
    render(<RecentSessionEntries entries={entries} timeZone="America/New_York" />)
    const rows = within(region()).getAllByRole('listitem')
    expect(rows.map(row => row.querySelector('time')?.textContent)).toEqual([
      'Nov 3, 2024, 1:30 AM', 'Nov 3, 2024, 1:30 AM',
    ])
    expect(within(rows[0]).getByText('UTC offset: GMT-5')).toBeDefined()
    expect(within(rows[1]).getByText('UTC offset: GMT-4')).toBeDefined()
    expect(rows.map(row => row.querySelector('time')?.dateTime)).toEqual([
      '2024-11-03T06:30:00.000Z', '2024-11-03T05:30:00.000Z',
    ])
  })

  it('falls back to the unchanged UTC instant if the display timezone is invalid', () => {
    const saved = record('one')
    render(<RecentSessionEntries entries={[saved]} timeZone="Invalid/Zone" />)
    expect(within(region()).getByText('Consumed time unavailable')).toBeDefined()
    expect(region().querySelector('time')?.dateTime).toBe(saved.entry.consumedAt)
    expect(region().querySelector('time')?.textContent).toBe(saved.entry.consumedAt)
  })

  it.each(['reviewed', 'user-provided'] as const)('keeps %s provenance and its historical source accessible in a collapsed disclosure', async kind => {
    const user = userEvent.setup()
    render(<RecentSessionEntries entries={[record('one', { kind, version: 3 })]} timeZone="UTC" />)
    expect(within(region()).getByText(kind === 'reviewed' ? 'Reviewed reference.' : 'User-provided — not independently verified.')).toBeDefined()
    expect(within(region()).getByText('Nutrition version 3')).toBeDefined()
    const summary = within(region()).getByText('Source details', { selector: 'summary' })
    expect(summary.closest('details')?.open).toBe(false)
    await user.tab()
    expect(document.activeElement).toBe(summary)
    // JSDOM does not implement Enter's native summary toggle; the browser check covers it.
    await user.click(summary)
    expect(summary.closest('details')?.open).toBe(true)
    expect(summary.closest('details')?.textContent).toContain('Reference illustrative-reference · Version 3')
    await user.tab()
    const source = within(region()).getByRole('link', { name: 'Illustrative source one' })
    expect(document.activeElement).toBe(source)
    expect(source.getAttribute('href')).toBe('https://example.invalid/label/one')
    expect(source.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('preserves old reference versions, source metadata, and frozen snapshots when a newer record is added', () => {
    const first = record('old', { version: 1, source: 'Illustrative original label' })
    const entries = Object.freeze([first])
    const before = structuredClone(entries)
    const view = render(<RecentSessionEntries entries={entries} timeZone="UTC" />)
    const second = record('new', { version: 2, source: 'Illustrative revised label' })
    view.rerender(<RecentSessionEntries entries={Object.freeze([...entries, second])} timeZone="Asia/Tokyo" />)
    const rows = within(region()).getAllByRole('listitem')
    expect(within(rows[0]).getByText('Nutrition version 2')).toBeDefined()
    expect(within(rows[1]).getByText('Nutrition version 1')).toBeDefined()
    expect(rows[1].querySelector('details')?.textContent).toContain('Illustrative original label')
    expect(rows[0].querySelector('details')?.textContent).toContain('Illustrative revised label')
    expect(entries).toEqual(before)
    expect(Object.isFrozen(first.entry.nutrition)).toBe(true)
    expect(Object.isFrozen(first.nutritionProvenance.reference.source)).toBe(true)
  })

  it('does not move focus or add success announcements when accepted records change', async () => {
    const user = userEvent.setup()
    const view = render(<><button type="button">Keep focus</button><RecentSessionEntries entries={[]} timeZone="UTC" /></>)
    const button = screen.getByRole('button', { name: 'Keep focus' })
    await user.click(button)
    view.rerender(<><button type="button">Keep focus</button><RecentSessionEntries entries={[record('one')]} timeZone="UTC" /></>)
    expect(document.activeElement).toBe(button)
    expect(within(region()).queryByRole('status')).toBeNull()
    expect(region().querySelector('[aria-live]')).toBeNull()
    expect(region().getAttribute('aria-live')).toBeNull()
    expect(within(region()).queryByText('Saved for this session only.')).toBeNull()
  })

  it('keeps repeated product rows independently named without duplicate DOM IDs', () => {
    render(<RecentSessionEntries entries={Object.freeze([record('one'), record('two')])} timeZone="UTC" />)
    const ids = [...region().querySelectorAll('[id]')].map(element => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(within(region()).getAllByRole('article')).toHaveLength(2)
  })

  it('does not render unsafe URLs from malformed saved source metadata', () => {
    const saved = record('one')
    const malformed = { ...saved, nutritionProvenance: {
      ...saved.nutritionProvenance,
      reference: { ...saved.nutritionProvenance.reference, source: { label: 'Unsafe source', url: 'javascript:alert(1)' } },
    } }
    render(<RecentSessionEntries entries={[malformed]} timeZone="UTC" />)
    expect(within(region()).queryByRole('link')).toBeNull()
    expect(region().querySelector('a[href^="javascript:"]')).toBeNull()
    expect(within(region()).getByText('Product details unavailable')).toBeDefined()
  })
})
