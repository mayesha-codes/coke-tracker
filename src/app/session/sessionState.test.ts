import { describe, expect, expectTypeOf, it } from 'vitest'
import { createNutritionReference, createNutritionSnapshot } from '../../domain/nutrition'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type { DrinkEntry, TrackingSettings } from '../../domain/types'
import type { PersonalNutritionDraft } from '../../features/nutrition/nutritionInput'
import {
  createSessionState,
  transitionSession,
} from './sessionState'
import type { NutritionProvenance, PersonalNutritionSetup, SessionEntryRecord, SessionState } from './sessionState'

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

// All personal label values and descriptions in these tests are illustrative, not verified data.
function personalDraft(overrides: Partial<PersonalNutritionDraft> = {}): PersonalNutritionDraft {
  return {
    productDescription: 'Illustrative personal can',
    sugarGramsPer100MlText: '10.5',
    kcalPer100MlText: '42',
    sourceDescription: 'Values transcribed from an illustrative can label',
    sourceUrl: 'https://example.invalid/personal-label',
    ...overrides,
  }
}

function applyPersonalNutrition(state: SessionState, draft: unknown = personalDraft()): SessionState {
  return acceptedState(transitionSession(state, {
    type: 'apply-personal-nutrition', id: 'personal-label', draft,
  }))
}

function personalSetup(state: SessionState): PersonalNutritionSetup {
  expect(state.personalNutrition).not.toBeNull()
  if (state.personalNutrition === null) throw new Error('Expected an accepted personal nutrition setup.')
  return state.personalNutrition
}

function stateWithPersonalHistory(): SessionState {
  const state = applyPersonalNutrition(initialState({
    currency: 'EUR', reportingTimeZone: 'Europe/Paris', dailyLimitMl: 750,
  }))
  const setup = personalSetup(state)
  const snapshot = createNutritionSnapshot(setup.reference)
  if (snapshot.valid === false) throw new Error('Expected a valid illustrative snapshot.')
  return acceptedState(transitionSession(state, {
    type: 'add-entry',
    record: {
      entry: { ...makeRecord().entry, nutrition: snapshot.snapshot },
      nutritionProvenance: setup,
    },
  }))
}

