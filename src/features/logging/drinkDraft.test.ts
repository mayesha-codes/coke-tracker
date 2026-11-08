import { describe, expect, expectTypeOf, it } from 'vitest'
import { prepareDrinkEntry } from './drinkDraft'
import type { DrinkDraft, DrinkDraftResult } from './drinkDraft'

// Product names, sources, and nutrition values are illustrative test fixtures only.
function makeReference() {
  return {
    id: 'illustrative-cola',
    version: 1,
    productDescription: 'Illustrative product for adapter tests',
    source: { label: 'Illustrative label', url: 'https://example.invalid/label' },
    sugarGramsPer100Ml: 10.5,
    kcalPer100Ml: 42,
  }
}

function makeDraft() {
  return {
    servingMlText: '330',
    quantityText: '2',
    price: { mode: 'known', amountText: '100.50' },
    localDateTime: '2026-11-08T00:05',
  } satisfies DrinkDraft
}

function preparedFrom(result: DrinkDraftResult) {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a prepared drink entry.')
  return result
}

function expectIssueFields(result: DrinkDraftResult, fields: readonly string[]) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected drink draft issues.')
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  for (const issue of result.issues) expect(issue.message.trim()).not.toBe('')
  expect(result).not.toHaveProperty('entry')
  expect(result).not.toHaveProperty('totals')
}

// JavaScript callers can bypass the public TypeScript parameter contracts.
function prepareUnknown(draft: unknown, reference: unknown, options: unknown): DrinkDraftResult {
  return Reflect.apply(prepareDrinkEntry, undefined, [draft, reference, options])
}

