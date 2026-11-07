import { validateDrinkEntry } from './entries'
import { evaluateDailyVolumeGoal } from './goals'
import type { DailyVolumeGoal, DailyVolumeGoalIssue } from './goals'
import {
  getCalendarDayPeriod,
  getCalendarMonthPeriod,
  getCalendarWeekPeriod,
} from './periods'
import type { PeriodIssue, PeriodResult, ReportingPeriod } from './periods'
import { calculateConsumptionTotals } from './totals'
import type { ConsumptionTotals, TotalsIssue } from './totals'
import type { DrinkEntry, UtcTimestamp } from './types'
import { isRecord, normalizeUtcTimestamp } from './validation'

export interface EntryReportingIssue extends TotalsIssue {
  readonly source: 'entry' | 'totals'
}

export interface GoalReportingIssue extends DailyVolumeGoalIssue {
  readonly source: 'goal'
  readonly entryIndex: null
}

export type ReportingIssue = PeriodIssue | EntryReportingIssue | GoalReportingIssue

export interface ReportingFailure {
  readonly valid: false
  readonly issues: readonly ReportingIssue[]
}

export type SelectionResult =
  | {
    readonly valid: true
    readonly entries: readonly DrinkEntry[]
    /** Index of each selected entry in the original, unfiltered input. */
    readonly originalIndices: readonly number[]
  }
  | ReportingFailure

export type PeriodTotalsResult =
  | {
    readonly valid: true
    readonly period: ReportingPeriod
    readonly totals: ConsumptionTotals
  }
  | ReportingFailure

export type DailySummaryResult =
  | {
    readonly valid: true
    readonly period: ReportingPeriod
    readonly totals: ConsumptionTotals
    readonly goal: DailyVolumeGoal
  }
  | ReportingFailure

function failure(issues: readonly ReportingIssue[]): ReportingFailure {
  return Object.freeze({
    valid: false,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
  })
}

function periodFailure(issues: readonly PeriodIssue[]): PeriodResult {
  return Object.freeze({
    valid: false,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
  })
}

/** Regenerate boundaries rather than trusting a caller-created period object. */
function validatePeriod(input: unknown): PeriodResult {
  if (!isRecord(input)) {
    return periodFailure([{
      source: 'period', field: 'period', message: 'Provide a calendar reporting period.', entryIndex: null,
    }])
  }

  const { kind, timeZone } = input
  const validKind = kind === 'day' || kind === 'week' || kind === 'month'
  const validZone = typeof timeZone === 'string'
  const startUtc = normalizeUtcTimestamp(input.startUtc)
  const endUtc = normalizeUtcTimestamp(input.endUtc)
  const issues: PeriodIssue[] = []
  if (!validKind) {
    issues.push({ source: 'period', field: 'kind', message: 'Use a day, week, or month period.', entryIndex: null })
  }
  if (!validZone) {
    issues.push({ source: 'period', field: 'timeZone', message: 'Provide a reporting timezone name.', entryIndex: null })
  }
  if (startUtc === null) {
    issues.push({ source: 'period', field: 'startUtc', message: 'Provide a valid UTC start timestamp.', entryIndex: null })
  }
  if (endUtc === null) {
    issues.push({ source: 'period', field: 'endUtc', message: 'Provide a valid UTC end timestamp.', entryIndex: null })
  }
  if (!validKind || !validZone || startUtc === null || endUtc === null) return periodFailure(issues)

  if (Date.parse(startUtc) >= Date.parse(endUtc)) {
    return periodFailure([{
      source: 'period', field: 'endUtc', message: 'The end must be later than the start.', entryIndex: null,
    }])
  }

  const expected = kind === 'day' ? getCalendarDayPeriod(startUtc, timeZone)
    : kind === 'week' ? getCalendarWeekPeriod(startUtc, timeZone)
      : getCalendarMonthPeriod(startUtc, timeZone)
  if (expected.valid === false) return expected

  if (expected.period.startUtc !== startUtc) {
    issues.push({ source: 'period', field: 'startUtc', message: 'The start must match the calendar period boundary.', entryIndex: null })
  }
  if (expected.period.endUtc !== endUtc) {
    issues.push({ source: 'period', field: 'endUtc', message: 'The end must match the next calendar period boundary.', entryIndex: null })
  }
  if (issues.length > 0) return periodFailure(issues)
  return Object.freeze({ valid: true, period: Object.freeze({ ...expected.period }) })
}

