import { isPositiveSafeInteger } from './validation'

export type DailyVolumeGoalState = 'disabled' | 'within' | 'reached' | 'exceeded'

export interface DisabledDailyVolumeGoal {
  readonly state: 'disabled'
  readonly consumedMl: number
  readonly limitMl: null
  readonly remainingMl: null
  readonly excessMl: null
}

export interface ActiveDailyVolumeGoal {
  readonly state: Exclude<DailyVolumeGoalState, 'disabled'>
  readonly consumedMl: number
  readonly limitMl: number
  readonly remainingMl: number
  readonly excessMl: number
}

export type DailyVolumeGoal = DisabledDailyVolumeGoal | ActiveDailyVolumeGoal

export interface DailyVolumeGoalIssue {
  readonly field: 'consumedMl' | 'dailyLimitMl'
  readonly message: string
}

export type DailyVolumeGoalResult =
  | { readonly valid: true; readonly goal: DailyVolumeGoal }
  | { readonly valid: false; readonly issues: readonly DailyVolumeGoalIssue[] }

/**
 * Compare a caller-supplied day's volume with its optional daily limit.
 * null disables the goal; zero is a valid zero-consumption goal.
 * Both values are checked before evaluating the state, even when the goal is disabled.
 * No date filtering, clock access, calorie thresholds, or percentage division is involved.
 */
export function evaluateDailyVolumeGoal(
  consumedMl: number,
  dailyLimitMl: number | null,
): DailyVolumeGoalResult {
  const validConsumption = consumedMl === 0 || isPositiveSafeInteger(consumedMl)
  const validLimit = dailyLimitMl === null || dailyLimitMl === 0 || isPositiveSafeInteger(dailyLimitMl)
  const issues: DailyVolumeGoalIssue[] = []

  if (!validConsumption) {
    issues.push({ field: 'consumedMl', message: 'Consumed volume must be a nonnegative safe integer in ml.' })
  }
  if (!validLimit) {
    issues.push({
      field: 'dailyLimitMl',
      message: 'Daily limit must be a nonnegative safe integer in ml, or null to disable the goal.',
    })
  }
  if (!validConsumption || !validLimit) return { valid: false, issues }

  if (dailyLimitMl === null) {
    return {
      valid: true,
      goal: Object.freeze({
        state: 'disabled', consumedMl, limitMl: null, remainingMl: null, excessMl: null,
      }),
    }
  }

  const state = consumedMl < dailyLimitMl ? 'within'
    : consumedMl === dailyLimitMl ? 'reached' : 'exceeded'

  return {
    valid: true,
    goal: Object.freeze({
      state,
      consumedMl,
      limitMl: dailyLimitMl,
      remainingMl: Math.max(dailyLimitMl - consumedMl, 0),
      excessMl: Math.max(consumedMl - dailyLimitMl, 0),
    }),
  }
}
