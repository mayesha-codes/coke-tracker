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
  it('provides the shell heading and an honest empty nutrition catalog', () => {
    render(<LogPage {...initialization} />)
    expect(screen.getByRole('heading', { level: 1 }).id).toBe('view-heading')
    expect(screen.getByText('Preview mode')).toBeDefined()
    expect(screen.getByLabelText(/nutrition reference/i)).toHaveProperty('disabled', true)
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
    render(<LogPage {...initialization} personalNutrition={personal} />)
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Nutrition reference' })
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
    expect(screen.getByRole('combobox', { name: 'Nutrition reference' })).toHaveProperty('value', '')
    const preview = screen.getByRole('region', { name: 'Draft preview' })
    expect(within(preview).getByText('1,000', { exact: false })).toBeDefined()
    expect(within(preview).getAllByText('Choose a nutrition reference to see estimates.')).toHaveLength(2)
    expect(screen.queryByText('Updated nutrition is available.')).toBeNull()
  })
})
