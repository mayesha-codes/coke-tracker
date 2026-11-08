// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LogPage from './LogPage'

afterEach(cleanup)

const initialization = { initialReferenceUtc: '2026-11-07T18:05:00Z', draftId: 'page-test-draft' }

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
})
