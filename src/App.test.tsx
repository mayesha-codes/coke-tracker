// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import SessionProvider from './app/session/SessionProvider'
import { useSession } from './app/session/sessionContext'
import { createSessionState, transitionSession } from './app/session/sessionState'
import type { SessionEntryRecord, SessionState } from './app/session/sessionState'
import { createDrinkEntry } from './domain/entries'
import type { CreateDrinkEntryInput, TrackingSettings } from './domain/types'
import type { PersonalNutritionDraft } from './features/nutrition/nutritionInput'

const referenceTime = '2026-11-08T09:30:00.000Z'

// Illustrative label data for integration tests only, never production defaults.
const illustrativeNutrition: PersonalNutritionDraft = {
  productDescription: 'Illustrative personal can',
  sugarGramsPer100MlText: '10.5',
  kcalPer100MlText: '42',
  sourceDescription: 'Illustrative package label',
  sourceUrl: 'https://example.invalid/personal-label',
}

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

function renderApp(options: { initialState?: SessionState; controls?: boolean; strict?: boolean } = {}) {
  const user = userEvent.setup()
  const content = (
    <SessionProvider initialState={options.initialState}>
      {options.controls && <SessionTestControls />}
      <App />
    </SessionProvider>
  )
  const view = render(options.strict ? <StrictMode>{content}</StrictMode> : content)
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

function nutritionSelect() {
  return screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' })
}

function reviewStatus() {
  return screen.getByRole('status', { name: 'Review status' })
}

function previewMetric(name: string): string {
  const preview = screen.getByRole('region', { name: 'Draft preview' })
  return within(preview).getByText(name, { selector: 'dt' }).parentElement?.textContent?.replace(/\s+/g, ' ') ?? ''
}

function personalState(preferences: TrackingSettings = {
  currency: 'JPY', reportingTimeZone: 'Asia/Tokyo', dailyLimitMl: null,
}): SessionState {
  const result = transitionSession(makeState(preferences), {
    type: 'apply-personal-nutrition', id: 'illustrative-personal-label', draft: illustrativeNutrition,
  })
  if (result.outcome !== 'accepted') throw new Error('Expected a valid illustrative personal setup.')
  return result.state
}

function fillNutritionSettings(changes: Partial<PersonalNutritionDraft> = {}) {
  const draft = { ...illustrativeNutrition, ...changes }
  const labels = {
    productDescription: 'Product description', sugarGramsPer100MlText: 'Sugar (g per 100 ml)',
    kcalPer100MlText: 'Calories (kcal per 100 ml)', sourceDescription: 'Source description',
    sourceUrl: 'Source URL (optional)',
  } as const
  for (const field of Object.keys(labels) as (keyof typeof labels)[]) {
    fireEvent.change(screen.getByLabelText(labels[field]), { target: { value: draft[field] ?? '' } })
  }
}

async function selectPersonalNutrition(user: ReturnType<typeof userEvent.setup>, version = 1) {
  await user.selectOptions(nutritionSelect(), JSON.stringify(['user-provided', 'illustrative-personal-label', version]))
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
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' }).disabled).toBe(false)
    expect(nutritionSelect().value).toBe('')
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
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' }).disabled).toBe(false)
    expect(nutritionSelect().value).toBe('')
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

describe('personal nutrition selection in retained Log drafts', () => {
  it('lets a user explicitly choose the Great Britain product while retaining their custom draft and later personal fallback', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(customServingInput(), { target: { value: ' 00375 ' } })
    fireEvent.change(quantityInput(), { target: { value: '02' } })
    await user.type(priceInput(), '300')
    fireEvent.change(dateTimeInput(), { target: { value: '2026-11-07T20:15' } })
    expect(nutritionSelect().value).toBe('')
    await user.selectOptions(nutritionSelect(), JSON.stringify(['reviewed', 'coca-cola-original-taste-gb', 1]))
    expect(previewMetric('Volume')).toContain('750 ml')
    expect(previewMetric('Estimated sugar')).toContain('79.5 g')
    expect(previewMetric('Coke-only calories')).toContain('315 kcal')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    await navigate(user, 'Settings')
    fillNutritionSettings()
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    for (const view of ['Home', 'History', 'Log'] as const) await navigate(user, view)
    expect(nutritionSelect().value).toBe(JSON.stringify(['reviewed', 'coca-cola-original-taste-gb', 1]))
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    const personal = within(nutritionSelect()).getByRole('group', { name: 'My label values' })
    const option = within(personal).getByRole<HTMLOptionElement>('option', { name: /Illustrative personal can/ })
    await user.selectOptions(nutritionSelect(), option.value)
    expect(previewMetric('Estimated sugar')).toContain('78.75 g')
    expect(reviewStatus().textContent).toBe('')
    expect(customServingInput().value).toBe(' 00375 ')
    expect(quantityInput().value).toBe('02')
    expect(priceInput().value).toBe('300')
    expect(dateTimeInput().value).toBe('2026-11-07T20:15')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(false)
  })

  it('keeps an existing custom draft and repeated-time choice when personal nutrition is first configured', async () => {
    const initialState = makeState({ currency: 'JPY', reportingTimeZone: 'America/New_York', dailyLimitMl: null })
    const { user } = renderApp({ initialState })
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(customServingInput(), { target: { value: ' 00375 ' } })
    fireEvent.change(quantityInput(), { target: { value: '02' } })
    await user.type(priceInput(), '300')
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    fireEvent.change(dateTimeInput(), { target: { value: '2026-11-01T01:30' } })
    await user.click(screen.getByRole('radio', { name: /Later occurrence/ }))

    await navigate(user, 'Settings')
    fillNutritionSettings()
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    expect(screen.getByRole('status', { name: 'Nutrition application status' }).textContent).toContain('Version 1')
    for (const view of ['History', 'Home', 'Log'] as const) await navigate(user, view)

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Custom' }).checked).toBe(true)
    expect(customServingInput().value).toBe(' 00375 ')
    expect(quantityInput().value).toBe('02')
    expect(priceInput().value).toBe('300')
    expect(priceInput().disabled).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Price unknown' }).checked).toBe(true)
    expect(dateTimeInput().value).toBe('2026-11-01T01:30')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Later occurrence/ }).checked).toBe(true)
    expect(nutritionSelect().disabled).toBe(false)
    expect(nutritionSelect().value).toBe('')
    expect(previewMetric('Volume')).toContain('750 ml')
    expect(previewMetric('Estimated sugar')).toContain('Choose a nutrition reference to see estimates.')
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
    await user.click(screen.getByRole('radio', { name: 'Price known' }))
    expect(priceInput().value).toBe('300')
  })

  it('pins a version-one selection after Review until explicit adoption and preserves every other draft field', async () => {
    const initialState = personalState({ currency: 'JPY', reportingTimeZone: 'America/New_York', dailyLimitMl: null })
    const { user } = renderApp({ initialState })
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(customServingInput(), { target: { value: ' 00375 ' } })
    fireEvent.change(quantityInput(), { target: { value: '02' } })
    await user.type(priceInput(), '300')
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    fireEvent.change(dateTimeInput(), { target: { value: '2026-11-01T01:30' } })
    await user.click(screen.getByRole('radio', { name: /Later occurrence/ }))
    await selectPersonalNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(previewMetric('Estimated sugar')).toContain('78.75 g')
    expect(previewMetric('Coke-only calories')).toContain('315 kcal')

    await navigate(user, 'Settings')
    fillNutritionSettings({ sugarGramsPer100MlText: '11', kcalPer100MlText: '43' })
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    await navigate(user, 'Log')
    expect(nutritionSelect().value).toBe(JSON.stringify(['user-provided', 'illustrative-personal-label', 1]))
    expect(previewMetric('Estimated sugar')).toContain('78.75 g')
    expect(previewMetric('Coke-only calories')).toContain('315 kcal')
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(screen.getByText('Updated nutrition is available.')).toBeDefined()

    screen.getByRole('button', { name: 'Use latest values' }).focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(nutritionSelect())
    expect(nutritionSelect().value).toBe(JSON.stringify(['user-provided', 'illustrative-personal-label', 2]))
    expect(previewMetric('Estimated sugar')).toContain('82.5 g')
    expect(previewMetric('Coke-only calories')).toContain('322.5 kcal')
    expect(reviewStatus().textContent).toBe('')
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Custom' }).checked).toBe(true)
    expect(customServingInput().value).toBe(' 00375 ')
    expect(quantityInput().value).toBe('02')
    expect(priceInput().disabled).toBe(true)
    expect(priceInput().value).toBe('300')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Price unknown' }).checked).toBe(true)
    expect(dateTimeInput().value).toBe('2026-11-01T01:30')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Later occurrence/ }).checked).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(false)
    await user.click(screen.getByRole('radio', { name: 'Price known' }))
    expect(priceInput().value).toBe('300')
  })

  it('requires explicit adoption of a source-only revision even when its numeric estimates are unchanged', async () => {
    const { user } = renderApp({ initialState: personalState() })
    await navigate(user, 'Log')
    await user.type(priceInput(), '0')
    await selectPersonalNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    const sugarBefore = previewMetric('Estimated sugar')
    await navigate(user, 'Settings')
    fillNutritionSettings({ sourceDescription: 'Corrected illustrative source', sourceUrl: 'https://example.invalid/corrected' })
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    await navigate(user, 'Log')
    expect(document.querySelector('.logging-reference-details')?.textContent).toContain('Illustrative package label')
    expect(document.querySelector('.logging-reference-details')?.textContent).not.toContain('Corrected illustrative source')
    expect(screen.getByText('Updated nutrition is available.')).toBeDefined()
    expect(previewMetric('Estimated sugar')).toBe(sugarBefore)
    await user.click(screen.getByRole('button', { name: 'Use latest values' }))
    expect(document.querySelector('.logging-reference-details')?.textContent).toContain('Corrected illustrative source')
    expect(previewMetric('Estimated sugar')).toBe(sugarBefore)
    expect(reviewStatus().textContent).toBe('')
    expect(priceInput().value).toBe('0')
  })

  it('adopts the newest available revision after multiple Settings applications', async () => {
    const { user } = renderApp({ initialState: personalState() })
    await navigate(user, 'Log')
    await selectPersonalNutrition(user)
    await navigate(user, 'Settings')
    fillNutritionSettings({ sugarGramsPer100MlText: '11' })
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    fillNutritionSettings({ sugarGramsPer100MlText: '12' })
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    await navigate(user, 'Log')
    expect(nutritionSelect().value).toBe(JSON.stringify(['user-provided', 'illustrative-personal-label', 1]))
    expect(previewMetric('Estimated sugar')).toContain('34.65 g')
    await user.click(screen.getByRole('button', { name: 'Use latest values' }))
    expect(nutritionSelect().value).toBe(JSON.stringify(['user-provided', 'illustrative-personal-label', 3]))
    expect(previewMetric('Estimated sugar')).toContain('39.6 g')
    expect(screen.queryByRole('button', { name: 'Use latest values' })).toBeNull()
  })

  it('keeps the selected version and Review after normalized unchanged and rejected Settings submissions', async () => {
    const { user } = renderApp({ initialState: personalState() })
    await navigate(user, 'Log')
    await user.type(priceInput(), '100')
    await selectPersonalNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    await navigate(user, 'Settings')
    fillNutritionSettings({
      productDescription: ' Illustrative personal can ', sugarGramsPer100MlText: '010.5000', kcalPer100MlText: '042.00',
      sourceDescription: ' Illustrative package label ', sourceUrl: ' https://example.invalid/personal-label ',
    })
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    expect(screen.getByRole('status', { name: 'Nutrition application status' }).textContent).toContain('Version 1')
    fillNutritionSettings({ sugarGramsPer100MlText: '-1' })
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    expect(screen.getByLabelText('Sugar (g per 100 ml)').getAttribute('aria-invalid')).toBe('true')
    await navigate(user, 'Log')
    expect(nutritionSelect().value).toBe(JSON.stringify(['user-provided', 'illustrative-personal-label', 1]))
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(priceInput().value).toBe('100')
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    expect(previewMetric('Estimated sugar')).toContain('34.65 g')
  })

  it('preserves the selected nutrition and completed Review when unchanged preferences are applied', async () => {
    const { user } = renderApp({ initialState: personalState() })
    await navigate(user, 'Log')
    await user.type(priceInput(), '300')
    await selectPersonalNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    const selectedBefore = nutritionSelect().value
    await navigate(user, 'Settings')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    await navigate(user, 'Log')
    expect(nutritionSelect().value).toBe(selectedBefore)
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(priceInput().value).toBe('300')
  })

  it.each(['currency', 'timezone'] as const)('resets nutrition selection with the rest of the draft after a %s change', async change => {
    const { user } = renderApp({ initialState: personalState() })
    await navigate(user, 'Log')
    await user.type(priceInput(), '300')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await selectPersonalNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    await navigate(user, 'Settings')
    if (change === 'currency') await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'USD')
    else fireEvent.change(screen.getByLabelText('Reporting timezone', { exact: true }), { target: { value: 'UTC' } })
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    await navigate(user, 'Log')
    expect(nutritionSelect().disabled).toBe(false)
    expect(nutritionSelect().value).toBe('')
    expect(reviewStatus().textContent).toBe('')
    expect(priceInput().value).toBe('')
    expect(quantityInput().value).toBe('1')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('preserves historical snapshots and provenance when a draft adopts a newer setup', async () => {
    const state = personalState()
    const setup = state.personalNutrition
    if (setup === null) throw new Error('Expected the illustrative setup.')
    const created = createDrinkEntry({
      id: 'old-nutrition-entry', consumedAt: '2026-11-07T09:00:00Z', quantity: 2,
      servingMl: 330, totalPriceMinor: 300, currency: 'JPY',
    }, setup.reference)
    if (created.valid === false) throw new Error('Expected a valid illustrative entry.')
    const added = transitionSession(state, {
      type: 'add-entry', record: { entry: created.entry, nutritionProvenance: setup },
    })
    if (added.outcome !== 'accepted') throw new Error('Expected valid illustrative history.')
    const { user } = renderApp({ initialState: added.state, controls: true })
    const historyBefore = screen.getByTestId('test-session-history').textContent
    await navigate(user, 'Log')
    await selectPersonalNutrition(user)
    await navigate(user, 'Settings')
    fillNutritionSettings({ sugarGramsPer100MlText: '11', sourceDescription: 'New illustrative package label' })
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    await navigate(user, 'Log')
    await user.click(screen.getByRole('button', { name: 'Use latest values' }))
    expect(screen.getByTestId('test-session-history').textContent).toBe(historyBefore)
    expect(added.state.entries[0].entry.nutrition.referenceVersion).toBe(1)
    expect(added.state.entries[0].nutritionProvenance.reference.source.label).toBe('Illustrative package label')
    expect(added.state.entries[0].nutritionProvenance.kind).toBe('user-provided')
  })
})

