import { describe, expect, it } from 'vitest'
import { createNutritionReference } from '../../domain/nutrition'
import { deriveDrinkPreview } from './drinkPreview.ts'
import type { DrinkDraft } from './drinkDraft'

function makeDraft() {
  return {
    servingMlText: '330',
    quantityText: '2',
    price: { mode: 'known', amountText: '100.50' },
    localDateTime: '',
  } satisfies DrinkDraft
}

// These rates and product details are illustrative test fixtures only.
function makeReference() {
  return {
    id: 'illustrative-preview-reference',
    version: 1,
    productDescription: 'Illustrative cola for preview tests',
    source: { label: 'Illustrative label', url: 'https://example.invalid/label' },
    sugarGramsPer100Ml: 10.5,
    kcalPer100Ml: 42,
  }
}

describe('deriveDrinkPreview', () => {
  it('shows a valid volume and spending while nutrition is unavailable without a reference', () => {
    const preview = deriveDrinkPreview(makeDraft(), undefined)
    expect(preview.volume).toEqual({ status: 'available', value: 660 })
    expect(preview.spending).toEqual({ status: 'available', value: { amountMinor: 10050, currency: 'BDT' } })
    expect(preview.nutrition.status).toBe('unavailable')
    expect(preview.issues.map(issue => issue.field)).toEqual(['nutritionReference'])
  })

  it('calculates a custom 375 ml serving twice without inventing nutrition or multiplying the price', () => {
    const draft = { ...makeDraft(), servingMlText: ' 00375 ' }
    const preview = deriveDrinkPreview(draft, undefined)
    expect(preview.volume).toEqual({ status: 'available', value: 750 })
    expect(preview.nutrition.status).toBe('unavailable')
    expect(preview.spending).toEqual({ status: 'available', value: { amountMinor: 10050, currency: 'BDT' } })
    expect(preview.issues.map(issue => issue.field)).toEqual(['nutritionReference'])
    expect(draft.servingMlText).toBe(' 00375 ')
  })

  it.each(['', '375.5', '0', '-1', '1e3', '9007199254740992'])(
    'rejects invalid custom volume text %j even without a nutrition reference', servingMlText => {
      const preview = deriveDrinkPreview({ ...makeDraft(), servingMlText }, undefined)
      expect(preview.volume.status).toBe('unavailable')
      expect(preview.nutrition.status).toBe('unavailable')
      expect(preview.spending).toEqual({ status: 'available', value: { amountMinor: 10050, currency: 'BDT' } })
      expect(preview.issues.map(issue => issue.field)).toEqual(['servingMlText', 'nutritionReference'])
    },
  )

  it('rejects overflowing custom volume before requiring nutrition data', () => {
    const draft = { ...makeDraft(), quantityText: '2', servingMlText: '4503599627370496' }
    const preview = deriveDrinkPreview(draft, undefined)
    expect(preview.volume.status).toBe('unavailable')
    expect(preview.nutrition.status).toBe('unavailable')
    expect(preview.issues.map(issue => issue.field)).toEqual(['servingMlText', 'nutritionReference'])
    expect(preview.issues.find(issue => issue.field === 'servingMlText')?.message).toContain('safe integer range')
    expect(preview.spending).toEqual({ status: 'available', value: { amountMinor: 10050, currency: 'BDT' } })
    expect(draft.servingMlText).toBe('4503599627370496')
  })

  it('accepts the largest safe custom volume when the quantity is one and nutrition is unavailable', () => {
    const preview = deriveDrinkPreview({
      ...makeDraft(), quantityText: '1', servingMlText: String(Number.MAX_SAFE_INTEGER),
    }, undefined)
    expect(preview.volume).toEqual({ status: 'available', value: Number.MAX_SAFE_INTEGER })
    expect(preview.nutrition.status).toBe('unavailable')
    expect(preview.issues.map(issue => issue.field)).toEqual(['nutritionReference'])
  })

  it('uses the supplied reference through domain nutrition calculations without rounding', () => {
    const preview = deriveDrinkPreview(makeDraft(), makeReference())
    expect(preview.nutrition.status).toBe('available')
    if (preview.nutrition.status !== 'available') throw new Error('Expected nutrition estimates.')
    expect(preview.nutrition.value.sugarGrams).toBeCloseTo(69.3, 10)
    expect(preview.nutrition.value.kcal).toBeCloseTo(277.2, 10)
    expect(preview.issues).toEqual([])
  })

  it('uses a captured reference version even after newer personal values become available', () => {
    const original = createNutritionReference(makeReference())
    if (original.valid === false) throw new Error('Expected a valid illustrative reference.')
    const updated = createNutritionReference({ ...original.reference, version: 2, sugarGramsPer100Ml: 9, kcalPer100Ml: 36 })
    if (updated.valid === false) throw new Error('Expected a valid illustrative revision.')
    const before = deriveDrinkPreview(makeDraft(), original.reference)
    const stillPinned = deriveDrinkPreview(makeDraft(), original.reference)
    expect(stillPinned.nutrition).toEqual(before.nutrition)
    expect(stillPinned.nutrition).toEqual({ status: 'available', value: { sugarGrams: 69.3, kcal: 277.2 } })
    const adopted = deriveDrinkPreview(makeDraft(), updated.reference)
    expect(adopted.nutrition.status).toBe('available')
    if (adopted.nutrition.status !== 'available') throw new Error('Expected nutrition estimates.')
    expect(adopted.nutrition.value.sugarGrams).toBeCloseTo(59.4, 10)
    expect(adopted.nutrition.value.kcal).toBeCloseTo(237.6, 10)
    expect(adopted.volume).toEqual(before.volume)
    expect(adopted.spending).toEqual(before.spending)
    expect(original.reference.version).toBe(1)
  })

  it('accepts explicit zero nutrition rates without confusing them with unavailable estimates', () => {
    const preview = deriveDrinkPreview(makeDraft(), { ...makeReference(), sugarGramsPer100Ml: 0, kcalPer100Ml: 0 })
    expect(preview.nutrition).toEqual({ status: 'available', value: { sugarGrams: 0, kcal: 0 } })
    expect(preview.volume).toEqual({ status: 'available', value: 660 })
    expect(preview.spending.status).toBe('available')
    expect(preview.issues).toEqual([])
  })

  it('retains small fractional nutrition estimates in preview state', () => {
    const preview = deriveDrinkPreview({ ...makeDraft(), quantityText: '1', servingMlText: '375' }, {
      ...makeReference(), sugarGramsPer100Ml: 0.01, kcalPer100Ml: 0.02,
    })
    if (preview.nutrition.status !== 'available') throw new Error('Expected nutrition estimates.')
    expect(preview.nutrition.value.sugarGrams).toBeCloseTo(0.0375, 12)
    expect(preview.nutrition.value.kcal).toBeCloseTo(0.075, 12)
  })

  it.each([
    { price: { mode: 'known', amountText: '0' } as const, amountMinor: 0 },
    { price: { mode: 'unknown' } as const, amountMinor: null },
  ])('keeps an explicit $amountMinor price available', ({ price, amountMinor }) => {
    expect(deriveDrinkPreview({ ...makeDraft(), price }, undefined).spending).toEqual({
      status: 'available', value: { amountMinor, currency: 'BDT' },
    })
  })

  it('keeps an incomplete known price unavailable without clearing valid volume or nutrition', () => {
    const preview = deriveDrinkPreview({ ...makeDraft(), price: { mode: 'known', amountText: '' } }, makeReference())
    expect(preview.volume).toEqual({ status: 'available', value: 660 })
    expect(preview.nutrition.status).toBe('available')
    expect(preview.spending.status).toBe('unavailable')
    expect(preview.issues.map(issue => issue.field)).toEqual(['priceText'])
  })

  it('does not multiply an entered total price when quantity or serving size changes', () => {
    for (const quantityText of ['1', '2', '5']) {
      const preview = deriveDrinkPreview({ ...makeDraft(), quantityText, servingMlText: '1000' }, undefined)
      expect(preview.spending).toEqual({ status: 'available', value: { amountMinor: 10050, currency: 'BDT' } })
    }
  })

  it('uses the caller’s configured currency through the price adapter', () => {
    expect(deriveDrinkPreview({ ...makeDraft(), price: { mode: 'known', amountText: '1.234' } }, undefined, 'KWD').spending)
      .toEqual({ status: 'available', value: { amountMinor: 1234, currency: 'KWD' } })
  })

  it('reports unsupported currency without replacing it or hiding a valid volume', () => {
    const preview = deriveDrinkPreview(makeDraft(), makeReference(), 'AAA')
    expect(preview.volume.status).toBe('available')
    expect(preview.spending.status).toBe('unavailable')
    expect(preview.issues.map(issue => issue.field)).toEqual(['currency'])
  })

  it.each([
    { field: 'quantityText', value: '' },
    { field: 'quantityText', value: '1.5' },
    { field: 'quantityText', value: '0' },
    { field: 'servingMlText', value: '' },
    { field: 'servingMlText', value: '-330' },
    { field: 'servingMlText', value: '9007199254740992' },
  ] as const)('reports invalid $field input $value instead of inventing values', ({ field, value }) => {
    const preview = deriveDrinkPreview({ ...makeDraft(), [field]: value }, makeReference())
    expect(preview.volume.status).toBe('unavailable')
    expect(preview.nutrition.status).toBe('unavailable')
    expect(preview.spending.status).toBe('available')
    expect(preview.issues.map(issue => issue.field)).toEqual([field])
  })

  it('rejects unsafe volume products even when quantity and serving size are individually safe', () => {
    const preview = deriveDrinkPreview({ ...makeDraft(), quantityText: '9007199254740991', servingMlText: '2' }, makeReference())
    expect(preview.volume.status).toBe('unavailable')
    expect(preview.nutrition.status).toBe('unavailable')
    expect(preview.issues.map(issue => issue.field)).toEqual(['servingMlText'])
  })

  it('does not show estimates from an invalid supplied reference', () => {
    const preview = deriveDrinkPreview(makeDraft(), { ...makeReference(), source: { label: '' } })
    expect(preview.volume.status).toBe('available')
    expect(preview.nutrition.status).toBe('unavailable')
    expect(preview.issues.map(issue => issue.field)).toEqual(['nutritionReference.source.label'])
  })

  it('lets the domain reject nonfinite calculated nutrition results', () => {
    const preview = deriveDrinkPreview({ ...makeDraft(), servingMlText: '1000' }, {
      ...makeReference(), kcalPer100Ml: Number.MAX_VALUE,
    })
    expect(preview.volume.status).toBe('available')
    expect(preview.nutrition.status).toBe('unavailable')
    expect(preview.issues.map(issue => issue.field)).toEqual(['nutritionReference.kcalPer100Ml'])
  })

  it('does not require an ID or valid consumption time to preview independent values', () => {
    const preview = deriveDrinkPreview({ ...makeDraft(), localDateTime: 'not a date' }, makeReference())
    expect(preview.volume.status).toBe('available')
    expect(preview.nutrition.status).toBe('available')
    expect(preview.spending.status).toBe('available')
    expect(preview.issues).toEqual([])
  })

  it('keeps inputs untouched and unfrozen while freezing independent preview results', () => {
    const draft = makeDraft()
    const reference = makeReference()
    const before = structuredClone({ draft, reference })
    const preview = deriveDrinkPreview(draft, reference)
    expect({ draft, reference }).toEqual(before)
    expect(Object.isFrozen(draft)).toBe(false)
    expect(Object.isFrozen(draft.price)).toBe(false)
    expect(Object.isFrozen(reference)).toBe(false)
    expect(Object.isFrozen(reference.source)).toBe(false)
    expect(Object.isFrozen(preview)).toBe(true)
    expect(Object.isFrozen(preview.volume)).toBe(true)
    expect(Object.isFrozen(preview.nutrition)).toBe(true)
    expect(Object.isFrozen(preview.spending)).toBe(true)
    expect(Object.isFrozen(preview.issues)).toBe(true)
    if (preview.nutrition.status !== 'available') throw new Error('Expected estimates.')
    expect(Object.isFrozen(preview.nutrition.value)).toBe(true)
    reference.kcalPer100Ml = 0
    draft.quantityText = '99'
    expect(preview.nutrition.value.kcal).toBeCloseTo(277.2, 10)
  })

  it('fails safely for a malformed JavaScript draft without fallback figures', () => {
    const preview = Reflect.apply(deriveDrinkPreview, undefined, [null, undefined])
    expect(preview.volume.status).toBe('unavailable')
    expect(preview.nutrition.status).toBe('unavailable')
    expect(preview.spending.status).toBe('unavailable')
    expect(preview.issues.map((issue: { field: string }) => issue.field)).toEqual(['draft'])
  })
})
