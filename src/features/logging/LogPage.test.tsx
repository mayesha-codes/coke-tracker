// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNutritionReference } from '../../domain/nutrition'
import type { PersonalNutritionSetup } from '../../app/session/sessionState'
import LogPage from './LogPage'

afterEach(cleanup)

const initialization = { initialReferenceUtc: '2026-11-07T18:05:00Z', draftId: 'page-test-draft' }

// Illustrative test values only, not production defaults or independently reviewed data.
function personalSetup(): PersonalNutritionSetup {
  const checked = createNutritionReference({
    id: 'personal-page-label', version: 1, productDescription: 'Illustrative personal page label',
    sugarGramsPer100Ml: 10.5, kcalPer100Ml: 42,
    source: { label: 'Illustrative personal package label' },
  })
  if (checked.valid === false) throw new Error('Expected valid illustrative nutrition.')
  return Object.freeze({ kind: 'user-provided', reference: checked.reference })
}

describe('the preview-only Log page', () => {
  it('offers exactly the reviewed Great Britain product without choosing it for the user', () => {
    render(<LogPage {...initialization} />)
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' })
    expect(select.disabled).toBe(false)
    expect(select.value).toBe('')
    const reviewed = within(select).getByRole('group', { name: 'Reviewed products' })
    expect(within(reviewed).getAllByRole('option')).toHaveLength(1)
    expect(within(reviewed).getByRole('option', { name: /Coca-Cola Original Taste — Great Britain/ })).toBeDefined()
    expect(screen.getByText('Product not listed? Add your label values in Settings.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
  })

  it('uses the documented production sugar measurement for two 330 ml drinks and keeps source details collapsed', async () => {
    const user = userEvent.setup()
    render(<LogPage {...initialization} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Coke product' }),
      JSON.stringify(['reviewed', 'coca-cola-original-taste-gb', 1]))
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText('660', { exact: false })).toBeDefined()
    expect(within(preview).getByText('69.96', { exact: false })).toBeDefined()
    expect(within(preview).getByText('277.2', { exact: false })).toBeDefined()
    const details = document.querySelector<HTMLDetailsElement>('details.logging-nutrition-details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
    // JSDOM does not model closed-details accessibility visibility; browser checks cover it.
    await user.click(screen.getByText('Nutrition details', { selector: 'summary' }))
    expect(details?.open).toBe(true)
    const source = screen.getByRole('link')
    expect(source.getAttribute('href')).toBe('https://www.coca-cola.com/gb/en/brands/coca-cola-original-taste')
    expect(source.getAttribute('rel')).toContain('noreferrer')
    expect(details?.textContent).toContain('Version 1')
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
  })

  it.each([
    ['JPY', 'Asia/Tokyo'], ['BDT', 'Asia/Dhaka'], ['USD', 'America/New_York'],
  ])('keeps the product market explicit and selection blank for %s in %s', (currency, timeZone) => {
    render(<LogPage {...initialization} currency={currency} timeZone={timeZone} />)
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' })
    expect(select.value).toBe('')
    expect(within(select).getByRole('option', { name: /Coca-Cola Original Taste — Great Britain/ })).toBeDefined()
    expect(screen.queryByText('Ready to save — not saved yet.')).toBeNull()
  })

  it('provides the shell heading and an honest empty nutrition catalog', () => {
    render(<LogPage {...initialization} references={[]} />)
    expect(screen.getByRole('heading', { level: 1 }).id).toBe('view-heading')
    expect(screen.getByText('Preview mode')).toBeDefined()
    expect(screen.getByLabelText(/coke product/i)).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
    expect(screen.queryByText('Ready to save — not saved yet.')).toBeNull()
  })

  it('initializes the local clock fields in Dhaka rather than UTC or the host timezone', () => {
    render(<LogPage {...initialization} />)
    expect(screen.getByLabelText(/consumption date and time/i)).toHaveProperty('value', '2026-11-08T00:05')
    expect(screen.getAllByText(/Asia\/Dhaka/).length).toBeGreaterThan(0)
  })

  it('uses an explicitly configured timezone for its initial date and time', () => {
    render(<LogPage {...initialization} timeZone="UTC" />)
    expect(screen.getByLabelText(/consumption date and time/i)).toHaveProperty('value', '2026-11-07T18:05')
  })

  it('initializes a Tokyo draft and formats its yen price without decimal places', async () => {
    const user = userEvent.setup()
    render(<LogPage {...initialization} currency="JPY" timeZone="Asia/Tokyo" />)
    expect(screen.getByLabelText(/consumption date and time/i)).toHaveProperty('value', '2026-11-08T03:05')
    await user.type(screen.getByRole('textbox', { name: 'Total paid for all drinks (JPY)' }), '100')
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText(/JPY\s+100$/)).toBeDefined()
    expect(within(preview).queryByText(/JPY\s+100\.00/)).toBeNull()
  })

  it('explains when changed preferences have cleared an earlier draft', () => {
    render(<LogPage {...initialization} draftWasReset headingId="retained-log-heading" />)
    expect(screen.getByRole('heading', { level: 1 }).id).toBe('retained-log-heading')
    expect(screen.getByText('Your previous draft was cleared after a currency or timezone change.')).toBeDefined()
  })

  it('does not replace an invalid explicitly supplied initial time with the current time', () => {
    render(<LogPage initialReferenceUtc="invalid" draftId="invalid-time" />)
    expect(screen.getByLabelText(/consumption date and time/i)).toHaveProperty('value', '')
  })

  it('lets users explore real draft volume while sugar and calorie estimates stay unavailable', async () => {
    const user = userEvent.setup()
    render(<LogPage {...initialization} />)
    await user.click(screen.getByRole('radio', { name: /500 ml/i }))
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText('1,000', { exact: false })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
    expect(screen.queryByText(/\d+\.\d+ kcal/)).toBeNull()
  })

  it('offers personal values separately from an empty reviewed catalog and requires explicit selection', async () => {
    const user = userEvent.setup()
    const personal = personalSetup()
    render(<LogPage {...initialization} references={[]} personalNutrition={personal} />)
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Coke product' })
    expect(select.disabled).toBe(false)
    expect(select.value).toBe('')
    expect(within(select).getAllByRole('option')).toHaveLength(2)
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getAllByText('Choose a nutrition reference to see estimates.')).toHaveLength(2)
    await user.selectOptions(select, JSON.stringify(['user-provided', personal.reference.id, 1]))
    expect(within(preview).getByText('34.65', { exact: false })).toBeDefined()
    expect(within(preview).getByText('138.6', { exact: false })).toBeDefined()
    expect(within(preview).getByText('User-provided — not independently verified.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save entry' })).toHaveProperty('disabled', true)
  })

  it('keeps reviewed products and personal label values in distinct groups', () => {
    render(<LogPage {...initialization} personalNutrition={personalSetup()} />)
    const select = screen.getByRole('combobox', { name: 'Coke product' })
    expect(within(select).getByRole('group', { name: 'Reviewed products' })).toBeDefined()
    expect(within(select).getByRole('group', { name: 'My label values' })).toBeDefined()
    expect(within(select).getAllByRole('option')).toHaveLength(3)
    expect(select).toHaveProperty('value', '')
  })

  it('does not replace edited inputs or select nutrition when the first personal setup becomes available', async () => {
    const user = userEvent.setup()
    const view = render(<LogPage {...initialization} />)
    await user.click(screen.getByRole('radio', { name: '500 ml' }))
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    const price = screen.getByRole<HTMLInputElement>('textbox', { name: /Total paid for all drinks/ })
    await user.type(price, '25.50')
    const focused = document.activeElement
    view.rerender(<LogPage {...initialization} personalNutrition={personalSetup()} />)
    expect(document.activeElement).toBe(focused)
    expect(price.value).toBe('25.50')
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveProperty('value', '2')
    expect(screen.getByLabelText('Consumption date and time')).toHaveProperty('value', '2026-11-08T00:05')
    expect(screen.getByRole('combobox', { name: 'Coke product' })).toHaveProperty('value', '')
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText('1,000', { exact: false })).toBeDefined()
    expect(within(preview).getAllByText('Choose a nutrition reference to see estimates.')).toHaveLength(2)
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
  })
})
