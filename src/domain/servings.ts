import type { ServingPreset } from './types'

/** Frozen size-only shortcuts. Records store servingMl, so custom sizes need no new preset. */
export const SERVING_PRESETS: readonly ServingPreset[] = Object.freeze([
  Object.freeze({ id: '200ml', label: '200 ml', servingMl: 200 }),
  Object.freeze({ id: '330ml', label: '330 ml', servingMl: 330 }),
  Object.freeze({ id: '500ml', label: '500 ml', servingMl: 500 }),
  Object.freeze({ id: '1000ml', label: '1,000 ml', servingMl: 1000 }),
])