describe('applying one versioned personal nutrition setup', () => {
  it('starts without personal values instead of inventing nutrition defaults', () => {
    expect(initialState().personalNutrition).toBeNull()
  })

  it('creates version one using the caller ID and assigns user-provided provenance internally', () => {
    const state = initialState()
    const next = applyPersonalNutrition(state)
    expect(personalSetup(next)).toEqual({
      kind: 'user-provided',
      reference: {
        id: 'personal-label', version: 1,
        productDescription: 'Illustrative personal can',
        sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42,
        source: {
          label: 'Values transcribed from an illustrative can label',
          url: 'https://example.invalid/personal-label',
        },
      },
    })
    expect(next.preferences).toBe(state.preferences)
    expect(next.entries).toBe(state.entries)
    expect(state.personalNutrition).toBeNull()
  })

  it('accepts explicit zero sugar and calorie values while keeping them user-provided', () => {
    const next = applyPersonalNutrition(initialState(), personalDraft({
      sugarGramsPer100MlText: '0', kcalPer100MlText: '0.00',
    }))
    expect(personalSetup(next).reference.sugarGramsPer100Ml).toBe(0)
    expect(personalSetup(next).reference.kcalPer100Ml).toBe(0)
    expect(personalSetup(next).kind).toBe('user-provided')
  })

  it('does not let caller-supplied kind, version, or nested reference metadata claim reviewed status', () => {
    const draft = {
      ...personalDraft(), kind: 'reviewed', version: 50,
      reference: { kind: 'reviewed', id: 'untrusted-id', version: 99 },
    }
    const action = {
      type: 'apply-personal-nutrition' as const, id: 'personal-label', draft,
      kind: 'reviewed', version: 60,
    }
    const next = acceptedState(transitionSession(initialState(), action))
    expect(personalSetup(next).kind).toBe('user-provided')
    expect(personalSetup(next).reference.id).toBe('personal-label')
    expect(personalSetup(next).reference.version).toBe(1)
    expect('kind' in personalSetup(next).reference).toBe(false)
  })

  it('retains the exact state and version for unchanged normalized values', () => {
    const state = applyPersonalNutrition(initialState())
    const next = applyPersonalNutrition(state, personalDraft({
      productDescription: '  Illustrative personal can  ',
      sugarGramsPer100MlText: '010.5000', kcalPer100MlText: ' 042.00 ',
      sourceDescription: ' Values transcribed from an illustrative can label ',
      sourceUrl: ' https://example.invalid/personal-label ',
    }))
    expect(next).toBe(state)
    expect(next.personalNutrition).toBe(state.personalNutrition)
    expect(personalSetup(next).reference.version).toBe(1)
  })

  it('treats omitted and whitespace-only optional URLs as the same normalized metadata', () => {
    const state = applyPersonalNutrition(initialState(), personalDraft({ sourceUrl: undefined }))
    const next = applyPersonalNutrition(state, personalDraft({ sourceUrl: ' \t ' }))
    expect(next).toBe(state)
    expect(personalSetup(next).reference.source).not.toHaveProperty('url')
  })

  it.each([
    ['product description', { productDescription: 'Another illustrative package' }],
    ['sugar rate', { sugarGramsPer100MlText: '11' }],
    ['calorie rate', { kcalPer100MlText: '43' }],
    ['source description only', { sourceDescription: 'A corrected illustrative label transcription' }],
    ['source URL only', { sourceUrl: 'https://example.invalid/corrected-label' }],
    ['source URL removal only', { sourceUrl: '' }],
  ] satisfies [string, Partial<PersonalNutritionDraft>][])('creates the next version when the %s changes', (_, changes) => {
    const state = applyPersonalNutrition(initialState())
    const previousSetup = personalSetup(state)
    const next = applyPersonalNutrition(state, personalDraft(changes))
    expect(personalSetup(next).reference.version).toBe(2)
    expect(personalSetup(next).reference.id).toBe(previousSetup.reference.id)
    expect(personalSetup(next).kind).toBe('user-provided')
    expect(next.personalNutrition).not.toBe(previousSetup)
    expect(previousSetup.reference.version).toBe(1)
    expect(next.entries).toBe(state.entries)
    expect(next.preferences).toBe(state.preferences)
  })

  it('increments once when several values change and again when restoring earlier values', () => {
    const first = applyPersonalNutrition(initialState())
    const second = applyPersonalNutrition(first, personalDraft({
      sugarGramsPer100MlText: '11', kcalPer100MlText: '43', sourceDescription: 'Corrected illustrative source',
    }))
    const third = applyPersonalNutrition(second)
    expect(personalSetup(second).reference.version).toBe(2)
    expect(personalSetup(third).reference.version).toBe(3)
    expect(personalSetup(first).reference.version).toBe(1)
    expect(applyPersonalNutrition(third)).toBe(third)
  })

  it('creates a version when a source URL is added to a setup that omitted it', () => {
    const state = applyPersonalNutrition(initialState(), personalDraft({ sourceUrl: undefined }))
    const next = applyPersonalNutrition(state)
    expect(personalSetup(next).reference.version).toBe(2)
    expect(personalSetup(next).reference.source.url).toBe('https://example.invalid/personal-label')
  })

  it('copies and deeply freezes the setup without freezing or changing caller-owned input', () => {
    const draft = { ...personalDraft(), productDescription: '  個人ラベル — مثال  ' }
    const action = { type: 'apply-personal-nutrition' as const, id: 'personal-label', draft }
    const before = structuredClone(action)
    const result = transitionSession(initialState(), action)
    const next = acceptedState(result)
    const setup = personalSetup(next)
    expect(action).toEqual(before)
    expect(Object.isFrozen(action)).toBe(false)
    expect(Object.isFrozen(draft)).toBe(false)
    for (const object of [result, next, setup, setup.reference, setup.reference.source]) {
      expect(Object.isFrozen(object)).toBe(true)
    }
    draft.productDescription = 'Changed after applying'
    draft.sugarGramsPer100MlText = '0'
    action.id = 'changed-id'
    expect(setup.reference.productDescription).toBe('個人ラベル — مثال')
    expect(setup.reference.sugarGramsPer100Ml).toBe(10.5)
    expect(setup.reference.id).toBe('personal-label')
    expect(Reflect.set(setup, 'kind', 'reviewed')).toBe(false)
    expect(Reflect.set(setup.reference, 'sugarGramsPer100Ml', 0)).toBe(false)
    expect(Reflect.set(setup.reference.source, 'label', 'Changed')).toBe(false)
  })

  it('is deterministic and never supplies a replacement ID or reads a clock', () => {
    const state = initialState()
    const action = { type: 'apply-personal-nutrition' as const, id: 'supplied-at-boundary', draft: personalDraft() }
    const first = acceptedState(transitionSession(state, action))
    const repeated = acceptedState(transitionSession(state, action))
    expect(repeated).toEqual(first)
    expect(personalSetup(first).reference.id).toBe('supplied-at-boundary')
    expect(state.personalNutrition).toBeNull()
  })
})

