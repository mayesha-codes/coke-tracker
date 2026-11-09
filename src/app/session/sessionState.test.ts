import { describe, expect, expectTypeOf, it } from 'vitest'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type { DrinkEntry, TrackingSettings } from '../../domain/types'
import {
  createSessionState,
  transitionSession,
} from './sessionState'
import type { NutritionProvenance, SessionEntryRecord, SessionState } from './sessionState'

// The source, product description, and rates below are illustrative test data only.
function makeRecord(overrides: Partial<DrinkEntry> = {}, kind: NutritionProvenance['kind'] = 'user-provided') {
  const reference = {
    id: 'illustrative-label',
    version: 1,
    productDescription: 'Illustrative personal label for session tests',
    source: { label: 'Illustrative package label', url: 'https://example.invalid/label' },
    sugarGramsPer100Ml: 10.5,
    kcalPer100Ml: 42,
  }
  return {
    entry: {
      id: 'drink-one',
      consumedAt: '2026-11-08T09:30:00Z',
      quantity: 2,
      servingMl: 330,
      nutrition: {
        referenceId: reference.id,
        referenceVersion: reference.version,
        sugarGramsPer100Ml: reference.sugarGramsPer100Ml,
        kcalPer100Ml: reference.kcalPer100Ml,
      },
      totalPriceMinor: 300,
      currency: 'JPY',
      ...overrides,
    },
    nutritionProvenance: { kind, reference },
  } satisfies SessionEntryRecord
}

function initialState(preferences?: unknown): SessionState {
  const result = createSessionState(preferences)
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected valid session preferences.')
  return result.state
}

function acceptedState(result: ReturnType<typeof transitionSession>): SessionState {
  expect(result.outcome).toBe('accepted')
  if (result.outcome !== 'accepted') throw new Error('Expected an accepted transition.')
  return result.state
}

function expectRejected(
  result: ReturnType<typeof transitionSession>,
  state: SessionState,
  field?: string,
) {
  expect(result.outcome).toBe('invalid')
  if (result.outcome !== 'invalid') throw new Error('Expected an invalid transition.')
  expect(result.state).toBe(state)
  expect(result.issues.length).toBeGreaterThan(0)
  for (const issue of result.issues) {
    expect(issue.field.trim()).not.toBe('')
    expect(issue.message.trim()).not.toBe('')
  }
  if (field !== undefined) expect(result.issues.map(issue => issue.field)).toContain(field)
  return result.issues
}

describe('creating an in-memory session', () => {
  it('starts empty with editable Japan setup suggestions while preserving the old domain defaults', () => {
    const state = initialState()
    expect(state.entries).toEqual([])
    expect(state.preferences).toEqual({ currency: 'JPY', reportingTimeZone: 'Asia/Tokyo', dailyLimitMl: null })
    expect(DEFAULT_TRACKING_SETTINGS).toEqual({ currency: 'BDT', reportingTimeZone: 'Asia/Dhaka', dailyLimitMl: null })
  })

  it('copies and freezes valid caller preferences without freezing the caller object', () => {
    const preferences = { currency: 'EUR', reportingTimeZone: 'Europe/Paris', dailyLimitMl: null }
    const state = initialState(preferences)
    expect(state.preferences).toEqual(preferences)
    expect(state.preferences).not.toBe(preferences)
    expect(Object.isFrozen(preferences)).toBe(false)
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.preferences)).toBe(true)
    expect(Object.isFrozen(state.entries)).toBe(true)
    preferences.currency = 'USD'
    expect(state.preferences.currency).toBe('EUR')
  })

  it('rejects invalid initial preferences without returning a usable partial session', () => {
    const result = createSessionState({ currency: 'XYZ', reportingTimeZone: 'Not/AZone', dailyLimitMl: null })
    expect(result.valid).toBe(false)
    expect('state' in result).toBe(false)
    if (result.valid === false) {
      expect(result.issues.map(issue => issue.field)).toEqual(expect.arrayContaining([
        'preferences.currency', 'preferences.reportingTimeZone',
      ]))
    }
  })
})

