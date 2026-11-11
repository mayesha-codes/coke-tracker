import { describe, expect, expectTypeOf, it } from 'vitest'
import { createDrinkEntry } from '../../domain/entries'
import { calculateNutrition, createNutritionSnapshot } from '../../domain/nutrition'
import { createSessionState, transitionSession } from '../../app/session/sessionState'
import {
  createReviewedProduct,
  createReviewedProductRegistry,
  REVIEWED_PRODUCTS,
  REVIEWED_REFERENCES,
} from './reviewedProducts'
import type { ReviewedProduct, ReviewedProductResult, ReviewedProductRegistryResult } from './reviewedProducts'

// Every helper-generated product/source below is conspicuously illustrative.
// Only the separate production-registry contract test asserts source-reviewed real data.
function fixture(version = 1) {
  return {
    productKey: 'illustrative-cola', productName: 'Illustrative cola',
    market: { code: 'GB', label: 'Great Britain' },
    evidence: {
      kind: 'manufacturer-page', location: 'https://example.invalid/label',
      section: 'Illustrative nutrition table', reviewedOn: '2026-11-11',
      basis: { value: 100, unit: 'ml' },
      sugars: { nutrient: 'sugars', label: 'Sugars', value: 10.5, unit: 'g' },
      energy: { label: 'Energy', value: 42, unit: 'kcal' },
    },
    reference: {
      id: 'illustrative-cola-gb', version,
      productDescription: 'Illustrative cola — Great Britain',
      sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42,
      source: { label: 'Illustrative manufacturer nutrition, per 100 ml', url: 'https://example.invalid/label' },
    },
  }
}

function productFrom(result: ReviewedProductResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected complete illustrative product evidence.')
  return result.product
}

function registryFrom(result: ReviewedProductRegistryResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid illustrative registry.')
  return result
}

function expectIssue(result: ReviewedProductResult | ReviewedProductRegistryResult, field: string, productIndex?: number) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected rejected product evidence.')
  expect(result.issues.some(issue => issue.field === field && (productIndex === undefined || issue.productIndex === productIndex)))
    .toBe(true)
  expect(result.issues.every(issue => issue.message.trim().length > 0)).toBe(true)
  expect(Object.isFrozen(result)).toBe(true)
  expect(Object.isFrozen(result.issues)).toBe(true)
  expect(result.issues.every(issue => Object.isFrozen(issue))).toBe(true)
}

