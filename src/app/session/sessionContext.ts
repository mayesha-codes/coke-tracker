import { createContext, useContext } from 'react'
import type { TrackingSettings } from '../../domain/types'
import type { SessionState, SessionTransitionResult } from './sessionState'

export interface SessionContextValue {
  readonly state: SessionState
  /** Dispatches an update; the committed result is exposed separately below. */
  readonly updatePreferences: (preferences: TrackingSettings) => void
  readonly lastPreferenceResult: SessionTransitionResult | null
}

export const SessionContext = createContext<SessionContextValue | null>(null)

/** Read the one in-memory session shared by the application views. */
export function useSession(): SessionContextValue {
  const session = useContext(SessionContext)
  if (session === null) throw new Error('useSession must be used within a SessionProvider.')
  return session
}
