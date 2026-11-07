import { describe, expect, expectTypeOf, it } from 'vitest'
import { evaluateDailyVolumeGoal } from './goals'
import type {
  ActiveDailyVolumeGoal,
  DailyVolumeGoal,
  DailyVolumeGoalIssue,
  DailyVolumeGoalResult,
  DisabledDailyVolumeGoal,
} from './goals'

function goalFrom(result: DailyVolumeGoalResult): DailyVolumeGoal {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid daily volume goal.')
  return result.goal
}

function expectIssueFields(result: DailyVolumeGoalResult, fields: readonly string[]) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected goal validation issues.')
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  for (const issue of result.issues) expect(issue.message.trim()).not.toBe('')
  expect(result).not.toHaveProperty('goal')
}

// JavaScript callers can bypass TypeScript's parameter types.
function evaluateUnknown(consumedMl: unknown, dailyLimitMl: unknown): DailyVolumeGoalResult {
  return Reflect.apply(evaluateDailyVolumeGoal, undefined, [consumedMl, dailyLimitMl])
}

const invalidVolumes = [
  { label: 'a negative integer', value: -1 },
  { label: 'a fractional millilitre', value: 0.5 },
  { label: 'an unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
  { label: 'NaN', value: NaN },
  { label: 'positive infinity', value: Infinity },
  { label: 'negative infinity', value: -Infinity },
  { label: 'a numeric string', value: '330' },
  { label: 'a boolean', value: false },
  { label: 'an object', value: {} },
  { label: 'an array', value: [] },
  { label: 'undefined', value: undefined },
]

describe('evaluateDailyVolumeGoal', () => {
  it.each([0, 330, Number.MAX_SAFE_INTEGER])(
    'disables the goal for a null limit while preserving %s ml of consumption',
    consumedMl => {
      expect(goalFrom(evaluateDailyVolumeGoal(consumedMl, null))).toEqual({
        state: 'disabled', consumedMl, limitMl: null, remainingMl: null, excessMl: null,
      })
    },
  )

  it.each([
    { consumedMl: 0, limitMl: 500, state: 'within', remainingMl: 500, excessMl: 0 },
    { consumedMl: 330, limitMl: 500, state: 'within', remainingMl: 170, excessMl: 0 },
    { consumedMl: 500, limitMl: 500, state: 'reached', remainingMl: 0, excessMl: 0 },
    { consumedMl: 660, limitMl: 500, state: 'exceeded', remainingMl: 0, excessMl: 160 },
  ] as const)(
    'reports $state for $consumedMl ml consumed against a $limitMl ml limit',
    ({ consumedMl, limitMl, state, remainingMl, excessMl }) => {
      expect(goalFrom(evaluateDailyVolumeGoal(consumedMl, limitMl))).toEqual({
        state, consumedMl, limitMl, remainingMl, excessMl,
      })
    },
  )

  it('reaches a zero-volume goal when nothing has been consumed', () => {
    expect(goalFrom(evaluateDailyVolumeGoal(0, 0))).toEqual({
      state: 'reached', consumedMl: 0, limitMl: 0, remainingMl: 0, excessMl: 0,
    })
  })

  it('exceeds a zero-volume goal by the full amount consumed', () => {
    expect(goalFrom(evaluateDailyVolumeGoal(330, 0))).toEqual({
      state: 'exceeded', consumedMl: 330, limitMl: 0, remainingMl: 0, excessMl: 330,
    })
  })

  it.each([
    { consumedMl: 0, limitMl: Number.MAX_SAFE_INTEGER, state: 'within', remainingMl: Number.MAX_SAFE_INTEGER, excessMl: 0 },
    { consumedMl: Number.MAX_SAFE_INTEGER, limitMl: Number.MAX_SAFE_INTEGER, state: 'reached', remainingMl: 0, excessMl: 0 },
    { consumedMl: Number.MAX_SAFE_INTEGER, limitMl: 0, state: 'exceeded', remainingMl: 0, excessMl: Number.MAX_SAFE_INTEGER },
  ] as const)('keeps $state arithmetic safe at the largest supported integer boundary', expected => {
    expect(goalFrom(evaluateDailyVolumeGoal(expected.consumedMl, expected.limitMl))).toEqual(expected)
  })

  it.each(invalidVolumes)('rejects $label as consumed volume even when the goal is disabled', ({ value }) => {
    expectIssueFields(evaluateUnknown(value, null), ['consumedMl'])
  })

  it('rejects null consumption instead of treating it as zero', () => {
    expectIssueFields(evaluateUnknown(null, 500), ['consumedMl'])
  })

  it.each(invalidVolumes)('rejects $label as the daily limit instead of silently disabling it', ({ value }) => {
    expectIssueFields(evaluateUnknown(330, value), ['dailyLimitMl'])
  })

  it('returns both issue fields when consumption and the limit are invalid', () => {
    expectIssueFields(evaluateUnknown(-1, '500'), ['consumedMl', 'dailyLimitMl'])
  })

  it('reports both missing arguments rather than creating a disabled zero-volume goal', () => {
    const result = Reflect.apply(evaluateDailyVolumeGoal, undefined, [])
    expectIssueFields(result, ['consumedMl', 'dailyLimitMl'])
  })

  it.each([null, 0, 500])('returns a frozen goal for limit %s', limitMl => {
    const goal = goalFrom(evaluateDailyVolumeGoal(330, limitMl))
    const before = { ...goal }
    expect(Object.isFrozen(goal)).toBe(true)
    expect(Reflect.set(goal, 'consumedMl', 999)).toBe(false)
    expect(goal).toEqual(before)
  })

  it.each([null, 0, 500])('returns only volume fields and a status without calculating a percentage for limit %s', limitMl => {
    const goal = goalFrom(evaluateDailyVolumeGoal(0, limitMl))
    expect(Object.keys(goal).sort()).toEqual([
      'consumedMl', 'excessMl', 'limitMl', 'remainingMl', 'state',
    ])
  })

  it('returns the same result for repeated calls with the same supplied volumes', () => {
    expect(evaluateDailyVolumeGoal(660, 500)).toEqual(evaluateDailyVolumeGoal(660, 500))
  })

  it('keeps goal fields and result branches readonly in TypeScript', () => {
    const checkReadonlyContracts = (goal: DailyVolumeGoal, result: DailyVolumeGoalResult) => {
      // @ts-expect-error Goal volumes cannot be edited through the returned interface.
      goal.consumedMl = 0
      if (goal.state === 'disabled') {
        expectTypeOf(goal).toEqualTypeOf<DisabledDailyVolumeGoal>()
        expectTypeOf(goal.remainingMl).toEqualTypeOf<null>()
      } else {
        expectTypeOf(goal).toEqualTypeOf<ActiveDailyVolumeGoal>()
        expectTypeOf(goal.remainingMl).toBeNumber()
      }
      if (result.valid === false) {
        expectTypeOf(result.issues).toEqualTypeOf<readonly DailyVolumeGoalIssue[]>()
        // @ts-expect-error Failure results do not expose a usable goal.
        void result.goal
      }
    }
    // The helper is type-checked by npm test but never called at runtime.
    expectTypeOf(checkReadonlyContracts).toBeFunction()
  })
})