/** All records are validated before any dates are used to exclude them. */
function selectEntries(entries: readonly DrinkEntry[], period: ReportingPeriod): SelectionResult {
  if (!Array.isArray(entries)) {
    return failure([{
      source: 'entry', field: 'entries', message: 'Provide an array of drink records.', entryIndex: null,
    }])
  }

  const validated: DrinkEntry[] = []
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    if (!Object.hasOwn(entries, entryIndex)) {
      return failure([{
        source: 'entry', field: 'entry',
        message: 'Provide a drink record at this index instead of an empty array slot.', entryIndex,
      }])
    }
    const result = validateDrinkEntry(entries[entryIndex])
    if (result.valid === false) {
      return failure(result.issues.map(issue => ({ ...issue, source: 'entry' as const, entryIndex })))
    }
    validated.push(result.entry)
  }

  const start = Date.parse(period.startUtc)
  const end = Date.parse(period.endUtc)
  const selected: DrinkEntry[] = []
  const originalIndices: number[] = []
  for (let index = 0; index < validated.length; index++) {
    const instant = Date.parse(validated[index].consumedAt)
    if (start <= instant && instant < end) {
      selected.push(validated[index])
      originalIndices.push(index)
    }
  }
  return Object.freeze({
    valid: true,
    entries: Object.freeze(selected),
    originalIndices: Object.freeze(originalIndices),
  })
}

/** Return normalized, frozen copies of entries in the start-inclusive/end-exclusive range. */
export function filterEntriesForPeriod(
  entries: readonly DrinkEntry[],
  period: ReportingPeriod,
): SelectionResult {
  const checkedPeriod = validatePeriod(period)
  if (checkedPeriod.valid === false) return failure(checkedPeriod.issues)
  return selectEntries(entries, checkedPeriod.period)
}

/** Compose validated selection with the existing consumption calculator. */
export function calculatePeriodTotals(
  entries: readonly DrinkEntry[],
  period: ReportingPeriod,
): PeriodTotalsResult {
  const checkedPeriod = validatePeriod(period)
  if (checkedPeriod.valid === false) return failure(checkedPeriod.issues)
  const selection = selectEntries(entries, checkedPeriod.period)
  if (selection.valid === false) return selection

  const result = calculateConsumptionTotals(selection.entries)
  if (result.valid === false) {
    return failure(result.issues.map(issue => ({
      ...issue,
      source: 'totals' as const,
      entryIndex: issue.entryIndex === null ? null : selection.originalIndices[issue.entryIndex] ?? null,
    })))
  }
  return Object.freeze({ valid: true, period: checkedPeriod.period, totals: result.totals })
}

/** The caller supplies the reference instant and limit; no current clock is read. */
export function calculateDailySummary(
  entries: readonly DrinkEntry[],
  referenceUtc: UtcTimestamp,
  dailyLimitMl: number | null,
  timeZone?: string,
): DailySummaryResult {
  const period = getCalendarDayPeriod(referenceUtc, timeZone)
  if (period.valid === false) return failure(period.issues)
  const report = calculatePeriodTotals(entries, period.period)
  if (report.valid === false) return report
  const evaluated = evaluateDailyVolumeGoal(report.totals.volumeMl, dailyLimitMl)
  if (evaluated.valid === false) {
    return failure(evaluated.issues.map(issue => ({ ...issue, source: 'goal' as const, entryIndex: null })))
  }
  return Object.freeze({
    valid: true,
    period: report.period,
    totals: report.totals,
    goal: evaluated.goal,
  })
}
