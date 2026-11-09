import { describe, expect, expectTypeOf, it } from 'vitest'
import { getCurrencyFractionDigits } from '../../domain/money'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type { TrackingSettings } from '../../domain/types'
import { isNamedTimeZone } from '../../domain/validation'
import {
  ENGLISH_DISPLAY_LOCALE,
  INITIAL_USER_PREFERENCES,
  PREFERENCE_CURRENCIES,
  validatePreferences,
} from './preferences'
import type { PreferenceIssue, PreferencesResult } from './preferences'

function makePreferences(overrides: Record<string, unknown> = {}) {
  return { currency: 'JPY', reportingTimeZone: 'Asia/Tokyo', dailyLimitMl: null, ...overrides }
}

function issueFields(result: PreferencesResult) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected invalid preferences in this test.')
  for (const issue of result.issues) expect(issue.message.length).toBeGreaterThan(0)
  return result.issues.map(issue => issue.field)
}

describe('initial international preference choices', () => {
  it('offers the four initial currencies with English labels', () => {
    expect(PREFERENCE_CURRENCIES).toEqual([
      { code: 'JPY', label: 'Japanese yen' },
      { code: 'USD', label: 'US dollar' },
      { code: 'EUR', label: 'Euro' },
      { code: 'BDT', label: 'Bangladeshi taka' },
    ])
    expect(ENGLISH_DISPLAY_LOCALE).toBe('en')
  })

  it('suggests Tokyo and yen without replacing the existing Dhaka domain defaults', () => {
    expect(INITIAL_USER_PREFERENCES).toEqual(makePreferences())
    expect(DEFAULT_TRACKING_SETTINGS).toEqual({
      currency: 'BDT', reportingTimeZone: 'Asia/Dhaka', dailyLimitMl: null,
    })
    expect(validatePreferences(INITIAL_USER_PREFERENCES).valid).toBe(true)
  })

  it('freezes the setup suggestion and each currency option', () => {
    expect(Object.isFrozen(INITIAL_USER_PREFERENCES)).toBe(true)
    expect(Object.isFrozen(PREFERENCE_CURRENCIES)).toBe(true)
    for (const option of PREFERENCE_CURRENCIES) {
      expect(Object.isFrozen(option)).toBe(true)
      expect(Reflect.set(option, 'label', 'Changed')).toBe(false)
    }
    expect(Reflect.set(INITIAL_USER_PREFERENCES, 'currency', 'USD')).toBe(false)
  })
})

describe('preference currency validation', () => {
  it.each([
    { currency: 'JPY', fractionDigits: 0 },
    { currency: 'USD', fractionDigits: 2 },
    { currency: 'EUR', fractionDigits: 2 },
    { currency: 'BDT', fractionDigits: 2 },
  ])('accepts $currency with its existing currency-specific precision', ({ currency, fractionDigits }) => {
    expect(validatePreferences(makePreferences({ currency }))).toEqual({
      valid: true, preferences: makePreferences({ currency }),
    })
    expect(getCurrencyFractionDigits(currency)).toEqual({ valid: true, fractionDigits })
  })

  it('accepts another valid currency without restricting the domain to the initial menu', () => {
    expect(validatePreferences(makePreferences({ currency: 'CHF' })).valid).toBe(true)
  })

  it.each([undefined, null, '', 'jpy', 'Usd', ' JPY', 'JPY ', 'JP', 'JPYY', 'XYZ', 392, {}, []])(
    'reports a currency issue instead of silently replacing invalid currency %j', currency => {
      expect(issueFields(validatePreferences(makePreferences({ currency })))).toEqual(['currency'])
    },
  )
})

describe('shared named-timezone validation', () => {
  it.each([
    'Asia/Tokyo', 'Asia/Dhaka', 'Europe/London', 'America/New_York',
    'Australia/Lord_Howe', 'Pacific/Apia', 'UTC', 'Etc/UTC',
  ])('accepts the supported IANA timezone %s independently of the host timezone', reportingTimeZone => {
    expect(isNamedTimeZone(reportingTimeZone)).toBe(true)
    const result = validatePreferences(makePreferences({ reportingTimeZone }))
    expect(result).toEqual({ valid: true, preferences: makePreferences({ reportingTimeZone }) })
  })

  it.each([
    undefined, null, '', ' ', ' Asia/Tokyo', 'Asia/Tokyo ', 'Not/AZone',
    '+09:00', '-05:00', '+0900', 9, {}, [],
  ])('reports a timezone issue for %j without falling back to Tokyo', reportingTimeZone => {
    expect(isNamedTimeZone(reportingTimeZone)).toBe(false)
    expect(issueFields(validatePreferences(makePreferences({ reportingTimeZone })))).toEqual(['reportingTimeZone'])
  })
})