function savedSessionEntries(): readonly SessionEntryRecord[] {
  return JSON.parse(screen.getByTestId('test-session-history').textContent ?? '[]')
}

function recentEntriesRegion() {
  return screen.getByRole('region', { name: 'Recent session entries' })
}

function recentEntryCards() {
  return within(recentEntriesRegion()).queryAllByRole('listitem')
}

function recentEntryText(card: HTMLElement) {
  return card.textContent?.replace(/\s+/g, ' ') ?? ''
}

/** Seed accepted history with illustrative label data, using the same pure session boundary. */
function withIllustrativeSavedEntry(state: SessionState, overrides: Partial<CreateDrinkEntryInput> = {}): SessionState {
  const provenance = state.personalNutrition
  if (provenance === null) throw new Error('Expected an illustrative personal setup.')
  const created = createDrinkEntry({
    id: `illustrative-recent-${state.entries.length + 1}`,
    consumedAt: referenceTime, quantity: 2, servingMl: 375,
    totalPriceMinor: 300, currency: 'JPY', ...overrides,
  }, provenance.reference)
  if (created.valid === false) throw new Error('Expected an illustrative drink entry.')
  const result = transitionSession(state, {
    type: 'add-entry', record: { entry: created.entry, nutritionProvenance: provenance },
  })
  if (result.outcome !== 'accepted') throw new Error('Expected accepted illustrative history.')
  return result.state
}

