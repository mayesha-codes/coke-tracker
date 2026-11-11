// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NutritionProvenance, SessionEntryRecord } from '../../app/session/sessionState'
import { createDrinkEntry } from '../../domain/entries'
import { createNutritionReference } from '../../domain/nutrition'
import type { CurrencyCode } from '../../domain/types'
import SavedEntryConfirmation from './SavedEntryConfirmation'

afterEach(cleanup)

// All values and product/source descriptions below are illustrative test fixtures.
function savedRecord(options: {
  kind?: NutritionProvenance['kind']
  price?: number | null
  currency?: CurrencyCode
  sugar?: number
  kcal?: number
} = {}): SessionEntryRecord {
  const reference = createNutritionReference({
    id: 'illustrative-saved-label', version: 3,
    productDescription: 'Illustrative Coke label — Example market',
    sugarGramsPer100Ml: options.sugar ?? 10.5,
    kcalPer100Ml: options.kcal ?? 42,
    source: { label: 'Illustrative saved package label', url: 'https://example.invalid/saved-label' },
  })
  if (reference.valid === false) throw new Error('Expected a valid illustrative reference.')
  const entry = createDrinkEntry({
    id: 'illustrative-saved-entry', consumedAt: '2026-11-08T09:30:00Z',
    quantity: 2, servingMl: 375,
    totalPriceMinor: options.price === undefined ? 300 : options.price,
    currency: options.currency ?? 'JPY',
  }, reference.reference)
  if (entry.valid === false) throw new Error('Expected a valid illustrative entry.')
  return Object.freeze({
    entry: entry.entry,
    nutritionProvenance: Object.freeze({ kind: options.kind ?? 'user-provided', reference: reference.reference }),
  })
}

function metric(name: string): string {
  const region = screen.getByRole('region', { name: 'Your drink is logged.' })
  const term = within(region).getByText(name, { selector: 'dt' })
  return term.nextElementSibling?.textContent?.replace(/\s+/g, ' ') ?? ''
}

