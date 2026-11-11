// @vitest-environment jsdom
import { StrictMode, useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TrackingSettings } from '../../domain/types'
import type { PersonalNutritionDraft } from '../../features/nutrition/nutritionInput'
import SessionProvider from './SessionProvider'
import { useSession } from './sessionContext'
import type { EntrySaveRequest, SessionContextValue } from './sessionContext'
import { createSessionState, transitionSession } from './sessionState'
import type { NutritionProvenance, SessionEntryRecord, SessionState } from './sessionState'

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

// These records reuse illustrative fixtures; "reviewed" tests provenance handling,
// not independent verification or inclusion in the production product registry.
function entryToSave(id = 'illustrative-new-entry', kind: NutritionProvenance['kind'] = 'user-provided'): SessionEntryRecord {
  const record = structuredClone(stateWithHistory().entries[0])
  return {
    entry: { ...record.entry, id },
    nutritionProvenance: { ...record.nutritionProvenance, kind },
  }
}

function EntryProbe({ onSnapshot }: { onSnapshot: (value: SessionContextValue) => void }) {
  const session = useSession()
  useEffect(() => { onSnapshot(session) }, [onSnapshot, session])
  return (
    <div>
      <p data-testid="saved-entry-count">{session.state.entries.length}</p>
      <p data-testid="entry-request">{session.lastEntryResult?.requestId ?? 'not requested'}</p>
      <p data-testid="entry-outcome">{session.lastEntryResult?.result.outcome ?? 'not requested'}</p>
    </div>
  )
}

function renderEntryProvider(initialState?: SessionState, strict = false) {
  let snapshot: SessionContextValue | undefined
  const onSnapshot = (value: SessionContextValue) => { snapshot = value }
  const contents = <SessionProvider initialState={initialState}><EntryProbe onSnapshot={onSnapshot} /></SessionProvider>
  const view = render(strict ? <StrictMode>{contents}</StrictMode> : contents)
  return {
    view,
    onSnapshot,
    session() {
      if (snapshot === undefined) throw new Error('Expected the mounted provider to expose its session.')
      return snapshot
    },
  }
}