async function readyPersonalEntry(user: ReturnType<typeof userEvent.setup>) {
  await navigate(user, 'Log')
  await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
  await selectPersonalNutrition(user)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(false)
}

describe('recent session entries connected to shared history', () => {
  it('starts with an honest empty state and no list-triggered success announcement', async () => {
    const { user } = renderApp()
    await navigate(user, 'Log')
    expect(recentEntryCards()).toHaveLength(0)
    expect(within(recentEntriesRegion()).getByText(/No drinks saved this session/)).toBeDefined()
    expect(within(recentEntriesRegion()).queryByRole('status')).toBeNull()
    expect(recentEntriesRegion().querySelector('[aria-live]')).toBeNull()
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(recentEntriesRegion().contains(document.activeElement)).toBe(false)
  })

  it('keeps previous drinks visible after Log another and orders a newly saved backdated drink first', async () => {
    const { user } = renderApp({ initialState: personalState(), controls: true })
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(customServingInput(), { target: { value: '375' } })
    fireEvent.change(quantityInput(), { target: { value: '2' } })
    await user.type(priceInput(), '300')
    await selectPersonalNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const first = savedSessionEntries()[0]
    expect(recentEntryCards()).toHaveLength(1)
    expect(recentEntryCards()[0].textContent).toContain('750 ml')
    expect(recentEntryText(recentEntryCards()[0])).toContain('JPY 300')
    expect(screen.getAllByText('Saved for this session only.')).toHaveLength(1)
    expect(within(recentEntriesRegion()).queryByRole('status')).toBeNull()
    expect(document.activeElement?.id).toBe('logging-saved-heading')

    await user.click(screen.getByRole('button', { name: 'Log another drink' }))
    expect(recentEntryCards()).toHaveLength(1)
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '330 ml' }))
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    fireEvent.change(dateTimeInput(), { target: { value: '2026-10-01T08:15' } })
    await selectPersonalNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const records = savedSessionEntries()
    const cards = recentEntryCards()
    expect(cards).toHaveLength(2)
    expect(cards.map(card => card.querySelector('time')?.dateTime))
      .toEqual([records[1].entry.consumedAt, first.entry.consumedAt])
    expect(Date.parse(records[1].entry.consumedAt)).toBeLessThan(Date.parse(first.entry.consumedAt))
    expect(recentEntryText(cards[0])).toContain('Unknown (JPY)')
    expect(recentEntryText(cards[1])).toContain('JPY 300')
    expect(screen.getAllByText('Saved for this session only.')).toHaveLength(1)
  })

  it('retains cards across navigation and reformats time after preferences reset the draft without rewriting history', async () => {
    const first = withIllustrativeSavedEntry(personalState(), {
      consumedAt: '2026-11-07T09:00:00Z', currency: 'USD', totalPriceMinor: 250,
    })
    const initialState = withIllustrativeSavedEntry(first, {
      consumedAt: '2026-11-07T18:30:00Z', currency: 'JPY', totalPriceMinor: 0,
    })
    const before = structuredClone(initialState.entries)
    const { user } = renderApp({ initialState, controls: true })
    await navigate(user, 'Log')
    const originalTimes = recentEntryCards().map(card => ({
      utc: card.querySelector('time')?.dateTime, text: card.querySelector('time')?.textContent,
    }))
    expect(recentEntryText(recentEntryCards()[0])).toContain('JPY 0')
    expect(recentEntryText(recentEntryCards()[1])).toContain('USD 2.50')
    await user.type(priceInput(), '300')
    for (const view of ['Home', 'History', 'Settings', 'Log'] as const) await navigate(user, view)
    expect(priceInput().value).toBe('300')
    expect(recentEntryCards().map(card => card.querySelector('time')?.dateTime))
      .toEqual(originalTimes.map(time => time.utc))
    await navigate(user, 'Settings')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'EUR')
    fireEvent.change(screen.getByLabelText('Reporting timezone', { exact: true }), { target: { value: 'America/New_York' } })
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    await navigate(user, 'Log')
    expect(priceInput().value).toBe('')
    expect(nutritionSelect().value).toBe('')
    const reformatted = recentEntryCards().map(card => ({
      utc: card.querySelector('time')?.dateTime, text: card.querySelector('time')?.textContent,
    }))
    expect(reformatted.map(time => time.utc)).toEqual(originalTimes.map(time => time.utc))
    expect(reformatted.map(time => time.text)).not.toEqual(originalTimes.map(time => time.text))
    expect(recentEntriesRegion().textContent).toContain('America/New_York')
    expect(recentEntryText(recentEntryCards()[0])).toContain('JPY 0')
    expect(recentEntryText(recentEntryCards()[1])).toContain('USD 2.50')
    expect(savedSessionEntries()).toEqual(before)
    expect(initialState.entries).toEqual(before)
    expect(Object.isFrozen(initialState.entries[0].entry.nutrition)).toBe(true)
  })

  it('keeps a historical nutrition version and source after Settings publishes different personal values', async () => {
    const initialState = withIllustrativeSavedEntry(personalState())
    const before = structuredClone(initialState.entries)
    const { user } = renderApp({ initialState, controls: true })
    await navigate(user, 'Settings')
    fillNutritionSettings({
      sugarGramsPer100MlText: '11', kcalPer100MlText: '43',
      sourceDescription: 'New illustrative source', sourceUrl: 'https://example.invalid/new-source',
    })
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    await navigate(user, 'Log')
    const card = recentEntryCards()[0]
    expect(within(card).getByText('Nutrition version 1')).toBeDefined()
    expect(within(card).queryByText('Nutrition version 2')).toBeNull()
    await user.click(within(card).getByText('Source details', { selector: 'summary' }))
    expect(within(card).getByRole('link', { name: 'Illustrative package label' }).getAttribute('href'))
      .toBe('https://example.invalid/personal-label')
    expect(within(card).queryByText('New illustrative source')).toBeNull()
    expect(savedSessionEntries()).toEqual(before)
    expect(initialState.entries[0].nutritionProvenance.reference.version).toBe(1)
    expect(Object.isFrozen(initialState.entries[0].nutritionProvenance.reference.source)).toBe(true)
  })

  it.each(['duplicate ID', 'aggregate spending overflow'] as const)('does not add a recent card after a rejected save caused by %s', async cause => {
    const existingId = '312f6a55-e737-41b3-b067-43c8537ef314'
    const initialState = withIllustrativeSavedEntry(personalState(), {
      id: existingId,
      totalPriceMinor: cause === 'aggregate spending overflow' ? Number.MAX_SAFE_INTEGER : 300,
    })
    if (cause === 'duplicate ID') {
      vi.spyOn(globalThis.crypto, 'randomUUID')
        .mockReturnValueOnce(existingId)
        .mockReturnValue('303e7a77-e6b6-4fea-8af7-d132570497be')
    }
    const { user } = renderApp({ initialState, controls: true })
    await navigate(user, 'Log')
    if (cause === 'duplicate ID') await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    else await user.type(priceInput(), '1')
    await selectPersonalNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(screen.getByRole('heading', { name: 'Entry was not saved' })).toBeDefined()
    expect(recentEntryCards()).toHaveLength(1)
    expect(savedSessionEntries()).toEqual(initialState.entries)
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(recentEntriesRegion().contains(document.activeElement)).toBe(false)
    expect(document.activeElement?.id).toBe('logging-save-error')
  })

  it('clears recent session history when the provider is mounted fresh', async () => {
    const first = renderApp({ initialState: withIllustrativeSavedEntry(personalState()) })
    await navigate(first.user, 'Log')
    expect(recentEntryCards()).toHaveLength(1)
    first.unmount()
    const fresh = renderApp()
    await navigate(fresh.user, 'Log')
    expect(recentEntryCards()).toHaveLength(0)
    expect(within(recentEntriesRegion()).getByText(/No drinks saved this session/)).toBeDefined()
  })
})

