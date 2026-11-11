// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DrinkEntryForm from './DrinkEntryForm'
import type { PersonalNutritionSetup } from '../../app/session/sessionState'
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
  personalNutrition?: PersonalNutritionSetup | null
} = {}) {
  const user = userEvent.setup()
  render(<DrinkEntryForm
    references={options.references ?? [makeReference()]}
    currency={options.currency ?? 'BDT'}
    timeZone={options.timeZone ?? 'Asia/Dhaka'}
    initialLocalDateTime={options.initialLocalDateTime ?? '2026-11-08T00:05'}
    draftId="test-draft-id"
    personalNutrition={options.personalNutrition}
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
  await user.selectOptions(screen.getByRole('combobox', { name: 'Coke product' }), JSON.stringify(['reviewed', 'illustrative-product', 1]))
}

function nutritionDetails() {
  const summary = screen.getByText('Nutrition details', { selector: 'summary' })
  const details = summary.closest('details')
  if (details === null) throw new Error('Expected a native nutrition disclosure.')
  return { summary, details }
}

async function openNutritionDetails(user: ReturnType<typeof userEvent.setup>) {
  const { summary, details } = nutritionDetails()
  if (!details.open) await user.click(summary)
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
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' }).disabled).toBe(true)
    expect(screen.getByText('Nutrition setup is needed')).toBeDefined()
    expect(metricText('Volume')).toContain('330 ml')
    expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
    expect(metricText('Coke-only calories')).toContain('Choose a nutrition reference')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(metricText('Volume')).toContain('660 ml')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('discloses the selected reference source and calculates nutrition only after selection', async () => {
    const user = renderForm()
    expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
    await selectReference(user)
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(metricText('Coke-only calories')).toContain('138.6 kcal')
    await openNutritionDetails(user)
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
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
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
    expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
    expect(metricText('Coke-only calories')).toContain('Choose a nutrition reference')
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
    expect(screen.getByRole('status', { name: 'Review status' }).textContent).toBe('')
  })

  it('allows keyboard review of valid details while Save remains disabled', async () => {
    const user = renderForm()
    await selectReference(user)
    await user.type(priceInput(), '0')
    await user.click(quantityInput())
    await user.keyboard('{Enter}')
    expect(screen.getByRole('status', { name: 'Review status' }).textContent).toBe('Ready to save — not saved yet.')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
    expect(screen.getByText(/Persistence will be added later/)).toBeDefined()
    expect(screen.queryByText(/^Saved successfully/i)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(screen.getByRole('status', { name: 'Review status' }).textContent).toBe('')
  })

  it('keeps review incomplete with missing references and focuses the error summary', async () => {
    const user = renderForm({ references: [] })
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(document.activeElement?.id).toBe('logging-error-summary')
    expect(screen.getByRole('status', { name: 'Review status' }).textContent).toBe('')
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
    expect(screen.getByRole('status', { name: 'Review status' }).textContent).toBe('')
  })

  it('requires an occurrence choice for a repeated time and clears it when the time changes', async () => {
    const user = renderForm({ timeZone: 'America/New_York', initialLocalDateTime: '2026-11-01T01:30' })
    await selectReference(user)
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(screen.getByRole('status', { name: 'Review status' }).textContent).toBe('')
    await user.click(screen.getByRole('radio', { name: /Later occurrence/ }))
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(screen.getByRole('status', { name: 'Review status' }).textContent).toBe('Ready to save — not saved yet.')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Later occurrence/ }).checked).toBe(true)

    // Native datetime controls expose a change event rather than ordinary text typing in jsdom.
    fireEvent.change(screen.getByLabelText('Consumption date and time'), { target: { value: '2026-11-01T01:45' } })
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Later occurrence/ }).checked).toBe(false)
    expect(screen.getByRole('status', { name: 'Review status' }).textContent).toBe('')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(screen.getByRole('status', { name: 'Review status' }).textContent).toBe('')
  })
})

