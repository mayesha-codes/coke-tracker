// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionProvider from '../../app/session/SessionProvider'
import { SessionContext, useSession } from '../../app/session/sessionContext'
import type { SessionContextValue } from '../../app/session/sessionContext'
import { createSessionState, transitionSession } from '../../app/session/sessionState'
import type { SessionState } from '../../app/session/sessionState'
import PersonalNutritionSetup from './PersonalNutritionSetup'
import type { PersonalNutritionDraft } from './nutritionInput'

afterEach(cleanup)

// These rates and source descriptions are illustrative test fixtures, never defaults.
const illustrativeDraft: PersonalNutritionDraft = {
  productDescription: 'Illustrative personal can',
  sugarGramsPer100MlText: '10.5',
  kcalPer100MlText: '42',
  sourceDescription: 'Illustrative package label',
  sourceUrl: 'https://example.invalid/label',
}

const labels = {
  productDescription: 'Product description',
  sugarGramsPer100MlText: 'Sugar (g per 100 ml)',
  kcalPer100MlText: 'Calories (kcal per 100 ml)',
  sourceDescription: 'Source description',
  sourceUrl: 'Source URL (optional)',
} as const

function initialState(): SessionState {
  const created = createSessionState()
  if (created.valid === false) throw new Error('Expected valid initial session.')
  return created.state
}

function SessionProbe() {
  const session = useSession()
  return <output data-testid="session-state">{JSON.stringify(session.state)}</output>
}

function setup(state = initialState()) {
  const user = userEvent.setup()
  render(<SessionProvider initialState={state}><PersonalNutritionSetup /><SessionProbe /></SessionProvider>)
  return user
}

function storedState(): SessionState {
  return JSON.parse(screen.getByTestId('session-state').textContent ?? '{}')
}

function field(name: keyof typeof labels): HTMLInputElement {
  return screen.getByLabelText(labels[name])
}

function nutritionStatus() {
  return screen.getByRole('status', { name: 'Nutrition application status' })
}

function fillDraft(draft: PersonalNutritionDraft = illustrativeDraft) {
  for (const name of Object.keys(labels) as (keyof typeof labels)[]) {
    fireEvent.change(field(name), { target: { value: draft[name] ?? '' } })
  }
}

function applyButton() {
  return screen.getByRole('button', { name: 'Apply personal nutrition' })
}

