import { describe, expect, expectTypeOf, it } from 'vitest'
import { preparePersonalNutrition } from './nutritionInput'
import type {
  NutritionInputIdentity,
  NutritionInputResult,
  PersonalNutritionDraft,
} from './nutritionInput'

// Illustrative test values only; these are not production nutrition defaults.
function draft(overrides: Partial<PersonalNutritionDraft> = {}): PersonalNutritionDraft {
  return {
    productDescription: 'My can label',
    sugarGramsPer100MlText: '10.5',
    kcalPer100MlText: '42',
    sourceDescription: 'Values copied from my package',
    ...overrides,
  }
}

const identity: NutritionInputIdentity = { id: 'personal-label', version: 1 }

function referenceFrom(result: NutritionInputResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected valid personal nutrition input.')
  return result.reference
}

function expectIssues(result: NutritionInputResult, fields: readonly string[]) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected personal nutrition field issues.')
  expect(result).not.toHaveProperty('reference')
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  for (const issue of result.issues) expect(issue.message.trim()).not.toBe('')
}

describe('preparePersonalNutrition', () => {
  it('creates a reference from entered per-100-ml values and caller-supplied identity', () => {
    expect(referenceFrom(preparePersonalNutrition(draft(), identity))).toEqual({
      id: 'personal-label',
      version: 1,
      productDescription: 'My can label',
      sugarGramsPer100Ml: 10.5,
      kcalPer100Ml: 42,
      source: { label: 'Values copied from my package' },
    })
  })

  it.each(['0', '0.0', '000.000', ' 0 '])('accepts explicit zero text %s for both rates', text => {
    const reference = referenceFrom(preparePersonalNutrition(draft({
      sugarGramsPer100MlText: text,
      kcalPer100MlText: text,
    }), identity))
    expect(reference.sugarGramsPer100Ml).toBe(0)
    expect(reference.kcalPer100Ml).toBe(0)
  })

  it('trims numeric and descriptive text while retaining Unicode descriptions', () => {
    const reference = referenceFrom(preparePersonalNutrition(draft({
      productDescription: '  コーラ — বাংলা 🥤  ',
      sugarGramsPer100MlText: ' 0010.50 ',
      kcalPer100MlText: '\t42.00\n',
      sourceDescription: '  缶の表示 / বোতলের লেবেল  ',
      sourceUrl: '  https://example.invalid/ラベル  ',
    }), identity))
    expect(reference).toMatchObject({
      productDescription: 'コーラ — বাংলা 🥤',
      sugarGramsPer100Ml: 10.5,
      kcalPer100Ml: 42,
      source: { label: '缶の表示 / বোতলের লেবেল', url: 'https://example.invalid/ラベル' },
    })
  })

  it.each([undefined, '', '   ', '\t\n'])('omits the optional URL when it is %j', sourceUrl => {
    const reference = referenceFrom(preparePersonalNutrition(draft({ sourceUrl }), identity))
    expect(reference.source).toEqual({ label: 'Values copied from my package' })
    expect(reference.source).not.toHaveProperty('url')
  })

  it.each(['http://example.invalid/label', 'https://example.invalid/label'])('accepts source URL %s', sourceUrl => {
    expect(referenceFrom(preparePersonalNutrition(draft({ sourceUrl }), identity)).source.url).toBe(sourceUrl)
  })

  it.each(['not a URL', 'ftp://example.invalid/label', 'javascript:alert(1)', null, 123])(
    'rejects an invalid optional URL %j', sourceUrl => {
      expectIssues(preparePersonalNutrition({ ...draft(), sourceUrl }, identity), ['sourceUrl'])
    },
  )

  describe.each(['sugarGramsPer100MlText', 'kcalPer100MlText'] as const)('%s validation', field => {
    it.each([
      { label: 'blank', value: '' },
      { label: 'whitespace', value: ' \t ' },
      { label: 'missing', value: undefined },
      { label: 'null', value: null },
      { label: 'a numeric value instead of text', value: 0 },
      { label: 'a negative value', value: '-1' },
      { label: 'negative zero', value: '-0' },
      { label: 'an explicit plus sign', value: '+1' },
      { label: 'scientific notation', value: '1e2' },
      { label: 'a leading decimal point', value: '.5' },
      { label: 'a trailing decimal point', value: '1.' },
      { label: 'a grouping comma', value: '1,000' },
      { label: 'a decimal comma', value: '10,5' },
      { label: 'an internal space', value: '1 0' },
      { label: 'hexadecimal syntax', value: '0x10' },
      { label: 'a unit suffix', value: '10 g' },
      { label: 'NaN text', value: 'NaN' },
      { label: 'infinity text', value: 'Infinity' },
      { label: 'an infinite number', value: Infinity },
      { label: 'a NaN number', value: NaN },
      { label: 'an overflowing decimal', value: '9'.repeat(309) },
      { label: 'a nonzero decimal that rounds to zero', value: `0.${'0'.repeat(323)}1` },
      { label: 'a much smaller underflowing decimal', value: `0.${'0'.repeat(400)}1` },
    ])('rejects $label without inventing a replacement value', ({ value }) => {
      expectIssues(preparePersonalNutrition({ ...draft(), [field]: value }, identity), [field])
    })

    it('accepts a small representable nonzero decimal without treating it as zero', () => {
      const reference = referenceFrom(preparePersonalNutrition({
        ...draft(), [field]: `0.${'0'.repeat(323)}5`,
      }, identity))
      const rate = field === 'sugarGramsPer100MlText' ? reference.sugarGramsPer100Ml : reference.kcalPer100Ml
      expect(rate).toBe(Number.MIN_VALUE)
    })

    it('accepts a large finite value without inventing an arbitrary nutrition limit', () => {
      const reference = referenceFrom(preparePersonalNutrition({ ...draft(), [field]: `1${'0'.repeat(308)}` }, identity))
      const rate = field === 'sugarGramsPer100MlText' ? reference.sugarGramsPer100Ml : reference.kcalPer100Ml
      expect(rate).toBe(1e308)
    })
  })

  it.each(['productDescription', 'sourceDescription'] as const)('requires nonblank text for %s', field => {
    for (const value of ['', '  ', undefined, null, 123]) {
      expectIssues(preparePersonalNutrition({ ...draft(), [field]: value }, identity), [field])
    }
  })

  it.each([null, undefined, [], 'label', 0])('rejects malformed draft %j', input => {
    expectIssues(preparePersonalNutrition(input, identity), ['input'])
  })

  it('reports every missing required draft field instead of using defaults', () => {
    expectIssues(preparePersonalNutrition({}, identity), [
      'productDescription', 'sugarGramsPer100MlText', 'kcalPer100MlText', 'sourceDescription',
    ])
  })

  it.each(['', ' personal-label', 'personal-label ', null, undefined, 123])('rejects invalid identity ID %j', id => {
    const result = Reflect.apply(preparePersonalNutrition, undefined, [draft(), { ...identity, id }])
    expectIssues(result, ['id'])
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined])(
    'rejects invalid reference version %j', version => {
      const result = Reflect.apply(preparePersonalNutrition, undefined, [draft(), { ...identity, version }])
      expectIssues(result, ['version'])
    },
  )

  it.each([null, undefined, [], 'identity'])('rejects malformed identity %j without generating one', invalidIdentity => {
    expectIssues(Reflect.apply(preparePersonalNutrition, undefined, [draft(), invalidIdentity]), ['id', 'version'])
  })

  it('accepts the maximum safe version supplied by the caller', () => {
    expect(referenceFrom(preparePersonalNutrition(draft(), { ...identity, version: Number.MAX_SAFE_INTEGER })).version)
      .toBe(Number.MAX_SAFE_INTEGER)
  })

  it('combines malformed numeric, source, and identity issues without duplicating fields', () => {
    expectIssues(preparePersonalNutrition({
      ...draft(), sugarGramsPer100MlText: '', kcalPer100MlText: '-1', sourceUrl: 'invalid',
    }, { id: '', version: 0 }), ['sugarGramsPer100MlText', 'kcalPer100MlText', 'sourceUrl', 'id', 'version'])
  })

  it('does not infer independently reviewed status from caller-supplied extra fields', () => {
    const reference = referenceFrom(preparePersonalNutrition({ ...draft(), kind: 'reviewed', verified: true }, identity))
    expect(reference).not.toHaveProperty('kind')
    expect(reference).not.toHaveProperty('verified')
  })

  it('copies and freezes accepted data without mutating or freezing the caller input', () => {
    const input = draft({ sourceUrl: ' https://example.invalid/label ' })
    const inputBefore = structuredClone(input)
    const suppliedIdentity = { ...identity }
    const result = preparePersonalNutrition(input, suppliedIdentity)
    const reference = referenceFrom(result)
    expect(input).toEqual(inputBefore)
    expect(suppliedIdentity).toEqual(identity)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(suppliedIdentity)).toBe(false)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(reference)).toBe(true)
    expect(Object.isFrozen(reference.source)).toBe(true)
    expect(Reflect.set(reference, 'sugarGramsPer100Ml', 0)).toBe(false)
    expect(Reflect.set(reference.source, 'label', 'Changed')).toBe(false)
    Reflect.set(input, 'productDescription', 'Changed later')
    suppliedIdentity.id = 'Changed later'
    expect(reference.productDescription).toBe('My can label')
    expect(reference.id).toBe('personal-label')
    expect(reference.source.url).toBe('https://example.invalid/label')
  })

  it('returns frozen independent field issues for invalid input', () => {
    const input = draft({ sugarGramsPer100MlText: '' })
    const result = preparePersonalNutrition(input, identity)
    expectIssues(result, ['sugarGramsPer100MlText'])
    if (result.valid === true) throw new Error('Expected issues.')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.issues)).toBe(true)
    expect(Object.isFrozen(result.issues[0])).toBe(true)
    expect(Reflect.set(result.issues[0], 'field', 'input')).toBe(false)
    expect(input.sugarGramsPer100MlText).toBe('')
  })

  it('keeps editable draft and identity contracts readonly in TypeScript', () => {
    expectTypeOf<PersonalNutritionDraft['sugarGramsPer100MlText']>().toEqualTypeOf<string>()
    expectTypeOf<PersonalNutritionDraft['sourceUrl']>().toEqualTypeOf<string | undefined>()
    const verifyReadonly = (input: PersonalNutritionDraft, suppliedIdentity: NutritionInputIdentity) => {
      // @ts-expect-error Draft values must be replaced rather than mutated.
      input.productDescription = 'Changed'
      // @ts-expect-error The application supplies an immutable identity.
      suppliedIdentity.version = 2
    }
    expectTypeOf(verifyReadonly).toBeFunction()
  })
})
