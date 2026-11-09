// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DrinkEntryForm from './DrinkEntryForm'
import type { CurrencyCode, NutritionCatalogReference } from '../../domain/types'

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
  currency?: CurrencyCode
  references?: readonly NutritionCatalogReference[]
  timeZone?: string
  initialLocalDateTime?: string
} = {}) {
  const user = userEvent.setup()
  render(<DrinkEntryForm
    references={options.references ?? [makeReference()]}
    currency={options.currency ?? 'BDT'}
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

function customSizeInput() {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Custom serving size (ml)' })
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
  it('offers the five presets followed by Custom and defaults to 330 ml', async () => {
    const user = renderForm()
    const servings = screen.getByRole('group', { name: 'Serving size' })
    expect(within(servings).getAllByRole('radio').map(radio => radio.getAttribute('aria-label'))).toEqual([
      '200 ml', '330 ml', '350 ml', '500 ml', '1000 ml', 'Custom',
    ])
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '330 ml' }).checked).toBe(true)
    expect(screen.queryByRole('textbox', { name: 'Custom serving size (ml)' })).toBeNull()
    await user.click(screen.getByRole('radio', { name: '350 ml' }))
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '350 ml' }).checked).toBe(true)
    expect(metricText('Volume')).toContain('350 ml')
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

