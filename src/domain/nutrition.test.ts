import { describe, expect, it } from 'vitest'
import {
  calculateNutrition,
  createNutritionReference,
  createNutritionSnapshot,
  validateNutritionSnapshot,
} from './nutrition'
import type {
  NutritionCalculationResult,
  NutritionReferenceResult,
  NutritionSnapshotResult,
} from './nutrition'

// All rates and product/source descriptions below are illustrative test data.
function makeReferenceInput() {
  return {
    id: 'example-cola',
    version: 1,
    sugarGramsPer100Ml: 10.5,
    kcalPer100Ml: 42,
    productDescription: 'Example cola for tests',
    source: {
      label: 'Illustrative package label',
      url: 'https://example.invalid/nutrition',
    },
  }
}

function makeSnapshot() {
  return {
    referenceId: 'example-cola',
    referenceVersion: 1,
    sugarGramsPer100Ml: 10.5,
    kcalPer100Ml: 42,
  }
}

function makeCalculation() {
  return { quantity: 2, servingMl: 330, nutrition: makeSnapshot() }
}

function referenceFrom(result: NutritionReferenceResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid nutrition reference.')
  return result.reference
}

function snapshotFrom(result: NutritionSnapshotResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid nutrition snapshot.')
  return result.snapshot
}

function estimateFrom(result: NutritionCalculationResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid nutrition estimate.')
  return result.estimate
}

function expectIssueFields(
  result: NutritionReferenceResult | NutritionSnapshotResult | NutritionCalculationResult,
  fields: readonly string[],
) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected nutrition validation issues.')
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  for (const issue of result.issues) {
    expect(issue.message.trim()).not.toBe('')
  }
}

// Simulate malformed JavaScript callers without weakening the production TypeScript API.
function calculateUnknown(input: unknown): NutritionCalculationResult {
  return Reflect.apply(calculateNutrition, undefined, [input])
}

describe('nutrition catalog references', () => {
  it('creates a reference with the supplied ID, version, description, source, and rates', () => {
    const input = makeReferenceInput()
    expect(referenceFrom(createNutritionReference(input))).toEqual(input)
  })

  it('copies and freezes the reference and nested source without changing the input', () => {
    const input = makeReferenceInput()
    const before = structuredClone(input)
    const reference = referenceFrom(createNutritionReference(input))

    expect(input).toEqual(before)
    expect(reference).not.toBe(input)
    expect(reference.source).not.toBe(input.source)
    expect(Object.isFrozen(reference)).toBe(true)
    expect(Object.isFrozen(reference.source)).toBe(true)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.source)).toBe(false)
    expect(Reflect.set(reference, 'version', 2)).toBe(false)
    expect(Reflect.set(reference.source, 'label', 'Changed source')).toBe(false)

    input.productDescription = 'Changed description'
    input.source.label = 'Changed label'
    expect(reference.productDescription).toBe('Example cola for tests')
    expect(reference.source.label).toBe('Illustrative package label')
  })

  it('allows a package-label source without an online URL', () => {
    const reference = referenceFrom(createNutritionReference({
      ...makeReferenceInput(),
      source: { label: 'Illustrative can label' },
    }))
    expect(reference.source).toEqual({ label: 'Illustrative can label' })
  })

  it.each(['http://example.invalid/label', 'https://example.invalid/label'])(
    'accepts an HTTP or HTTPS source URL: %s',
    url => {
      const reference = referenceFrom(createNutritionReference({
        ...makeReferenceInput(), source: { label: 'Example label', url },
      }))
      expect(reference.source.url).toBe(url)
    },
  )

  it.each(['', ' ', ' description', 'description ', 42, null, undefined])(
    'rejects an invalid product description: %s',
    productDescription => {
      expectIssueFields(createNutritionReference({ ...makeReferenceInput(), productDescription }), [
        'productDescription',
      ])
    },
  )

  it.each([null, undefined, [], 'label', 42])('rejects malformed source information: %s', source => {
    expectIssueFields(createNutritionReference({ ...makeReferenceInput(), source }), ['source'])
  })

  it.each(['', ' ', ' label', 'label ', 42, null, undefined])(
    'rejects an invalid source label: %s',
    label => {
      expectIssueFields(createNutritionReference({
        ...makeReferenceInput(), source: { label },
      }), ['source.label'])
    },
  )

  it.each(['', ' ', '/relative/path', 'not a URL', 'ftp://example.invalid/label',
    'javascript:alert(1)', 'data:text/plain,label', ' https://example.invalid ', 42, null])(
    'rejects an invalid or unsupported source URL: %s',
    url => {
      expectIssueFields(createNutritionReference({
        ...makeReferenceInput(), source: { label: 'Example label', url },
      }), ['source.url'])
    },
  )

  it.each([
    { field: 'id', value: '' },
    { field: 'version', value: 0 },
    { field: 'sugarGramsPer100Ml', value: -1 },
    { field: 'kcalPer100Ml', value: Infinity },
  ] as const)('uses the catalog field name for invalid $field', ({ field, value }) => {
    expectIssueFields(createNutritionReference({ ...makeReferenceInput(), [field]: value }), [field])
  })

  it.each([null, undefined, [], 'reference', 42])('rejects a non-record reference: %s', input => {
    expectIssueFields(createNutritionReference(input), ['reference'])
  })

  it('collects several reference and metadata errors in one result', () => {
    expectIssueFields(createNutritionReference({
      ...makeReferenceInput(), id: '', version: 0, productDescription: '', source: {},
    }), ['id', 'version', 'productDescription', 'source.label'])
  })
})