describe('adding validated records with their historical provenance', () => {
  it('accepts two 330 ml drinks and preserves their currency, price, volume, rates, and normalized UTC time', () => {
    const state = initialState()
    const next = acceptedState(transitionSession(state, { type: 'add-entry', record: makeRecord() }))
    const saved = next.entries[0]
    expect(saved.entry).toEqual({ ...makeRecord().entry, consumedAt: '2026-11-08T09:30:00.000Z' })
    expect(saved.entry.quantity * saved.entry.servingMl).toBe(660)
    expect(saved.entry.totalPriceMinor).toBe(300)
    expect(saved.nutritionProvenance.kind).toBe('user-provided')
    expect(saved.nutritionProvenance.reference.source).toEqual(makeRecord().nutritionProvenance.reference.source)
    expect(state.entries).toEqual([])
    expect(next).not.toBe(state)
  })

  it.each(['reviewed', 'user-provided'] as const)('preserves the explicit %s source kind', kind => {
    const state = initialState()
    const next = acceptedState(transitionSession(state, { type: 'add-entry', record: makeRecord({}, kind) }))
    expect(next.entries[0].nutritionProvenance.kind).toBe(kind)
  })

  it.each([0, null])('preserves the explicit total price %s without multiplying it by quantity', totalPriceMinor => {
    const state = initialState()
    const next = acceptedState(transitionSession(state, { type: 'add-entry', record: makeRecord({ totalPriceMinor }) }))
    expect(next.entries[0].entry.totalPriceMinor).toBe(totalPriceMinor)
  })

  it('keeps currencies separate and accepts a custom serving size already supported by the domain', () => {
    const state = acceptedState(transitionSession(initialState(), { type: 'add-entry', record: makeRecord() }))
    const next = acceptedState(transitionSession(state, {
      type: 'add-entry',
      record: makeRecord({ id: 'drink-two', currency: 'USD', totalPriceMinor: 250, servingMl: 375 }),
    }))
    expect(next.entries.map(record => record.entry.currency)).toEqual(['JPY', 'USD'])
    expect(next.entries.map(record => record.entry.totalPriceMinor)).toEqual([300, 250])
    expect(next.entries[1].entry.servingMl).toBe(375)
  })

  it('owns frozen copies of every nested record and source without mutating the supplied objects', () => {
    const record = makeRecord()
    const before = structuredClone(record)
    const next = acceptedState(transitionSession(initialState(), { type: 'add-entry', record }))
    const saved = next.entries[0]
    expect(record).toEqual(before)
    for (const object of [record, record.entry, record.entry.nutrition, record.nutritionProvenance,
      record.nutritionProvenance.reference, record.nutritionProvenance.reference.source]) {
      expect(Object.isFrozen(object)).toBe(false)
    }
    for (const object of [next, next.entries, saved, saved.entry, saved.entry.nutrition,
      saved.nutritionProvenance, saved.nutritionProvenance.reference, saved.nutritionProvenance.reference.source]) {
      expect(Object.isFrozen(object)).toBe(true)
    }
    expect(saved.entry).not.toBe(record.entry)
    expect(saved.entry.nutrition).not.toBe(record.entry.nutrition)
    expect(saved.nutritionProvenance.reference.source).not.toBe(record.nutritionProvenance.reference.source)
    record.entry.currency = 'BDT'
    expect(Reflect.set(record.entry.nutrition, 'sugarGramsPer100Ml', 0)).toBe(true)
    record.nutritionProvenance.reference.kcalPer100Ml = 0
    record.nutritionProvenance.reference.source.label = 'Changed source'
    expect(saved.entry.currency).toBe('JPY')
    expect(saved.entry.nutrition.sugarGramsPer100Ml).toBe(10.5)
    expect(saved.nutritionProvenance.reference.kcalPer100Ml).toBe(42)
    expect(saved.nutritionProvenance.reference.source.label).toBe('Illustrative package label')
    expect(Reflect.set(saved.nutritionProvenance, 'kind', 'reviewed')).toBe(false)
    expect(Reflect.set(next.entries, 'length', 0)).toBe(false)
  })
})