describe('custom serving sizes', () => {
  it('calculates two custom 375 ml drinks without requiring nutrition data or changing the total price', async () => {
    const user = renderForm({ references: [] })
    await user.type(priceInput(), '100.50')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    expect(customSizeInput().value).toBe('')
    await user.type(customSizeInput(), '375')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(metricText('Volume')).toContain('750 ml')
    expect(metricText('Total spending')).toContain('BDT 100.50')
    expect(priceInput().value).toBe('100.50')
    expect(metricText('Estimated sugar')).toContain('Choose a reviewed nutrition reference')
    expect(metricText('Coke-only calories')).toContain('Choose a reviewed nutrition reference')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('preserves exact custom text when changing presets and returning to Custom', async () => {
    const user = renderForm()
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customSizeInput(), ' 00375 ')
    expect(customSizeInput().value).toBe(' 00375 ')
    expect(metricText('Volume')).toContain('375 ml')
    await user.click(screen.getByRole('radio', { name: '500 ml' }))
    expect(screen.queryByRole('textbox', { name: 'Custom serving size (ml)' })).toBeNull()
    expect(metricText('Volume')).toContain('500 ml')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    expect(customSizeInput().value).toBe(' 00375 ')
    expect(metricText('Volume')).toContain('375 ml')
  })

  it('keeps Custom selected when its value equals the 350 ml preset', async () => {
    const user = renderForm()
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customSizeInput(), '350')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Custom' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '350 ml' }).checked).toBe(false)
    expect(customSizeInput().value).toBe('350')
    expect(metricText('Volume')).toContain('350 ml')
  })

  it('preserves a cached known price while changing Custom size and quantity in unknown-price mode', async () => {
    const user = renderForm()
    await user.type(priceInput(), '123.45')
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customSizeInput(), '375')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.click(screen.getByRole('radio', { name: '350 ml' }))
    expect(metricText('Total spending')).toContain('Unknown')
    await user.click(screen.getByRole('radio', { name: 'Price known' }))
    expect(priceInput().value).toBe('123.45')
    expect(metricText('Total spending')).toContain('BDT 123.45')
  })

  it('preserves native radio arrows and lets Tab reach the Custom input without stealing focus', async () => {
    const user = renderForm()
    await user.click(screen.getByRole('radio', { name: '1000 ml' }))
    await user.keyboard('{ArrowRight}')
    const customRadio = screen.getByRole<HTMLInputElement>('radio', { name: 'Custom' })
    expect(customRadio.checked).toBe(true)
    expect(document.activeElement).toBe(customRadio)
    expect(customSizeInput().value).toBe('')
    await user.keyboard(' ')
    expect(document.activeElement).toBe(customRadio)
    await user.tab()
    expect(document.activeElement).toBe(customSizeInput())
  })

  it('waits until the blank Custom input is blurred before showing its field error', async () => {
    const user = renderForm({ references: [] })
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    expect(document.getElementById('logging-serving-error')).toBeNull()
    await user.tab()
    expect(document.activeElement).toBe(customSizeInput())
    await user.tab()
    expect(customSizeInput().getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('logging-serving-error')?.textContent).toMatch(/serving|millilitres|ml/i)
  })

  it.each([
    { label: 'blank', value: '' },
    { label: 'fractional', value: '375.5' },
    { label: 'zero', value: '0' },
    { label: 'negative', value: '-1' },
    { label: 'exponent-form', value: '1e3' },
    { label: 'unsafe integer', value: '9007199254740992' },
  ])('rejects a $label Custom size without replacing or rounding its text', async ({ value }) => {
    const user = renderForm({ references: [] })
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.tab()
    if (value) await user.type(customSizeInput(), value)
    await user.tab()
    expect(customSizeInput().value).toBe(value)
    expect(customSizeInput().getAttribute('aria-invalid')).toBe('true')
    expect(customSizeInput().getAttribute('aria-describedby')).toContain('logging-serving-error')
    expect(document.getElementById('logging-serving-error')?.textContent?.length).toBeGreaterThan(0)
    expect(metricText('Volume')).toContain('Enter a valid quantity and serving size')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
    if (value === '9007199254740992') {
      expect(document.getElementById('logging-serving-error')?.textContent).toMatch(/large|range|limit/i)
    }
  })

  it('focuses an invalid Custom size after Review and lets correction clear the error', async () => {
    const user = renderForm({ references: [] })
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.tab()
    await user.type(customSizeInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(document.activeElement).toBe(customSizeInput())
    expect(customSizeInput().getAttribute('aria-invalid')).toBe('true')
    await user.clear(customSizeInput())
    await user.type(customSizeInput(), '375')
    expect(customSizeInput().getAttribute('aria-invalid')).toBe('false')
    expect(metricText('Volume')).toContain('375 ml')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('focuses the Custom input before Quantity when both fields are invalid', async () => {
    const user = renderForm({ references: [] })
    await user.clear(quantityInput())
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(document.activeElement).toBe(customSizeInput())
    expect(customSizeInput().getAttribute('aria-invalid')).toBe('true')
    expect(quantityInput().getAttribute('aria-invalid')).toBe('true')
  })

  it('rejects an overflowing quantity times Custom size even when both numbers are individually safe', async () => {
    const user = renderForm({ references: [] })
    await user.type(priceInput(), '100.50')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.tab()
    await user.type(customSizeInput(), '4503599627370496')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(customSizeInput().value).toBe('4503599627370496')
    expect(document.activeElement).toBe(customSizeInput())
    expect(document.getElementById('logging-serving-error')?.textContent).toMatch(/large|range|limit/i)
    expect(metricText('Volume')).toContain('safe integer range')
    expect(metricText('Total spending')).toContain('BDT 100.50')
    expect(priceInput().value).toBe('100.50')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('preserves invalid Custom text across a preset toggle and validates it again on return', async () => {
    const user = renderForm({ references: [] })
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customSizeInput(), '1e3')
    await user.tab()
    await user.click(screen.getByRole('radio', { name: '200 ml' }))
    expect(metricText('Volume')).toContain('200 ml')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    expect(customSizeInput().value).toBe('1e3')
    expect(customSizeInput().getAttribute('aria-invalid')).toBe('true')
  })
})

describe('currency-aware price input and preview', () => {
  it.each(['100', '0'])('displays the JPY total %s without fractional digits', async amount => {
    const user = renderForm({ currency: 'JPY' })
    await user.type(priceInput(), amount)
    expect(metricText('Total spending')).toContain(`JPY ${amount}`)
    expect(metricText('Total spending')).not.toContain('.00')
    expect(priceInput().value).toBe(amount)
  })

  it('reports fractional yen beside the price field instead of rounding it', async () => {
    const user = renderForm({ currency: 'JPY' })
    await user.type(priceInput(), '100.5')
    await user.tab()
    expect(priceInput().value).toBe('100.5')
    expect(priceInput().getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('logging-price-error')?.textContent).toContain('0 decimal places')
    expect(metricText('Total spending')).toContain('Enter a valid total price')
  })

  it('keeps an unknown JPY price distinct from known zero', async () => {
    const user = renderForm({ currency: 'JPY' })
    await user.type(priceInput(), '0')
    expect(metricText('Total spending')).toContain('JPY 0')
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    expect(metricText('Total spending')).toContain('Unknown')
    expect(metricText('Total spending')).not.toContain('JPY 0')
    expect(priceInput().disabled).toBe(true)
  })

  it.each(['USD', 'EUR', 'BDT'])('keeps two decimal places for %s totals', async currency => {
    const user = renderForm({ currency })
    await user.type(priceInput(), '12.50')
    expect(metricText('Total spending')).toContain(`${currency} 12.50`)
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