describe('prepareDrinkEntry', () => {
  it('prepares two 330 ml drinks with UTC time, a copied nutrition snapshot, and the total price once', () => {
    const prepared = preparedFrom(prepareDrinkEntry(makeDraft(), makeReference(), { id: 'caller-id' }))

    expect(prepared.entry).toEqual({
      id: 'caller-id',
      consumedAt: '2026-11-07T18:05:00.000Z',
      quantity: 2,
      servingMl: 330,
      totalPriceMinor: 10050,
      currency: 'BDT',
      nutrition: {
        referenceId: 'illustrative-cola',
        referenceVersion: 1,
        sugarGramsPer100Ml: 10.5,
        kcalPer100Ml: 42,
      },
    })
    expect(prepared.totals.entryCount).toBe(1)
    expect(prepared.totals.drinkCount).toBe(2)
    expect(prepared.totals.volumeMl).toBe(660)
    expect(prepared.totals.sugarGrams).toBeCloseTo(69.3, 10)
    expect(prepared.totals.kcal).toBeCloseTo(277.2, 10)
    expect(prepared.totals.spendingByCurrency).toEqual([
      { currency: 'BDT', knownAmountMinor: 10050, unknownPriceEntryCount: 0 },
    ])
  })

  it('normalizes surrounding whitespace and leading zeros in integer fields', () => {
    const prepared = preparedFrom(prepareDrinkEntry({
      ...makeDraft(), quantityText: ' 0002 ', servingMlText: ' 0330 ',
    }, makeReference(), { id: 'integer-text' }))
    expect(prepared.entry.quantity).toBe(2)
    expect(prepared.entry.servingMl).toBe(330)
  })

  it('accepts a custom whole-millilitre serving without inventing a preset', () => {
    const prepared = preparedFrom(prepareDrinkEntry({ ...makeDraft(), servingMlText: '375' },
      makeReference(), { id: 'custom-size' }))
    expect(prepared.entry.servingMl).toBe(375)
    expect(prepared.totals.volumeMl).toBe(750)
  })

  it.each([
    { label: 'known zero', price: { mode: 'known', amountText: '0' } as const, amount: 0, unknownCount: 0 },
    { label: 'explicitly unknown', price: { mode: 'unknown' } as const, amount: null, unknownCount: 1 },
  ])('keeps $label pricing distinct while preserving quantity', ({ price, amount, unknownCount }) => {
    const prepared = preparedFrom(prepareDrinkEntry({ ...makeDraft(), quantityText: '5', price },
      makeReference(), { id: 'price-choice' }))
    expect(prepared.entry.quantity).toBe(5)
    expect(prepared.entry.totalPriceMinor).toBe(amount)
    expect(prepared.totals.unknownPriceEntryCount).toBe(unknownCount)
  })

  it('uses the caller-selected currency and timezone instead of applying the defaults', () => {
    const prepared = preparedFrom(prepareDrinkEntry({ ...makeDraft(), timeZone: 'UTC' },
      makeReference(), { id: 'configured', currency: 'USD' }))
    expect(prepared.entry.currency).toBe('USD')
    expect(prepared.entry.totalPriceMinor).toBe(10050)
    expect(prepared.entry.consumedAt).toBe('2026-11-08T00:05:00.000Z')
  })

  describe.each(['quantityText', 'servingMlText'] as const)('%s validation', field => {
    it.each([
      { label: 'blank text', value: '' },
      { label: 'zero', value: '0' },
      { label: 'a negative value', value: '-1' },
      { label: 'a fraction', value: '1.5' },
      { label: 'exponent notation', value: '1e3' },
      { label: 'an unsafe integer', value: '9007199254740992' },
      { label: 'a number instead of text', value: 2 },
      { label: 'null', value: null },
      { label: 'a missing value', value: undefined },
    ])('rejects $label with the input field name', ({ value }) => {
      expectIssueFields(prepareUnknown({ ...makeDraft(), [field]: value }, makeReference(), {
        id: 'bad-integer',
      }), [field])
    })
  })

  it('reports blank known-price text instead of assuming the drinks were free', () => {
    expectIssueFields(prepareDrinkEntry({ ...makeDraft(), price: { mode: 'known', amountText: '' } },
      makeReference(), { id: 'blank-price' }), ['priceText'])
  })

  it('requires an explicit known or unknown price choice', () => {
    const draft: Record<string, unknown> = { ...makeDraft() }
    delete draft.price
    expectIssueFields(prepareUnknown(draft, makeReference(), { id: 'missing-price' }), ['priceMode'])
  })

  it('rejects excessive price precision with a price-field issue', () => {
    expectIssueFields(prepareDrinkEntry({ ...makeDraft(), price: { mode: 'known', amountText: '1.001' } },
      makeReference(), { id: 'precision' }), ['priceText'])
  })

  it('preserves an invalid currency issue even for an explicitly unknown price', () => {
    expectIssueFields(prepareDrinkEntry({ ...makeDraft(), price: { mode: 'unknown' } },
      makeReference(), { id: 'currency', currency: 'AAA' }), ['currency'])
  })

  it('rejects an explicitly null currency instead of silently replacing it with BDT', () => {
    expectIssueFields(prepareUnknown(makeDraft(), makeReference(), {
      id: 'null-currency', currency: null,
    }), ['currency'])
  })

  it.each([
    { label: 'a blank consumption time', value: '' },
    { label: 'an impossible date', value: '2026-02-30T12:00' },
    { label: 'a missing consumption time', value: undefined },
  ])('reports $label instead of substituting the current time', ({ value }) => {
    expectIssueFields(prepareUnknown({ ...makeDraft(), localDateTime: value }, makeReference(), {
      id: 'bad-time',
    }), ['localDateTime'])
  })

  it('rejects a nonexistent local time in a daylight-saving gap', () => {
    expectIssueFields(prepareDrinkEntry({
      ...makeDraft(), localDateTime: '2026-03-08T02:30', timeZone: 'America/New_York',
    }, makeReference(), { id: 'gap' }), ['localDateTime'])
  })

  it('preserves earlier/later candidates so the form can ask about a repeated local time', () => {
    const result = prepareDrinkEntry({
      ...makeDraft(), localDateTime: '2026-11-01T01:30', timeZone: 'America/New_York',
    }, makeReference(), { id: 'ambiguous' })
    expectIssueFields(result, ['disambiguation'])
    if (result.valid === true) throw new Error('Expected a choice for the repeated time.')
    expect(result.timeCandidates).toEqual([
      { choice: 'earlier', consumedAt: '2026-11-01T05:30:00.000Z' },
      { choice: 'later', consumedAt: '2026-11-01T06:30:00.000Z' },
    ])
    expect(Object.isFrozen(result.timeCandidates)).toBe(true)
  })

  it.each([
    { choice: 'earlier', expected: '2026-11-01T05:30:00.000Z' },
    { choice: 'later', expected: '2026-11-01T06:30:00.000Z' },
  ] as const)('uses the explicit $choice choice when the local time repeats', ({ choice, expected }) => {
    const prepared = preparedFrom(prepareDrinkEntry({
      ...makeDraft(), localDateTime: '2026-11-01T01:30', timeZone: 'America/New_York', disambiguation: choice,
    }, makeReference(), { id: 'chosen-time' }))
    expect(prepared.entry.consumedAt).toBe(expected)
  })

  it('maps an invalid timezone to its own field', () => {
    expectIssueFields(prepareDrinkEntry({ ...makeDraft(), timeZone: 'Not/A_Zone' },
      makeReference(), { id: 'zone' }), ['timeZone'])
  })

  it.each([
    { change: { id: '' }, field: 'nutritionReference.id' },
    { change: { version: 0 }, field: 'nutritionReference.version' },
    { change: { productDescription: '' }, field: 'nutritionReference.productDescription' },
    { change: { source: undefined }, field: 'nutritionReference.source' },
    { change: { source: { label: '' } }, field: 'nutritionReference.source.label' },
    { change: { source: { label: 'Example source', url: 'javascript:example' } }, field: 'nutritionReference.source.url' },
    { change: { sugarGramsPer100Ml: -1 }, field: 'nutritionReference.sugarGramsPer100Ml' },
    { change: { kcalPer100Ml: Infinity }, field: 'nutritionReference.kcalPer100Ml' },
  ])('reports the supplied reference problem as $field', ({ change, field }) => {
    expectIssueFields(prepareUnknown(makeDraft(), { ...makeReference(), ...change }, { id: 'reference' }), [field])
  })

  it('requires product description and source information instead of accepting a bare rate fixture', () => {
    expectIssueFields(prepareUnknown(makeDraft(), {
      id: 'bare-reference', version: 1, sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42,
    }, { id: 'no-provenance' }), ['nutritionReference.productDescription', 'nutritionReference.source'])
  })

  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'an array', value: [] },
  ])('reports $label as a missing nutrition reference without inventing defaults', ({ value }) => {
    expectIssueFields(prepareUnknown(makeDraft(), value, { id: 'no-reference' }), ['nutritionReference'])
  })

  it('requires the caller to provide an ID instead of generating a fallback', () => {
    expectIssueFields(prepareUnknown(makeDraft(), makeReference(), {}), ['id'])
    expectIssueFields(prepareUnknown(makeDraft(), makeReference(), undefined), ['id'])
  })

  it('collects independent field errors in one failed result without exposing a partial entry', () => {
    expectIssueFields(prepareDrinkEntry({
      ...makeDraft(), quantityText: '', servingMlText: '0',
      price: { mode: 'known', amountText: '' }, localDateTime: '',
    }, makeReference(), { id: '' }), [
      'id', 'quantityText', 'servingMlText', 'priceText', 'localDateTime',
    ])
  })

  it('lets existing nutrition and totals utilities reject an unsafe volume product', () => {
    expectIssueFields(prepareDrinkEntry({
      ...makeDraft(), quantityText: '9007199254740991', servingMlText: '2',
    }, makeReference(), { id: 'volume-overflow' }), ['servingMlText'])
  })

  it('maps a nonfinite nutrition estimate back to the supplied reference field', () => {
    expectIssueFields(prepareDrinkEntry({ ...makeDraft(), servingMlText: '1000' }, {
      ...makeReference(), kcalPer100Ml: Number.MAX_VALUE,
    }, { id: 'nutrition-overflow' }), ['nutritionReference.kcalPer100Ml'])
  })

  it('does not introduce a current-clock policy or alter a valid explicitly supplied future time', () => {
    const prepared = preparedFrom(prepareDrinkEntry({ ...makeDraft(), localDateTime: '2099-01-01T12:00' },
      makeReference(), { id: 'explicit-time' }))
    expect(prepared.entry.consumedAt).toBe('2099-01-01T06:00:00.000Z')
  })

  it('keeps all supplied inputs unchanged and unfrozen while returning independent frozen data', () => {
    const draft = makeDraft()
    const reference = makeReference()
    const options = { id: 'immutable', currency: 'BDT' }
    const before = structuredClone({ draft, reference, options })
    const prepared = preparedFrom(prepareDrinkEntry(draft, reference, options))
    expect({ draft, reference, options }).toEqual(before)
    for (const input of [draft, draft.price, reference, reference.source, options]) {
      expect(Object.isFrozen(input)).toBe(false)
    }
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.entry)).toBe(true)
    expect(Object.isFrozen(prepared.entry.nutrition)).toBe(true)
    expect(Object.isFrozen(prepared.totals)).toBe(true)
    expect(Object.isFrozen(prepared.totals.spendingByCurrency)).toBe(true)
    reference.sugarGramsPer100Ml = 0
    reference.version = 2
    draft.quantityText = '99'
    expect(prepared.entry.quantity).toBe(2)
    expect(prepared.entry.nutrition.sugarGramsPer100Ml).toBe(10.5)
    expect(prepared.entry.nutrition.referenceVersion).toBe(1)
    expect(Reflect.set(prepared.entry.nutrition, 'kcalPer100Ml', 0)).toBe(false)
  })

  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'an array', value: [] },
    { label: 'text', value: 'draft' },
  ])('rejects $label as a malformed form draft', ({ value }) => {
    expectIssueFields(prepareUnknown(value, makeReference(), { id: 'malformed' }), ['draft'])
  })

  it('returns the same prepared data for repeated calls with the same explicit inputs', () => {
    expect(prepareDrinkEntry(makeDraft(), makeReference(), { id: 'deterministic' })).toEqual(
      prepareDrinkEntry(makeDraft(), makeReference(), { id: 'deterministic' }),
    )
  })

  it('keeps form drafts and prepared result fields readonly in TypeScript', () => {
    const checkReadonly = (draft: DrinkDraft, result: DrinkDraftResult) => {
      // @ts-expect-error The form replaces draft values instead of mutating this contract.
      draft.quantityText = '3'
      if (result.valid === true) {
        // @ts-expect-error Prepared record snapshots are readonly domain data.
        result.entry.nutrition.kcalPer100Ml = 0
      } else {
        // @ts-expect-error A failed preparation has no usable drink entry.
        void result.entry
      }
    }
    expectTypeOf(checkReadonly).toBeFunction()
  })
})
