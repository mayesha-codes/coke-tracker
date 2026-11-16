// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NutritionProvenance, SessionEntryRecord } from '../../app/session/sessionState'
import { createDrinkEntry } from '../../domain/entries'
import { createNutritionReference } from '../../domain/nutrition'
import type { CurrencyCode } from '../../domain/types'
import HistoryPage from './HistoryPage'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-08T09:30:00.000Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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

function renderHistory(entries: readonly SessionEntryRecord[], timeZone = 'Asia/Tokyo', dailyLimitMl: number | null = null) {
  return render(<HistoryPage entries={entries} timeZone={timeZone} dailyLimitMl={dailyLimitMl} />)
}

function historyList() {
  return screen.getByRole('region', { name: 'Period entries' })
}

function summary() {
  return screen.getByRole('region', { name: 'Period summary' })
}

function periodRangeText() {
  return document.querySelector('.history-period-range')?.textContent?.replace(/\s+/g, ' ') ?? ''
}

function dateInput() {
  return screen.getByLabelText('Reference date') as HTMLInputElement
}

function customDateInput(label: 'Start date' | 'End date') {
  return screen.getByLabelText(label) as HTMLInputElement
}

function selectDate(value: string) {
  fireEvent.change(dateInput(), { target: { value } })
}

function selectPeriod(label: 'Daily' | 'Weekly' | 'Monthly' | 'Custom') {
  fireEvent.click(screen.getByRole('radio', { name: label }))
}

function metric(container: HTMLElement, label: string) {
  return within(container).getByText(label, { selector: 'dt' })
    .nextElementSibling?.textContent?.replace(/\s+/g, ' ')
}

function normalizedText(element: HTMLElement) {
  return element.textContent?.replace(/\s+/g, ' ') ?? ''
}