describe('personal nutrition label inputs', () => {
  it('starts with five blank English fields and no assumed nutrition values or confirmation', () => {
    setup()
    expect(screen.getByRole('form', { name: 'Personal nutrition setup' })).toBeDefined()
    for (const name of Object.keys(labels) as (keyof typeof labels)[]) {
      expect(field(name).value).toBe('')
      expect(field(name).required).toBe(name !== 'sourceUrl')
    }
    expect(storedState().personalNutrition).toBeNull()
    expect(nutritionStatus().textContent).toBe('')
    expect(screen.getByText('User-provided — not independently verified.')).toBeDefined()
    expect(screen.getByText(/temporary and clears on refresh/)).toBeDefined()
    expect(screen.getByText(/save drinks for this session/)).toBeDefined()
  })

  it('keeps typed text local until Apply and accepts explicit zero values with an omitted URL', async () => {
    const user = setup()
    fillDraft({ ...illustrativeDraft, sugarGramsPer100MlText: '0', kcalPer100MlText: '0.00', sourceUrl: '  ' })
    expect(storedState().personalNutrition).toBeNull()
    expect(nutritionStatus().textContent).toBe('')
    await user.click(applyButton())
    const appliedSetup = storedState().personalNutrition
    expect(appliedSetup?.kind).toBe('user-provided')
    expect(appliedSetup?.reference).toMatchObject({ version: 1, sugarGramsPer100Ml: 0, kcalPer100Ml: 0 })
    expect(appliedSetup?.reference.source).toEqual({ label: 'Illustrative package label' })
    expect(nutritionStatus().textContent).toBe('Personal nutrition applied for this session. Version 1.')
    expect(screen.getByText('0 g')).toBeDefined()
    expect(screen.getByText('0 kcal')).toBeDefined()
  })

  it('normalizes Unicode descriptions and source metadata and exposes the applied source safely', async () => {
    const user = setup()
    fillDraft({
      ...illustrativeDraft, productDescription: '  個人のコーラ — বাংলা  ',
      sourceDescription: '  缶の表示 / বোতলের লেবেল  ', sourceUrl: ' https://example.invalid/ラベル ',
    })
    await user.click(applyButton())
    const reference = storedState().personalNutrition?.reference
    expect(reference?.productDescription).toBe('個人のコーラ — বাংলা')
    expect(reference?.source).toEqual({ label: '缶の表示 / বোতলের লেবেল', url: 'https://example.invalid/ラベル' })
    const sourceLink = screen.getByRole('link', { name: 'View source (opens in a new tab)' })
    expect(sourceLink.getAttribute('href')).toBe('https://example.invalid/ラベル')
    expect(sourceLink.getAttribute('rel')).toContain('noopener')
    expect(sourceLink.getAttribute('rel')).toContain('noreferrer')
    expect(screen.getAllByText('User-provided — not independently verified.')).toHaveLength(2)
  })

  it('shows required-field feedback and focuses the first invalid control in visual order', async () => {
    const user = setup()
    await user.click(applyButton())
    expect(document.activeElement).toBe(field('productDescription'))
    for (const name of ['productDescription', 'sugarGramsPer100MlText', 'kcalPer100MlText', 'sourceDescription'] as const) {
      expect(field(name).getAttribute('aria-invalid')).toBe('true')
      expect(field(name).getAttribute('aria-describedby')).toContain(`personal-nutrition-${name}-error`)
    }
    expect(storedState().personalNutrition).toBeNull()
    expect(nutritionStatus().textContent).toBe('')
  })

  it('focuses the first invalid field again when unchanged invalid values are submitted with Enter', async () => {
    const user = setup()
    await user.click(applyButton())
    expect(document.activeElement).toBe(field('productDescription'))
    await user.tab()
    expect(document.activeElement).toBe(field('sugarGramsPer100MlText'))
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(field('productDescription'))
    expect(storedState().personalNutrition).toBeNull()
    expect(nutritionStatus().textContent).toBe('')
    await user.click(applyButton())
    expect(document.activeElement).toBe(field('productDescription'))
  })

  it.each(['', '-1', 'NaN', 'Infinity', '1e2', '9'.repeat(309), `0.${'0'.repeat(400)}1`])(
    'rejects invalid sugar text %j without replacing it with a different value', async sugarGramsPer100MlText => {
      const user = setup()
      fillDraft({ ...illustrativeDraft, sugarGramsPer100MlText })
      await user.click(applyButton())
      expect(document.activeElement).toBe(field('sugarGramsPer100MlText'))
      expect(field('sugarGramsPer100MlText').value).toBe(sugarGramsPer100MlText)
      expect(field('sugarGramsPer100MlText').getAttribute('aria-invalid')).toBe('true')
      expect(storedState().personalNutrition).toBeNull()
      expect(nutritionStatus().textContent).toBe('')
    },
  )

  it('rejects a missing calorie value separately from an explicit zero sugar value', async () => {
    const user = setup()
    fillDraft({ ...illustrativeDraft, sugarGramsPer100MlText: '0', kcalPer100MlText: '' })
    await user.click(applyButton())
    expect(document.activeElement).toBe(field('kcalPer100MlText'))
    expect(field('sugarGramsPer100MlText').getAttribute('aria-invalid')).toBe('false')
    expect(storedState().personalNutrition).toBeNull()
  })

  it('rejects an invalid optional URL at that field without applying a partial setup', async () => {
    const user = setup()
    fillDraft({ ...illustrativeDraft, sourceUrl: 'javascript:example' })
    await user.click(applyButton())
    expect(document.activeElement).toBe(field('sourceUrl'))
    expect(field('sourceUrl').getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('personal-nutrition-sourceUrl-error')?.textContent).toContain('HTTP or HTTPS')
    expect(storedState().personalNutrition).toBeNull()
  })

  it('shows errors on blur and updates feedback while typing without moving focus', async () => {
    const user = setup()
    await user.click(field('sugarGramsPer100MlText'))
    await user.type(field('sugarGramsPer100MlText'), '-1')
    expect(field('sugarGramsPer100MlText').getAttribute('aria-invalid')).toBe('false')
    await user.tab()
    expect(field('sugarGramsPer100MlText').getAttribute('aria-invalid')).toBe('true')
    await user.clear(field('sugarGramsPer100MlText'))
    await user.type(field('sugarGramsPer100MlText'), '0')
    expect(document.activeElement).toBe(field('sugarGramsPer100MlText'))
    expect(field('sugarGramsPer100MlText').getAttribute('aria-invalid')).toBe('false')
  })

  it('supports keyboard navigation and Enter submission without requiring a pointer', async () => {
    const user = setup()
    fillDraft({ ...illustrativeDraft, sourceUrl: '' })
    await user.tab()
    expect(document.activeElement).toBe(field('productDescription'))
    await user.tab()
    expect(document.activeElement).toBe(field('sugarGramsPer100MlText'))
    await user.tab()
    expect(document.activeElement).toBe(field('kcalPer100MlText'))
    await user.keyboard('{Enter}')
    expect(storedState().personalNutrition?.reference.version).toBe(1)
    expect(nutritionStatus().textContent).toContain('applied for this session')
  })
})

