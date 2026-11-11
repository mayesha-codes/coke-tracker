// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import SessionProvider from '../../app/session/SessionProvider'
import { SessionContext, useSession } from '../../app/session/sessionContext'
import { createSessionState, transitionSession } from '../../app/session/sessionState'
import type { SessionState } from '../../app/session/sessionState'
import type { TrackingSettings } from '../../domain/types'
import PreferencesPage from './PreferencesPage'
import { INITIAL_USER_PREFERENCES } from './preferences'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function initialState(preferences: TrackingSettings = INITIAL_USER_PREFERENCES): SessionState {
  const created = createSessionState(preferences)
  if (created.valid === false) throw new Error('Expected valid initial preferences.')
  return created.state
}

function StoredPreferences() {
  const { state } = useSession()
  return <>
    <div data-testid="stored-preferences">{JSON.stringify(state.preferences)}</div>
    <div data-testid="stored-nutrition">{JSON.stringify(state.personalNutrition)}</div>
  </>
}

function setup(options: { preferences?: TrackingSettings; hasLogDraft?: boolean } = {}) {
  const user = userEvent.setup()
  render(<SessionProvider initialState={initialState(options.preferences)}>
    <PreferencesPage hasLogDraft={options.hasLogDraft} />
    <StoredPreferences />
  </SessionProvider>)
  return user
}

function currencyField() {
  return screen.getByLabelText<HTMLSelectElement>('Currency')
}

function timezoneField() {
  return screen.getByLabelText<HTMLInputElement>('Reporting timezone')
}

function storedPreferences(): TrackingSettings {
  return JSON.parse(screen.getByTestId('stored-preferences').textContent ?? '{}')
}

