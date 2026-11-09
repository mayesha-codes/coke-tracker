import { validateDrinkEntry } from '../../domain/entries'
import { createNutritionReference } from '../../domain/nutrition'
import type { NutritionReferenceField } from '../../domain/nutrition'
import { calculateConsumptionTotals } from '../../domain/totals'
import type { TotalsIssueField } from '../../domain/totals'
import type {
  CurrencyCode,
  DrinkEntry,
  DrinkEntryValidationField,
  NutritionCatalogReference,
  TrackingSettings,
} from '../../domain/types'
import { isRecord } from '../../domain/validation'
import { INITIAL_USER_PREFERENCES, validatePreferences } from '../../features/preferences/preferences'
import type { PreferenceIssue } from '../../features/preferences/preferences'

/** A source's label is preserved without claiming user-entered values were reviewed. */
export interface NutritionProvenance {
  readonly kind: 'reviewed' | 'user-provided'
  readonly reference: NutritionCatalogReference
}

/** Existing calculations use entry; this envelope also preserves the source metadata. */
export interface SessionEntryRecord {
  readonly entry: DrinkEntry
  readonly nutritionProvenance: NutritionProvenance
}

/** In-memory data only. React, persistence, UUID generation, and clocks belong to callers. */
export interface SessionState {
  readonly preferences: TrackingSettings
  readonly entries: readonly SessionEntryRecord[]
}

/** Payloads are checked at runtime before they can enter the validated session state. */
export type SessionAction =
  | { readonly type: 'update-preferences'; readonly preferences: unknown }
  | { readonly type: 'add-entry'; readonly record: unknown }

export type SessionIssueField =
  | 'action'
  | 'record'
  | 'preferences'
  | `preferences.${keyof TrackingSettings}`
  | 'entry'
  | `entry.${Exclude<DrinkEntryValidationField, 'entry'>}`
  | 'nutritionProvenance'
  | 'nutritionProvenance.kind'
  | 'nutritionProvenance.reference'
  | `nutritionProvenance.reference.${Exclude<NutritionReferenceField, 'reference'>}`
  | `entries.${TotalsIssueField}`

export interface SessionIssue {
  readonly field: SessionIssueField
  readonly message: string
  /** Original insertion index, when an aggregate calculation reports an issue. */
  readonly entryIndex?: number | null
  readonly currency?: CurrencyCode
}

export type SessionInitializationResult =
  | { readonly valid: true; readonly state: SessionState }
  | { readonly valid: false; readonly issues: readonly SessionIssue[] }

export type SessionTransitionResult =
  | { readonly outcome: 'accepted'; readonly state: SessionState }
  | {
    readonly outcome: 'duplicate'
    readonly state: SessionState
    readonly entryId: string
    readonly issues: readonly SessionIssue[]
  }
  | { readonly outcome: 'invalid'; readonly state: SessionState; readonly issues: readonly SessionIssue[] }

type RecordResult =
  | { readonly valid: true; readonly record: SessionEntryRecord }
  | { readonly valid: false; readonly issues: readonly SessionIssue[] }

function frozenIssues(issues: readonly SessionIssue[]): readonly SessionIssue[] {
  return Object.freeze(issues.map(issue => Object.freeze({ ...issue })))
}

function preferenceIssues(issues: readonly PreferenceIssue[]): readonly SessionIssue[] {
  return issues.map(issue => ({
    field: issue.field === 'preferences' ? 'preferences' : `preferences.${issue.field}`,
    message: issue.message,
  }))
}

function invalid(state: SessionState, issues: readonly SessionIssue[]): SessionTransitionResult {
  return Object.freeze({ outcome: 'invalid', state, issues: frozenIssues(issues) })
}

/** An omitted initial setup uses editable application suggestions, not domain defaults. */
export function createSessionState(preferences: unknown = INITIAL_USER_PREFERENCES): SessionInitializationResult {
  const checked = validatePreferences(preferences)
  if (checked.valid === false) {
    return Object.freeze({ valid: false, issues: frozenIssues(preferenceIssues(checked.issues)) })
  }
  return Object.freeze({
    valid: true,
    state: Object.freeze({ preferences: checked.preferences, entries: Object.freeze([]) }),
  })
}

