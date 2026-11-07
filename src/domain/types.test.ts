import { describe, expect, expectTypeOf, it } from 'vitest'
import { DEFAULT_TRACKING_SETTINGS } from './types'
import type {
  CreateDrinkEntryInput,
  DrinkEntry,
  DrinkEntryValidationIssue,
  DrinkEntryValidationResult,
  MoneyAmount,
  NutritionCatalogReference,
  NutritionEstimate,
  NutritionReference,
  NutritionSnapshot,
  ServingPreset,
  TrackingSettings,
} from './types'

describe('domain types and default settings', () => {
  it('starts with BDT, Asia/Dhaka, and no daily volume limit', () => {
    expect(DEFAULT_TRACKING_SETTINGS).toEqual({
      currency: 'BDT',
      reportingTimeZone: 'Asia/Dhaka',
      dailyLimitMl: null,
    })
  })

  it('freezes the default settings so callers cannot change them', () => {
    expect(Object.isFrozen(DEFAULT_TRACKING_SETTINGS)).toBe(true)
    expect(Reflect.set(DEFAULT_TRACKING_SETTINGS, 'currency', 'USD')).toBe(false)
    expect(DEFAULT_TRACKING_SETTINGS.currency).toBe('BDT')
  })

  it('lets callers supply entry details without supplying a nutrition snapshot', () => {
    const details = {
      id: 'caller-supplied-id',
      consumedAt: '2026-11-07T12:00:00Z',
      quantity: 2,
      servingMl: 330,
      totalPriceMinor: 10000,
      currency: 'BDT',
    } satisfies CreateDrinkEntryInput

    expectTypeOf(details).toExtend<CreateDrinkEntryInput>()
    expectTypeOf<DrinkEntry['nutrition']>().toEqualTypeOf<NutritionSnapshot>()
    expectTypeOf<TrackingSettings['dailyLimitMl']>().toEqualTypeOf<number | null>()
  })

  it('requires an explicit price while allowing known or explicitly unknown amounts', () => {
    expectTypeOf<DrinkEntry['totalPriceMinor']>().toEqualTypeOf<number | null>()
    expectTypeOf<CreateDrinkEntryInput['totalPriceMinor']>().toEqualTypeOf<number | null>()
    expectTypeOf<MoneyAmount['amountMinor']>().toEqualTypeOf<number | null>()
    expectTypeOf<undefined>().not.toExtend<DrinkEntry['totalPriceMinor']>()
    expectTypeOf<undefined>().not.toExtend<MoneyAmount['amountMinor']>()
    expectTypeOf<Omit<CreateDrinkEntryInput, 'totalPriceMinor'>>()
      .not.toExtend<CreateDrinkEntryInput>()
  })

  it('adds catalog descriptions and sources without requiring them on existing references', () => {
    expectTypeOf<NutritionCatalogReference>().toExtend<NutritionReference>()
    expectTypeOf<NutritionCatalogReference['productDescription']>().toBeString()
    expectTypeOf<NutritionCatalogReference['source']['label']>().toBeString()
    expectTypeOf<NutritionEstimate['sugarGrams']>().toBeNumber()
    expectTypeOf<NutritionEstimate['kcal']>().toBeNumber()
  })

  it('keeps catalog metadata and money amounts readonly in TypeScript', () => {
    // This helper is type-checked but is never called at runtime.
    const checkReadonlyContracts = (reference: NutritionCatalogReference, money: MoneyAmount) => {
      // @ts-expect-error Catalog descriptions cannot be edited through this interface.
      reference.productDescription = 'Different product'
      // @ts-expect-error Nested source metadata is readonly too.
      reference.source.label = 'Different source'
      // @ts-expect-error A validated amount must be replaced rather than mutated.
      money.amountMinor = 0
      // @ts-expect-error An amount cannot be silently relabeled with another currency.
      money.currency = 'USD'
    }

    expectTypeOf(checkReadonlyContracts).toBeFunction()
  })

  it('keeps records, nutrition, settings, and presets readonly in TypeScript', () => {
    // TypeScript checks this helper during npm test; it is never called at runtime.
    const checkReadonlyContracts = (
      entry: DrinkEntry,
      snapshot: NutritionSnapshot,
      reference: NutritionReference,
      settings: TrackingSettings,
      preset: ServingPreset,
    ) => {
      // @ts-expect-error A saved entry's quantity is readonly.
      entry.quantity = 3
      // @ts-expect-error The snapshot property on a saved entry is readonly.
      entry.nutrition = snapshot
      // @ts-expect-error Historical nutrition rates are readonly.
      snapshot.sugarGramsPer100Ml = 0
      // @ts-expect-error Nutrition reference values are readonly through this interface.
      reference.kcalPer100Ml = 0
      // @ts-expect-error Settings must be replaced rather than mutated.
      settings.currency = 'USD'
      // @ts-expect-error Serving preset sizes are readonly.
      preset.servingMl = 375
    }

    expectTypeOf(checkReadonlyContracts).toBeFunction()
  })

  it('exposes an entry only for success and issues only for failure', () => {
    // The compiler checks both branches without constructing an invalid runtime result.
    const checkResultContracts = (result: DrinkEntryValidationResult) => {
      if (result.valid === true) {
        expectTypeOf(result.entry).toEqualTypeOf<DrinkEntry>()
        // @ts-expect-error A successful result has no validation issues property.
        void result.issues
      } else {
        expectTypeOf(result.issues).toEqualTypeOf<readonly DrinkEntryValidationIssue[]>()
        // @ts-expect-error A failed result has no usable entry property.
        void result.entry
        // @ts-expect-error The issue collection is readonly.
        result.issues.push({ field: 'quantity', message: 'Example issue.' })
      }
    }

    expectTypeOf(checkResultContracts).toBeFunction()
  })
})
