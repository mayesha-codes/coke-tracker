import { useCallback, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import type { TrackingSettings } from '../../domain/types'
import type { PersonalNutritionDraft } from '../../features/nutrition/nutritionInput'
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
  lastNutritionResult: SessionTransitionResult | null
}

type ProviderAction =
  | { readonly type: 'update-preferences'; readonly preferences: TrackingSettings }
  | {
    readonly type: 'apply-personal-nutrition'
    readonly draft: PersonalNutritionDraft
    readonly newSetupId: string | null
  }

function initializeSession(initialState: SessionState | undefined): ProviderState {
  if (initialState !== undefined) {
    return { session: initialState, lastPreferenceResult: null, lastNutritionResult: null }
  }
  const initial = createSessionState()
  if (initial.valid === false) throw new Error('The initial session preferences are invalid.')
  return { session: initial.state, lastPreferenceResult: null, lastNutritionResult: null }
}

function applySessionAction(current: ProviderState, action: ProviderAction): ProviderState {
  // React processes queued actions against the latest state, not a captured render snapshot.
  if (action.type === 'update-preferences') {
    const result = transitionSession(current.session, action)
    return { ...current, session: result.state, lastPreferenceResult: result }
  }

  // Two commands can be queued before React renders the first setup. Resolve its
  // stable identity here against the latest state, while generating no IDs here.
  const id = current.session.personalNutrition?.reference.id ?? action.newSetupId
  if (id === null) {
    const result: SessionTransitionResult = Object.freeze({
      outcome: 'invalid',
      state: current.session,
      issues: Object.freeze([Object.freeze({
        field: 'personalNutrition.id',
        message: 'A nutrition setup ID could not be created. Try again in a browser with secure UUID support.',
      })]),
    })
    return { ...current, lastNutritionResult: result }
  }

  const result = transitionSession(current.session, { type: 'apply-personal-nutrition', id, draft: action.draft })
  return { ...current, session: result.state, lastNutritionResult: result }
}

/** Keeps preferences and future history alive across navigation, without writing to storage. */
function SessionProvider({ children, initialState }: SessionProviderProps) {
  const [current, dispatch] = useReducer(applySessionAction, initialState, initializeSession)
  const updatePreferences = useCallback((preferences: TrackingSettings) => {
    dispatch({ type: 'update-preferences', preferences })
  }, [])
  const applyPersonalNutrition = useCallback((draft: PersonalNutritionDraft) => {
    // This event-command boundary owns UUID generation; the reducer stays pure.
    let newSetupId: string | null
    try {
      newSetupId = globalThis.crypto.randomUUID()
    } catch {
      newSetupId = null
    }
    dispatch({ type: 'apply-personal-nutrition', draft, newSetupId })
  }, [])
  const value = useMemo(() => ({
    state: current.session,
    updatePreferences,
    lastPreferenceResult: current.lastPreferenceResult,
    applyPersonalNutrition,
    lastNutritionResult: current.lastNutritionResult,
  }), [current, updatePreferences, applyPersonalNutrition])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export default SessionProvider