describe('rejecting invalid or duplicate additions atomically', () => {
  it.each([null, { type: 'delete-entry' }])('rejects a malformed runtime action %j without changing state', action => {
    const state = initialState()
    // Reflect.apply represents an untyped JavaScript caller without weakening the public action type.
    const result: ReturnType<typeof transitionSession> = Reflect.apply(transitionSession, undefined, [state, action])
    expectRejected(result, state, 'action')
  })

  it.each([null, undefined, [], {}, { entry: makeRecord().entry }])('rejects a malformed session record %j', record => {
    const state = initialState()
    expectRejected(transitionSession(state, { type: 'add-entry', record }), state)
    expect(state.entries).toEqual([])
  })

  it('rejects an invalid entry timestamp using its entry field', () => {
    const state = initialState()
    expectRejected(transitionSession(state, {
      type: 'add-entry', record: makeRecord({ consumedAt: '2026-02-30T09:30:00Z' }),
    }), state, 'entry.consumedAt')
  })

  it('rejects a missing total price rather than silently saving a free drink', () => {
    const state = initialState()
    const record = makeRecord()
    const entry: Record<string, unknown> = { ...record.entry }
    delete entry.totalPriceMinor
    expectRejected(transitionSession(state, { type: 'add-entry', record: { ...record, entry } }),
      state, 'entry.totalPriceMinor')
  })

  it('rejects an unsupported provenance kind without relabeling it as reviewed', () => {
    const state = initialState()
    const record = makeRecord()
    expectRejected(transitionSession(state, {
      type: 'add-entry', record: { ...record, nutritionProvenance: { ...record.nutritionProvenance, kind: 'verified' } },
    }), state, 'nutritionProvenance.kind')
  })

  it.each([
    { key: 'id', value: 'another-label' },
    { key: 'version', value: 2 },
    { key: 'sugarGramsPer100Ml', value: 11 },
    { key: 'kcalPer100Ml', value: 43 },
  ])('rejects a provenance $key that disagrees with the saved snapshot', ({ key, value }) => {
    const state = initialState()
    const record = makeRecord()
    const mismatched = {
      ...record,
      nutritionProvenance: { ...record.nutritionProvenance, reference: { ...record.nutritionProvenance.reference, [key]: value } },
    }
    expectRejected(transitionSession(state, { type: 'add-entry', record: mismatched }), state,
      `nutritionProvenance.reference.${key}`)
  })

  it('rejects malformed source metadata through the existing reference validation', () => {
    const state = initialState()
    const record = makeRecord()
    record.nutritionProvenance.reference.source.url = 'javascript:example'
    expectRejected(transitionSession(state, { type: 'add-entry', record }), state,
      'nutritionProvenance.reference.source.url')
  })

  it('rejects a duplicate ID without replacing or appending the original record', () => {
    const first = makeRecord()
    const state = acceptedState(transitionSession(initialState(), { type: 'add-entry', record: first }))
    const result = transitionSession(state, { type: 'add-entry', record: makeRecord({ quantity: 3 }) })
    expect(result.outcome).toBe('duplicate')
    if (result.outcome !== 'duplicate') throw new Error('Expected a duplicate ID outcome.')
    expect(result.state).toBe(state)
    expect(result.entryId).toBe(first.entry.id)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0].entry.quantity).toBe(2)
  })

  it('allows intentionally identical drinks when the supplied IDs differ', () => {
    const state = acceptedState(transitionSession(initialState(), { type: 'add-entry', record: makeRecord() }))
    const next = acceptedState(transitionSession(state, {
      type: 'add-entry', record: makeRecord({ id: 'drink-two' }),
    }))
    expect(next.entries.map(record => record.entry.id)).toEqual(['drink-one', 'drink-two'])
    expect(next.entries[0].entry.consumedAt).toBe(next.entries[1].entry.consumedAt)
    expect(next.entries).toHaveLength(2)
  })

  it('rejects unsafe serving arithmetic without adding a partial record', () => {
    const state = initialState()
    const issues = expectRejected(transitionSession(state, {
      type: 'add-entry', record: makeRecord({ quantity: Number.MAX_SAFE_INTEGER }),
    }), state, 'entries.totalMl')
    expect(issues.some(issue => issue.entryIndex === 0)).toBe(true)
    expect(state.entries).toEqual([])
  })

  it('rejects nonfinite nutrition estimates even when rates and volume are individually valid', () => {
    const state = initialState()
    const record = makeRecord({ quantity: 1, servingMl: 200 })
    expect(Reflect.set(record.entry.nutrition, 'kcalPer100Ml', Number.MAX_VALUE)).toBe(true)
    record.nutritionProvenance.reference.kcalPer100Ml = Number.MAX_VALUE
    expectRejected(transitionSession(state, { type: 'add-entry', record }), state, 'entries.kcal')
  })

  it('rejects aggregate currency spending overflow and preserves the earlier accepted entry', () => {
    const first = makeRecord({ totalPriceMinor: Number.MAX_SAFE_INTEGER })
    const state = acceptedState(transitionSession(initialState(), { type: 'add-entry', record: first }))
    const issues = expectRejected(transitionSession(state, {
      type: 'add-entry', record: makeRecord({ id: 'drink-two', totalPriceMinor: 1 }),
    }), state, 'entries.knownAmountMinor')
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ entryIndex: 1, currency: 'JPY' }),
    ]))
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0].entry.totalPriceMinor).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('updating preferences without rewriting drink history', () => {
  it('changes preferences while retaining original records and their immutable source snapshots', () => {
    const state = acceptedState(transitionSession(initialState(), { type: 'add-entry', record: makeRecord() }))
    const previousRecords = state.entries
    const history = structuredClone(previousRecords)
    const preferences = { currency: 'USD', reportingTimeZone: 'America/New_York', dailyLimitMl: null }
    const next = acceptedState(transitionSession(state, { type: 'update-preferences', preferences }))
    expect(next.preferences).toEqual(preferences)
    expect(next.preferences).not.toBe(preferences)
    expect(next.entries).toBe(previousRecords)
    expect(next.entries).toEqual(history)
    expect(next.entries[0].entry.currency).toBe('JPY')
    expect(next.entries[0].entry.consumedAt).toBe('2026-11-08T09:30:00.000Z')
    expect(next.entries[0].entry.servingMl).toBe(330)
    expect(next.entries[0].nutritionProvenance.kind).toBe('user-provided')
    expect(state.preferences.currency).toBe('JPY')
    expect(Object.isFrozen(preferences)).toBe(false)
    expect(Object.isFrozen(next.preferences)).toBe(true)
    preferences.reportingTimeZone = 'UTC'
    expect(next.preferences.reportingTimeZone).toBe('America/New_York')
  })

  it('rejects invalid preference changes without partially changing either preferences or entries', () => {
    const state = acceptedState(transitionSession(initialState(), { type: 'add-entry', record: makeRecord() }))
    expectRejected(transitionSession(state, {
      type: 'update-preferences',
      preferences: { currency: 'USD', reportingTimeZone: '+09:00', dailyLimitMl: null },
    }), state, 'preferences.reportingTimeZone')
    expect(state.preferences.currency).toBe('JPY')
    expect(state.preferences.reportingTimeZone).toBe('Asia/Tokyo')
    expect(state.entries).toHaveLength(1)
  })

  it('returns the same transition data for the same inputs without generating IDs or timestamps', () => {
    const state = initialState()
    const action = { type: 'add-entry' as const, record: makeRecord() }
    const first = acceptedState(transitionSession(state, action))
    const repeated = acceptedState(transitionSession(state, action))
    expect(repeated).toEqual(first)
    expect(repeated.entries[0].entry.id).toBe(action.record.entry.id)
    expect(repeated.entries[0].entry.consumedAt).toBe('2026-11-08T09:30:00.000Z')
    expect(state.entries).toEqual([])
  })

  it('exposes session records, preferences, and provenance as readonly TypeScript contracts', () => {
    const checkReadonly = (state: SessionState, record: SessionEntryRecord, preferences: TrackingSettings) => {
      // @ts-expect-error Session history is a readonly collection.
      state.entries.push(record)
      // @ts-expect-error Preferences are replaced through a transition.
      state.preferences = preferences
      // @ts-expect-error Historical provenance cannot be relabeled.
      record.nutritionProvenance.kind = 'reviewed'
      // @ts-expect-error Stored source metadata is readonly.
      record.nutritionProvenance.reference.source.label = 'Changed source'
    }
    expectTypeOf(checkReadonly).toBeFunction()
  })
})