describe('rejecting personal nutrition changes atomically', () => {
  it.each([
    ['missing draft', undefined, 'input'],
    ['null draft', null, 'input'],
    ['missing fields', {}, 'productDescription'],
    ['blank description', personalDraft({ productDescription: ' ' }), 'productDescription'],
    ['blank sugar', personalDraft({ sugarGramsPer100MlText: '' }), 'sugarGramsPer100MlText'],
    ['blank calories', personalDraft({ kcalPer100MlText: '' }), 'kcalPer100MlText'],
    ['negative sugar', personalDraft({ sugarGramsPer100MlText: '-1' }), 'sugarGramsPer100MlText'],
    ['nonfinite calories', personalDraft({ kcalPer100MlText: 'Infinity' }), 'kcalPer100MlText'],
    ['overflowing sugar', personalDraft({ sugarGramsPer100MlText: '9'.repeat(400) }), 'sugarGramsPer100MlText'],
    ['underflowing sugar', personalDraft({ sugarGramsPer100MlText: `0.${'0'.repeat(400)}1` }), 'sugarGramsPer100MlText'],
    ['blank source', personalDraft({ sourceDescription: '\t' }), 'sourceDescription'],
    ['invalid URL', personalDraft({ sourceUrl: 'javascript:example' }), 'sourceUrl'],
  ])('rejects %s without changing the setup, history, or preferences', (_, draft, field) => {
    const state = stateWithPersonalHistory()
    const before = structuredClone(state)
    const result = transitionSession(state, { type: 'apply-personal-nutrition', id: 'personal-label', draft })
    const issues = expectRejected(result, state, `personalNutrition.${field}`)
    expect(state).toEqual(before)
    expect(Object.isFrozen(issues)).toBe(true)
    expect(issues.every(issue => Object.isFrozen(issue))).toBe(true)
  })

  it.each([undefined, null, '', ' spaced-id '])('rejects an invalid application-supplied ID %j without generating one', id => {
    const state = initialState()
    const action = { type: 'apply-personal-nutrition', id, draft: personalDraft() }
    const result: ReturnType<typeof transitionSession> = Reflect.apply(transitionSession, undefined, [state, action])
    expectRejected(result, state, 'personalNutrition.id')
    expect(state.personalNutrition).toBeNull()
  })

  it('rejects a different setup ID instead of replacing the existing setup identity', () => {
    const state = stateWithPersonalHistory()
    expectRejected(transitionSession(state, {
      type: 'apply-personal-nutrition', id: 'unexpected-new-id', draft: personalDraft(),
    }), state, 'personalNutrition.id')
    expect(personalSetup(state).reference.id).toBe('personal-label')
    expect(personalSetup(state).reference.version).toBe(1)
  })

  it('does not consume a version after a rejected edit', () => {
    const state = applyPersonalNutrition(initialState())
    expectRejected(transitionSession(state, {
      type: 'apply-personal-nutrition', id: 'personal-label', draft: personalDraft({ kcalPer100MlText: '' }),
    }), state, 'personalNutrition.kcalPer100MlText')
    const next = applyPersonalNutrition(state, personalDraft({ kcalPer100MlText: '43' }))
    expect(personalSetup(next).reference.version).toBe(2)
  })

  it('allows an unchanged maximum-version setup but rejects an overflowing revision without partial changes', () => {
    const earlier = stateWithPersonalHistory()
    // This valid frozen fixture reaches the boundary directly instead of performing trillions of edits.
    const checked = createNutritionReference({ ...personalSetup(earlier).reference, version: Number.MAX_SAFE_INTEGER })
    if (checked.valid === false) throw new Error('Expected a valid maximum-version fixture.')
    const state: SessionState = Object.freeze({
      ...earlier,
      personalNutrition: Object.freeze({ kind: 'user-provided', reference: checked.reference }),
    })
    expect(applyPersonalNutrition(state)).toBe(state)
    const before = structuredClone(state)
    expectRejected(transitionSession(state, {
      type: 'apply-personal-nutrition', id: 'personal-label',
      draft: personalDraft({ sourceDescription: 'A new illustrative source' }),
    }), state, 'personalNutrition.version')
    expect(state).toEqual(before)
    expect(personalSetup(state).reference.version).toBe(Number.MAX_SAFE_INTEGER)
    expect(state.entries).toBe(earlier.entries)
    expect(state.preferences).toBe(earlier.preferences)
  })
})

