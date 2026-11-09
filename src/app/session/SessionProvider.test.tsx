// @vitest-environment jsdom
import { StrictMode, useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TrackingSettings } from '../../domain/types'
import SessionProvider from './SessionProvider'
import { useSession } from './sessionContext'
import type { SessionContextValue } from './sessionContext'
import { createSessionState, transitionSession } from './sessionState'
import type { SessionState } from './sessionState'

afterEach(cleanup)

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
