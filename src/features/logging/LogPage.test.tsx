// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNutritionReference } from '../../domain/nutrition'
import type { PersonalNutritionSetup, SessionEntryRecord } from '../../app/session/sessionState'
import { createSessionState, transitionSession } from '../../app/session/sessionState'
import type { SessionState } from '../../app/session/sessionState'
import type { EntrySaveReceipt, EntrySaveRequest } from '../../app/session/sessionContext'
import LogPage from './LogPage'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const initialization = { initialReferenceUtc: '2026-11-07T18:05:00Z', draftId: 'page-test-draft' }

// Illustrative test values only, not production defaults or independently reviewed data.
function personalSetup(): PersonalNutritionSetup {
  const checked = createNutritionReference({
    id: 'personal-page-label', version: 1, productDescription: 'Illustrative personal page label',
    sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42,
    source: { label: 'Illustrative personal package label' },
  })
  if (checked.valid === false) throw new Error('Expected valid illustrative nutrition.')
  return Object.freeze({ kind: 'user-provided', reference: checked.reference })
}

describe('the Log page draft', () => {
  it('offers exactly the reviewed Great Britain product without choosing it for the user', () => {
    render(<LogPage {...initialization} />)
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' })
    expect(select.disabled).toBe(false)
    expect(select.value).toBe('')
    const reviewed = within(select).getByRole('group', { name: 'Reviewed products' })
    expect(within(reviewed).getAllByRole('option')).toHaveLength(1)
    expect(within(reviewed).getByRole('option', { name: /Coca-Cola Original Taste — Great Britain/ })).toBeDefined()
    expect(screen.getByText('Product not listed? Add your label values in Settings.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
  })

  it('uses the documented production sugar measurement for two 330 ml drinks and keeps source details collapsed', async () => {
    const user = userEvent.setup()
    render(<LogPage {...initialization} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Coke product' }),
      JSON.stringify(['reviewed', 'coca-cola-original-taste-gb', 1]))
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText('660', { exact: false })).toBeDefined()
    expect(within(preview).getByText('69.96', { exact: false })).toBeDefined()
    expect(within(preview).getByText('277.2', { exact: false })).toBeDefined()
    const details = document.querySelector<HTMLDetailsElement>('details.logging-nutrition-details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
    // JSDOM does not model closed-details accessibility visibility; browser checks cover it.
    await user.click(screen.getByText('Nutrition details', { selector: 'summary' }))
    expect(details?.open).toBe(true)
    const source = screen.getByRole('link')
    expect(source.getAttribute('href')).toBe('https://www.coca-cola.com/gb/en/brands/coca-cola-original-taste')
    expect(source.getAttribute('rel')).toContain('noreferrer')
    expect(details?.textContent).toContain('Version 1')
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
  })

  it.each([
    ['JPY', 'Asia/Tokyo'], ['BDT', 'Asia/Dhaka'], ['USD', 'America/New_York'],
  ])('keeps the product market explicit and selection blank for %s in %s', (currency, timeZone) => {
    render(<LogPage {...initialization} currency={currency} timeZone={timeZone} />)
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' })
    expect(select.value).toBe('')
    expect(within(select).getByRole('option', { name: /Coca-Cola Original Taste — Great Britain/ })).toBeDefined()
    expect(screen.queryByText('Ready to save — not saved yet.')).toBeNull()
  })

  it('provides the shell heading and an honest empty nutrition catalog', () => {
    render(<LogPage {...initialization} references={[]} />)
    expect(screen.getByRole('heading', { level: 1 }).id).toBe('view-heading')
    expect(screen.getByText('Session logging')).toBeDefined()
    expect(screen.getByLabelText(/coke product/i)).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
    expect(screen.queryByText('Ready to save — not saved yet.')).toBeNull()
  })

  it('initializes the local clock fields in Dhaka rather than UTC or the host timezone', () => {
    render(<LogPage {...initialization} />)
    expect(screen.getByLabelText(/consumption date and time/i)).toHaveProperty('value', '2026-11-08T00:05')
    expect(screen.getAllByText(/Asia\/Dhaka/).length).toBeGreaterThan(0)
  })

  it('uses an explicitly configured timezone for its initial date and time', () => {
    render(<LogPage {...initialization} timeZone="UTC" />)
    expect(screen.getByLabelText(/consumption date and time/i)).toHaveProperty('value', '2026-11-07T18:05')
  })

  it('initializes a Tokyo draft and formats its yen price without decimal places', async () => {
    const user = userEvent.setup()
    render(<LogPage {...initialization} currency="JPY" timeZone="Asia/Tokyo" />)
    expect(screen.getByLabelText(/consumption date and time/i)).toHaveProperty('value', '2026-11-08T03:05')
    await user.type(screen.getByRole('textbox', { name: 'Total paid for all drinks (JPY)' }), '100')
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText(/JPY\s+100$/)).toBeDefined()
    expect(within(preview).queryByText(/JPY\s+100\.00/)).toBeNull()
  })

  it('explains when changed preferences have cleared an earlier draft', () => {
    render(<LogPage {...initialization} draftWasReset headingId="retained-log-heading" />)
    expect(screen.getByRole('heading', { level: 1 }).id).toBe('retained-log-heading')
    expect(screen.getByText('Your previous draft was cleared after a currency or timezone change.')).toBeDefined()
  })

  it('does not replace an invalid explicitly supplied initial time with the current time', () => {
    render(<LogPage initialReferenceUtc="invalid" draftId="invalid-time" />)
    expect(screen.getByLabelText(/consumption date and time/i)).toHaveProperty('value', '')
  })

  it('lets users explore real draft volume while sugar and calorie estimates stay unavailable', async () => {
    const user = userEvent.setup()
    render(<LogPage {...initialization} />)
    await user.click(screen.getByRole('radio', { name: /500 ml/i }))
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText('1,000', { exact: false })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
    expect(screen.queryByText(/\d+\.\d+ kcal/)).toBeNull()
  })

  it('offers personal values separately from an empty reviewed catalog and requires explicit selection', async () => {
    const user = userEvent.setup()
    const personal = personalSetup()
    render(<LogPage {...initialization} references={[]} personalNutrition={personal} />)
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' })
    expect(select.disabled).toBe(false)
    expect(select.value).toBe('')
    expect(within(select).getAllByRole('option')).toHaveLength(2)
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getAllByText('Choose a nutrition reference to see estimates.')).toHaveLength(2)
    await user.selectOptions(select, JSON.stringify(['user-provided', personal.reference.id, 1]))
    expect(within(preview).getByText('34.65', { exact: false })).toBeDefined()
    expect(within(preview).getByText('138.6', { exact: false })).toBeDefined()
    expect(within(preview).getByText('User-provided — not independently verified.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
  })

  it('keeps reviewed products and personal label values in distinct groups', () => {
    render(<LogPage {...initialization} personalNutrition={personalSetup()} />)
    const select = screen.getByRole('combobox', { name: 'Coke product' })
    expect(within(select).getByRole('group', { name: 'Reviewed products' })).toBeDefined()
    expect(within(select).getByRole('group', { name: 'My label values' })).toBeDefined()
    expect(within(select).getAllByRole('option')).toHaveLength(3)
    expect(select).toHaveProperty('value', '')
  })

  it('does not replace edited inputs or select nutrition when the first personal setup becomes available', async () => {
    const user = userEvent.setup()
    const view = render(<LogPage {...initialization} />)
    await user.click(screen.getByRole('radio', { name: '500 ml' }))
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    const price = screen.getByRole<HTMLInputElement>('textbox', { name: /Total paid for all drinks/ })
    await user.type(price, '25.50')
    const focused = document.activeElement
    view.rerender(<LogPage {...initialization} personalNutrition={personalSetup()} />)
    expect(document.activeElement).toBe(focused)
    expect(price.value).toBe('25.50')
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveProperty('value', '2')
    expect(screen.getByLabelText('Consumption date and time')).toHaveProperty('value', '2026-11-08T00:05')
    expect(screen.getByRole('combobox', { name: 'Coke product' })).toHaveProperty('value', '')
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText('1,000', { exact: false })).toBeDefined()
    expect(within(preview).getAllByText('Choose a nutrition reference to see estimates.')).toHaveLength(2)
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
  })
})

function emptySession(): SessionState {
  const result = createSessionState()
  if (result.valid === false) throw new Error('Expected test session preferences.')
  return result.state
}

function acceptedReceipt(request: EntrySaveRequest, state = emptySession()): EntrySaveReceipt {
  const result = transitionSession(state, { type: 'add-entry', record: request.record })
  if (result.outcome !== 'accepted') throw new Error('Expected an accepted test record.')
  return { requestId: request.requestId, result }
}

function controlledPage(options: { timeZone?: string; personalNutrition?: PersonalNutritionSetup; draftId?: string; strict?: boolean; entries?: readonly SessionEntryRecord[] } = {}) {
  const addEntry = vi.fn<(request: EntrySaveRequest) => void>()
  let receipt: EntrySaveReceipt | null = null
  let active = true
  let entries = options.entries
  const content = () => <LogPage {...initialization} {...options} entries={entries} addEntry={addEntry} lastEntryResult={receipt} isActive={active} />
  const view = render(options.strict ? <StrictMode>{content()}</StrictMode> : content())
  return {
    addEntry,
    request() { return addEntry.mock.calls[addEntry.mock.calls.length - 1][0] },
    publish(next: EntrySaveReceipt | null, isActive = active) {
      receipt = next
      active = isActive
      view.rerender(options.strict ? <StrictMode>{content()}</StrictMode> : content())
    },
    updateEntries(next: readonly SessionEntryRecord[]) {
      entries = next
      view.rerender(options.strict ? <StrictMode>{content()}</StrictMode> : content())
    },
  }
}

async function completeDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: /Total paid for all drinks/ }), '0')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Coke product' }),
    JSON.stringify(['reviewed', 'coca-cola-original-taste-gb', 1]))
}