describe('historical nutrition snapshots', () => {
  it('creates a size-independent snapshot without copying catalog descriptions or source objects', () => {
    expect(snapshotFrom(createNutritionSnapshot(makeReferenceInput()))).toEqual(makeSnapshot())
  })

  it('keeps a frozen independent snapshot after its source reference is edited', () => {
    const reference = makeReferenceInput()
    const before = structuredClone(reference)
    const snapshot = snapshotFrom(createNutritionSnapshot(reference))

    expect(reference).toEqual(before)
    expect(Object.isFrozen(reference)).toBe(false)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Reflect.set(snapshot, 'sugarGramsPer100Ml', 0)).toBe(false)
    reference.id = 'new-reference'
    reference.version = 2
    reference.sugarGramsPer100Ml = 8
    reference.kcalPer100Ml = 32
    expect(snapshot).toEqual(makeSnapshot())
  })

  it('validates saved snapshots by returning a fresh frozen copy', () => {
    const input = makeSnapshot()
    const snapshot = snapshotFrom(validateNutritionSnapshot(input))
    expect(snapshot).toEqual(input)
    expect(snapshot).not.toBe(input)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(input)).toBe(false)
  })

  it.each([0, 0.5, 10.75])('accepts finite nonnegative rates including %s', rate => {
    const snapshot = snapshotFrom(validateNutritionSnapshot({
      ...makeSnapshot(), sugarGramsPer100Ml: rate, kcalPer100Ml: rate,
    }))
    expect(snapshot.sugarGramsPer100Ml).toBe(rate)
    expect(snapshot.kcalPer100Ml).toBe(rate)
  })

  describe.each(['sugarGramsPer100Ml', 'kcalPer100Ml'] as const)('%s', field => {
    it.each([-1, NaN, Infinity, -Infinity, '10', null, undefined])(
      'rejects the invalid rate %s with the matching field',
      value => {
        expectIssueFields(validateNutritionSnapshot({ ...makeSnapshot(), [field]: value }), [field])
      },
    )
  })

  it.each(['', ' ', ' id', 'id ', 42, null, undefined])('rejects the reference ID %s', referenceId => {
    expectIssueFields(validateNutritionSnapshot({ ...makeSnapshot(), referenceId }), ['referenceId'])
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined])(
    'rejects the reference version %s',
    referenceVersion => {
      expectIssueFields(validateNutritionSnapshot({ ...makeSnapshot(), referenceVersion }), [
        'referenceVersion',
      ])
    },
  )

  it.each([null, undefined, [], 'snapshot', 42])('rejects a non-record snapshot: %s', input => {
    expectIssueFields(validateNutritionSnapshot(input), ['snapshot'])
  })

  it('returns a snapshot issue when a JavaScript caller supplies no reference', () => {
    const result = Reflect.apply(createNutritionSnapshot, undefined, [null])
    expectIssueFields(result, ['snapshot'])
  })
})