describe('temporary entry-saving commands in the session provider', () => {
  it('starts without an entry result and exposes no acceptance merely from calling addEntry', () => {
    const { session } = renderEntryProvider()
    expect(session().lastEntryResult).toBeNull()
    act(() => {
      const returned = session().addEntry({ requestId: 'save-attempt-one', record: entryToSave() })
      expect(returned).toBeUndefined()
      // The current render is unchanged until React commits the queued transition.
      expect(session().lastEntryResult).toBeNull()
      expect(session().state.entries).toHaveLength(0)
    })
    expect(session().lastEntryResult?.requestId).toBe('save-attempt-one')
    expect(session().lastEntryResult?.result.outcome).toBe('accepted')
    expect(session().state.entries).toHaveLength(1)
  })

  it.each(['reviewed', 'user-provided'] as const)('accepts a %s record with its original values and matching request ID', kind => {
    const original = makeState()
    const { session } = renderEntryProvider(original)
    const record = entryToSave('illustrative-entry', kind)
    const before = structuredClone(record)
    act(() => { session().addEntry({ requestId: `save-${kind}`, record }) })
    const receipt = session().lastEntryResult
    expect(receipt?.requestId).toBe(`save-${kind}`)
    expect(receipt?.result.outcome).toBe('accepted')
    expect(receipt?.result.state).toBe(session().state)
    expect(session().state.entries).toEqual([before])
    expect(session().state.entries[0].nutritionProvenance.kind).toBe(kind)
    expect(session().state.preferences).toBe(original.preferences)
    expect(session().state.personalNutrition).toBeNull()
    expect(session().lastPreferenceResult).toBeNull()
    expect(session().lastNutritionResult).toBeNull()
    expect(record).toEqual(before)
    expect(Object.isFrozen(receipt)).toBe(true)
  })

  it('reports a duplicate as a rejection for the new request without reusing the previous acceptance', () => {
    const { session } = renderEntryProvider()
    act(() => { session().addEntry({ requestId: 'accepted-attempt', record: entryToSave() }) })
    const acceptedReceipt = session().lastEntryResult
    const acceptedState = session().state
    const duplicate = entryToSave()
    act(() => { session().addEntry({ requestId: 'duplicate-attempt', record: duplicate }) })
    const receipt = session().lastEntryResult
    expect(receipt).not.toBe(acceptedReceipt)
    expect(receipt?.requestId).toBe('duplicate-attempt')
    expect(receipt?.result.outcome).toBe('duplicate')
    if (receipt?.result.outcome !== 'duplicate') throw new Error('Expected a duplicate outcome, never acceptance.')
    expect(receipt.result.entryId).toBe(duplicate.entry.id)
    expect(receipt.result.issues.map(issue => issue.field)).toContain('entry.id')
    expect(session().state).toBe(acceptedState)
    expect(session().state.entries).toHaveLength(1)
  })

  it('checks a rapid duplicate against the first queued addition instead of the old empty state', () => {
    const { session } = renderEntryProvider()
    act(() => {
      session().addEntry({ requestId: 'first-click', record: entryToSave() })
      session().addEntry({ requestId: 'second-click', record: entryToSave() })
    })
    expect(session().state.entries).toHaveLength(1)
    expect(session().lastEntryResult?.requestId).toBe('second-click')
    expect(session().lastEntryResult?.result.outcome).toBe('duplicate')
  })

  it('preserves intentionally identical drinks with different IDs when commands are queued rapidly', () => {
    const { session } = renderEntryProvider()
    const first = entryToSave('illustrative-first')
    const second = entryToSave('illustrative-second')
    act(() => {
      session().addEntry({ requestId: 'first-attempt', record: first })
      session().addEntry({ requestId: 'second-attempt', record: second })
    })
    expect(session().state.entries).toEqual([first, second])
    expect(session().state.entries.map(saved => saved.entry.id)).toEqual(['illustrative-first', 'illustrative-second'])
    expect(session().lastEntryResult?.requestId).toBe('second-attempt')
    expect(session().lastEntryResult?.result.outcome).toBe('accepted')
  })

  it('keeps the first queued entry when the next command is invalid and tags the rejection correctly', () => {
    const { session } = renderEntryProvider()
    const first = entryToSave('illustrative-first')
    const invalid = entryToSave('illustrative-invalid')
    act(() => {
      session().addEntry({ requestId: 'valid-attempt', record: first })
      session().addEntry({
        requestId: 'invalid-attempt',
        record: { ...invalid, entry: { ...invalid.entry, consumedAt: '2026-02-30T09:30:00Z' } },
      })
    })
    const receipt = session().lastEntryResult
    expect(receipt?.requestId).toBe('invalid-attempt')
    expect(receipt?.result.outcome).toBe('invalid')
    if (receipt?.result.outcome !== 'invalid') throw new Error('Expected invalid timestamp feedback.')
    expect(receipt.result.issues.map(issue => issue.field)).toContain('entry.consumedAt')
    expect(receipt.result.state).toBe(session().state)
    expect(session().state.entries).toEqual([first])
  })

  it('rejects a malformed runtime record atomically instead of trusting its TypeScript contract', () => {
    const original = stateWithHistory()
    const { session } = renderEntryProvider(original)
    act(() => {
      // An untyped JavaScript caller can still supply malformed data at runtime.
      Reflect.apply(session().addEntry, undefined, [{ requestId: 'malformed-attempt', record: null }])
    })
    const receipt = session().lastEntryResult
    expect(receipt?.requestId).toBe('malformed-attempt')
    if (receipt?.result.outcome !== 'invalid') throw new Error('Expected invalid record feedback.')
    expect(receipt.result.issues.map(issue => issue.field)).toContain('record')
    expect(session().state).toBe(original)
  })

  it.each([
    { field: 'quantity', value: 0, issue: 'entry.quantity' },
    { field: 'servingMl', value: 0, issue: 'entry.servingMl' },
    { field: 'totalPriceMinor', value: -1, issue: 'entry.totalPriceMinor' },
    { field: 'currency', value: 'invalid', issue: 'entry.currency' },
  ])('preserves session state when an invalid $field is submitted', ({ field, value, issue }) => {
    const original = stateWithHistory()
    const { session } = renderEntryProvider(original)
    const record = entryToSave()
    act(() => {
      session().addEntry({ requestId: `invalid-${field}`, record: { ...record, entry: { ...record.entry, [field]: value } } })
    })
    const receipt = session().lastEntryResult
    expect(receipt?.requestId).toBe(`invalid-${field}`)
    if (receipt?.result.outcome !== 'invalid') throw new Error('Expected invalid entry feedback.')
    expect(receipt.result.issues.map(found => found.field)).toContain(issue)
    expect(session().state).toBe(original)
  })

  it.each([
    { field: 'id', value: 'different-label' },
    { field: 'version', value: 2 },
    { field: 'sugarGramsPer100Ml', value: 11 },
    { field: 'kcalPer100Ml', value: 43 },
  ])('rejects a provenance $field that does not match the entry snapshot', ({ field, value }) => {
    const original = stateWithHistory()
    const { session } = renderEntryProvider(original)
    const record = entryToSave()
    act(() => {
      session().addEntry({
        requestId: `mismatch-${field}`,
        record: {
          ...record,
          nutritionProvenance: {
            ...record.nutritionProvenance,
            reference: { ...record.nutritionProvenance.reference, [field]: value },
          },
        },
      })
    })
    const receipt = session().lastEntryResult
    expect(receipt?.requestId).toBe(`mismatch-${field}`)
    if (receipt?.result.outcome !== 'invalid') throw new Error('Expected mismatched nutrition feedback.')
    expect(receipt.result.issues.map(issue => issue.field)).toContain(`nutritionProvenance.reference.${field}`)
    expect(session().state).toBe(original)
  })

  it('rejects aggregate spending overflow without adding any part of the second entry', () => {
    const { session } = renderEntryProvider()
    const first = entryToSave('illustrative-first')
    const firstRequest: EntrySaveRequest = {
      requestId: 'large-price-attempt',
      record: { ...first, entry: { ...first.entry, totalPriceMinor: Number.MAX_SAFE_INTEGER } },
    }
    act(() => { session().addEntry(firstRequest) })
    expect(session().lastEntryResult?.result.outcome).toBe('accepted')
    const acceptedState = session().state
    const second = entryToSave('illustrative-second')
    act(() => {
      session().addEntry({ requestId: 'overflow-attempt', record: { ...second, entry: { ...second.entry, totalPriceMinor: 1 } } })
    })
    const receipt = session().lastEntryResult
    expect(receipt?.requestId).toBe('overflow-attempt')
    if (receipt?.result.outcome !== 'invalid') throw new Error('Expected aggregate overflow rejection.')
    expect(receipt.result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'entries.knownAmountMinor', entryIndex: 1, currency: 'JPY' }),
    ]))
    expect(session().state).toBe(acceptedState)
    expect(session().state.entries).toEqual([firstRequest.record])
  })

  it('rejects aggregate volume overflow after preserving the first safe entry', () => {
    const { session } = renderEntryProvider()
    const first = entryToSave('illustrative-first')
    act(() => {
      session().addEntry({
        requestId: 'large-volume-attempt',
        record: { ...first, entry: { ...first.entry, quantity: 1, servingMl: Number.MAX_SAFE_INTEGER } },
      })
    })
    expect(session().lastEntryResult?.result.outcome).toBe('accepted')
    const acceptedState = session().state
    const second = entryToSave('illustrative-second')
    act(() => {
      session().addEntry({
        requestId: 'volume-overflow-attempt',
        record: { ...second, entry: { ...second.entry, quantity: 1, servingMl: 1 } },
      })
    })
    const receipt = session().lastEntryResult
    if (receipt?.result.outcome !== 'invalid') throw new Error('Expected aggregate volume rejection.')
    expect(receipt.result.issues.map(issue => issue.field)).toContain('entries.volumeMl')
    expect(session().state).toBe(acceptedState)
    expect(session().state.entries).toHaveLength(1)
  })

  it('owns frozen snapshots and source copies without freezing or retaining caller-owned records', () => {
    const { session } = renderEntryProvider()
    const record = entryToSave()
    const before = structuredClone(record)
    act(() => { session().addEntry({ requestId: 'immutable-attempt', record }) })
    const saved = session().state.entries[0]
    for (const object of [session().state, session().state.entries, saved, saved.entry,
      saved.entry.nutrition, saved.nutritionProvenance, saved.nutritionProvenance.reference,
      saved.nutritionProvenance.reference.source]) {
      expect(Object.isFrozen(object)).toBe(true)
    }
    expect(saved.entry).not.toBe(record.entry)
    expect(saved.entry.nutrition).not.toBe(record.entry.nutrition)
    expect(saved.nutritionProvenance.reference).not.toBe(record.nutritionProvenance.reference)
    expect(saved.nutritionProvenance.reference.source).not.toBe(record.nutritionProvenance.reference.source)
    expect(Reflect.set(record.entry, 'currency', 'BDT')).toBe(true)
    expect(Reflect.set(record.entry.nutrition, 'sugarGramsPer100Ml', 0)).toBe(true)
    expect(Reflect.set(record.nutritionProvenance.reference, 'kcalPer100Ml', 0)).toBe(true)
    expect(Reflect.set(record.nutritionProvenance.reference.source, 'label', 'Changed test source')).toBe(true)
    expect(saved).toEqual(before)
    expect(Reflect.set(saved.entry, 'quantity', 99)).toBe(false)
  })

  it('keeps entry, preference, and nutrition results independent while commands are interleaved', () => {
    const { session } = renderEntryProvider()
    act(() => {
      session().updatePreferences(usdPreferences)
      session().applyPersonalNutrition(personalDraft())
    })
    const preferencesResult = session().lastPreferenceResult
    const nutritionResult = session().lastNutritionResult
    act(() => { session().addEntry({ requestId: 'independent-attempt', record: entryToSave() }) })
    expect(session().lastPreferenceResult).toBe(preferencesResult)
    expect(session().lastNutritionResult).toBe(nutritionResult)
    const entryReceipt = session().lastEntryResult
    act(() => {
      session().updatePreferences({ ...usdPreferences, reportingTimeZone: 'Invalid/Zone' })
      session().applyPersonalNutrition(personalDraft({ sugarGramsPer100MlText: '' }))
    })
    expect(session().lastPreferenceResult?.outcome).toBe('invalid')
    expect(session().lastNutritionResult?.outcome).toBe('invalid')
    expect(session().lastEntryResult).toBe(entryReceipt)
    const rejectedPreferences = session().lastPreferenceResult
    const rejectedNutrition = session().lastNutritionResult
    act(() => { session().addEntry({ requestId: 'duplicate-independent-attempt', record: entryToSave() }) })
    expect(session().lastEntryResult?.result.outcome).toBe('duplicate')
    expect(session().lastPreferenceResult).toBe(rejectedPreferences)
    expect(session().lastNutritionResult).toBe(rejectedNutrition)
    expect(session().state.preferences).toEqual(usdPreferences)
    expect(session().state.personalNutrition?.reference.version).toBe(1)
    expect(session().state.entries).toHaveLength(1)
  })

  it('preserves saved currencies, timestamps, volumes, and nutrition after preferences and label values change', () => {
    const { session } = renderEntryProvider()
    const record = entryToSave()
    act(() => { session().addEntry({ requestId: 'historical-attempt', record }) })
    const entries = session().state.entries
    const before = structuredClone(entries)
    act(() => {
      session().updatePreferences(usdPreferences)
      session().applyPersonalNutrition(personalDraft({ sugarGramsPer100MlText: '0', kcalPer100MlText: '0' }))
    })
    expect(session().state.entries).toBe(entries)
    expect(session().state.entries).toEqual(before)
    expect(session().state.entries[0].entry.currency).toBe('JPY')
    expect(session().state.entries[0].entry.consumedAt).toBe('2026-11-08T09:30:00.000Z')
    expect(session().state.entries[0].entry.quantity).toBe(2)
    expect(session().state.entries[0].entry.servingMl).toBe(330)
    expect(session().state.entries[0].entry.totalPriceMinor).toBe(300)
    expect(session().state.entries[0].entry.nutrition.sugarGramsPer100Ml).toBe(10.5)
    expect(session().state.entries[0].nutritionProvenance.reference.version).toBe(1)
  })

  it('retains saved entries and their receipt when consumers navigate beneath the same provider', () => {
    const { session, view, onSnapshot } = renderEntryProvider()
    act(() => { session().addEntry({ requestId: 'navigation-attempt', record: entryToSave() }) })
    const savedState = session().state
    const receipt = session().lastEntryResult
    view.rerender(<SessionProvider><p>Another application view</p></SessionProvider>)
    view.rerender(<SessionProvider><EntryProbe onSnapshot={onSnapshot} /></SessionProvider>)
    expect(session().state).toBe(savedState)
    expect(session().lastEntryResult).toBe(receipt)
    expect(screen.getByTestId('saved-entry-count').textContent).toBe('1')
    expect(screen.getByTestId('entry-request').textContent).toBe('navigation-attempt')
  })

  it('clears saved entries and every result when a fresh provider is mounted', () => {
    const { session, view } = renderEntryProvider()
    act(() => {
      session().addEntry({ requestId: 'previous-session-attempt', record: entryToSave() })
      session().updatePreferences(usdPreferences)
      session().applyPersonalNutrition(personalDraft())
    })
    expect(session().state.entries).toHaveLength(1)
    view.unmount()
    const fresh = renderEntryProvider()
    expect(fresh.session().state.entries).toEqual([])
    expect(fresh.session().state.preferences.currency).toBe('JPY')
    expect(fresh.session().state.personalNutrition).toBeNull()
    expect(fresh.session().lastEntryResult).toBeNull()
    expect(fresh.session().lastPreferenceResult).toBeNull()
    expect(fresh.session().lastNutritionResult).toBeNull()
  })

  it('saves once under StrictMode using supplied IDs without generating a UUID for entry saving', () => {
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => { throw new Error('UUID must be supplied by the caller') })
    const { session } = renderEntryProvider(undefined, true)
    expect(session().state.entries).toEqual([])
    act(() => { session().addEntry({ requestId: 'strict-mode-attempt', record: entryToSave() }) })
    expect(session().lastEntryResult?.requestId).toBe('strict-mode-attempt')
    expect(session().lastEntryResult?.result.outcome).toBe('accepted')
    expect(session().state.entries).toHaveLength(1)
    expect(uuid).not.toHaveBeenCalled()
  })
})
