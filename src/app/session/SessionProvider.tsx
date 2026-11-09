import { useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import type { TrackingSettings } from '../../domain/types'
import { SessionContext } from './sessionContext'
import { createSessionState, transitionSession } from './sessionState'
import type { SessionState, SessionTransitionResult } from './sessionState'

type SessionProviderProps = {
  children: ReactNode
  /** One-time initialization seam. Supply only a state created by C1's pure functions. */
  initialState?: SessionState
}

type ProviderState = {
  session: SessionState
  lastPreferenceResult: SessionTransitionResult | null
}

function initializeSession(initialState: SessionState | undefined): ProviderState {
  if (initialState !== undefined) return { session: initialState, lastPreferenceResult: null }
  const initial = createSessionState()
  if (initial.valid === false) throw new Error('The initial session preferences are invalid.')
  return { session: initial.state, lastPreferenceResult: null }
}

function applyPreferences(current: ProviderState, preferences: TrackingSettings): ProviderState {
  // React processes queued actions against the latest state, not a captured render snapshot.
  const result = transitionSession(current.session, { type: 'update-preferences', preferences })
  return { session: result.state, lastPreferenceResult: result }
}

/** Keeps preferences and future history alive across navigation, without writing to storage. */
function SessionProvider({ children, initialState }: SessionProviderProps) {
  const [current, updatePreferences] = useReducer(applyPreferences, initialState, initializeSession)
  const value = useMemo(() => ({
    state: current.session,
    updatePreferences,
    lastPreferenceResult: current.lastPreferenceResult,
  }), [current])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export default SessionProvider
