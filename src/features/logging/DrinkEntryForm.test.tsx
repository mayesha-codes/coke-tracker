// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DrinkEntryForm from './DrinkEntryForm'
import type { NutritionCatalogReference } from '../../domain/types'

afterEach(cleanup)

// These product descriptions and rates are illustrative test data only.
function makeReference(): NutritionCatalogReference {
  return {
    id: 'illustrative-product',
    version: 1,
    productDescription: 'Illustrative product for form tests',
    source: { label: 'Illustrative package label', url: 'https://example.invalid/label' },
    sugarGramsPer100Ml: 10.5,
    kcalPer100Ml: 42,
  }
}

function renderForm(options: {
  references?: readonly NutritionCatalogReference[]
  timeZone?: string
  initialLocalDateTime?: string
} = {}) {
  const user = userEvent.setup()
  render(<DrinkEntryForm
    references={options.references ?? [makeReference()]}
    currency="BDT"
    timeZone={options.timeZone ?? 'Asia/Dhaka'}
    initialLocalDateTime={options.initialLocalDateTime ?? '2026-11-08T00:05'}
    draftId="test-draft-id"
  />)
  return user
}

function quantityInput() {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Quantity' })
}

function priceInput() {
  return screen.getByRole<HTMLInputElement>('textbox', { name: /Total paid for all drinks/ })
}

function metricText(name: string): string {
  const preview = screen.getByRole('region', { name: 'Draft preview' })
  const label = within(preview).getByText(name, { selector: 'dt' })
  return label.parentElement?.textContent?.replace(/\s/g, ' ') ?? ''
}

async function selectReference(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByRole('combobox', { name: 'Nutrition reference' }), 'illustrative-product')
}

