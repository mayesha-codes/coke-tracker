// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import CalorieGlass, { GLASS_CAPACITY_ML } from './CalorieGlass'

afterEach(cleanup)

function glassRegion() {
  return screen.getByRole('region', { name: "Today's Coke glass" })
}

function expectMetric(label: string, value: string) {
  const region = within(glassRegion())
  const term = region.getByText(label)
  const definition = term.nextElementSibling

  expect(definition?.tagName.toLowerCase()).toBe('dd')
  expect(definition?.textContent?.replace(/\s+/g, ' ').trim()).toBe(value)
}

describe('dashboard Coke glass visualization', () => {
  it('shows an empty glass and zero calories when there has been no consumption', () => {
    render(<CalorieGlass volumeMl={0} kcal={0} />)

    expectMetric('Consumed today', '0 ml')
    expectMetric('Estimated Coke-only calories', '0 kcal')
    expect(screen.getByTestId('glass-fill-level').getAttribute('data-fill-percent')).toBe('0')
    expect(screen.getByRole('img', { name: /0 millilitres consumed today/ })).toBeDefined()
  })

  it('fills proportionally for partial volume while displaying the supplied calorie estimate', () => {
    render(<CalorieGlass volumeMl={250} kcal={123.45} />)

    expect(screen.getByTestId('glass-fill-level').getAttribute('data-fill-percent')).toBe('50')
    expectMetric('Consumed today', '250 ml')
    expectMetric('Estimated Coke-only calories', '123.45 kcal')
    expect(screen.getByRole('img', { name: /50 percent of its illustrative 500 millilitre visual capacity/ })).toBeDefined()
  })

  it('fills to capacity at a full glass', () => {
    render(<CalorieGlass volumeMl={GLASS_CAPACITY_ML} kcal={210} />)

    expect(screen.getByTestId('glass-fill-level').getAttribute('data-fill-percent')).toBe('100')
    expectMetric('Consumed today', '500 ml')
    expectMetric('Estimated Coke-only calories', '210 kcal')
    expect(within(glassRegion()).queryByText(/above its visual capacity/)).toBeNull()
  })

  it('caps the illustration when consumption exceeds capacity but keeps the actual volume and calories', () => {
    render(<CalorieGlass volumeMl={1250} kcal={525} />)

    expect(screen.getByTestId('glass-fill-level').getAttribute('data-fill-percent')).toBe('100')
    expectMetric('Consumed today', '1,250 ml')
    expectMetric('Estimated Coke-only calories', '525 kcal')
    expect(within(glassRegion()).getByText(/750 ml is above its visual capacity/)).toBeDefined()
    expect(screen.getByRole('img', { name: /not a drink limit/ })).toBeDefined()
  })

  it('uses calorie data independently of the glass fill and does not expose the SVG as duplicate content', () => {
    const { container } = render(<CalorieGlass volumeMl={GLASS_CAPACITY_ML} kcal={0} />)

    expect(screen.getByTestId('glass-fill-level').getAttribute('data-fill-percent')).toBe('100')
    expectMetric('Estimated Coke-only calories', '0 kcal')
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