describe('international session preferences', () => {
  it('offers four English currency choices with editable Tokyo and yen suggestions', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' }).id).toBe('view-heading')
    expect(currencyField().value).toBe('JPY')
    expect(timezoneField().value).toBe('Asia/Tokyo')
    expect(within(currencyField()).getAllByRole('option').map(option => option.textContent)).toEqual([
      'JPY — Japanese yen', 'USD — US dollar', 'EUR — Euro', 'BDT — Bangladeshi taka',
    ])
    expect(screen.queryByRole('combobox', { name: /language|country/i })).toBeNull()
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('')
  })

  it('keeps edits local until Apply and then preserves the existing daily limit', async () => {
    const user = setup({ preferences: { ...INITIAL_USER_PREFERENCES, dailyLimitMl: 500 } })
    await user.selectOptions(currencyField(), 'EUR')
    await user.clear(timezoneField())
    await user.type(timezoneField(), 'Europe/Paris')
    expect(storedPreferences().currency).toBe('JPY')
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(storedPreferences()).toEqual({ currency: 'EUR', reportingTimeZone: 'Europe/Paris', dailyLimitMl: 500 })
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('Preferences applied for this session.')
  })

  it('supports valid IANA zones beyond the helpful suggestions', async () => {
    const user = setup()
    expect(timezoneField().getAttribute('list')).toBe('preferences-timezone-suggestions')
    expect(document.getElementById('preferences-timezone-suggestions')?.querySelector('option[value="UTC"]')).not.toBeNull()
    await user.clear(timezoneField())
    await user.type(timezoneField(), 'Africa/Nairobi')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(storedPreferences().reportingTimeZone).toBe('Africa/Nairobi')
    expect(timezoneField().getAttribute('aria-invalid')).toBe('false')
  })

  it('preserves a valid existing currency outside the initial menu', async () => {
    const user = setup({ preferences: { ...INITIAL_USER_PREFERENCES, currency: 'CHF' } })
    expect(currencyField().value).toBe('CHF')
    expect(within(currencyField()).getByRole('option', { name: 'CHF — Current currency' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(storedPreferences().currency).toBe('CHF')
  })

  it('explains temporary data and preserves drafts across navigation until preferences change', () => {
    setup()
    expect(screen.getByText(/Refreshing or closing this page clears them/)).toBeDefined()
    expect(screen.getByText('Your unfinished Log draft stays with you between pages.')).toBeDefined()
    expect(screen.getByText(/Applying a different currency or timezone resets that draft/)).toBeDefined()
  })
})

// Illustrative input for form behavior only; no production nutrition defaults.
function fillPersonalNutrition() {
  fireEvent.change(screen.getByLabelText('Product description'), { target: { value: 'My illustrative can' } })
  fireEvent.change(screen.getByLabelText('Sugar (g per 100 ml)'), { target: { value: '10.5' } })
  fireEvent.change(screen.getByLabelText('Calories (kcal per 100 ml)'), { target: { value: '42' } })
  fireEvent.change(screen.getByLabelText('Source description'), { target: { value: 'Illustrative package label' } })
}

describe('separate preferences and personal nutrition forms', () => {
  it('renders two named sibling forms without nesting either submission', () => {
    setup()
    const preferencesForm = screen.getByRole('form', { name: 'Your preferences' })
    const nutritionForm = screen.getByRole('form', { name: 'Personal nutrition setup' })
    expect(preferencesForm.contains(nutritionForm)).toBe(false)
    expect(nutritionForm.contains(preferencesForm)).toBe(false)
    expect(screen.getByLabelText<HTMLInputElement>('Product description').value).toBe('')
    expect(screen.getByRole('status', { name: 'Nutrition application status' }).textContent).toBe('')
  })

  it('applies nutrition without applying unfinished currency or timezone edits', async () => {
    const user = setup({ hasLogDraft: true })
    await user.selectOptions(currencyField(), 'EUR')
    await user.clear(timezoneField())
    await user.type(timezoneField(), 'Invalid/Zone')
    fillPersonalNutrition()
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    expect(storedPreferences()).toEqual(INITIAL_USER_PREFERENCES)
    expect(screen.getByTestId('stored-nutrition').textContent).toContain('user-provided')
    expect(screen.getByRole('status', { name: 'Nutrition application status' }).textContent).toContain('applied')
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('')
    expect(screen.queryByText('Your previous Log draft has been reset.')).toBeNull()
    expect(document.getElementById('preferences-error-summary')).toBeNull()
  })

  it('submits only the nutrition form when Enter is pressed in a nutrition field', async () => {
    const user = setup()
    await user.selectOptions(currencyField(), 'USD')
    fillPersonalNutrition()
    await user.click(screen.getByLabelText('Source description'))
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('stored-nutrition').textContent).toContain('My illustrative can')
    expect(storedPreferences().currency).toBe('JPY')
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('')
  })

  it('applies preferences without validating or applying the blank nutrition form', async () => {
    const user = setup()
    await user.selectOptions(currencyField(), 'BDT')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(storedPreferences().currency).toBe('BDT')
    expect(screen.getByTestId('stored-nutrition').textContent).toBe('null')
    expect(screen.getByLabelText('Product description').getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.getByRole('status', { name: 'Nutrition application status' }).textContent).toBe('')
  })

  it('keeps both successful application statuses independent when the other form is submitted', async () => {
    const user = setup()
    fillPersonalNutrition()
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    const nutritionStatus = screen.getByRole('status', { name: 'Nutrition application status' }).textContent
    const nutritionBefore = screen.getByTestId('stored-nutrition').textContent
    await user.selectOptions(currencyField(), 'USD')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent)
      .toBe('Preferences applied for this session.')
    expect(screen.getByRole('status', { name: 'Nutrition application status' }).textContent).toBe(nutritionStatus)
    expect(screen.getByTestId('stored-nutrition').textContent).toBe(nutritionBefore)
  })

  it('offers applied personal nutrition in Log without silently selecting it or enabling Save', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<SessionProvider><App /><StoredPreferences /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    fillPersonalNutrition()
    await user.click(screen.getByRole('button', { name: 'Apply personal nutrition' }))
    const applied = screen.getByTestId('stored-nutrition').textContent
    await user.click(screen.getByRole('button', { name: 'Log' }))
    expect(screen.getByRole('button', { name: 'Save entry' }).hasAttribute('disabled')).toBe(true)
    const referenceSelect = screen.getByLabelText<HTMLSelectElement>('Coke product')
    expect(referenceSelect.disabled).toBe(false)
    expect(referenceSelect.value).toBe('')
    expect(within(referenceSelect).getByRole('group', { name: 'Reviewed products' })).toBeDefined()
    expect(within(referenceSelect).getByRole('group', { name: 'My label values' })).toBeDefined()
    expect(within(referenceSelect).getByRole('option', { name: /Coca-Cola Original Taste — Great Britain/ })).toBeDefined()
    expect(within(referenceSelect).getByRole('option', { name: /My illustrative can/ })).toBeDefined()
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getAllByText('Choose a nutrition reference to see estimates.')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByTestId('stored-nutrition').textContent).toBe(applied)
    expect(screen.getByLabelText<HTMLInputElement>('Product description').value).toBe('My illustrative can')
    expect(within(screen.getByRole('region', { name: 'Applied for this session' }))
      .getByText('User-provided — not independently verified.')).toBeDefined()
    expect(screen.getByRole('status', { name: 'Nutrition application status' }).textContent).toBe('')
  })
})

