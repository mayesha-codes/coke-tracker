// @vitest-environment jsdom
import { StrictMode, useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TrackingSettings } from '../../domain/types'
import type { PersonalNutritionDraft } from '../../features/nutrition/nutritionInput'
import SessionProvider from './SessionProvider'
import { useSession } from './sessionContext'
import type { SessionContextValue } from './sessionContext'
import { createSessionState, transitionSession } from './sessionState'
import type { SessionState } from './sessionState'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const usdPreferences: TrackingSettings = {
  currency: 'USD', reportingTimeZone: 'America/New_York', dailyLimitMl: 500,
}
const eurPreferences: TrackingSettings = {
  currency: 'EUR', reportingTimeZone: 'Europe/Paris', dailyLimitMl: 750,
}

function makeState(preferences?: TrackingSettings): SessionState {
  const result = createSessionState(preferences)
  if (result.valid === false) throw new Error('Expected valid test preferences.')
  return result.state
}

// Product details and nutrition rates are illustrative fixtures, never production defaults.
function stateWithHistory(): SessionState {
  const result = transitionSession(makeState(), {
    type: 'add-entry',
    record: {
      entry: {
        id: 'illustrative-saved-entry', consumedAt: '2026-11-08T09:30:00Z',
        quantity: 2, servingMl: 330, totalPriceMinor: 300, currency: 'JPY',
        nutrition: {
          referenceId: 'illustrative-label', referenceVersion: 1,
          sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42,
        },
      },
      nutritionProvenance: {
        kind: 'user-provided',
        reference: {
          id: 'illustrative-label', version: 1,
          productDescription: 'Illustrative product for provider tests',
          sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42,
          source: { label: 'Illustrative package label' },
        },
      },
    },
  })
  if (result.outcome !== 'accepted') throw new Error('Expected valid illustrative history.')
  return result.state
}

function SessionProbe({ onSnapshot }: { onSnapshot?: (value: SessionContextValue) => void }) {
  const session = useSession()
  useEffect(() => { onSnapshot?.(session) }, [onSnapshot, session])
  return (
    <div>
      <p data-testid="currency">{session.state.preferences.currency}</p>
      <p data-testid="timezone">{session.state.preferences.reportingTimeZone}</p>
      <p data-testid="limit">{String(session.state.preferences.dailyLimitMl)}</p>
      <p data-testid="count">{session.state.entries.length}</p>
      <p data-testid="outcome">{session.lastPreferenceResult?.outcome ?? 'not applied'}</p>
      <button onClick={() => session.updatePreferences(usdPreferences)}>Use USD and New York</button>
      <button onClick={() => session.updatePreferences({ ...usdPreferences, reportingTimeZone: 'Invalid/Zone' })}>
        Use invalid timezone
      </button>
      <button onClick={() => {
        session.updatePreferences(usdPreferences)
        session.updatePreferences(eurPreferences)
      }}>Update twice quickly</button>
      <button onClick={() => {
        session.updatePreferences(usdPreferences)
        session.updatePreferences({ ...eurPreferences, reportingTimeZone: '+09:00' })
      }}>Valid then invalid</button>
    </div>
  )
}