describe('read-only session history', () => {
  it('shows the timezone-local initial date, an empty period state, and temporary-data notice', () => {
    renderHistory(Object.freeze([]))

    expect(screen.getByRole('heading', { name: 'History', level: 1 })).toBeDefined()
    expect(within(historyList()).getByText('No drinks saved this session yet. Log a drink to start your history.')).toBeDefined()
    expect(within(historyList()).queryAllByRole('listitem')).toHaveLength(0)
    expect(dateInput().value).toBe('2026-11-08')
    expect(screen.getByRole('radio', { name: 'Daily' })).toHaveProperty('checked', true)
    expect(screen.getByText('November 8, 2026')).toBeDefined()
    expect(screen.getByText(/November 9, 2026 \(exclusive\)/)).toBeDefined()
    expect(metric(summary(), 'Total volume')).toBe('0 ml')
    expect(metric(summary(), 'Estimated sugar')).toBe('0 g')
    expect(metric(summary(), 'Coke-only calories')).toBe('0 kcal')
    expect(metric(summary(), 'Entries with unknown prices')).toBe('0')
    expect(within(summary()).getByText('No prices recorded in this period.')).toBeDefined()
    expect(within(summary()).getByRole('region', { name: 'Daily volume goal status' }).textContent).toContain('Goal disabled.')
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
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Daily' }))
    await user.keyboard('{ArrowRight}')
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(disclosure)
    // jsdom does not implement the browser's native Enter action on <summary>.
    await user.click(disclosure)
    expect(disclosure.closest('details')?.open).toBe(true)
    expect(within(rows[0]).getByText('Reference fixture-reference-one · Version 4')).toBeDefined()
    expect(within(rows[0]).getByRole('link', { name: 'Illustrative package label one' }).getAttribute('href'))
      .toBe('https://example.invalid/label/one')
  })

  it('filters to the selected day and preserves save order instead of sorting backdated drinks', () => {
    const entries = Object.freeze([
      makeRecord('first', { timestamp: '2026-11-08T13:00:00Z' }),
      makeRecord('second', { timestamp: '2026-11-08T14:00:00Z' }),
      makeRecord('backdated', { timestamp: '2026-11-08T02:00:00Z' }),
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
      'BDTKnown subtotal: BDT 120.50 · complete',
      'EURKnown subtotal: EUR 3.99 · complete',
      'JPYKnown subtotal: JPY 0 · complete',
      'USDKnown subtotal: USD 1.25 · incomplete1 entry has unknown price',
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
    selectDate('2024-11-03')

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

    view.rerender(<HistoryPage entries={entries} timeZone="Asia/Dhaka" dailyLimitMl={null} />)
    expect(dateInput().value).toBe('2024-11-03')
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

  it('filters the list and summary together using inclusive start and exclusive end boundaries', () => {
    const entries = Object.freeze([
      makeRecord('at-end', { timestamp: '2026-11-08T15:00:00Z' }),
      makeRecord('inside', { timestamp: '2026-11-08T14:59:59.999Z' }),
      makeRecord('at-start', { timestamp: '2026-11-07T15:00:00Z' }),
    ])
    renderHistory(entries)
    expect(within(historyList()).getAllByRole('listitem').map(item => item.textContent)).toHaveLength(2)
    expect(within(historyList()).getByText('Illustrative product inside')).toBeDefined()
    expect(within(historyList()).getByText('Illustrative product at-start')).toBeDefined()
    expect(within(historyList()).queryByText('Illustrative product at-end')).toBeNull()
    expect(within(summary()).getByText('2 entries · 4 drinks')).toBeDefined()
  })

  it('updates period mode and reference date while filtering results and summary together', () => {
    const entries = Object.freeze([
      makeRecord('sunday', { timestamp: '2026-11-08T14:59:59Z' }),
      makeRecord('monday', { timestamp: '2026-11-08T15:00:00Z' }),
      makeRecord('december', { timestamp: '2026-11-30T15:00:00Z' }),
    ])
    renderHistory(entries)
    expect(within(historyList()).getAllByRole('listitem')).toHaveLength(1)
    expect(within(summary()).getByText('1 entry · 2 drinks')).toBeDefined()

    selectPeriod('Weekly')
    expect(within(historyList()).getAllByRole('listitem')).toHaveLength(1)
    expect(within(historyList()).getByText('Illustrative product sunday')).toBeDefined()
    expect(within(summary()).getByText('1 entry · 2 drinks')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Daily volume goal status' })).toBeNull()

    selectPeriod('Monthly')
    expect(within(historyList()).getAllByRole('listitem')).toHaveLength(2)
    expect(within(summary()).getByText('2 entries · 4 drinks')).toBeDefined()

    selectDate('2026-12-01')
    expect(within(historyList()).getAllByRole('listitem')).toHaveLength(1)
    expect(within(historyList()).getByText('Illustrative product december')).toBeDefined()
    expect(within(summary()).getByText('1 entry · 2 drinks')).toBeDefined()
  })

  it('offers Custom as the fourth mode and initializes an inclusive range from the reference date', () => {
    renderHistory(Object.freeze([]))
    const radios = screen.getAllByRole('radio')
    expect(radios.map(radio => (radio as HTMLInputElement).value)).toEqual(['day', 'week', 'month', 'custom'])
    selectDate('2026-11-10')
    selectPeriod('Custom')
    expect(customDateInput('Start date').value).toBe('2026-11-10')
    expect(customDateInput('End date').value).toBe('2026-11-10')
    expect(screen.getByText('Both selected dates are included.')).toBeDefined()
    expect(periodRangeText()).toContain('From 2026-11-10 through 2026-11-10 (inclusive) in Asia/Tokyo.')
    expect(screen.queryByRole('region', { name: 'Daily volume goal status' })).toBeNull()
  })

  it('updates start and end independently and shows both selected dates inclusively', () => {
    const entries = Object.freeze([
      makeRecord('at-start', { timestamp: '2026-11-06T15:00:00Z' }),
      makeRecord('inside-end-date', { timestamp: '2026-11-08T14:59:59.999Z' }),
      makeRecord('at-exclusive-end', { timestamp: '2026-11-08T15:00:00Z' }),
    ])
    renderHistory(entries)
    selectPeriod('Custom')
    fireEvent.change(customDateInput('Start date'), { target: { value: '2026-11-07' } })
    fireEvent.change(customDateInput('End date'), { target: { value: '2026-11-08' } })

    expect(customDateInput('Start date').value).toBe('2026-11-07')
    expect(customDateInput('End date').value).toBe('2026-11-08')
    expect(periodRangeText()).toContain('From 2026-11-07 through 2026-11-08 (inclusive)')
    expect(within(historyList()).getAllByRole('listitem').map(item =>
      within(item).getByRole('heading', { level: 2 }).textContent,
    )).toEqual(['Illustrative product inside-end-date', 'Illustrative product at-start'])
    expect(within(summary()).getByText('2 entries · 4 drinks')).toBeDefined()
    expect(metric(summary(), 'Total volume')).toBe('1,320 ml')
  })

  it('shows range validation errors and hides all period results for reversed or missing dates', () => {
    renderHistory(Object.freeze([makeRecord('outside')]))
    selectPeriod('Custom')
    fireEvent.change(customDateInput('Start date'), { target: { value: '2026-11-10' } })
    fireEvent.change(customDateInput('End date'), { target: { value: '2026-11-09' } })
    expect(screen.getByRole('alert').textContent).toContain('start date must be on or before the end date')
    expect(screen.queryByRole('region', { name: 'Period summary' })).toBeNull()
    expect(within(historyList()).getByText(/hidden until the selected period can be validated/)).toBeDefined()

    fireEvent.change(customDateInput('Start date'), { target: { value: '' } })
    expect(screen.getByRole('alert').textContent).toContain('start date in YYYY-MM-DD format')
    expect(screen.queryByRole('region', { name: 'Period summary' })).toBeNull()
  })

  it('rejects a custom range containing a nonexistent local date in Apia', () => {
    const entries = Object.freeze([makeRecord('exists')])
    const view = renderHistory(entries, 'Pacific/Apia')
    selectPeriod('Custom')
    fireEvent.change(customDateInput('Start date'), { target: { value: '2011-12-29' } })
    fireEvent.change(customDateInput('End date'), { target: { value: '2011-12-30' } })
    expect(screen.getByRole('alert').textContent).toContain('end date does not exist')
    expect(screen.queryByRole('region', { name: 'Period summary' })).toBeNull()
    expect(within(historyList()).queryAllByRole('listitem')).toHaveLength(0)

    view.rerender(<HistoryPage entries={entries} timeZone="Pacific/Apia" dailyLimitMl={null} />)
    expect(customDateInput('Start date').value).toBe('2011-12-29')
  })

  it('shows zero totals and an outside-period empty state for a valid empty custom range', () => {
    renderHistory(Object.freeze([makeRecord('other-date', { timestamp: '2026-11-10T12:00:00Z' })]))
    selectPeriod('Custom')
    fireEvent.change(customDateInput('Start date'), { target: { value: '2026-11-01' } })
    fireEvent.change(customDateInput('End date'), { target: { value: '2026-11-02' } })
    expect(within(summary()).getByText('0 entries · 0 drinks')).toBeDefined()
    expect(metric(summary(), 'Total volume')).toBe('0 ml')
    expect(within(historyList()).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(historyList()).getByText(/session may contain drinks from other dates/)).toBeDefined()
  })

  it('preserves custom dates while switching modes and recalculates them after a timezone change', () => {
    const record = makeRecord('timezone-range', { timestamp: '2026-11-08T01:00:00Z' })
    const entries = Object.freeze([record])
    const before = structuredClone(entries)
    const view = renderHistory(entries, 'America/Los_Angeles')
    selectDate('2026-11-07')
    selectPeriod('Custom')
    fireEvent.change(customDateInput('End date'), { target: { value: '2026-11-08' } })
    selectPeriod('Weekly')
    selectPeriod('Custom')
    expect(customDateInput('Start date').value).toBe('2026-11-07')
    expect(customDateInput('End date').value).toBe('2026-11-08')
    const originalRange = periodRangeText()

    view.rerender(<HistoryPage entries={entries} timeZone="Asia/Tokyo" dailyLimitMl={null} />)
    expect(customDateInput('Start date').value).toBe('2026-11-07')
    expect(customDateInput('End date').value).toBe('2026-11-08')
    expect(periodRangeText()).not.toBe(originalRange)
    expect(entries).toEqual(before)
    expect(record.entry.consumedAt).toBe('2026-11-08T01:00:00.000Z')
  })

  it('keeps the selected civil date when the reporting timezone changes', () => {
    const record = makeRecord('zone-edge', { timestamp: '2026-11-08T01:00:00Z' })
    const entries = Object.freeze([record])
    const before = structuredClone(entries)
    const view = renderHistory(entries, 'America/Los_Angeles')
    selectDate('2026-11-07')
    expect(within(historyList()).getAllByRole('listitem')).toHaveLength(1)
    const oldBoundary = screen.getByText(/Period in America\/Los_Angeles:/).textContent

    view.rerender(<HistoryPage entries={entries} timeZone="Asia/Tokyo" dailyLimitMl={null} />)
    expect(dateInput().value).toBe('2026-11-07')
    expect(screen.getByText(/Period in Asia\/Tokyo:/)).toBeDefined()
    expect(screen.getByText(/Period in Asia\/Tokyo:/).textContent).not.toBe(oldBoundary)
    expect(within(historyList()).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(historyList()).getByText(/session may contain drinks from other dates/)).toBeDefined()
    expect(entries).toEqual(before)
    expect(record.entry.consumedAt).toBe('2026-11-08T01:00:00.000Z')
    expect(Object.isFrozen(record.entry.nutrition)).toBe(true)
  })

  it.each([
    { limit: null, stateText: 'Goal disabled.' },
    { limit: 1000, stateText: '340 ml remaining' },
    { limit: 660, stateText: 'Daily limit reached.' },
    { limit: 500, stateText: '160 ml above your daily limit.' },
  ])('shows the daily goal result for limit $limit', ({ limit, stateText }) => {
    renderHistory(Object.freeze([makeRecord('goal')]), 'Asia/Tokyo', limit)
    expect(within(screen.getByRole('region', { name: 'Daily volume goal status' })).getByText(stateText)).toBeDefined()
  })

  it('does not display a misleading summary when a civil date cannot be built', () => {
    const entries = Object.freeze([makeRecord('existing')])
    renderHistory(entries, 'Pacific/Apia')
    selectDate('2011-12-30')
    expect(screen.getByRole('alert').textContent).toContain('does not exist')
    expect(screen.queryByRole('region', { name: 'Period summary' })).toBeNull()
    expect(within(historyList()).getByText(/hidden until the selected period can be validated/)).toBeDefined()
  })

  it('uses an accessible native date input and keyboard-operable period radios', async () => {
    const user = userEvent.setup()
    renderHistory(Object.freeze([]))
    expect(dateInput().type).toBe('date')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Daily' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Weekly' })).toHaveProperty('checked', true)
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Custom' })).toHaveProperty('checked', true)
    expect(customDateInput('Start date')).toBeDefined()
  })
})