describe('reviewed product evidence validation', () => {
  it('retains explicit product, market, units, source location, review date, and version', () => {
    const input = fixture()
    const product = productFrom(createReviewedProduct(input))
    expect(product).toEqual(input)
    expect(product.reference.productDescription).toContain(product.market.label)
    expect(product.reference.source.url).toBe(product.evidence.location)
  })

  it('accepts explicit zero sugar and calorie values as declared source measurements', () => {
    const input = fixture()
    input.evidence.sugars.value = 0
    input.evidence.energy.value = 0
    input.reference.sugarGramsPer100Ml = 0
    input.reference.kcalPer100Ml = 0
    const product = productFrom(createReviewedProduct(input))
    expect(product.reference.sugarGramsPer100Ml).toBe(0)
    expect(product.reference.kcalPer100Ml).toBe(0)
  })

  it('accepts an identified archived package label without inventing an online URL', () => {
    const input = fixture()
    const source = { label: input.reference.source.label }
    const product = productFrom(createReviewedProduct({
      ...input,
      evidence: { ...input.evidence, kind: 'package-label', location: 'docs/evidence/illustrative-can.jpg' },
      reference: { ...input.reference, source },
    }))
    expect(product.evidence.kind).toBe('package-label')
    expect(product.reference.source).not.toHaveProperty('url')
  })

  it.each(['javascript:label.jpg', 'data:image/png;base64,abc', 'file:///label.jpg', '/label.jpg', '../label.jpg',
    'docs/../label.jpg', 'C:\\labels\\can.jpg', 'docs/label.txt'])(
    'rejects an unsafe or unsupported package-label location %j', location => {
      const input = fixture()
      expectIssue(createReviewedProduct({
        ...input, evidence: { ...input.evidence, kind: 'package-label', location },
      }), 'evidence.location')
    },
  )

  it.each([null, undefined, [], 'product', 0])('rejects malformed product input %j', input => {
    expectIssue(createReviewedProduct(input), 'product')
  })

  it.each([
    ['product key', { productKey: 'Wrong Key' }, 'productKey'],
    ['blank product name', { productName: ' ' }, 'productName'],
    ['missing market', { market: undefined }, 'market.code'],
    ['lowercase market code', { market: { code: 'gb', label: 'Great Britain' } }, 'market.code'],
    ['three-letter market code', { market: { code: 'GBR', label: 'Great Britain' } }, 'market.code'],
    ['blank market name', { market: { code: 'GB', label: '' } }, 'market.label'],
    ['missing evidence', { evidence: undefined }, 'evidence.kind'],
    ['missing reference', { reference: undefined }, 'reference.reference'],
  ])('rejects %s without providing partially usable product data', (_, changes, field) => {
    const result = createReviewedProduct({ ...fixture(), ...changes })
    expectIssue(result, field as string)
    expect(result).not.toHaveProperty('product')
  })

  it.each([
    ['unsupported evidence kind', { kind: 'retailer-guess' }, 'evidence.kind'],
    ['blank evidence location', { location: '' }, 'evidence.location'],
    ['unsafe manufacturer URL', { location: 'javascript:alert(1)' }, 'evidence.location'],
    ['non-web manufacturer location', { location: 'docs/screenshot.jpg' }, 'evidence.location'],
    ['missing source section', { section: undefined }, 'evidence.section'],
    ['blank source section', { section: ' ' }, 'evidence.section'],
    ['missing units', { basis: {} }, 'evidence.basis'],
    ['a per-serving basis', { basis: { value: 330, unit: 'ml' } }, 'evidence.basis'],
    ['a mass basis', { basis: { value: 100, unit: 'g' } }, 'evidence.basis'],
    ['missing sugars', { sugars: undefined }, 'evidence.sugars'],
    ['missing calories', { energy: undefined }, 'evidence.energy'],
  ])('rejects evidence with %s', (_, changes, field) => {
    const input = fixture()
    expectIssue(createReviewedProduct({ ...input, evidence: { ...input.evidence, ...changes } }), field as string)
  })

  it.each(['', '2026-02-29', '2024-02-30', '2026-13-01', '2026-11-11T00:00:00Z', '11/11/2026', undefined])(
    'rejects malformed or impossible review date %j', reviewedOn => {
      const input = fixture()
      expectIssue(createReviewedProduct({ ...input, evidence: { ...input.evidence, reviewedOn } }), 'evidence.reviewedOn')
    },
  )

  it('accepts a real leap-day review date without reading the current clock', () => {
    const input = fixture()
    input.evidence.reviewedOn = '2024-02-29'
    expect(productFrom(createReviewedProduct(input)).evidence.reviewedOn).toBe('2024-02-29')
  })

  it('rejects carbohydrate-only evidence instead of treating it as sugar', () => {
    const input = fixture()
    const { sugars, ...evidence } = input.evidence
    expectIssue(createReviewedProduct({
      ...input, evidence: { ...evidence, carbohydrates: { ...sugars, nutrient: 'carbohydrates', label: 'Carbohydrates' } },
    }), 'evidence.sugars')
    expectIssue(createReviewedProduct({
      ...input, evidence: { ...evidence, sugars: { ...sugars, nutrient: 'carbohydrates', label: 'Carbohydrates' } },
    }), 'evidence.sugars')
  })

  it.each([undefined, null, '10.5', -1, Infinity, NaN])('rejects invalid source sugar measurement %j', value => {
    const input = fixture()
    expectIssue(createReviewedProduct({
      ...input, evidence: { ...input.evidence, sugars: { ...input.evidence.sugars, value } },
    }), 'evidence.sugars')
  })

  it('rejects sugar unit substitution, kJ substitution, and blank nutrient labels', () => {
    const input = fixture()
    expectIssue(createReviewedProduct({ ...input, evidence: {
      ...input.evidence, sugars: { ...input.evidence.sugars, unit: 'mg' },
    } }), 'evidence.sugars')
    expectIssue(createReviewedProduct({ ...input, evidence: {
      ...input.evidence, energy: { ...input.evidence.energy, value: 180, unit: 'kJ' },
    } }), 'evidence.energy')
    expectIssue(createReviewedProduct({ ...input, evidence: {
      ...input.evidence, sugars: { ...input.evidence.sugars, label: '' },
    } }), 'evidence.sugars')
  })

  it.each([
    ['a market-independent ID', { id: 'illustrative-cola' }, 'reference.id'],
    ['a different market ID', { id: 'illustrative-cola-jp' }, 'reference.id'],
    ['a description omitting the market', { productDescription: 'Illustrative cola' }, 'reference.productDescription'],
    ['a mismatched sugar rate', { sugarGramsPer100Ml: 11 }, 'evidence.sugars'],
    ['a mismatched calorie rate', { kcalPer100Ml: 43 }, 'evidence.energy'],
    ['a different saved source URL', { source: { label: 'Illustrative source', url: 'https://example.invalid/another' } }, 'reference.source.url'],
    ['an unsafe saved URL', { source: { label: 'Illustrative source', url: 'javascript:example' } }, 'reference.source.url'],
    ['an invalid version', { version: 0 }, 'reference.version'],
  ])('rejects %s', (_, changes, field) => {
    const input = fixture()
    expectIssue(createReviewedProduct({ ...input, reference: { ...input.reference, ...changes } }), field as string)
  })

  it('owns deep immutable copies without mutating or freezing caller objects', () => {
    const input = fixture()
    const before = structuredClone(input)
    const product = productFrom(createReviewedProduct(input))
    expect(input).toEqual(before)
    for (const object of [product, product.market, product.evidence, product.evidence.basis,
      product.evidence.sugars, product.evidence.energy, product.reference, product.reference.source]) {
      expect(Object.isFrozen(object)).toBe(true)
    }
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.evidence.sugars)).toBe(false)
    expect(product.reference).not.toBe(input.reference)
    expect(product.evidence.sugars).not.toBe(input.evidence.sugars)
    input.evidence.sugars.value = 0
    input.reference.source.label = 'Changed later'
    input.market.label = 'Changed market'
    expect(product.evidence.sugars.value).toBe(10.5)
    expect(product.market.label).toBe('Great Britain')
    expect(Reflect.set(product.evidence, 'reviewedOn', '2026-01-01')).toBe(false)
    expect(Reflect.set(product.reference.source, 'label', 'Changed')).toBe(false)
  })
})