/** Copy both the existing entry snapshot and the full source; retain no caller-owned objects. */
function validateSessionRecord(input: unknown): RecordResult {
  if (!isRecord(input)) {
    return { valid: false, issues: [{ field: 'record', message: 'Provide an entry and its nutrition provenance.' }] }
  }

  const checkedEntry = validateDrinkEntry(input.entry)
  const rawProvenance = input.nutritionProvenance
  const issues: SessionIssue[] = []
  if (checkedEntry.valid === false) {
    issues.push(...checkedEntry.issues.map(issue => ({
      field: issue.field === 'entry' ? 'entry' as const : `entry.${issue.field}` as const,
      message: issue.message,
    })))
  }
  if (!isRecord(rawProvenance)) {
    issues.push({ field: 'nutritionProvenance', message: 'Provide the nutrition source and its provenance kind.' })
    return { valid: false, issues }
  }

  const kind = rawProvenance.kind
  const validKind = kind === 'reviewed' || kind === 'user-provided'
  if (!validKind) {
    issues.push({ field: 'nutritionProvenance.kind', message: 'Identify the nutrition source as reviewed or user-provided.' })
  }
  // This validates structure and numbers, not the factual accuracy or review status of a label.
  const checkedReference = createNutritionReference(rawProvenance.reference)
  if (checkedReference.valid === false) {
    issues.push(...checkedReference.issues.map(issue => ({
      field: issue.field === 'reference' ? 'nutritionProvenance.reference' as const
        : `nutritionProvenance.reference.${issue.field}` as const,
      message: issue.message,
    })))
  }
  if (checkedEntry.valid === false || checkedReference.valid === false || !validKind) {
    return { valid: false, issues }
  }

  const entry = checkedEntry.entry
  const reference = checkedReference.reference
  const matchingFields = [
    ['id', entry.nutrition.referenceId],
    ['version', entry.nutrition.referenceVersion],
    ['sugarGramsPer100Ml', entry.nutrition.sugarGramsPer100Ml],
    ['kcalPer100Ml', entry.nutrition.kcalPer100Ml],
  ] as const
  for (const [field, savedValue] of matchingFields) {
    if (reference[field] !== savedValue) {
      issues.push({
        field: `nutritionProvenance.reference.${field}`,
        message: `Nutrition provenance ${field} must match the entry's saved snapshot.`,
      })
    }
  }
  if (issues.length > 0) return { valid: false, issues }

  return {
    valid: true,
    record: Object.freeze({
      entry,
      nutritionProvenance: Object.freeze({ kind, reference }),
    }),
  }
}

/**
 * Apply an action to a state returned by createSessionState or a previous transition.
 * Rejections return that exact state unchanged. Accepted actions own frozen copies;
 * preference changes reuse historical records without relabeling or recalculating them.
 */
export function transitionSession(state: SessionState, action: SessionAction): SessionTransitionResult {
  if (!isRecord(action)) {
    return invalid(state, [{ field: 'action', message: 'Provide a session action.' }])
  }
  if (action.type === 'update-preferences') {
    const checked = validatePreferences(action.preferences)
    if (checked.valid === false) return invalid(state, preferenceIssues(checked.issues))
    return Object.freeze({
      outcome: 'accepted',
      state: Object.freeze({ preferences: checked.preferences, entries: state.entries }),
    })
  }
  if (action.type !== 'add-entry') {
    return invalid(state, [{ field: 'action', message: 'Choose an add-entry or update-preferences action.' }])
  }

  const checked = validateSessionRecord(action.record)
  if (checked.valid === false) return invalid(state, checked.issues)
  const record = checked.record
  if (state.entries.some(saved => saved.entry.id === record.entry.id)) {
    return Object.freeze({
      outcome: 'duplicate',
      state,
      entryId: record.entry.id,
      issues: frozenIssues([{ field: 'entry.id', message: 'This entry ID is already in the session.' }]),
    })
  }

  // Reuse aggregate safety checks; never keep a cached, potentially stale totals object.
  const entries = [...state.entries, record]
  const totals = calculateConsumptionTotals(entries.map(saved => saved.entry))
  if (totals.valid === false) {
    return invalid(state, totals.issues.map(issue => ({
      ...issue,
      field: `entries.${issue.field}`,
    })))
  }
  return Object.freeze({
    outcome: 'accepted',
    state: Object.freeze({ preferences: state.preferences, entries: Object.freeze(entries) }),
  })
}