describe('recent entries alongside the retained Log interface', () => {
  it('shows an empty recent-entries region after the editable form without another success announcement', () => {
    render(<LogPage {...initialization} />)
    const form = screen.getByRole('region', { name: 'Drink entry form' })
    const recent = screen.getByRole('region', { name: 'Recent session entries' })
    expect(form.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(recent).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(recent).getByText('No drinks saved this session yet.')).toBeDefined()
    expect(within(recent).queryByRole('status')).toBeNull()
    expect(within(recent).queryByText('Saved for this session only.')).toBeNull()
  })

  it('keeps accepted records below the confirmation and the new draft after Log another drink', async () => {
    const user = userEvent.setup()
    const page = controlledPage()
    await completeDraft(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const receipt = acceptedReceipt(page.request())
    page.publish(receipt)
    // Only records supplied from shared state populate the list, not a retained receipt.
    const recent = screen.getByRole('region', { name: 'Recent session entries' })
    expect(within(recent).queryAllByRole('listitem')).toHaveLength(0)
    page.updateEntries(receipt.result.state.entries)
    const confirmation = screen.getByRole('region', { name: 'Your drink is logged.' })
    expect(confirmation.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(recent).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getAllByText('Saved for this session only.')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Log another drink' }))
    expect(screen.getByRole('combobox', { name: 'Coke product' })).toHaveProperty('value', '')
    expect(within(recent).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '330 ml' }))
  })

  it('does not change an unfinished draft or move focus when shared entries update', async () => {
    const user = userEvent.setup()
    const page = controlledPage()
    await completeDraft(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const accepted = acceptedReceipt(page.request())
    // A rejected request leaves this form editable, while another accepted record can be displayed.
    const result = transitionSession(accepted.result.state, { type: 'add-entry', record: page.request().record })
    page.publish({ requestId: page.request().requestId, result })
    const price = screen.getByRole<HTMLInputElement>('textbox', { name: /Total paid for all drinks/ })
    await user.clear(price)
    await user.type(price, '25.50')
    const selected = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' }).value
    const focused = document.activeElement
    page.updateEntries(accepted.result.state.entries)
    expect(document.activeElement).toBe(focused)
    expect(price.value).toBe('25.50')
    expect(screen.getByRole('combobox', { name: 'Coke product' })).toHaveProperty('value', selected)
    expect(within(screen.getByRole('region', { name: 'Recent session entries' })).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
  })
})

describe('request-matched temporary drink saving', () => {
  it('requires complete data, guards rapid clicks, and waits for accepted state before confirming', async () => {
    const user = userEvent.setup()
    const page = controlledPage()
    const save = screen.getByRole('button', { name: 'Save entry' })
    expect(save).toHaveProperty('disabled', true)
    await completeDraft(user)
    expect(save).toHaveProperty('disabled', false)
    act(() => { fireEvent.click(save); fireEvent.click(save) })
    expect(page.addEntry).toHaveBeenCalledTimes(1)
    const request = page.request()
    expect(request.record.entry.id).toBe(initialization.draftId)
    expect(request.record.entry.totalPriceMinor).toBe(0)
    expect(request.record.nutritionProvenance.kind).toBe('reviewed')
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Quantity' }).matches(':disabled')).toBe(true)
    page.publish(acceptedReceipt({ ...request, requestId: 'unrelated-request' }))
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    const accepted = acceptedReceipt(request)
    page.publish(accepted)
    expect(screen.getByText('Saved for this session only.')).toBeDefined()
    expect(screen.queryByRole('textbox', { name: 'Quantity' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Draft preview' })).toBeNull()
    expect(document.activeElement?.id).toBe('logging-saved-heading')
  })

  it('ignores a matching accepted receipt for the wrong entry and consumes the correct receipt only once', async () => {
    const user = userEvent.setup()
    const page = controlledPage()
    await completeDraft(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const request = page.request()
    const wrong = { ...request, record: { ...request.record, entry: { ...request.record.entry, id: 'another-entry' } } }
    page.publish(acceptedReceipt(wrong))
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    const correct = acceptedReceipt(request)
    page.publish(correct)
    await user.click(screen.getByRole('button', { name: 'Log another drink' }))
    page.publish({ ...correct })
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Coke product' })).toHaveProperty('value', '')
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveProperty('value', '1')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '330 ml' }))
  })

  it.each(['invalid', 'duplicate'] as const)('keeps all editable fields after a %s result and retries with the same entry ID', async outcome => {
    const user = userEvent.setup()
    const personal = personalSetup()
    const page = controlledPage({ timeZone: 'America/New_York', personalNutrition: personal })
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('Custom serving size (ml)'), { target: { value: ' 00375 ' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Quantity' }), { target: { value: '02' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Total paid for all drinks/ }), { target: { value: '25.50' } })
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    fireEvent.change(screen.getByLabelText('Consumption date and time'), { target: { value: '2024-11-03T01:30' } })
    await user.click(screen.getByRole('radio', { name: /Later occurrence/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Coke product' }), JSON.stringify(['user-provided', personal.reference.id, 1]))
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const first = page.request()
    let result
    if (outcome === 'duplicate') {
      const accepted = acceptedReceipt(first)
      result = transitionSession(accepted.result.state, { type: 'add-entry', record: first.record })
    } else {
      result = transitionSession(emptySession(), { type: 'add-entry', record: { ...first.record, entry: { ...first.record.entry, quantity: 0 } } })
    }
    expect(result.outcome).toBe(outcome)
    page.publish({ requestId: first.requestId, result })
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(document.activeElement?.id).toBe('logging-save-error')
    expect(screen.getByLabelText('Custom serving size (ml)')).toHaveProperty('value', ' 00375 ')
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveProperty('value', '02')
    expect(screen.getByRole('textbox', { name: /Total paid for all drinks/ })).toHaveProperty('value', '25.50')
    expect(screen.getByRole('radio', { name: 'Price unknown' })).toHaveProperty('checked', true)
    expect(screen.getByRole('radio', { name: /Later occurrence/ })).toHaveProperty('checked', true)
    expect(screen.getByLabelText('Consumption date and time')).toHaveProperty('value', '2024-11-03T01:30')
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const retry = page.request()
    expect(retry.requestId).not.toBe(first.requestId)
    expect(retry.record).toEqual(first.record)
    expect(retry.record.entry.consumedAt).toBe('2024-11-03T06:30:00.000Z')
    expect(retry.record.entry.totalPriceMinor).toBeNull()
    expect(retry.record.nutritionProvenance.reference).toEqual(personal.reference)
  })

  it('displays aggregate-session rejection without clearing an otherwise valid draft', async () => {
    const user = userEvent.setup()
    const page = controlledPage()
    await completeDraft(user)
    fireEvent.change(screen.getByRole('textbox', { name: /Total paid for all drinks/ }), { target: { value: '0.01' } })
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const request = page.request()
    const initial = acceptedReceipt({ ...request, record: { ...request.record, entry: { ...request.record.entry, id: 'existing-large-price', totalPriceMinor: Number.MAX_SAFE_INTEGER } } })
    const result = transitionSession(initial.result.state, { type: 'add-entry', record: request.record })
    expect(result.outcome).toBe('invalid')
    page.publish({ requestId: request.requestId, result })
    expect(screen.getByRole('alert').textContent).toContain('Known spending for this currency exceeds the safe integer range.')
    expect(screen.getByRole('textbox', { name: /Total paid for all drinks/ })).toHaveProperty('value', '0.01')
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', false)
  })

  it('keeps input when initial UUID generation fails and retries ID setup without remounting the form', async () => {
    const user = userEvent.setup()
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => { throw new Error('Unavailable') })
    const addEntry = vi.fn()
    render(<LogPage initialReferenceUtc={initialization.initialReferenceUtc} addEntry={addEntry} />)
    await completeDraft(user)
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
    uuid.mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
    await user.click(screen.getByRole('button', { name: 'Retry ID setup' }))
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveProperty('value', '2')
    expect(screen.getByRole('textbox', { name: /Total paid for all drinks/ })).toHaveProperty('value', '0')
    expect(screen.getByRole('combobox', { name: 'Coke product' })).not.toHaveProperty('value', '')
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', false)
    uuid.mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(addEntry.mock.calls[0][0].record.entry.id).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('retains a saved confirmation if restarting cannot generate a UUID, then recovers deliberately', async () => {
    const user = userEvent.setup()
    const page = controlledPage()
    await completeDraft(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    page.publish(acceptedReceipt(page.request()))
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => { throw new Error('Unavailable') })
    await user.click(screen.getByRole('button', { name: 'Log another drink' }))
    expect(screen.getByText('Saved for this session only.')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('saved entry is unchanged')
    expect(document.activeElement?.id).toBe('logging-restart-error')
    uuid.mockReturnValueOnce('33333333-3333-4333-8333-333333333333')
    await user.click(screen.getByRole('button', { name: 'Log another drink' }))
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Coke product' })).toHaveProperty('value', '')
  })

  it('does not steal focus when an acknowledgement arrives while Log is inactive', async () => {
    const user = userEvent.setup()
    const page = controlledPage({ strict: true })
    await completeDraft(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const focused = document.activeElement
    page.publish(acceptedReceipt(page.request()), false)
    expect(document.activeElement?.id).not.toBe('logging-saved-heading')
    // The removed Save button may return focus to body; it must never focus inactive Log.
    expect(document.activeElement === focused || document.activeElement === document.body).toBe(true)
    page.publish(null, true)
    expect(screen.getByText('Saved for this session only.')).toBeDefined()
  })
})