describe('preserving personal nutrition and historical records across session actions', () => {
  it('leaves saved version-one snapshots and source metadata unchanged after a personal revision', () => {
    const state = stateWithPersonalHistory()
    const history = structuredClone(state.entries)
    const next = applyPersonalNutrition(state, personalDraft({
      sugarGramsPer100MlText: '11', kcalPer100MlText: '43',
      sourceDescription: 'A new illustrative package label', sourceUrl: '',
    }))
    expect(personalSetup(next).reference.version).toBe(2)
    expect(personalSetup(next).reference.sugarGramsPer100Ml).toBe(11)
    expect(personalSetup(next).reference.kcalPer100Ml).toBe(43)
    expect(personalSetup(next).reference.source).toEqual({ label: 'A new illustrative package label' })
    expect(next.preferences).toBe(state.preferences)
    expect(next.entries).toBe(state.entries)
    expect(next.entries).toEqual(history)
    const saved = next.entries[0]
    expect(saved.entry.currency).toBe('JPY')
    expect(saved.entry.consumedAt).toBe('2026-11-08T09:30:00.000Z')
    expect(saved.entry.servingMl).toBe(330)
    expect(saved.entry.nutrition).toEqual({
      referenceId: 'personal-label', referenceVersion: 1, sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42,
    })
    expect(saved.nutritionProvenance.kind).toBe('user-provided')
    expect(saved.nutritionProvenance.reference.version).toBe(1)
    expect(saved.nutritionProvenance.reference.source.url).toBe('https://example.invalid/personal-label')
    expect(saved.nutritionProvenance.reference).not.toBe(personalSetup(next).reference)
  })

  it('retains the personal setup after accepted preference changes and accepted entry additions', () => {
    const state = stateWithPersonalHistory()
    const preferences = { currency: 'USD', reportingTimeZone: 'America/New_York', dailyLimitMl: 750 }
    const updatedPreferences = acceptedState(transitionSession(state, { type: 'update-preferences', preferences }))
    expect(updatedPreferences.personalNutrition).toBe(state.personalNutrition)
    expect(updatedPreferences.entries).toBe(state.entries)
    const addedEntry = acceptedState(transitionSession(updatedPreferences, {
      type: 'add-entry', record: makeRecord({ id: 'drink-two' }),
    }))
    expect(addedEntry.personalNutrition).toBe(state.personalNutrition)
    expect(addedEntry.preferences).toBe(updatedPreferences.preferences)
    expect(addedEntry.entries[0]).toBe(state.entries[0])
    expect(addedEntry.entries).toHaveLength(2)
  })

  it('retains the setup, preferences, and history through duplicate and invalid transition branches', () => {
    const state = stateWithPersonalHistory()
    const duplicate = transitionSession(state, { type: 'add-entry', record: makeRecord() })
    expect(duplicate.outcome).toBe('duplicate')
    expect(duplicate.state).toBe(state)
    const rejectedActions = [
      { type: 'update-preferences' as const, preferences: { ...state.preferences, currency: 'XYZ' } },
      { type: 'add-entry' as const, record: null },
      { type: 'add-entry' as const, record: makeRecord({ id: 'unsafe-entry', quantity: Number.MAX_SAFE_INTEGER }) },
    ]
    for (const action of rejectedActions) {
      expectRejected(transitionSession(state, action), state)
    }
    const malformed: ReturnType<typeof transitionSession> = Reflect.apply(transitionSession, undefined, [state, null])
    expectRejected(malformed, state, 'action')
    expect(personalSetup(state).reference.version).toBe(1)
    expect(state.entries).toHaveLength(1)
    expect(state.preferences.dailyLimitMl).toBe(750)
  })

  it('exposes personal setup, metadata, and provenance as readonly TypeScript contracts', () => {
    const checkReadonly = (state: SessionState, setup: PersonalNutritionSetup) => {
      // @ts-expect-error Personal setup changes go through a validated transition.
      state.personalNutrition = null
      // @ts-expect-error Personal values cannot claim independent review.
      setup.kind = 'reviewed'
      // @ts-expect-error Reference versions are assigned by the session transition.
      setup.reference.version = 2
      // @ts-expect-error Historical source metadata is immutable.
      setup.reference.source.label = 'Changed'
    }
    expectTypeOf(checkReadonly).toBeFunction()
    expectTypeOf<PersonalNutritionSetup['kind']>().toEqualTypeOf<'user-provided'>()
  })
})