// Personal references remain illustrative fixtures, never production nutrition defaults.
function makePersonalSetup(version = 1, overrides: Partial<NutritionCatalogReference> = {}) {
  return {
    kind: 'user-provided' as const,
    reference: {
      ...makeReference(),
      id: 'personal-label',
      version,
      productDescription: 'Illustrative personal can',
      source: { label: 'Illustrative personal label', url: 'https://example.invalid/personal-label' },
      ...overrides,
    },
  } satisfies PersonalNutritionSetup
}

function nutritionKey(setup: PersonalNutritionSetup) {
  return JSON.stringify([setup.kind, setup.reference.id, setup.reference.version])
}

function nutritionInput() {
  return screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' })
}

function reviewStatus() {
  return screen.getByRole('status', { name: 'Review status' })
}

function renderPersonalForm(
  personalNutrition: PersonalNutritionSetup | null = makePersonalSetup(),
  options: { timeZone?: string; initialLocalDateTime?: string; references?: readonly NutritionCatalogReference[] } = {},
) {
  const user = userEvent.setup()
  const props = {
    references: options.references ?? [],
    currency: 'BDT',
    timeZone: options.timeZone ?? 'Asia/Dhaka',
    initialLocalDateTime: options.initialLocalDateTime ?? '2026-11-08T00:05',
    draftId: 'personal-form-draft',
  }
  const view = render(<DrinkEntryForm {...props} personalNutrition={personalNutrition} />)
  return {
    user,
    updatePersonal: (latest: PersonalNutritionSetup | null) => {
      view.rerender(<DrinkEntryForm {...props} personalNutrition={latest} />)
    },
  }
}