describe('preference validation and accessible feedback', () => {
  it.each(['Not/AZone', '+09:00', ''])('rejects timezone %j and focuses the invalid field after Apply', async timeZone => {
    const user = setup()
    await user.clear(timezoneField())
    if (timeZone) await user.type(timezoneField(), timeZone)
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(document.activeElement).toBe(timezoneField())
    expect(timezoneField().getAttribute('aria-invalid')).toBe('true')
    expect(timezoneField().getAttribute('aria-describedby')).toContain('preferences-timezone-error')
    expect(document.getElementById('preferences-timezone-error')?.textContent).toContain('IANA timezone')
    expect(storedPreferences().reportingTimeZone).toBe('Asia/Tokyo')
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('')
  })

  it('focuses currency first if both controls are invalid', async () => {
    const user = setup()
    fireEvent.change(currencyField(), { target: { value: '' } })
    await user.clear(timezoneField())
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(document.activeElement).toBe(currencyField())
    expect(currencyField().getAttribute('aria-invalid')).toBe('true')
    expect(currencyField().getAttribute('aria-describedby')).toContain('preferences-currency-error')
    expect(storedPreferences().currency).toBe('JPY')
  })

  it('shows a timezone error on blur and clears it when corrected', async () => {
    const user = setup()
    await user.clear(timezoneField())
    await user.type(timezoneField(), 'Invalid/Zone')
    expect(document.getElementById('preferences-timezone-error')).toBeNull()
    await user.tab()
    expect(timezoneField().getAttribute('aria-invalid')).toBe('true')
    await user.clear(timezoneField())
    await user.type(timezoneField(), 'UTC')
    expect(timezoneField().getAttribute('aria-invalid')).toBe('false')
  })

  it('allows keyboard submission and clears confirmation when preferences are edited again', async () => {
    const user = setup()
    await user.clear(timezoneField())
    await user.type(timezoneField(), 'UTC')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('Preferences applied for this session.')
    expect(storedPreferences().reportingTimeZone).toBe('UTC')
    await user.selectOptions(currencyField(), 'USD')
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('')
    expect(storedPreferences().currency).toBe('JPY')
  })

  it('announces a draft reset only when changed preferences affect an existing draft', async () => {
    const user = setup({ hasLogDraft: true })
    await user.selectOptions(currencyField(), 'USD')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toContain('Preferences applied for this session.')
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toContain('Your previous Log draft has been reset.')
  })

  it('does not claim a draft reset when unchanged preferences are applied', async () => {
    const user = setup({ hasLogDraft: true })
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('Preferences applied for this session.')
    expect(screen.queryByText('Your previous Log draft has been reset.')).toBeNull()
  })

  it('waits for a committed accepted result before announcing application', async () => {
    const user = userEvent.setup()
    const state = initialState()
    const updatePreferences = vi.fn()
    const view = render(<SessionContext.Provider value={{ state, updatePreferences, lastPreferenceResult: null, applyPersonalNutrition: vi.fn(), lastNutritionResult: null, addEntry: vi.fn(), lastEntryResult: null }}>
      <PreferencesPage />
    </SessionContext.Provider>)
    await user.selectOptions(currencyField(), 'USD')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(updatePreferences).toHaveBeenCalledWith({ ...INITIAL_USER_PREFERENCES, currency: 'USD' })
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('')

    const accepted = transitionSession(state, { type: 'update-preferences', preferences: updatePreferences.mock.calls[0][0] })
    expect(accepted.outcome).toBe('accepted')
    view.rerender(<SessionContext.Provider value={{ state: accepted.state, updatePreferences, lastPreferenceResult: accepted, applyPersonalNutrition: vi.fn(), lastNutritionResult: null, addEntry: vi.fn(), lastEntryResult: null }}>
      <PreferencesPage />
    </SessionContext.Provider>)
    expect(screen.getByRole('status', { name: 'Preference application status' }).textContent).toBe('Preferences applied for this session.')
  })
})