describe('the read-only saved-entry confirmation', () => {
  it('shows the accepted record and calculates its custom volume and estimates with existing utilities', () => {
    render(<SavedEntryConfirmation record={savedRecord()} timeZone="Asia/Tokyo" onLogAnother={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toBe('Saved for this session only.')
    expect(screen.getByRole('heading', { name: 'Your drink is logged.' }).tabIndex).toBe(-1)
    expect(metric('Quantity')).toBe('2')
    expect(metric('Serving size')).toBe('375 ml')
    expect(metric('Total volume')).toBe('750 ml')
    expect(metric('Estimated sugar')).toBe('78.75 g')
    expect(metric('Coke-only calories')).toBe('315 kcal')
    expect(metric('Total price')).toBe('JPY 300')
    expect(screen.getByText('Illustrative Coke label — Example market')).toBeDefined()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save entry' })).toBeNull()
    expect(screen.queryByText('Unsaved estimate')).toBeNull()
    expect(screen.queryByText('Draft preview')).toBeNull()
  })

  it.each(['reviewed', 'user-provided'] as const)('preserves the %s provenance disclosure and versioned saved source', async kind => {
    const user = userEvent.setup()
    render(<SavedEntryConfirmation record={savedRecord({ kind })} timeZone="Asia/Tokyo" onLogAnother={vi.fn()} />)
    expect(screen.getByText(kind === 'reviewed'
      ? 'Reviewed reference.' : 'User-provided — not independently verified.')).toBeDefined()
    const summary = screen.getByText('Nutrition details', { selector: 'summary' })
    const details = summary.closest('details')
    expect(details?.open).toBe(false)
    await user.click(summary)
    expect(details?.open).toBe(true)
    expect(details?.textContent).toContain('Reference illustrative-saved-label · Version 3')
    expect(details?.textContent).toContain('10.5 g')
    expect(details?.textContent).toContain('42 kcal')
    const source = screen.getByRole('link', { name: 'Illustrative saved package label' })
    expect(source.getAttribute('href')).toBe('https://example.invalid/saved-label')
    expect(source.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.queryByRole('button', { name: 'Use latest values' })).toBeNull()
  })

  it('shows known zero as free rather than unknown and keeps explicit zero nutrition rates', () => {
    render(<SavedEntryConfirmation record={savedRecord({ price: 0, sugar: 0, kcal: 0 })}
      timeZone="Asia/Tokyo" onLogAnother={vi.fn()} />)
    expect(metric('Total price')).toBe('JPY 0')
    expect(metric('Estimated sugar')).toBe('0 g')
    expect(metric('Coke-only calories')).toBe('0 kcal')
  })

  it('keeps an unknown price explicitly unknown and includes the original currency', () => {
    render(<SavedEntryConfirmation record={savedRecord({ price: null, currency: 'USD' })}
      timeZone="Asia/Tokyo" onLogAnother={vi.fn()} />)
    expect(metric('Total price')).toBe('Unknown (USD)')
  })

  it('formats the original total price without multiplying it by quantity', () => {
    render(<SavedEntryConfirmation record={savedRecord({ price: 250, currency: 'USD' })}
      timeZone="Asia/Tokyo" onLogAnother={vi.fn()} />)
    expect(metric('Total price')).toBe('USD 2.50')
  })

  it('shows a labeled reporting timezone and the unchanged original UTC timestamp', () => {
    const { rerender } = render(<SavedEntryConfirmation record={savedRecord()}
      timeZone="Asia/Tokyo" onLogAnother={vi.fn()} />)
    const tokyo = document.querySelector('time')
    expect(tokyo?.dateTime).toBe('2026-11-08T09:30:00.000Z')
    expect(tokyo?.textContent).toContain('6:30 PM')
    expect(screen.getByText('Display timezone: Asia/Tokyo')).toBeDefined()
    expect(screen.getByText('2026-11-08T09:30:00.000Z', { selector: 'code' })).toBeDefined()
    rerender(<SavedEntryConfirmation record={savedRecord()} timeZone="America/New_York" onLogAnother={vi.fn()} />)
    expect(document.querySelector('time')?.dateTime).toBe('2026-11-08T09:30:00.000Z')
    expect(document.querySelector('time')?.textContent).toContain('4:30 AM')
  })

  it('keeps the saved UTC instant visible if a display timezone is invalid', () => {
    render(<SavedEntryConfirmation record={savedRecord()} timeZone="Invalid/Zone" onLogAnother={vi.fn()} />)
    expect(screen.getByText('Local display unavailable.')).toBeDefined()
    expect(screen.getByText('2026-11-08T09:30:00.000Z', { selector: 'code' })).toBeDefined()
  })

  it('does not alter or recalculate the accepted snapshot from any live reference', () => {
    const record = savedRecord()
    const before = structuredClone(record)
    render(<SavedEntryConfirmation record={record} timeZone="Asia/Tokyo" onLogAnother={vi.fn()} />)
    expect(record).toEqual(before)
    expect(Object.isFrozen(record.entry.nutrition)).toBe(true)
    expect(metric('Estimated sugar')).toBe('78.75 g')
  })

  it('does not show nonfinite estimates when record calculations fail', () => {
    render(<SavedEntryConfirmation record={savedRecord({ kcal: Number.MAX_VALUE })}
      timeZone="Asia/Tokyo" onLogAnother={vi.fn()} />)
    expect(metric('Estimated sugar')).toBe('Unavailable')
    expect(metric('Coke-only calories')).toBe('Unavailable')
    expect(screen.queryByText(/Infinity/)).toBeNull()
  })

  it('never renders an unsafe source URL from malformed reference metadata', () => {
    const record = savedRecord()
    const malformed = {
      ...record,
      nutritionProvenance: {
        ...record.nutritionProvenance,
        reference: { ...record.nutritionProvenance.reference, source: { label: 'Unsafe source', url: 'javascript:alert(1)' } },
      },
    }
    render(<SavedEntryConfirmation record={malformed} timeZone="Asia/Tokyo" onLogAnother={vi.fn()} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Product details unavailable')).toBeDefined()
  })

  it('provides an accessible restart action and explicit temporary-data warning', async () => {
    const user = userEvent.setup()
    const restart = vi.fn()
    render(<SavedEntryConfirmation record={savedRecord()} timeZone="Asia/Tokyo" onLogAnother={restart} />)
    expect(screen.getByText('Refreshing or closing the app clears entries and preferences.')).toBeDefined()
    screen.getByRole('button', { name: 'Log another drink' }).focus()
    await user.keyboard('{Enter}')
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('retains the accepted confirmation and exposes a focusable error if restart fails', async () => {
    const user = userEvent.setup()
    const restart = vi.fn()
    render(<SavedEntryConfirmation record={savedRecord()} timeZone="Asia/Tokyo" onLogAnother={restart}
      restartError="A new drink ID could not be created. Try again." />)
    expect(screen.getByRole('status').textContent).toBe('Saved for this session only.')
    expect(screen.getByRole('alert').id).toBe('logging-restart-error')
    expect(screen.getByRole('alert').tabIndex).toBe(-1)
    await user.click(screen.getByRole('button', { name: 'Log another drink' }))
    expect(restart).toHaveBeenCalledTimes(1)
  })
})