describe('temporary saving through the application and shared session', () => {
  it.each(['known zero', 'unknown'] as const)('saves a reviewed product with a %s total price', async mode => {
    const { user } = renderApp({ controls: true })
    await navigate(user, 'Log')
    if (mode === 'known zero') await user.type(priceInput(), '0')
    else await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    await user.selectOptions(nutritionSelect(), JSON.stringify(['reviewed', 'coca-cola-original-taste-gb', 1]))
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.click(screen.getByRole('button', { name: 'Save entry' }))

    expect(screen.getByText('Saved for this session only.')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Draft preview' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Quantity' })).toBeNull()
    const records = savedSessionEntries()
    expect(records).toHaveLength(1)
    expect(records[0].entry).toMatchObject({
      quantity: 2, servingMl: 330, consumedAt: referenceTime,
      currency: 'JPY', totalPriceMinor: mode === 'known zero' ? 0 : null,
      nutrition: { referenceId: 'coca-cola-original-taste-gb', referenceVersion: 1 },
    })
    expect(records[0].nutritionProvenance.kind).toBe('reviewed')
    expect(records[0].nutritionProvenance.reference.productDescription).toBe('Coca-Cola Original Taste — Great Britain')
  })

  it('saves the pinned personal version, custom volume, and later time occurrence after Settings publishes newer values', async () => {
    const initialState = personalState({ currency: 'JPY', reportingTimeZone: 'America/New_York', dailyLimitMl: null })
    const { user } = renderApp({ initialState, controls: true })
    await navigate(user, 'Log')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(customServingInput(), { target: { value: ' 00375 ' } })
    fireEvent.change(quantityInput(), { target: { value: '02' } })
    await user.type(priceInput(), '300')
    fireEvent.change(dateTimeInput(), { target: { value: '2026-11-01T01:30' } })
    await user.click(screen.getByRole('radio', { name: /Later occurrence/ }))
    await selectPersonalNutrition(user)
    await navigate(user, 'Settings')
    fillNutritionSettings({ sugarGramsPer100MlText: '11', kcalPer100MlText: '43', sourceDescription: 'New illustrative label' })
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    await navigate(user, 'Log')
    expect(screen.getByText('Updated nutrition is available.')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Save entry' }))

    const first = savedSessionEntries()[0]
    expect(first.entry).toMatchObject({
      quantity: 2, servingMl: 375, totalPriceMinor: 300, currency: 'JPY',
      consumedAt: '2026-11-01T06:30:00.000Z',
      nutrition: { referenceVersion: 1, sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42 },
    })
    expect(first.nutritionProvenance).toMatchObject({
      kind: 'user-provided', reference: { version: 1, source: { label: 'Illustrative package label' } },
    })
    expect(screen.getByText('Saved for this session only.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Use latest values' })).toBeNull()
    const before = JSON.stringify(savedSessionEntries())

    await navigate(user, 'Settings')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'USD')
    fireEvent.change(screen.getByLabelText('Reporting timezone', { exact: true }), { target: { value: 'UTC' } })
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    await navigate(user, 'Log')
    expect(JSON.stringify(savedSessionEntries())).toBe(before)
    expect(nutritionSelect().value).toBe('')
    expect(priceInput().value).toBe('')
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
  })

  it('retains a saved confirmation through navigation and accepts intentionally identical drinks after Log another drink', async () => {
    const { user } = renderApp({ initialState: personalState(), controls: true })
    await readyPersonalEntry(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const first = savedSessionEntries()[0]
    for (const view of ['Home', 'History', 'Settings', 'Log'] as const) await navigate(user, view)
    expect(screen.getByText('Saved for this session only.')).toBeDefined()
    expect(savedSessionEntries()).toEqual([first])
    await user.click(screen.getByRole('button', { name: 'Log another drink' }))
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '330 ml' }).checked).toBe(true)
    expect(quantityInput().value).toBe('1')
    expect(priceInput().value).toBe('')
    expect(nutritionSelect().value).toBe('')
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    await selectPersonalNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    const records = savedSessionEntries()
    expect(records).toHaveLength(2)
    expect(records[1].entry.id).not.toBe(first.entry.id)
    const { id: firstId, ...firstValues } = first.entry
    const { id: secondId, ...secondValues } = records[1].entry
    expect(firstId).toBeTruthy()
    expect(secondId).toBeTruthy()
    expect(secondValues).toEqual(firstValues)
    expect(records[1].nutritionProvenance).toEqual(first.nutritionProvenance)
  })

  it('keeps Enter in a text field as Review and saves only after activating the focused Save button', async () => {
    const { user } = renderApp({ initialState: personalState(), controls: true })
    await navigate(user, 'Log')
    await user.type(priceInput(), '0')
    await selectPersonalNutrition(user)
    priceInput().focus()
    await user.keyboard('{Enter}')
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(savedSessionEntries()).toHaveLength(0)
    screen.getByRole('button', { name: 'Save entry' }).focus()
    await user.keyboard('{Enter}{Enter}')
    expect(savedSessionEntries()).toHaveLength(1)
    expect(screen.getByText('Saved for this session only.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Save entry' })).toBeNull()
  })

  it('adds one record for a rapid double click under StrictMode and never resubmits on navigation', async () => {
    const { user } = renderApp({ initialState: personalState(), controls: true, strict: true })
    await readyPersonalEntry(user)
    await user.dblClick(screen.getByRole('button', { name: 'Save entry' }))
    expect(savedSessionEntries()).toHaveLength(1)
    await navigate(user, 'Home')
    await navigate(user, 'Log')
    expect(savedSessionEntries()).toHaveLength(1)
    expect(screen.getByText('Saved for this session only.')).toBeDefined()
  })

  it('retains an editable draft when request UUID generation fails and saves it with the original entry ID after retry', async () => {
    const entryId = '303e7a77-e6b6-4fea-8af7-d132570497be'
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce(entryId)
      .mockImplementationOnce(() => { throw new Error('Illustrative UUID failure') })
    const { user } = renderApp({ initialState: personalState(), controls: true })
    await readyPersonalEntry(user)
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(customServingInput(), { target: { value: ' 00375 ' } })
    fireEvent.change(quantityInput(), { target: { value: '02' } })
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(savedSessionEntries()).toHaveLength(0)
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(customServingInput().value).toBe(' 00375 ')
    expect(quantityInput().value).toBe('02')
    expect(nutritionSelect().value).toBe(JSON.stringify(['user-provided', 'illustrative-personal-label', 1]))
    uuid.mockRestore()
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(savedSessionEntries()).toHaveLength(1)
    expect(savedSessionEntries()[0].entry.id).toBe(entryId)
    expect(savedSessionEntries()[0].entry.servingMl).toBe(375)
  })

  it.each(['Use USD in test', 'Use UTC in test'])('preserves an accepted record but does not confirm the new draft after %s is queued during saving', async change => {
    const { user } = renderApp({ initialState: personalState(), controls: true })
    await readyPersonalEntry(user)
    const save = screen.getByRole('button', { name: 'Save entry' })
    const update = screen.getByRole('button', { name: change })
    act(() => { save.click(); update.click() })
    expect(savedSessionEntries()).toHaveLength(1)
    expect(screen.queryByText('Saved for this session only.')).toBeNull()
    expect(nutritionSelect().value).toBe('')
    expect(quantityInput().value).toBe('1')
    expect(priceInput().value).toBe('')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('does not focus hidden Log content when saving and navigation are queued together', async () => {
    const { user } = renderApp({ initialState: personalState(), controls: true })
    await readyPersonalEntry(user)
    const save = screen.getByRole('button', { name: 'Save entry' })
    const settings = screen.getByRole('button', { name: 'Settings' })
    act(() => { save.click(); settings.click() })
    expect(savedSessionEntries()).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Settings')
    expect(document.activeElement?.closest('[hidden], [inert]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Log another drink' })).toBeNull()
    await navigate(user, 'Log')
    expect(screen.getByText('Saved for this session only.')).toBeDefined()
    expect(savedSessionEntries()).toHaveLength(1)
  })
})