describe('immutable reviewed reference version registry', () => {
  it('retains every supplied version while choosing the highest one regardless of input order', () => {
    const input = [fixture(3), fixture(1), fixture(2)]
    const registry = registryFrom(createReviewedProductRegistry(input))
    expect(registry.products.map(product => product.reference.version)).toEqual([3, 1, 2])
    expect(registry.references.map(reference => reference.version)).toEqual([3])
    expect(Object.isFrozen(registry)).toBe(true)
    expect(Object.isFrozen(registry.products)).toBe(true)
    expect(Object.isFrozen(registry.references)).toBe(true)
    expect(Object.isFrozen(input)).toBe(false)
  })

  it('allows an explicit empty registry and rejects malformed arrays or sparse records', () => {
    expect(registryFrom(createReviewedProductRegistry([])).references).toEqual([])
    for (const input of [null, undefined, {}, 'registry']) expectIssue(createReviewedProductRegistry(input), 'registry')
    expectIssue(createReviewedProductRegistry(new Array(1)), 'product', 0)
  })

  it('rejects duplicate ID/version records atomically even when their values match', () => {
    const result = createReviewedProductRegistry([fixture(), fixture()])
    expectIssue(result, 'reference.version', 1)
    expect(result).not.toHaveProperty('products')
    expect(result).not.toHaveProperty('references')
  })

  it('rejects an invalid later record without returning an accepted partial list', () => {
    const invalid = fixture(2)
    invalid.evidence.sugars.nutrient = 'carbohydrates'
    const result = createReviewedProductRegistry([fixture(), invalid])
    expectIssue(result, 'evidence.sugars', 1)
    expect(result).not.toHaveProperty('references')
  })

  it('rejects changing the product identity within an existing reference ID', () => {
    const revised = fixture(2)
    revised.productName = 'Different illustrative drink'
    revised.reference.productDescription = 'Different illustrative drink — Great Britain'
    expectIssue(createReviewedProductRegistry([fixture(), revised]), 'reference.id', 1)
  })

  it('keeps identical product names in different markets as separate choices', () => {
    const japan = fixture()
    japan.market = { code: 'JP', label: 'Japan' }
    japan.reference.id = 'illustrative-cola-jp'
    japan.reference.productDescription = 'Illustrative cola — Japan'
    const registry = registryFrom(createReviewedProductRegistry([fixture(), japan]))
    expect(registry.references.map(reference => reference.id)).toEqual(['illustrative-cola-gb', 'illustrative-cola-jp'])
    expect(registry.references.map(reference => reference.productDescription)).toEqual([
      'Illustrative cola — Great Britain', 'Illustrative cola — Japan',
    ])
  })

  it('accepts the largest safe version without incrementing or overflowing it', () => {
    const registry = registryFrom(createReviewedProductRegistry([fixture(Number.MAX_SAFE_INTEGER), fixture()]))
    expect(registry.references[0].version).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('keeps historical snapshots and source provenance unchanged after a new reviewed source version', () => {
    const original = productFrom(createReviewedProduct(fixture()))
    const created = createDrinkEntry({
      id: 'illustrative-drink', consumedAt: '2026-11-11T10:00:00Z', quantity: 2, servingMl: 330,
      totalPriceMinor: 300, currency: 'JPY',
    }, original.reference)
    if (created.valid === false) throw new Error('Expected a valid illustrative drink.')
    const initial = createSessionState()
    if (initial.valid === false) throw new Error('Expected initial session preferences.')
    const saved = transitionSession(initial.state, {
      type: 'add-entry', record: { entry: created.entry, nutritionProvenance: { kind: 'reviewed', reference: original.reference } },
    })
    if (saved.outcome !== 'accepted') throw new Error('Expected accepted illustrative history.')
    const before = structuredClone(saved.state.entries)
    const revision = fixture(2)
    revision.evidence.location = 'https://example.invalid/revised-label'
    revision.reference.source = { label: 'Revised illustrative source', url: revision.evidence.location }
    const registry = registryFrom(createReviewedProductRegistry([fixture(), revision]))
    expect(registry.references[0].version).toBe(2)
    expect(saved.state.entries).toEqual(before)
    expect(saved.state.entries[0].entry.nutrition.referenceVersion).toBe(1)
    expect(saved.state.entries[0].nutritionProvenance.reference.source.url).toBe('https://example.invalid/label')
    expect(registry.products[0].reference.source.label).toBe('Illustrative manufacturer nutrition, per 100 ml')
  })

  it('exposes readonly product, evidence, and version contracts in TypeScript', () => {
    const checkReadonly = (product: ReviewedProduct) => {
      // @ts-expect-error Published evidence is immutable.
      product.evidence.sugars.value = 0
      // @ts-expect-error A market revision cannot overwrite a published object.
      product.market.code = 'JP'
      // @ts-expect-error Reference versions cannot be changed in place.
      product.reference.version = 2
    }
    expectTypeOf(checkReadonly).toBeFunction()
  })
})

describe('the evidence-backed production list', () => {
  it('contains exactly the reviewed Great Britain Original Taste reference, with explicit manufacturer units', () => {
    expect(REVIEWED_PRODUCTS).toHaveLength(1)
    expect(REVIEWED_REFERENCES).toHaveLength(1)
    const product = REVIEWED_PRODUCTS[0]
    expect(product.reference).toBe(REVIEWED_REFERENCES[0])
    expect(product.reference).toEqual({
      id: 'coca-cola-original-taste-gb', version: 1,
      productDescription: 'Coca-Cola Original Taste — Great Britain',
      sugarGramsPer100Ml: 10.6, kcalPer100Ml: 42,
      source: {
        label: 'Coca-Cola Great Britain — Original Taste manufacturer nutrition, per 100 ml',
        url: 'https://www.coca-cola.com/gb/en/brands/coca-cola-original-taste',
      },
    })
    expect(product.market).toEqual({ code: 'GB', label: 'Great Britain' })
    expect(product.evidence).toMatchObject({
      kind: 'manufacturer-page', reviewedOn: '2026-11-11', basis: { value: 100, unit: 'ml' },
      sugars: { nutrient: 'sugars', label: 'Of which sugars', value: 10.6, unit: 'g' },
      energy: { label: 'Energy', value: 42, unit: 'kcal' },
    })
    expect(product.evidence.section).toContain('Coca-Cola Original Taste')
    expect(product.evidence.location).toBe(product.reference.source.url)
    const snapshot = createNutritionSnapshot(product.reference)
    if (snapshot.valid === false) throw new Error('Expected the reviewed snapshot.')
    const estimated = calculateNutrition({ quantity: 2, servingMl: 330, nutrition: snapshot.snapshot })
    if (estimated.valid === false) throw new Error('Expected finite reviewed estimates.')
    expect(estimated.estimate.sugarGrams).toBeCloseTo(69.96, 10)
    expect(estimated.estimate.kcal).toBeCloseTo(277.2, 10)
  })
})
