// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionProvider from '../../app/session/SessionProvider'
import { SessionContext, useSession } from '../../app/session/sessionContext'
import { createSessionState, transitionSession } from '../../app/session/sessionState'
import type { SessionState } from '../../app/session/sessionState'
import type { TrackingSettings } from '../../domain/types'
import PreferencesPage from './PreferencesPage'
import { INITIAL_USER_PREFERENCES } from './preferences'

afterEach(cleanup)

function initialState(preferences: TrackingSettings = INITIAL_USER_PREFERENCES): SessionState {
  const created = createSessionState(preferences)
  if (created.valid === false) throw new Error('Expected valid initial preferences.')
  return created.state
}

function StoredPreferences() {
  const { state } = useSession()
  return <div data-testid="stored-preferences">{JSON.stringify(state.preferences)}</div>
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
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('keeps edits local until Apply and then preserves the existing daily limit', async () => {
    const user = setup({ preferences: { ...INITIAL_USER_PREFERENCES, dailyLimitMl: 500 } })
    await user.selectOptions(currencyField(), 'EUR')
    await user.clear(timezoneField())
    await user.type(timezoneField(), 'Europe/Paris')
    expect(storedPreferences().currency).toBe('JPY')
    expect(screen.getByRole('status').textContent).toBe('')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(storedPreferences()).toEqual({ currency: 'EUR', reportingTimeZone: 'Europe/Paris', dailyLimitMl: 500 })
    expect(screen.getByRole('status').textContent).toBe('Preferences applied for this session.')
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
    expect(screen.getByRole('status').textContent).toBe('')
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
    expect(screen.getByRole('status').textContent).toBe('Preferences applied for this session.')
    expect(storedPreferences().reportingTimeZone).toBe('UTC')
    await user.selectOptions(currencyField(), 'USD')
    expect(screen.getByRole('status').textContent).toBe('')
    expect(storedPreferences().currency).toBe('JPY')
  })

  it('announces a draft reset only when changed preferences affect an existing draft', async () => {
    const user = setup({ hasLogDraft: true })
    await user.selectOptions(currencyField(), 'USD')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.getByRole('status').textContent).toContain('Preferences applied for this session.')
    expect(screen.getByRole('status').textContent).toContain('Your previous Log draft has been reset.')
  })

  it('does not claim a draft reset when unchanged preferences are applied', async () => {
    const user = setup({ hasLogDraft: true })
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(screen.getByRole('status').textContent).toBe('Preferences applied for this session.')
    expect(screen.queryByText('Your previous Log draft has been reset.')).toBeNull()
  })

  it('waits for a committed accepted result before announcing application', async () => {
    const user = userEvent.setup()
    const state = initialState()
    const updatePreferences = vi.fn()
    const view = render(<SessionContext.Provider value={{ state, updatePreferences, lastPreferenceResult: null }}>
      <PreferencesPage />
    </SessionContext.Provider>)
    await user.selectOptions(currencyField(), 'USD')
    await user.click(screen.getByRole('button', { name: 'Apply preferences' }))
    expect(updatePreferences).toHaveBeenCalledWith({ ...INITIAL_USER_PREFERENCES, currency: 'USD' })
    expect(screen.getByRole('status').textContent).toBe('')

    const accepted = transitionSession(state, { type: 'update-preferences', preferences: updatePreferences.mock.calls[0][0] })
    expect(accepted.outcome).toBe('accepted')
    view.rerender(<SessionContext.Provider value={{ state: accepted.state, updatePreferences, lastPreferenceResult: accepted }}>
      <PreferencesPage />
    </SessionContext.Provider>)
    expect(screen.getByRole('status').textContent).toBe('Preferences applied for this session.')
  })
})
