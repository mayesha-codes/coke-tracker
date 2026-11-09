// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import SessionProvider from './app/session/SessionProvider'
import { useSession } from './app/session/sessionContext'
import { createSessionState, transitionSession } from './app/session/sessionState'
import type { SessionState } from './app/session/sessionState'
import { createDrinkEntry } from './domain/entries'
import type { TrackingSettings } from './domain/types'

const referenceTime = '2026-11-08T09:30:00.000Z'

beforeEach(() => {
  // Only the clock is fixed: user-event still uses real timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(referenceTime))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Test controls exercise Context updates without adding any production settings route. */
function SessionTestControls() {
  const { state, updatePreferences } = useSession()
  return (
    <aside aria-label="Test session controls">
      <button type="button" onClick={() => updatePreferences({ ...state.preferences, currency: 'USD' })}>Use USD in test</button>
      <button type="button" onClick={() => updatePreferences({ ...state.preferences, reportingTimeZone: 'UTC' })}>Use UTC in test</button>
      <output data-testid="test-session-history">{JSON.stringify(state.entries)}</output>
    </aside>
  )
}

function renderApp(options: { initialState?: SessionState; controls?: boolean } = {}) {
  const user = userEvent.setup()
  const view = render(
    <SessionProvider initialState={options.initialState}>
      {options.controls && <SessionTestControls />}
      <App />
    </SessionProvider>,
  )
  return { user, ...view }
}

function makeState(preferences: TrackingSettings): SessionState {
  const result = createSessionState(preferences)
  if (result.valid === false) throw new Error('Expected valid test preferences.')
  return result.state
}

function quantityInput() {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Quantity' })
}

function priceInput() {
  return screen.getByRole<HTMLInputElement>('textbox', { name: /Total paid for all drinks/ })
}

function dateTimeInput() {
  return screen.getByLabelText<HTMLInputElement>('Consumption date and time')
}

function customServingInput() {
  return screen.getByLabelText<HTMLInputElement>('Custom serving size (ml)')
}

async function navigate(user: ReturnType<typeof userEvent.setup>, view: 'Home' | 'Log' | 'History' | 'Settings') {
  await user.click(screen.getByRole('button', { name: view }))
}

describe('shared preferences across the application views', () => {
  it('starts the application with editable yen and Tokyo suggestions', async () => {
    const { user } = renderApp()
    await navigate(user, 'Settings')
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveProperty('value', 'JPY')
    expect(screen.getByLabelText('Reporting timezone', { exact: true })).toHaveProperty('value', 'Asia/Tokyo')
    await navigate(user, 'Log')
    expect(priceInput().getAttribute('aria-label')).toContain('JPY')
    expect(dateTimeInput().value).toBe('2026-11-08T18:30')
    expect(screen.getByText('Asia/Tokyo', { exact: true })).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Nutrition reference' }).disabled).toBe(true)
  })

  it('retains applied preferences through Home, History, Settings, and Log navigation', async () => {
    const { user } = renderApp()
    await navigate(user, 'Settings')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'EUR')
    const zone = screen.getByLabelText('Reporting timezone', { exact: true })
    await user.clear(zone)
    await user.type(zone, 'Europe/Paris')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.getByText('Preferences applied for this session.')).toBeDefined()
    await navigate(user, 'Home')
    await navigate(user, 'History')
    await navigate(user, 'Settings')
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveProperty('value', 'EUR')
    expect(screen.getByLabelText('Reporting timezone', { exact: true })).toHaveProperty('value', 'Europe/Paris')
    await navigate(user, 'Log')
    expect(priceInput().getAttribute('aria-label')).toContain('EUR')
    expect(dateTimeInput().value).toBe('2026-11-08T10:30')
  })

  it('starts a fresh provider mount with the original session suggestions', async () => {
    const first = renderApp()
    await navigate(first.user, 'Settings')
    await first.user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'USD')
    await first.user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    first.unmount()
    const second = renderApp()
    await navigate(second.user, 'Settings')
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveProperty('value', 'JPY')
    expect(screen.getByLabelText('Reporting timezone', { exact: true })).toHaveProperty('value', 'Asia/Tokyo')
  })
})