describe('nutrition calculations', () => {
  it('estimates 69.3 g sugar and 277.2 kcal for two 330 ml drinks using their saved rates', () => {
    const estimate = estimateFrom(calculateNutrition(makeCalculation()))
    expect(estimate.sugarGrams).toBeCloseTo(69.3, 10)
    expect(estimate.kcal).toBeCloseTo(277.2, 10)
  })

  it('uses the historical snapshot after the original reference changes', () => {
    const reference = makeReferenceInput()
    const nutrition = snapshotFrom(createNutritionSnapshot(reference))
    reference.sugarGramsPer100Ml = 0
    reference.kcalPer100Ml = 0

    const estimate = estimateFrom(calculateNutrition({ quantity: 2, servingMl: 330, nutrition }))
    expect(estimate.sugarGrams).toBeCloseTo(69.3, 10)
    expect(estimate.kcal).toBeCloseTo(277.2, 10)
  })

  it('preserves fractional estimates without rounding and supports custom serving sizes', () => {
    const estimate = estimateFrom(calculateNutrition({
      quantity: 1,
      servingMl: 375,
      nutrition: { ...makeSnapshot(), sugarGramsPer100Ml: 0.01, kcalPer100Ml: 0.02 },
    }))
    expect(estimate.sugarGrams).toBeCloseTo(0.0375, 12)
    expect(estimate.kcal).toBeCloseTo(0.075, 12)
  })

  it('returns zero estimates for explicitly zero nutrition rates', () => {
    const estimate = estimateFrom(calculateNutrition({
      ...makeCalculation(),
      nutrition: { ...makeSnapshot(), sugarGramsPer100Ml: 0, kcalPer100Ml: 0 },
    }))
    expect(estimate).toEqual({ sugarGrams: 0, kcal: 0 })
  })

  it('leaves the calculation input unchanged and returns a frozen estimate', () => {
    const input = makeCalculation()
    const before = structuredClone(input)
    const estimate = estimateFrom(calculateNutrition(input))
    expect(input).toEqual(before)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.nutrition)).toBe(false)
    expect(Object.isFrozen(estimate)).toBe(true)
    expect(Reflect.set(estimate, 'kcal', 0)).toBe(false)
  })

  describe.each(['quantity', 'servingMl'] as const)('%s', field => {
    it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null, undefined])(
      'rejects the invalid value %s with the matching field',
      value => {
        expectIssueFields(calculateUnknown({ ...makeCalculation(), [field]: value }), [field])
      },
    )
  })

  it('rejects an unsafe total volume even when quantity and serving size are individually safe', () => {
    expectIssueFields(calculateNutrition({
      ...makeCalculation(), quantity: Number.MAX_SAFE_INTEGER, servingMl: 2,
    }), ['totalMl'])
  })

  it('allows a safe maximum total volume when the resulting estimates stay finite', () => {
    const estimate = estimateFrom(calculateNutrition({
      ...makeCalculation(), quantity: 1, servingMl: Number.MAX_SAFE_INTEGER,
    }))
    expect(Number.isFinite(estimate.sugarGrams)).toBe(true)
    expect(Number.isFinite(estimate.kcal)).toBe(true)
  })

  it.each([
    { field: 'sugarGramsPer100Ml', issue: 'sugarGrams' },
    { field: 'kcalPer100Ml', issue: 'kcal' },
  ] as const)('rejects an overflowing $issue estimate', ({ field, issue }) => {
    expectIssueFields(calculateNutrition({
      quantity: 1,
      servingMl: 1000,
      nutrition: { ...makeSnapshot(), [field]: Number.MAX_VALUE },
    }), [issue])
  })

  it('collects both estimate overflow issues when both rates are too large for this volume', () => {
    expectIssueFields(calculateNutrition({
      quantity: 1,
      servingMl: 1000,
      nutrition: { ...makeSnapshot(), sugarGramsPer100Ml: Number.MAX_VALUE, kcalPer100Ml: Number.MAX_VALUE },
    }), ['sugarGrams', 'kcal'])
  })

  it('identifies invalid saved nutrition rather than looking up current catalog values', () => {
    expectIssueFields(calculateNutrition({
      ...makeCalculation(), nutrition: { ...makeSnapshot(), kcalPer100Ml: -1 },
    }), ['nutrition.kcalPer100Ml'])
  })

  it('collects invalid quantities and missing snapshot issues together', () => {
    expectIssueFields(calculateUnknown({ quantity: 0, servingMl: 0 }), [
      'quantity', 'servingMl', 'nutrition',
    ])
  })

  it.each([null, undefined, [], 'calculation', 42])('rejects a malformed calculation: %s', input => {
    expectIssueFields(calculateUnknown(input), ['calculation'])
  })
})