describe('explicit personal nutrition selection', () => {
  it('offers personal values without selecting them or showing estimates automatically', () => {
    renderPersonalForm()
    expect(nutritionInput().disabled).toBe(false)
    expect(nutritionInput().value).toBe('')
    expect(within(nutritionInput()).getByRole('option', { name: /Illustrative personal can/ })).toBeDefined()
    expect(metricText('Volume')).toContain('330 ml')
    expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
    expect(metricText('Coke-only calories')).toContain('Choose a nutrition reference')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('uses selected per-100-ml rates for two 330 ml drinks and discloses their personal source', async () => {
    const setup = makePersonalSetup()
    const { user } = renderPersonalForm(setup)
    await user.selectOptions(nutritionInput(), nutritionKey(setup))
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(metricText('Volume')).toContain('660 ml')
    expect(metricText('Estimated sugar')).toContain('69.3 g')
    expect(metricText('Coke-only calories')).toContain('277.2 kcal')
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText('User-provided — not independently verified.')).toBeDefined()
    expect(screen.getAllByText(/Version 1/).length).toBeGreaterThan(0)
    await openNutritionDetails(user)
    const source = screen.getByRole('link', { name: 'Illustrative personal label' })
    expect(source.getAttribute('href')).toBe('https://example.invalid/personal-label')
    expect(source.getAttribute('rel')).toContain('noopener')
    expect(source.getAttribute('rel')).toContain('noreferrer')
  })

  it('shows explicit zero rates as zero estimates rather than unavailable values', async () => {
    const setup = makePersonalSetup(1, { sugarGramsPer100Ml: 0, kcalPer100Ml: 0 })
    const { user } = renderPersonalForm(setup)
    await user.selectOptions(nutritionInput(), nutritionKey(setup))
    expect(metricText('Estimated sugar')).toContain('0 g')
    expect(metricText('Coke-only calories')).toContain('0 kcal')
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it.each([
    ['negative sugar', { sugarGramsPer100Ml: -1 }],
    ['nonfinite calories', { kcalPer100Ml: Infinity }],
    ['missing description', { productDescription: '' }],
    ['invalid version', { version: 0 }],
    ['unsafe source link', { source: { label: 'Unsafe personal source', url: 'javascript:example' } }],
  ] satisfies [string, Partial<NutritionCatalogReference>][])(
    'rejects personal values with %s without displaying their estimates or unsafe source', (_, overrides) => {
      renderPersonalForm(makePersonalSetup(1, overrides))
      expect(nutritionInput().disabled).toBe(true)
      expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
      expect(metricText('Coke-only calories')).toContain('Choose a nutrition reference')
      expect(screen.queryByRole('link', { name: 'Unsafe personal source' })).toBeNull()
      expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
    },
  )

  it('does not let a malformed personal setup claim reviewed provenance', () => {
    const malformed = { ...makePersonalSetup(), kind: 'reviewed' } as unknown as PersonalNutritionSetup
    renderPersonalForm(malformed)
    expect(nutritionInput().disabled).toBe(true)
    expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
    expect(screen.queryByRole('link', { name: 'Illustrative personal label' })).toBeNull()
  })

  it('keeps valid volume and known spending when a selected reference overflows nutrition calculations', async () => {
    const setup = makePersonalSetup(1, { kcalPer100Ml: Number.MAX_VALUE })
    const { user } = renderPersonalForm(setup)
    await user.type(priceInput(), '100.50')
    await user.selectOptions(nutritionInput(), nutritionKey(setup))
    expect(metricText('Volume')).toContain('330 ml')
    expect(metricText('Total spending')).toContain('BDT 100.50')
    expect(metricText('Estimated sugar')).toContain('unavailable')
    expect(metricText('Coke-only calories')).toContain('unavailable')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(reviewStatus().textContent).toBe('')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('keeps reviewed and personal options distinct even when their IDs and versions match', async () => {
    const setup = makePersonalSetup(1, { id: 'illustrative-product', sugarGramsPer100Ml: 0, kcalPer100Ml: 0 })
    const { user } = renderPersonalForm(setup, { references: [makeReference()] })
    await selectReference(user)
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    await user.selectOptions(nutritionInput(), nutritionKey(setup))
    expect(metricText('Estimated sugar')).toContain('0 g')
    expect(nutritionInput().value).toBe(nutritionKey(setup))
  })

  it('does not mutate or freeze supplied references and owns an independent selected copy', async () => {
    const setup = makePersonalSetup()
    const before = structuredClone(setup)
    const { user, updatePersonal } = renderPersonalForm(setup)
    await user.selectOptions(nutritionInput(), nutritionKey(setup))
    expect(setup).toEqual(before)
    expect(Object.isFrozen(setup.reference)).toBe(false)
    expect(Object.isFrozen(setup.reference.source)).toBe(false)
    setup.reference.sugarGramsPer100Ml = 0
    setup.reference.kcalPer100Ml = 0
    expect(Reflect.set(setup.reference.source, 'label', 'Caller changed this source later')).toBe(true)
    updatePersonal(setup)
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(metricText('Coke-only calories')).toContain('138.6 kcal')
    await openNutritionDetails(user)
    expect(screen.getByRole('link', { name: 'Illustrative personal label' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Caller changed this source later' })).toBeNull()
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
  })

  it('does not silently select the first setup published while an existing draft is being edited', async () => {
    const { user, updatePersonal } = renderPersonalForm(null)
    await user.type(priceInput(), '42.50')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    updatePersonal(makePersonalSetup())
    expect(nutritionInput().disabled).toBe(false)
    expect(nutritionInput().value).toBe('')
    expect(quantityInput().value).toBe('2')
    expect(priceInput().value).toBe('42.50')
    expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
  })
})

describe('pinned personal nutrition versions and explicit adoption', () => {
  it('keeps the selected version, source, estimates, Review, and focus unchanged when newer values arrive', async () => {
    const first = makePersonalSetup()
    const { user, updatePersonal } = renderPersonalForm(first)
    await user.selectOptions(nutritionInput(), nutritionKey(first))
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    await user.click(priceInput())
    updatePersonal(makePersonalSetup(2, { sugarGramsPer100Ml: 11, kcalPer100Ml: 43 }))
    expect(document.activeElement).toBe(priceInput())
    expect(nutritionInput().value).toBe(nutritionKey(first))
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(metricText('Coke-only calories')).toContain('138.6 kcal')
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(screen.getByText('Updated nutrition is available.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Use latest values' }).getAttribute('type')).toBe('button')
  })

  it('adopts the latest version with the keyboard, clears Review, and returns focus to the nutrition control', async () => {
    const first = makePersonalSetup()
    const second = makePersonalSetup(2, { sugarGramsPer100Ml: 11, kcalPer100Ml: 43 })
    const { user, updatePersonal } = renderPersonalForm(first)
    await user.selectOptions(nutritionInput(), nutritionKey(first))
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    updatePersonal(second)
    await user.click(nutritionInput())
    await user.tab()
    expect(document.activeElement).toBe(nutritionDetails().summary)
    expect(nutritionDetails().details.open).toBe(false)
    // JSDOM does not emulate the native summary Enter action; browser verification covers it.
    await user.click(nutritionDetails().summary)
    expect(nutritionDetails().details.open).toBe(true)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Illustrative personal label' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Use latest values' }))
    await user.keyboard('{Enter}')
    expect(nutritionInput().value).toBe(nutritionKey(second))
    expect(metricText('Estimated sugar')).toContain('36.3 g')
    expect(metricText('Coke-only calories')).toContain('141.9 kcal')
    expect(reviewStatus().textContent).toBe('')
    expect(document.activeElement).toBe(nutritionInput())
    expect(screen.queryByRole('button', { name: 'Use latest values' })).toBeNull()
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('preserves exact custom text, quantity, cached unknown price, and repeated-time choice during adoption', async () => {
    const first = makePersonalSetup()
    const { user, updatePersonal } = renderPersonalForm(first, {
      timeZone: 'America/New_York', initialLocalDateTime: '2026-11-01T01:30',
    })
    await user.selectOptions(nutritionInput(), nutritionKey(first))
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.type(customSizeInput(), ' 00375 ')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await user.type(priceInput(), '123.45')
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    await user.click(screen.getByRole('radio', { name: /Later occurrence/ }))
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    updatePersonal(makePersonalSetup(2, { sugarGramsPer100Ml: 11, kcalPer100Ml: 43 }))
    await user.click(screen.getByRole('button', { name: 'Use latest values' }))
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Custom' }).checked).toBe(true)
    expect(customSizeInput().value).toBe(' 00375 ')
    expect(quantityInput().value).toBe('2')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Price unknown' }).checked).toBe(true)
    expect(priceInput().disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Consumption date and time').value).toBe('2026-11-01T01:30')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Later occurrence/ }).checked).toBe(true)
    expect(metricText('Volume')).toContain('750 ml')
    expect(metricText('Estimated sugar')).toContain('82.5 g')
    expect(metricText('Coke-only calories')).toContain('322.5 kcal')
    expect(metricText('Total spending')).toContain('Unknown')
    expect(reviewStatus().textContent).toBe('')
    await user.click(screen.getByRole('radio', { name: 'Price known' }))
    expect(priceInput().value).toBe('123.45')
    expect(metricText('Total spending')).toContain('BDT 123.45')
  })

  it('treats source-only revisions as an update while retaining the old source until adoption', async () => {
    const first = makePersonalSetup()
    const second = makePersonalSetup(2, {
      source: { label: 'Corrected illustrative personal source', url: 'https://example.invalid/corrected' },
    })
    const { user, updatePersonal } = renderPersonalForm(first)
    await user.selectOptions(nutritionInput(), nutritionKey(first))
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    updatePersonal(second)
    await openNutritionDetails(user)
    expect(screen.getByRole('link', { name: 'Illustrative personal label' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Corrected illustrative personal source' })).toBeNull()
    expect(screen.getByText('Updated nutrition is available.')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Use latest values' }))
    await openNutritionDetails(user)
    expect(screen.getByRole('link', { name: 'Corrected illustrative personal source' }).getAttribute('href'))
      .toBe('https://example.invalid/corrected')
    expect(nutritionInput().value).toBe(nutritionKey(second))
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(reviewStatus().textContent).toBe('')
  })

  it('skips intervening revisions and adopts the newest available version', async () => {
    const first = makePersonalSetup()
    const latest = makePersonalSetup(4, { sugarGramsPer100Ml: 13, kcalPer100Ml: 45 })
    const { user, updatePersonal } = renderPersonalForm(first)
    await user.selectOptions(nutritionInput(), nutritionKey(first))
    updatePersonal(makePersonalSetup(2, { sugarGramsPer100Ml: 11 }))
    updatePersonal(makePersonalSetup(3, { sugarGramsPer100Ml: 12 }))
    updatePersonal(latest)
    expect(nutritionInput().value).toBe(nutritionKey(first))
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    await user.click(screen.getByRole('button', { name: 'Use latest values' }))
    expect(nutritionInput().value).toBe(nutritionKey(latest))
    expect(metricText('Estimated sugar')).toContain('42.9 g')
    updatePersonal(makePersonalSetup(5, { sugarGramsPer100Ml: 14 }))
    expect(screen.getByText('Updated nutrition is available.')).toBeDefined()
    expect(nutritionInput().value).toBe(nutritionKey(latest))
  })

  it('does not show an update for unchanged normalized submissions or replace the selected snapshot', async () => {
    const first = makePersonalSetup()
    const { user, updatePersonal } = renderPersonalForm(first)
    await user.selectOptions(nutritionInput(), nutritionKey(first))
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    updatePersonal(makePersonalSetup())
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    expect(nutritionInput().value).toBe(nutritionKey(first))
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
  })

  it('rejects an invalid latest reference without invalidating the selected older version', async () => {
    const first = makePersonalSetup()
    const { user, updatePersonal } = renderPersonalForm(first)
    await user.selectOptions(nutritionInput(), nutritionKey(first))
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    updatePersonal(makePersonalSetup(2, { source: { label: 'Unsafe new source', url: 'javascript:example' } }))
    expect(screen.queryByRole('button', { name: 'Use latest values' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Unsafe new source' })).toBeNull()
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(nutritionInput().value).toBe(nutritionKey(first))
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(metricText('Coke-only calories')).toContain('138.6 kcal')
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
  })

  it('clears nutrition only on explicit deselection and allows selecting the latest values afterward', async () => {
    const first = makePersonalSetup()
    const latest = makePersonalSetup(2, { sugarGramsPer100Ml: 11 })
    const { user, updatePersonal } = renderPersonalForm(first)
    await user.selectOptions(nutritionInput(), nutritionKey(first))
    updatePersonal(latest)
    await user.selectOptions(nutritionInput(), '')
    expect(nutritionInput().value).toBe('')
    expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    await user.selectOptions(nutritionInput(), nutritionKey(latest))
    expect(metricText('Estimated sugar')).toContain('36.3 g')
    expect(nutritionInput().value).toBe(nutritionKey(latest))
  })
})

// These injected reviewed references exercise UI behavior only. Their names,
// markets, and rates are illustrative fixtures, not production review evidence.
function makeReviewedReference(version = 1, overrides: Partial<NutritionCatalogReference> = {}): NutritionCatalogReference {
  return {
    ...makeReference(),
    id: 'illustrative-cola-gb',
    version,
    productDescription: 'Illustrative cola — Great Britain',
    source: { label: 'Illustrative reviewed source', url: 'https://example.invalid/reviewed-label' },
    ...overrides,
  }
}

function reviewedKey(reference: NutritionCatalogReference) {
  return JSON.stringify(['reviewed', reference.id, reference.version])
}

function renderReviewedForm(
  references: readonly NutritionCatalogReference[] = [makeReviewedReference()],
  options: { personalNutrition?: PersonalNutritionSetup; timeZone?: string; currency?: CurrencyCode; initialLocalDateTime?: string } = {},
) {
  const user = userEvent.setup()
  const props = {
    currency: options.currency ?? 'BDT',
    timeZone: options.timeZone ?? 'Asia/Dhaka',
    initialLocalDateTime: options.initialLocalDateTime ?? '2026-11-08T00:05',
    personalNutrition: options.personalNutrition,
    draftId: 'illustrative-reviewed-draft',
  }
  const view = render(<DrinkEntryForm {...props} references={references} />)
  return {
    user,
    updateReferences: (latest: readonly NutritionCatalogReference[]) => {
      view.rerender(<DrinkEntryForm {...props} references={latest} />)
    },
  }
}

describe('simple reviewed Coke product selection', () => {
  it('groups reviewed products and personal values without choosing either automatically', async () => {
    const first = makeReviewedReference()
    const personal = makePersonalSetup()
    const { user } = renderReviewedForm([first], { personalNutrition: personal })
    expect(nutritionInput().value).toBe('')
    const reviewed = within(nutritionInput()).getByRole('group', { name: 'Reviewed products' })
    const ownValues = within(nutritionInput()).getByRole('group', { name: 'My label values' })
    expect(within(reviewed).getByRole('option', { name: first.productDescription })).toBeDefined()
    expect(within(ownValues).getByRole('option', { name: personal.reference.productDescription })).toBeDefined()
    expect(screen.getByText('Product not listed? Add your label values in Settings.')).toBeDefined()
    expect(metricText('Estimated sugar')).toContain('Choose a nutrition reference')
    await user.selectOptions(nutritionInput(), reviewedKey(first))
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(metricText('Coke-only calories')).toContain('138.6 kcal')
    await user.selectOptions(nutritionInput(), nutritionKey(personal))
    expect(within(screen.getByRole('region', { name: 'Draft preview' }))
      .getByText('User-provided — not independently verified.')).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('keeps nutrition details collapsed and preserves keyboard order through the disclosed safe source', async () => {
    const first = makeReviewedReference()
    const { user } = renderReviewedForm([first])
    await user.selectOptions(nutritionInput(), reviewedKey(first))
    expect(nutritionDetails().details.open).toBe(false)
    await user.click(nutritionInput())
    await user.tab()
    expect(document.activeElement).toBe(nutritionDetails().summary)
    await user.click(nutritionDetails().summary)
    expect(nutritionDetails().details.open).toBe(true)
    await user.tab()
    const source = screen.getByRole('link', { name: first.source.label })
    expect(document.activeElement).toBe(source)
    expect(source.getAttribute('href')).toBe(first.source.url)
    expect(source.getAttribute('rel')).toContain('noopener')
    expect(source.getAttribute('rel')).toContain('noreferrer')
    expect(screen.getByText(/Reference illustrative-cola-gb · Version 1/)).toBeDefined()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(nutritionDetails().summary)
    await user.click(nutritionDetails().summary)
    expect(nutritionDetails().details.open).toBe(false)
  })

  it('requires explicit choice between the same product from different markets regardless of currency', async () => {
    const british = makeReviewedReference()
    const japanese = makeReviewedReference(1, {
      id: 'illustrative-cola-jp', productDescription: 'Illustrative cola — Japan', sugarGramsPer100Ml: 12,
    })
    const { user, updateReferences } = renderReviewedForm([british, japanese], { currency: 'JPY', timeZone: 'Asia/Tokyo' })
    expect(nutritionInput().value).toBe('')
    await user.selectOptions(nutritionInput(), reviewedKey(british))
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    updateReferences([{ ...japanese, version: 2, sugarGramsPer100Ml: 13 }])
    expect(nutritionInput().value).toBe(reviewedKey(british))
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    await user.selectOptions(nutritionInput(), reviewedKey({ ...japanese, version: 2 }))
    expect(metricText('Estimated sugar')).toContain('42.9 g')
  })
})

describe('pinned reviewed product versions', () => {
  it('preserves the selected reviewed version until adoption and retains every other draft field', async () => {
    const first = makeReviewedReference()
    const second = makeReviewedReference(2, { sugarGramsPer100Ml: 11, kcalPer100Ml: 43 })
    const { user, updateReferences } = renderReviewedForm([first], {
      timeZone: 'America/New_York', initialLocalDateTime: '2026-11-01T01:30',
    })
    await user.selectOptions(nutritionInput(), reviewedKey(first))
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(customSizeInput(), { target: { value: ' 00375 ' } })
    fireEvent.change(quantityInput(), { target: { value: '02' } })
    await user.type(priceInput(), '123.45')
    await user.click(screen.getByRole('radio', { name: 'Price unknown' }))
    await user.click(screen.getByRole('radio', { name: /Later occurrence/ }))
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    const focusBefore = document.activeElement
    updateReferences([second])
    expect(document.activeElement).toBe(focusBefore)
    expect(nutritionInput().value).toBe(reviewedKey(first))
    expect(metricText('Estimated sugar')).toContain('78.75 g')
    expect(metricText('Coke-only calories')).toContain('315 kcal')
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(screen.getByText('Updated nutrition is available.')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Use latest values' }))
    expect(document.activeElement).toBe(nutritionInput())
    expect(nutritionInput().value).toBe(reviewedKey(second))
    expect(metricText('Estimated sugar')).toContain('82.5 g')
    expect(metricText('Coke-only calories')).toContain('322.5 kcal')
    expect(reviewStatus().textContent).toBe('')
    expect(customSizeInput().value).toBe(' 00375 ')
    expect(quantityInput().value).toBe('02')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Price unknown' }).checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Consumption date and time').value).toBe('2026-11-01T01:30')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Later occurrence/ }).checked).toBe(true)
    await user.click(screen.getByRole('radio', { name: 'Price known' }))
    expect(priceInput().value).toBe('123.45')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('pins source-only changes until explicit adoption and clears the old Review afterward', async () => {
    const first = makeReviewedReference()
    const second = makeReviewedReference(2, {
      source: { label: 'Corrected illustrative reviewed source', url: 'https://example.invalid/reviewed-correction' },
    })
    const { user, updateReferences } = renderReviewedForm([first])
    await user.selectOptions(nutritionInput(), reviewedKey(first))
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    updateReferences([second])
    await openNutritionDetails(user)
    expect(screen.getByRole('link', { name: first.source.label })).toBeDefined()
    expect(screen.queryByRole('link', { name: second.source.label })).toBeNull()
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    await user.click(screen.getByRole('button', { name: 'Use latest values' }))
    await openNutritionDetails(user)
    expect(screen.getByRole('link', { name: second.source.label }).getAttribute('href')).toBe(second.source.url)
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(reviewStatus().textContent).toBe('')
    expect(priceInput().value).toBe('0')
  })

  it('adopts the highest valid matching revision even when references are not version-sorted', async () => {
    const first = makeReviewedReference()
    const second = makeReviewedReference(2, { sugarGramsPer100Ml: 11 })
    const newest = makeReviewedReference(4, { sugarGramsPer100Ml: 13 })
    const invalidNewer = makeReviewedReference(9, { kcalPer100Ml: Infinity })
    const { user, updateReferences } = renderReviewedForm([first])
    await user.selectOptions(nutritionInput(), reviewedKey(first))
    updateReferences([newest, first, invalidNewer, second])
    expect(nutritionInput().value).toBe(reviewedKey(first))
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    await user.click(screen.getByRole('button', { name: 'Use latest values' }))
    expect(nutritionInput().value).toBe(reviewedKey(newest))
    expect(metricText('Estimated sugar')).toContain('42.9 g')
    expect(screen.queryByRole('button', { name: 'Use latest values' })).toBeNull()
  })

  it('preserves a valid pinned review when the only newer reviewed candidate is invalid', async () => {
    const first = makeReviewedReference()
    const { user, updateReferences } = renderReviewedForm([first])
    await user.selectOptions(nutritionInput(), reviewedKey(first))
    await user.type(priceInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Review entry' }))
    updateReferences([makeReviewedReference(2, {
      source: { label: 'Unsafe reviewed source', url: 'javascript:example' },
    })])
    expect(nutritionInput().value).toBe(reviewedKey(first))
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(reviewStatus().textContent).toBe('Ready to save — not saved yet.')
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Unsafe reviewed source' })).toBeNull()
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save entry' }).disabled).toBe(true)
  })

  it('keeps a copied reviewed version unchanged when callers mutate data without publishing a new version', async () => {
    const first = makeReviewedReference()
    const { user, updateReferences } = renderReviewedForm([first])
    await user.selectOptions(nutritionInput(), reviewedKey(first))
    expect(Reflect.set(first, 'sugarGramsPer100Ml', 0)).toBe(true)
    expect(Reflect.set(first.source, 'label', 'Changed after selection')).toBe(true)
    updateReferences([first])
    expect(metricText('Estimated sugar')).toContain('34.65 g')
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
    await openNutritionDetails(user)
    expect(screen.getByRole('link', { name: 'Illustrative reviewed source' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Changed after selection' })).toBeNull()
  })
})