describe('unfinished drink drafts', () => {
  it('retains serving, quantity, time, price mode, and cached price while navigating', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: '500 ml' }))
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.type(priceInput(), '300')
    fireEvent.change(dateTimeInput(), { target: { value: '2026-11-07T20:15' } })
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    for (const view of ['Home', 'History', 'Settings'] as const) await navigate(user, view)
    expect(screen.queryByRole('textbox', { name: 'Quantity' })).toBeNull()
    await navigate(user, 'Log')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '500 ml' }).checked).toBe(true)
    expect(quantityInput().value).toBe('2')
    expect(dateTimeInput().value).toBe('2026-11-07T20:15')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Price unknown' }).checked).toBe(true)
    expect(priceInput().disabled).toBe(true)
    await user.click(screen.getByRole('radio', { name: 'Price known' }))
    expect(priceInput().value).toBe('300')
  })

  it('preserves the draft when the same preference values are applied again', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await user.type(priceInput(), '100')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    fireEvent.change(dateTimeInput(), { target: { value: '2026-10-31T21:15' } })
    await navigate(user, 'Settings')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.queryByText('Your previous Log draft has been reset.')).toBeNull()
    await navigate(user, 'Log')
    expect(priceInput().value).toBe('100')
    expect(quantityInput().value).toBe('2')
    expect(dateTimeInput().value).toBe('2026-10-31T21:15')
    expect(screen.queryByText('Your previous draft was cleared after a currency or timezone change.')).toBeNull()
  })

  it('clears a former decimal price instead of reinterpreting it as yen', async () => {
    const initialState = makeState({ currency: 'USD', reportingTimeZone: 'Asia/Tokyo', dailyLimitMl: null })
    const { user } = renderApp({ initialState })
    await navigate(user, 'Log')
    await user.type(priceInput(), '12.50')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await navigate(user, 'Settings')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'JPY')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.getByText('Your previous Log draft has been reset.')).toBeDefined()
    await navigate(user, 'Log')
    expect(priceInput().value).toBe('')
    expect(quantityInput().value).toBe('1')
    expect(priceInput().getAttribute('aria-label')).toContain('JPY')
    expect(screen.getByText('Your previous draft was cleared after a currency or timezone change.')).toBeDefined()
    await user.type(priceInput(), '100')
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText(/JPY\s*100/)).toBeDefined()
    expect(within(preview).queryByText(/100\.00/)).toBeNull()
  })

  it('creates a fresh local clock value when the reporting timezone changes', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    fireEvent.change(dateTimeInput(), { target: { value: '2026-10-01T08:45' } })
    await user.type(priceInput(), '200')
    await navigate(user, 'Settings')
    const zone = screen.getByLabelText('Reporting timezone', { exact: true })
    await user.clear(zone)
    await user.type(zone, 'UTC')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    await navigate(user, 'Log')
    expect(dateTimeInput().value).toBe('2026-11-08T09:30')
    expect(priceInput().value).toBe('')
    expect(screen.getByText('UTC', { exact: true })).toBeDefined()
  })

  it('rejects an invalid timezone without losing the unfinished Log draft', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await user.type(priceInput(), '250')
    fireEvent.change(dateTimeInput(), { target: { value: '2026-10-01T10:15' } })
    await navigate(user, 'Settings')
    const zone = screen.getByLabelText('Reporting timezone', { exact: true })
    await user.clear(zone)
    await user.type(zone, '+09:00')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(document.activeElement).toBe(zone)
    expect(zone.getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByText('Preferences applied for this session.')).toBeNull()
    await navigate(user, 'Log')
    expect(priceInput().value).toBe('250')
    expect(dateTimeInput().value).toBe('2026-10-01T10:15')
    expect(screen.getByText('Asia/Tokyo', { exact: true })).toBeDefined()
  })

  it('resets cached unknown-price text and old review feedback after a Context currency change', async () => {
    const { user } = renderApp({ controls: true })
    await navigate(user, 'Log')
    await user.type(priceInput(), '300')
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(screen.getByRole('heading', { name: 'Check these details' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Use USD in test' }))
    expect(priceInput().value).toBe('')
    expect(priceInput().disabled).toBe(false)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Price known' }).checked).toBe(true)
    expect(screen.queryByRole('heading', { name: 'Check these details' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('clears the repeated-time choice instead of carrying it into another timezone', async () => {
    const initialState = makeState({ currency: 'JPY', reportingTimeZone: 'America/New_York', dailyLimitMl: null })
    const { user } = renderApp({ initialState, controls: true })
    await navigate(user, 'Log')
    fireEvent.change(dateTimeInput(), { target: { value: '2026-11-01T01:30' } })
    await user.click(screen.getByRole('radio', { name: /Later occurrence/ }))
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Later occurrence/ }).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Use UTC in test' }))
    expect(dateTimeInput().value).toBe('2026-11-08T09:30')
    expect(screen.queryByRole('radio', { name: /Later occurrence/ })).toBeNull()
  })

  it('keeps inactive Log controls out of keyboard navigation and uses one active view heading', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await navigate(user, 'Settings')
    expect(document.querySelectorAll('#view-heading')).toHaveLength(1)
    expect(screen.queryByRole('textbox', { name: 'Quantity' })).toBeNull()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Currency' }))
    expect(document.activeElement?.closest('[hidden]')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Settings')
  })
})

describe('custom serving drafts across application views', () => {
  it('retains the exact custom text, quantity, total price, and selected mode through navigation', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customServingInput(), ' 00375 ')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.type(priceInput(), '300')
    for (const view of ['Home', 'History', 'Settings'] as const) await navigate(user, view)
    expect(screen.queryByRole('textbox', { name: 'Custom serving size (ml)' })).toBeNull()
    await navigate(user, 'Log')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Custom' }).checked).toBe(true)
    expect(customServingInput().value).toBe(' 00375 ')
    expect(quantityInput().value).toBe('2')
    expect(priceInput().value).toBe('300')
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    const volumeLabel = within(preview).getByText('Volume', { selector: 'dt' })
    expect(volumeLabel.parentElement?.textContent?.replace(/\s+/g, ' ')).toContain('750 ml')
    expect(within(preview).getByText(/JPY\s*300/)).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Nutrition reference' }).disabled).toBe(true)
  })

  it('retains cached custom text when a numeric preset is selected during navigation', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customServingInput(), ' 00375 ')
    await user.click(screen.getByRole('radio', { name: '350 ml' }))
    await navigate(user, 'Home')
    await navigate(user, 'History')
    await navigate(user, 'Log')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '350 ml' }).checked).toBe(true)
    expect(screen.queryByRole('textbox', { name: 'Custom serving size (ml)' })).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    expect(customServingInput().value).toBe(' 00375 ')
  })

  it('keeps invalid custom text visible and unchanged after leaving and returning to Log', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customServingInput(), '375.5')
    await navigate(user, 'Home')
    await navigate(user, 'Log')
    expect(customServingInput().value).toBe('375.5')
    expect(customServingInput().getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Custom' }).checked).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('keeps Custom selected when its value equals a preset and unchanged preferences are applied', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customServingInput(), '350')
    await user.type(priceInput(), '100')
    await navigate(user, 'Settings')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.queryByText('Your previous Log draft has been reset.')).toBeNull()
    await navigate(user, 'Log')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Custom' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '350 ml' }).checked).toBe(false)
    expect(customServingInput().value).toBe('350')
    expect(priceInput().value).toBe('100')
  })

  it.each(['currency', 'timezone'] as const)('resets custom mode and cached text after an applied %s change', async change => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customServingInput(), '375')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.type(priceInput(), '300')
    fireEvent.change(dateTimeInput(), { target: { value: '2026-10-01T08:45' } })
    // A cached value must reset even if the Custom input is currently hidden.
    await user.click(screen.getByRole('radio', { name: '500 ml' }))
    await navigate(user, 'Settings')
    if (change === 'currency') {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'USD')
    } else {
      const zone = screen.getByLabelText('Reporting timezone', { exact: true })
      await user.clear(zone)
      await user.type(zone, 'UTC')
    }
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.getByText('Your previous Log draft has been reset.')).toBeDefined()
    await navigate(user, 'Log')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '330 ml' }).checked).toBe(true)
    expect(screen.queryByRole('textbox', { name: 'Custom serving size (ml)' })).toBeNull()
    expect(priceInput().value).toBe('')
    expect(quantityInput().value).toBe('1')
    expect(dateTimeInput().value).toBe(change === 'timezone' ? '2026-11-08T09:30' : '2026-11-08T18:30')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    expect(customServingInput().value).toBe('')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })
})