describe('DrinkEntryForm controls and draft preview', () => {
  it('offers four native serving choices and updates volume when selected', async () => {
    const user = renderForm()
    for (const size of [200, 330, 500, 1000]) {
      expect(screen.getByRole('radio', { name: `${size} ml` })).toBeDefined()
    }
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '330 ml' }).checked).toBe(true)
    await user.click(screen.getByRole('radio', { name: '500 ml' }))
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '500 ml' }).checked).toBe(true)
    expect(metricText('Volume')).toContain('500 ml')
  })

  it('supports native radio keyboard navigation', async () => {
    const user = renderForm()
    await user.click(screen.getByRole('radio', { name: '200 ml' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '330 ml' }).checked).toBe(true)
    expect(metricText('Volume')).toContain('330 ml')
  })

  it('supports editable quantity and named increase/decrease controls without dropping below one', async () => {
    const user = renderForm()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Decrease quantity' }).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(quantityInput().value).toBe('2')
    expect(metricText('Volume')).toContain('660 ml')
    await user.clear(quantityInput())
    await user.type(quantityInput(), '3')
    expect(metricText('Volume')).toContain('990 ml')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(quantityInput().value).toBe('2')
  })

  it('preserves the total price through serving, quantity, and known/unknown changes', async () => {
    const user = renderForm()
    await user.type(priceInput(), '100.50')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.click(screen.getByRole('radio', { name: '500 ml' }))
    expect(priceInput().value).toBe('100.50')
    expect(metricText('Total spending')).toContain('BDT 100.50')

    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    expect(priceInput().disabled).toBe(true)
    expect(metricText('Total spending')).toContain('Unknown')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.click(screen.getByRole('radio', { name: 'Price known' }))
    expect(priceInput().disabled).toBe(false)
    expect(priceInput().value).toBe('100.50')
    expect(metricText('Total spending')).toContain('BDT 100.50')
  })

  it('distinguishes known zero, unknown, and a blank price in the preview', async () => {
    const user = renderForm()
    expect(metricText('Total spending')).toContain('Enter a valid total price')
    await user.type(priceInput(), '0')
    expect(metricText('Total spending')).toContain('BDT 0.00')
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    expect(metricText('Total spending')).toContain('Unknown')
    await user.click(screen.getByRole('radio', { name: 'Price known' }))
    await user.clear(priceInput())
    expect(metricText('Total spending')).toContain('Enter a valid total price')
  })

  it('shows valid volume but unavailable nutrition when no reviewed references exist', async () => {
    const user = renderForm({ references: [] })
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Nutrition reference' }).disabled).toBe(true)
    expect(screen.getByText('Reviewed product data is needed')).toBeDefined()
    expect(metricText('Volume')).toContain('330 ml')
    expect(metricText('Estimated sugar')).toContain('Choose a reviewed nutrition reference')
    expect(metricText('Coke-only calories')).toContain('Choose a reviewed nutrition reference')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(metricText('Volume')).toContain('660 ml')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('discloses the selected reference source and calculates nutrition only after selection', async () => {
    const user = renderForm()
    expect(metricText('Estimated sugar')).toContain('Choose a reviewed nutrition reference')
    await selectReference(user)
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(metricText('Coke-only calories')).toContain('138.6 kcal')
    expect(screen.getByRole('link', { name: 'Illustrative package label' }).getAttribute('href'))
      .toBe('https://example.invalid/label')
    expect(screen.getByText(/Reference illustrative-product · Version 1/)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(metricText('Estimated sugar')).toContain('69.3 g')
    expect(metricText('Coke-only calories')).toContain('277.2 kcal')
  })

  it('blocks invalid reference data without rendering its unsafe source link or estimates', () => {
    renderForm({ references: [{ ...makeReference(), source: { label: 'Bad source', url: 'javascript:example' } }] })
    expect(screen.getByText('Nutrition reference data needs review before it can be used.')).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Bad source' })).toBeNull()
    expect(metricText('Estimated sugar')).toContain('Choose a reviewed nutrition reference')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })
})

describe('DrinkEntryForm validation and review', () => {
  it('shows errors on blur and clears them as the field is corrected', async () => {
    const user = renderForm()
    await user.type(priceInput(), '1.001')
    expect(document.getElementById('logging-price-error')).toBeNull()
    await user.tab()
    expect(priceInput().getAttribute('aria-invalid')).toBe('true')
    expect(priceInput().getAttribute('aria-describedby')).toContain('logging-price-error')
    expect(document.getElementById('logging-price-error')?.textContent).toContain('decimal places')
    await user.clear(priceInput())
    await user.type(priceInput(), '1.00')
    expect(priceInput().getAttribute('aria-invalid')).toBe('false')
  })

  it('focuses an invalid quantity after Review and never substitutes one for blank text', async () => {
    const user = renderForm()
    await selectReference(user)
    await user.type(priceInput(), '0')
    await user.clear(quantityInput())
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(document.activeElement).toBe(quantityInput())
    expect(quantityInput().value).toBe('')
    expect(quantityInput().getAttribute('aria-invalid')).toBe('true')
    expect(quantityInput().getAttribute('aria-describedby')).toContain('logging-quantity-error')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Increase quantity' }).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('allows keyboard review of valid details while Save remains disabled', async () => {
    const user = renderForm()
    await selectReference(user)
    await user.type(priceInput(), '0')
    await user.click(quantityInput())
    await user.keyboard('{Enter}')
    expect(screen.getByRole('status').textContent).toBe('Ready to save — not saved yet.')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
    expect(screen.getByText(/Persistence will be added later/)).toBeDefined()
    expect(screen.queryByText(/^Saved successfully/i)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('keeps review incomplete with missing references and focuses the error summary', async () => {
    const user = renderForm({ references: [] })
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(document.activeElement?.id).toBe('logging-error-summary')
    expect(screen.getByRole('status').textContent).toBe('')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('reports nonexistent local time beside the datetime control', async () => {
    const user = renderForm({ timeZone: 'America/New_York', initialLocalDateTime: '2026-03-08T02:30' })
    await selectReference(user)
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    const input = screen.getByLabelText<HTMLInputElement>('Consumption date and time')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('logging-time-error')?.textContent).toContain('does not exist')
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('requires an occurrence choice for a repeated time and clears it when the time changes', async () => {
    const user = renderForm({ timeZone: 'America/New_York', initialLocalDateTime: '2026-11-01T01:30' })
    await selectReference(user)
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(screen.getByRole('status').textContent).toBe('')
    await user.click(screen.getByRole('radio', { name: /Later occurrence/ }))
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(screen.getByRole('status').textContent).toBe('Ready to save — not saved yet.')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Later occurrence/ }).checked).toBe(true)

    // Native datetime controls expose a change event rather than ordinary text typing in jsdom.
    fireEvent.change(screen.getByLabelText('Consumption date and time'), { target: { value: '2026-11-01T01:45' } })
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Later occurrence/ }).checked).toBe(false)
    expect(screen.getByRole('status').textContent).toBe('')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(screen.getByRole('status').textContent).toBe('')
  })
})
