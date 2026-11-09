import { describe, expect, expectTypeOf, it } from 'vitest'
import { SERVING_PRESETS } from './servings'
import type { ServingPreset } from './types'

describe('serving-size presets', () => {
  it('provides five numeric presets while preserving the existing serving sizes', () => {
    expect(SERVING_PRESETS).toEqual([
      { id: '200ml', label: '200 ml', servingMl: 200 },
      { id: '330ml', label: '330 ml', servingMl: 330 },
      { id: '350ml', label: '350 ml', servingMl: 350 },
      { id: '500ml', label: '500 ml', servingMl: 500 },
      { id: '1000ml', label: '1,000 ml', servingMl: 1000 },
    ])
  })

  it('gives every preset a unique ID', () => {
    const ids = SERVING_PRESETS.map((preset) => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stores only size details, without prices or nutrition values', () => {
    for (const preset of SERVING_PRESETS) {
      expect(Object.keys(preset).sort()).toEqual(['id', 'label', 'servingMl'])
    }
  })

  it('freezes the preset array and every individual preset', () => {
    expect(Object.isFrozen(SERVING_PRESETS)).toBe(true)
    for (const preset of SERVING_PRESETS) {
      expect(Object.isFrozen(preset)).toBe(true)
    }

    expect(Reflect.set(SERVING_PRESETS, 'length', 0)).toBe(false)
    expect(Reflect.set(SERVING_PRESETS[0], 'servingMl', 375)).toBe(false)
    expect(SERVING_PRESETS).toHaveLength(5)
    expect(SERVING_PRESETS[0].servingMl).toBe(200)
  })

  it('exposes the presets as a readonly collection in TypeScript', () => {
    expectTypeOf(SERVING_PRESETS).toEqualTypeOf<readonly ServingPreset[]>()

    // This helper is checked by TypeScript but never mutates the real presets.
    const checkReadonlyCollection = (presets: typeof SERVING_PRESETS) => {
      // @ts-expect-error A readonly collection cannot have presets appended to it.
      presets.push({ id: '330ml', label: '330 ml', servingMl: 330 })
      // @ts-expect-error A readonly collection cannot have an element replaced.
      presets[0] = { id: '200ml', label: '200 ml', servingMl: 200 }
    }

    expectTypeOf(checkReadonlyCollection).toBeFunction()
  })
})