describe('complete preference validation and immutable results', () => {
  it.each([null, 0, 1, 350, Number.MAX_SAFE_INTEGER])(
    'preserves the existing valid daily limit value %j', dailyLimitMl => {
      expect(validatePreferences(makePreferences({ dailyLimitMl }))).toEqual({
        valid: true, preferences: makePreferences({ dailyLimitMl }),
      })
    },
  )

  it.each([undefined, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '350', false, {}])(
    'reports a daily-limit issue for %j', dailyLimitMl => {
      expect(issueFields(validatePreferences(makePreferences({ dailyLimitMl })))).toEqual(['dailyLimitMl'])
    },
  )

  it.each([undefined, null, [], 'JPY', 0, false])('rejects malformed preference objects %j', input => {
    expect(issueFields(validatePreferences(input))).toEqual(['preferences'])
  })

  it('reports every missing field rather than inserting setup suggestions', () => {
    expect(issueFields(validatePreferences({}))).toEqual(['currency', 'reportingTimeZone', 'dailyLimitMl'])
  })

  it.each(['currency', 'reportingTimeZone', 'dailyLimitMl'] as const)(
    'requires the %s field even when the other fields are valid', field => {
      const input: Record<string, unknown> = makePreferences()
      delete input[field]
      expect(issueFields(validatePreferences(input))).toEqual([field])
    },
  )

  it('copies known fields without mutating or freezing the caller', () => {
    const input = { ...makePreferences(), note: { text: 'Caller-owned metadata' } }
    const before = structuredClone(input)
    const result = validatePreferences(input)
    expect(result.valid).toBe(true)
    if (result.valid === false) throw new Error('Expected valid preferences.')

    expect(input).toEqual(before)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.note)).toBe(false)
    expect(result.preferences).not.toBe(input)
    expect(Object.keys(result.preferences).sort()).toEqual(['currency', 'dailyLimitMl', 'reportingTimeZone'])
    input.currency = 'USD'
    input.reportingTimeZone = 'America/New_York'
    expect(result.preferences.currency).toBe('JPY')
    expect(result.preferences.reportingTimeZone).toBe('Asia/Tokyo')
  })

  it('creates frozen results and field-specific issues', () => {
    const success = validatePreferences(makePreferences())
    const failure = validatePreferences({})
    expect(Object.isFrozen(success)).toBe(true)
    expect(Object.isFrozen(failure)).toBe(true)
    if (success.valid === false || failure.valid === true) throw new Error('Unexpected validation result.')
    expect(Object.isFrozen(success.preferences)).toBe(true)
    expect(Object.isFrozen(failure.issues)).toBe(true)
    for (const issue of failure.issues) expect(Object.isFrozen(issue)).toBe(true)
    expect(Reflect.set(success.preferences, 'currency', 'USD')).toBe(false)
  })

  it('has readonly TypeScript contracts and separates success from failure', () => {
    const checkContracts = (result: PreferencesResult) => {
      if (result.valid === true) {
        expectTypeOf(result.preferences).toEqualTypeOf<TrackingSettings>()
        // @ts-expect-error Preferences must be replaced rather than mutated.
        result.preferences.currency = 'USD'
        // @ts-expect-error A successful result has no issues.
        void result.issues
      } else {
        expectTypeOf(result.issues).toEqualTypeOf<readonly PreferenceIssue[]>()
        // @ts-expect-error Validation issues are readonly.
        result.issues.push({ field: 'currency', message: 'Example issue' })
        // @ts-expect-error A failed result has no usable preferences.
        void result.preferences
      }
      // @ts-expect-error Initial currency choices are a readonly collection.
      PREFERENCE_CURRENCIES.push({ code: 'CHF', label: 'Swiss franc' })
    }
    expectTypeOf(checkContracts).toBeFunction()
  })
})