describe('historical data through preferences and navigation', () => {
  it('keeps an existing entry and user-provided nutrition provenance unchanged', async () => {
    // Rates and source metadata are illustrative fixtures, never production defaults.
    const reference = {
      id: 'illustrative-japan-label', version: 1, sugarGramsPer100Ml: 10, kcalPer100Ml: 40,
      productDescription: 'Illustrative personal label', source: { label: 'Illustrative package label' },
    }
    const created = createDrinkEntry({
      id: 'historical-test-entry', consumedAt: '2026-11-07T09:00:00Z', quantity: 2,
      servingMl: 330, totalPriceMinor: 300, currency: 'JPY',
    }, reference)
    if (created.valid === false) throw new Error('Expected a valid illustrative entry.')
    const initial = createSessionState()
    if (initial.valid === false) throw new Error('Expected initial preferences.')
    const added = transitionSession(initial.state, {
      type: 'add-entry',
      record: { entry: created.entry, nutritionProvenance: { kind: 'user-provided', reference } },
    })
    if (added.outcome !== 'accepted') throw new Error('Expected a valid illustrative session.')
    const { user } = renderApp({ initialState: added.state, controls: true })
    const before = screen.getByTestId('test-session-history').textContent
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customServingInput(), '375')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.click(screen.getByRole('radio', { name: '350 ml' }))
    expect(screen.getByTestId('test-session-history').textContent).toBe(before)
    await navigate(user, 'Settings')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'USD')
    const zone = screen.getByLabelText('Reporting timezone', { exact: true })
    await user.clear(zone)
    await user.type(zone, 'UTC')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    await navigate(user, 'History')
    await navigate(user, 'Home')
    expect(screen.getByTestId('test-session-history').textContent).toBe(before)
    expect(added.state.entries[0].entry.servingMl).toBe(330)
    expect(added.state.entries[0].nutritionProvenance.kind).toBe('user-provided')
  })
})