describe('applied personal setup and committed feedback', () => {
  it('clears confirmation when editing and increments only for normalized content changes', async () => {
    const user = setup()
    fillDraft()
    await user.click(applyButton())
    const firstId = storedState().personalNutrition?.reference.id
    fireEvent.change(field('sugarGramsPer100MlText'), { target: { value: '010.500' } })
    expect(nutritionStatus().textContent).toBe('')
    await user.click(applyButton())
    expect(storedState().personalNutrition?.reference.version).toBe(1)
    fireEvent.change(field('sourceDescription'), { target: { value: 'Corrected illustrative label description' } })
    await user.click(applyButton())
    expect(storedState().personalNutrition?.reference.version).toBe(2)
    expect(storedState().personalNutrition?.reference.id).toBe(firstId)
    expect(nutritionStatus().textContent).toBe('Personal nutrition applied for this session. Version 2.')
  })

  it('restores an existing applied setup for editing without claiming it was newly applied', () => {
    const state = transitionSession(initialState(), { type: 'apply-personal-nutrition', id: 'personal-setup', draft: illustrativeDraft })
    if (state.outcome !== 'accepted') throw new Error('Expected valid illustrative setup.')
    setup(state.state)
    expect(field('productDescription').value).toBe('Illustrative personal can')
    expect(field('sugarGramsPer100MlText').value).toBe('10.5')
    expect(field('sourceDescription').value).toBe('Illustrative package label')
    expect(screen.getByRole('heading', { name: 'Applied for this session' })).toBeDefined()
    expect(nutritionStatus().textContent).toBe('')
  })

  it.each([
    ['a tiny rate', '0.0000001'],
    ['a large rate', `1${'0'.repeat(21)}`],
    ['the smallest representable rate', `0.${'0'.repeat(323)}5`],
    ['a large finite rate', `1${'0'.repeat(308)}`],
  ])('restores %s as a valid plain decimal without creating a revision', async (_, rateText) => {
    const state = transitionSession(initialState(), {
      type: 'apply-personal-nutrition', id: 'personal-setup',
      draft: { ...illustrativeDraft, sugarGramsPer100MlText: rateText },
    })
    if (state.outcome !== 'accepted') throw new Error('Expected valid illustrative rate.')
    const user = setup(state.state)
    expect(field('sugarGramsPer100MlText').value).toMatch(/^\d+(?:\.\d+)?$/)
    expect(Number(field('sugarGramsPer100MlText').value)).toBe(Number(rateText))
    await user.click(applyButton())
    expect(storedState().personalNutrition?.reference.version).toBe(1)
    expect(nutritionStatus().textContent).toContain('applied for this session')
  })

  it('waits for the committed accepted nutrition result before announcing success', async () => {
    const user = userEvent.setup()
    const state = initialState()
    const applyPersonalNutrition = vi.fn()
    const context: SessionContextValue = {
      state, applyPersonalNutrition, lastNutritionResult: null,
      updatePreferences: vi.fn(), lastPreferenceResult: null,
      addEntry: vi.fn(), lastEntryResult: null,
    }
    const view = render(<SessionContext.Provider value={context}><PersonalNutritionSetup /></SessionContext.Provider>)
    fillDraft()
    await user.click(applyButton())
    expect(applyPersonalNutrition).toHaveBeenCalledWith(illustrativeDraft)
    expect(nutritionStatus().textContent).toBe('')
    const accepted = transitionSession(state, { type: 'apply-personal-nutrition', id: 'personal-setup', draft: illustrativeDraft })
    if (accepted.outcome !== 'accepted') throw new Error('Expected valid illustrative setup.')
    view.rerender(<SessionContext.Provider value={{ ...context, state: accepted.state, lastNutritionResult: accepted }}>
      <PersonalNutritionSetup />
    </SessionContext.Provider>)
    expect(nutritionStatus().textContent).toContain('applied for this session')
  })

  it('does not confuse an accepted preferences result with nutrition application', async () => {
    const user = userEvent.setup()
    const state = initialState()
    const context: SessionContextValue = {
      state, applyPersonalNutrition: vi.fn(), lastNutritionResult: null,
      updatePreferences: vi.fn(), lastPreferenceResult: null,
      addEntry: vi.fn(), lastEntryResult: null,
    }
    const view = render(<SessionContext.Provider value={context}><PersonalNutritionSetup /></SessionContext.Provider>)
    fillDraft()
    await user.click(applyButton())
    const accepted = transitionSession(state, {
      type: 'update-preferences', preferences: { ...state.preferences, currency: 'EUR' },
    })
    view.rerender(<SessionContext.Provider value={{ ...context, state: accepted.state, lastPreferenceResult: accepted }}>
      <PersonalNutritionSetup />
    </SessionContext.Provider>)
    expect(nutritionStatus().textContent).toBe('')
  })

  it('shows a committed rejection and focuses the summary without a false confirmation', async () => {
    const user = userEvent.setup()
    const state = initialState()
    const context: SessionContextValue = {
      state, applyPersonalNutrition: vi.fn(), lastNutritionResult: null,
      updatePreferences: vi.fn(), lastPreferenceResult: null,
      addEntry: vi.fn(), lastEntryResult: null,
    }
    const view = render(<SessionContext.Provider value={context}><PersonalNutritionSetup /></SessionContext.Provider>)
    fillDraft()
    await user.click(applyButton())
    const rejected = transitionSession(state, { type: 'apply-personal-nutrition', id: '', draft: illustrativeDraft })
    expect(rejected.outcome).toBe('invalid')
    view.rerender(<SessionContext.Provider value={{ ...context, lastNutritionResult: rejected }}>
      <PersonalNutritionSetup />
    </SessionContext.Provider>)
    expect(nutritionStatus().textContent).toBe('')
    const summary = document.getElementById('personal-nutrition-error-summary')
    expect(document.activeElement).toBe(summary)
    if (summary === null) throw new Error('Expected an error summary.')
    expect(within(summary).getByText(/nutrition reference ID/)).toBeDefined()
  })
})