describe('the in-memory React session provider', () => {
  it('initializes editable JPY and Tokyo suggestions without claiming an update was applied', () => {
    render(<SessionProvider><SessionProbe /></SessionProvider>)
    expect(screen.getByTestId('currency').textContent).toBe('JPY')
    expect(screen.getByTestId('timezone').textContent).toBe('Asia/Tokyo')
    expect(screen.getByTestId('limit').textContent).toBe('null')
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.getByTestId('outcome').textContent).toBe('not applied')
  })

  it('exposes an accepted result after applying a valid preference update', async () => {
    const user = userEvent.setup()
    let snapshot: SessionContextValue | undefined
    render(<SessionProvider><SessionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Use USD and New York' }))
    expect(screen.getByTestId('currency').textContent).toBe('USD')
    expect(screen.getByTestId('timezone').textContent).toBe('America/New_York')
    expect(screen.getByTestId('limit').textContent).toBe('500')
    expect(screen.getByTestId('outcome').textContent).toBe('accepted')
    expect(Object.isFrozen(snapshot?.state.preferences)).toBe(true)
  })

  it('exposes C1 field issues while keeping rejected preference updates unchanged', async () => {
    const user = userEvent.setup()
    let snapshot: SessionContextValue | undefined
    const original = makeState()
    render(<SessionProvider initialState={original}>
      <SessionProbe onSnapshot={value => { snapshot = value }} />
    </SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Use invalid timezone' }))
    expect(snapshot?.state).toBe(original)
    expect(screen.getByTestId('outcome').textContent).toBe('invalid')
    if (snapshot?.lastPreferenceResult?.outcome !== 'invalid') throw new Error('Expected invalid update.')
    expect(snapshot.lastPreferenceResult.issues.map(issue => issue.field)).toContain('preferences.reportingTimeZone')
  })

  it('processes rapid sequential updates in order and keeps the latest accepted preferences', async () => {
    const user = userEvent.setup()
    render(<SessionProvider><SessionProbe /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Update twice quickly' }))
    expect(screen.getByTestId('currency').textContent).toBe('EUR')
    expect(screen.getByTestId('timezone').textContent).toBe('Europe/Paris')
    expect(screen.getByTestId('limit').textContent).toBe('750')
    expect(screen.getByTestId('outcome').textContent).toBe('accepted')
  })

  it('rejects a second queued update against the newly accepted state rather than the old render', async () => {
    const user = userEvent.setup()
    render(<SessionProvider><SessionProbe /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Valid then invalid' }))
    expect(screen.getByTestId('currency').textContent).toBe('USD')
    expect(screen.getByTestId('timezone').textContent).toBe('America/New_York')
    expect(screen.getByTestId('limit').textContent).toBe('500')
    expect(screen.getByTestId('outcome').textContent).toBe('invalid')
  })

  it('preserves the exact historical entry array, snapshots, provenance, and original currency', async () => {
    const user = userEvent.setup()
    const original = stateWithHistory()
    const before = structuredClone(original.entries)
    let snapshot: SessionContextValue | undefined
    render(<SessionProvider initialState={original}>
      <SessionProbe onSnapshot={value => { snapshot = value }} />
    </SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Use USD and New York' }))
    expect(snapshot?.state.entries).toBe(original.entries)
    expect(snapshot?.state.entries).toEqual(before)
    expect(snapshot?.state.entries[0].entry).toBe(original.entries[0].entry)
    expect(snapshot?.state.entries[0].entry.currency).toBe('JPY')
    expect(snapshot?.state.entries[0].nutritionProvenance.kind).toBe('user-provided')
  })

  it('retains the session when consumers unmount and return beneath the same provider', async () => {
    const user = userEvent.setup()
    const view = render(<SessionProvider><SessionProbe /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Use USD and New York' }))
    view.rerender(<SessionProvider><p>Another application view</p></SessionProvider>)
    view.rerender(<SessionProvider><SessionProbe /></SessionProvider>)
    expect(screen.getByTestId('currency').textContent).toBe('USD')
    expect(screen.getByTestId('timezone').textContent).toBe('America/New_York')
  })

  it('uses initialization props only on the first mount', async () => {
    const user = userEvent.setup()
    const view = render(<SessionProvider initialState={makeState()}><SessionProbe /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Use USD and New York' }))
    view.rerender(<SessionProvider initialState={makeState(eurPreferences)}><SessionProbe /></SessionProvider>)
    expect(screen.getByTestId('currency').textContent).toBe('USD')
  })

  it('starts a fresh empty session when the provider is unmounted and mounted again', async () => {
    const user = userEvent.setup()
    const view = render(<SessionProvider initialState={stateWithHistory()}><SessionProbe /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Use USD and New York' }))
    view.unmount()
    render(<SessionProvider><SessionProbe /></SessionProvider>)
    expect(screen.getByTestId('currency').textContent).toBe('JPY')
    expect(screen.getByTestId('timezone').textContent).toBe('Asia/Tokyo')
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.getByTestId('outcome').textContent).toBe('not applied')
  })

  it('initializes safely under StrictMode without adding or duplicating historical entries', () => {
    const initial = stateWithHistory()
    render(<StrictMode><SessionProvider initialState={initial}><SessionProbe /></SessionProvider></StrictMode>)
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(initial.entries).toHaveLength(1)
    expect(screen.getByTestId('outcome').textContent).toBe('not applied')
  })

  it('explains a missing provider instead of silently creating separate sessions', () => {
    expect(() => render(<SessionProbe />)).toThrow('useSession must be used within a SessionProvider.')
  })
})

// These per-100-ml rates and source details are illustrative test input only.
function personalDraft(overrides: Partial<PersonalNutritionDraft> = {}): PersonalNutritionDraft {
  return {
    productDescription: 'Illustrative personal label',
    sugarGramsPer100MlText: '10.5',
    kcalPer100MlText: '42',
    sourceDescription: 'Illustrative values transcribed from a can',
    sourceUrl: 'https://example.invalid/personal-label',
    ...overrides,
  }
}

function NutritionProbe({ onSnapshot }: { onSnapshot?: (value: SessionContextValue) => void }) {
  const session = useSession()
  useEffect(() => { onSnapshot?.(session) }, [onSnapshot, session])
  return (
    <div>
      <p data-testid="nutrition-outcome">{session.lastNutritionResult?.outcome ?? 'not applied'}</p>
      <p data-testid="nutrition-version">{session.state.personalNutrition?.reference.version ?? 'not configured'}</p>
      <button onClick={() => session.applyPersonalNutrition(personalDraft())}>Apply illustrative label</button>
      <button onClick={() => session.applyPersonalNutrition(personalDraft({ sugarGramsPer100MlText: '' }))}>
        Apply invalid label
      </button>
      <button onClick={() => session.applyPersonalNutrition(personalDraft({
        productDescription: ' Illustrative personal label ',
        sugarGramsPer100MlText: '010.500', kcalPer100MlText: '042.00',
        sourceDescription: ' Illustrative values transcribed from a can ',
        sourceUrl: ' https://example.invalid/personal-label ',
      }))}>Apply equivalent label</button>
      <button onClick={() => session.applyPersonalNutrition(personalDraft({ sugarGramsPer100MlText: '11' }))}>
        Change illustrative sugar
      </button>
      <button onClick={() => session.applyPersonalNutrition(personalDraft({ sourceDescription: 'Corrected illustrative source' }))}>
        Change illustrative source
      </button>
      <button onClick={() => {
        session.applyPersonalNutrition(personalDraft())
        session.applyPersonalNutrition(personalDraft({ kcalPer100MlText: '43' }))
      }}>Apply two labels quickly</button>
      <button onClick={() => {
        session.applyPersonalNutrition(personalDraft())
        session.applyPersonalNutrition(personalDraft({ kcalPer100MlText: '' }))
      }}>Valid label then invalid label</button>
      <button onClick={() => {
        session.applyPersonalNutrition(personalDraft())
        session.updatePreferences(usdPreferences)
        session.applyPersonalNutrition(personalDraft({ kcalPer100MlText: '43' }))
        session.updatePreferences(eurPreferences)
      }}>Interleave both settings</button>
      <button onClick={() => session.updatePreferences(usdPreferences)}>Apply provider test preferences</button>
      <button onClick={() => session.updatePreferences({ ...usdPreferences, reportingTimeZone: 'Invalid/Zone' })}>
        Reject provider test preferences
      </button>
    </div>
  )
}

describe('separate personal nutrition commands in the session provider', () => {
  it('starts without nutrition data or an application result and creates no ID during render', () => {
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID')
    let snapshot: SessionContextValue | undefined
    render(<StrictMode><SessionProvider><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider></StrictMode>)
    expect(snapshot?.state.personalNutrition).toBeNull()
    expect(snapshot?.lastNutritionResult).toBeNull()
    expect(snapshot?.lastPreferenceResult).toBeNull()
    expect(uuid).not.toHaveBeenCalled()
  })

  it('applies validated label input with an application-generated UUID and frozen user-provided values', async () => {
    const user = userEvent.setup()
    const id = 'f04f4c62-a997-4e41-9adc-b4bc1f6342f5'
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(id)
    let snapshot: SessionContextValue | undefined
    const original = makeState()
    render(<SessionProvider initialState={original}><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Apply illustrative label' }))
    expect(uuid).toHaveBeenCalledTimes(1)
    expect(snapshot?.lastNutritionResult?.outcome).toBe('accepted')
    expect(snapshot?.lastPreferenceResult).toBeNull()
    expect(snapshot?.state.preferences).toBe(original.preferences)
    expect(snapshot?.state.entries).toBe(original.entries)
    const setup = snapshot?.state.personalNutrition
    expect(setup?.kind).toBe('user-provided')
    expect(setup?.reference.id).toBe(id)
    expect(setup?.reference.version).toBe(1)
    expect(setup?.reference.sugarGramsPer100Ml).toBe(10.5)
    expect(Object.isFrozen(setup)).toBe(true)
    expect(Object.isFrozen(setup?.reference)).toBe(true)
    expect(Object.isFrozen(setup?.reference.source)).toBe(true)
    expect(original.personalNutrition).toBeNull()
  })

  it('returns field-specific C4A issues without partially changing session state', async () => {
    const user = userEvent.setup()
    const original = stateWithHistory()
    let snapshot: SessionContextValue | undefined
    render(<SessionProvider initialState={original}><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Apply invalid label' }))
    expect(snapshot?.state).toBe(original)
    expect(snapshot?.lastPreferenceResult).toBeNull()
    if (snapshot?.lastNutritionResult?.outcome !== 'invalid') throw new Error('Expected rejected nutrition.')
    expect(snapshot.lastNutritionResult.issues.map(issue => issue.field)).toContain('personalNutrition.sugarGramsPer100MlText')
  })

  it('acknowledges equivalent normalized input without creating another version', async () => {
    const user = userEvent.setup()
    let snapshot: SessionContextValue | undefined
    render(<SessionProvider><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Apply illustrative label' }))
    const previous = snapshot?.state
    const previousResult = snapshot?.lastNutritionResult
    await user.click(screen.getByRole('button', { name: 'Apply equivalent label' }))
    expect(snapshot?.state).toBe(previous)
    expect(snapshot?.lastNutritionResult?.outcome).toBe('accepted')
    expect(snapshot?.lastNutritionResult).not.toBe(previousResult)
    expect(snapshot?.state.personalNutrition?.reference.version).toBe(1)
  })

  it.each(['Change illustrative sugar', 'Change illustrative source'])(
    'uses C4A versioning when the user chooses %s', async name => {
      const user = userEvent.setup()
      let snapshot: SessionContextValue | undefined
      render(<SessionProvider><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
      await user.click(screen.getByRole('button', { name: 'Apply illustrative label' }))
      const previousSetup = snapshot?.state.personalNutrition
      await user.click(screen.getByRole('button', { name }))
      expect(snapshot?.state.personalNutrition?.reference.version).toBe(2)
      expect(snapshot?.state.personalNutrition?.reference.id).toBe(previousSetup?.reference.id)
      expect(previousSetup?.reference.version).toBe(1)
      expect(snapshot?.state.personalNutrition?.kind).toBe('user-provided')
    },
  )

  it('processes two initial nutrition commands against the latest state with one stable setup identity', async () => {
    const user = userEvent.setup()
    const firstId = 'f04f4c62-a997-4e41-9adc-b4bc1f6342f5'
    const secondId = '5704b021-cb0b-4c44-97d9-45faadfe4884'
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce(firstId).mockReturnValueOnce(secondId)
    let snapshot: SessionContextValue | undefined
    render(<StrictMode><SessionProvider><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider></StrictMode>)
    await user.click(screen.getByRole('button', { name: 'Apply two labels quickly' }))
    expect(snapshot?.lastNutritionResult?.outcome).toBe('accepted')
    expect(snapshot?.state.personalNutrition?.reference.id).toBe(firstId)
    expect(snapshot?.state.personalNutrition?.reference.version).toBe(2)
    expect(snapshot?.state.personalNutrition?.reference.kcalPer100Ml).toBe(43)
  })

  it('rejects a queued invalid edit while retaining the newly accepted setup', async () => {
    const user = userEvent.setup()
    let snapshot: SessionContextValue | undefined
    render(<SessionProvider><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Valid label then invalid label' }))
    expect(snapshot?.lastNutritionResult?.outcome).toBe('invalid')
    expect(snapshot?.state.personalNutrition?.reference.version).toBe(1)
    expect(snapshot?.state.personalNutrition?.reference.kcalPer100Ml).toBe(42)
  })

  it('keeps independent result statuses and state when preferences and nutrition are interleaved', async () => {
    const user = userEvent.setup()
    const original = stateWithHistory()
    const history = structuredClone(original.entries)
    let snapshot: SessionContextValue | undefined
    render(<SessionProvider initialState={original}><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Interleave both settings' }))
    expect(snapshot?.lastPreferenceResult?.outcome).toBe('accepted')
    expect(snapshot?.lastNutritionResult?.outcome).toBe('accepted')
    expect(snapshot?.state.preferences).toEqual(eurPreferences)
    expect(snapshot?.state.personalNutrition?.reference.version).toBe(2)
    expect(snapshot?.state.personalNutrition?.reference.kcalPer100Ml).toBe(43)
    expect(snapshot?.state.entries).toBe(original.entries)
    expect(snapshot?.state.entries).toEqual(history)
  })

  it('does not overwrite the other form result when either form rejects an update', async () => {
    const user = userEvent.setup()
    let snapshot: SessionContextValue | undefined
    render(<SessionProvider><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Apply provider test preferences' }))
    const acceptedPreferences = snapshot?.lastPreferenceResult
    await user.click(screen.getByRole('button', { name: 'Apply invalid label' }))
    expect(snapshot?.lastPreferenceResult).toBe(acceptedPreferences)
    const rejectedNutrition = snapshot?.lastNutritionResult
    const previousState = snapshot?.state
    await user.click(screen.getByRole('button', { name: 'Reject provider test preferences' }))
    expect(snapshot?.state).toBe(previousState)
    expect(snapshot?.lastNutritionResult).toBe(rejectedNutrition)
    await user.click(screen.getByRole('button', { name: 'Apply illustrative label' }))
    const acceptedNutrition = snapshot?.lastNutritionResult
    await user.click(screen.getByRole('button', { name: 'Apply provider test preferences' }))
    expect(snapshot?.lastNutritionResult).toBe(acceptedNutrition)
    expect(snapshot?.lastPreferenceResult?.outcome).toBe('accepted')
  })

  it('retains applied nutrition while views navigate and clears it on a fresh provider mount', async () => {
    const user = userEvent.setup()
    const view = render(<SessionProvider><NutritionProbe /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Apply illustrative label' }))
    view.rerender(<SessionProvider><p>Another application view</p></SessionProvider>)
    view.rerender(<SessionProvider><NutritionProbe /></SessionProvider>)
    expect(screen.getByTestId('nutrition-version').textContent).toBe('1')
    expect(screen.getByTestId('nutrition-outcome').textContent).toBe('accepted')
    view.unmount()
    render(<SessionProvider><NutritionProbe /></SessionProvider>)
    expect(screen.getByTestId('nutrition-version').textContent).toBe('not configured')
    expect(screen.getByTestId('nutrition-outcome').textContent).toBe('not applied')
  })

  it('reports UUID failure instead of throwing or claiming the setup was applied', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => { throw new Error('UUID unavailable') })
    const original = makeState()
    let snapshot: SessionContextValue | undefined
    render(<SessionProvider initialState={original}><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Apply illustrative label' }))
    expect(snapshot?.state).toBe(original)
    if (snapshot?.lastNutritionResult?.outcome !== 'invalid') throw new Error('Expected an ID issue.')
    expect(snapshot.lastNutritionResult.issues.map(issue => issue.field)).toContain('personalNutrition.id')
    expect(Object.isFrozen(snapshot.lastNutritionResult.issues[0])).toBe(true)
    expect(snapshot.state.personalNutrition).toBeNull()
  })

  it('can revise an existing setup when new UUID generation is unavailable', async () => {
    const user = userEvent.setup()
    let snapshot: SessionContextValue | undefined
    render(<SessionProvider><NutritionProbe onSnapshot={value => { snapshot = value }} /></SessionProvider>)
    await user.click(screen.getByRole('button', { name: 'Apply illustrative label' }))
    const id = snapshot?.state.personalNutrition?.reference.id
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => { throw new Error('UUID unavailable') })
    await user.click(screen.getByRole('button', { name: 'Change illustrative sugar' }))
    expect(snapshot?.lastNutritionResult?.outcome).toBe('accepted')
    expect(snapshot?.state.personalNutrition?.reference.id).toBe(id)
    expect(snapshot?.state.personalNutrition?.reference.version).toBe(2)
  })
})
