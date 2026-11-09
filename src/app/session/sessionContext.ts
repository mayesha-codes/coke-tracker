import { createContext, useContext } from 'react'
import type { TrackingSettings } from '../../domain/types'
import type { PersonalNutritionDraft } from '../../features/nutrition/nutritionInput'
import type { SessionState, SessionTransitionResult } from './sessionState'

export interface SessionContextValue {
  readonly state: SessionState
  /** Dispatches an update; the committed result is exposed separately below. */
  readonly updatePreferences: (preferences: TrackingSettings) => void
  readonly lastPreferenceResult: SessionTransitionResult | null
  /** Applies label values separately from currency and timezone preferences. */
  readonly applyPersonalNutrition: (draft: PersonalNutritionDraft) => void
  readonly lastNutritionResult: SessionTransitionResult | null
}

export const SessionContext = createContext<SessionContextValue | null>(null)

/** Read the one in-memory session shared by the application views. */
export function useSession(): SessionContextValue {
  const session = useContext(SessionContext)
  if (session === null) throw new Error('useSession must be used within a SessionProvider.')
  return session
}
