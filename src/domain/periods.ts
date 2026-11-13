import { TZDateMini, tzOffset, tzScan } from '@date-fns/tz'
import { DEFAULT_TRACKING_SETTINGS } from './types'
import type { UtcTimestamp } from './types'
import { isNamedTimeZone, normalizeUtcTimestamp } from './validation'

export type ReportingPeriodKind = 'day' | 'week' | 'month'

/** A half-open UTC interval representing a calendar period in the named timezone. */
export interface ReportingPeriod {
  readonly kind: ReportingPeriodKind
  readonly timeZone: string
  readonly startUtc: UtcTimestamp
  readonly endUtc: UtcTimestamp
}

export interface PeriodIssue {
  readonly source: 'period'
  readonly field: 'referenceUtc' | 'timeZone' | 'kind' | 'period' | 'startUtc' | 'endUtc'
  readonly message: string
  readonly entryIndex: null
}

export type PeriodResult =
  | { readonly valid: true; readonly period: ReportingPeriod }
  | { readonly valid: false; readonly issues: readonly PeriodIssue[] }

function invalid(issues: readonly PeriodIssue[]): PeriodResult {
  return Object.freeze({
    valid: false,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
  })
}

function failure(field: PeriodIssue['field'], message: string): PeriodResult {
  return invalid([{ source: 'period', field, message, entryIndex: null }])
}

function isPeriodKind(value: unknown): value is ReportingPeriodKind {
  return value === 'day' || value === 'week' || value === 'month'
}

/** UTC is used only as a neutral carrier of civil dates, not as the reporting zone. */
function civilDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  // setUTCFullYear preserves years 0000–0099, unlike the multi-argument Date constructor.
  date.setUTCFullYear(year, month, day)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

function localDateValue(instant: number, timeZone: string): number {
  const zoned = new TZDateMini(instant, timeZone)
  return civilDate(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()).getTime()
}

/**
 * tzScan locates changes to the hour. Refine only that bracket when a transition
 * falls on a half hour or a historical minute/second, using the library's offsets.
 */
function refineTransition(instant: number, oldOffset: number, newOffset: number, timeZone: string) {
  let before = instant - 60 * 60 * 1000
  let after = instant
  if (tzOffset(timeZone, new Date(before)) !== oldOffset ||
      tzOffset(timeZone, new Date(after)) !== newOffset) return null

  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2)
    const offset = tzOffset(timeZone, new Date(middle))
    if (!Number.isFinite(offset)) return null
    if (offset === oldOffset) before = middle
    else if (offset === newOffset) after = middle
    else return null // A more complicated transition is outside this narrow resolver.
  }
  return after
}

/**
 * Resolve just a calendar boundary, not arbitrary user-entered wall times.
 * Nearby offsets supply midnight candidates; transitions supply gap candidates.
 * Every candidate must cross from an earlier local date into the requested date
 * (or its next existing date). This rejects a later repeated midnight and any
 * unverified normalization. No calendar end is computed by adding these probe hours.
 */
function resolveBoundary(date: Date, timeZone: string): number | null {
  const civil = date.getTime()
  const probeMargin = 48 * 60 * 60 * 1000
  const start = new Date(civil - probeMargin)
  const end = new Date(civil + probeMargin)
  const offsets = new Set([tzOffset(timeZone, start), tzOffset(timeZone, end)])
  const candidates: number[] = []

  for (const change of tzScan(timeZone, { start, end })) {
    // tzScan may inspect the containing month; keep only this boundary's probe window.
    const instant = change.date.getTime()
    if (instant < start.getTime() || instant > end.getTime()) continue
    const oldOffset = change.offset - change.change
    offsets.add(oldOffset)
    offsets.add(change.offset)
    const transition = refineTransition(instant, oldOffset, change.offset, timeZone)
    if (transition !== null) candidates.push(transition)
  }
  for (const offset of offsets) {
    if (!Number.isFinite(offset)) return null
    // Historical offsets can include seconds; round only the offset conversion to milliseconds.
    candidates.push(civil - Math.round(offset * 60 * 1000))
  }

  const verified = candidates.filter(instant =>
    localDateValue(instant, timeZone) >= civil &&
    localDateValue(instant - 1, timeZone) < civil,
  )
  return verified.length === 0 ? null : Math.min(...verified)
}

function buildCalendarPeriod(
  referenceDate: Date,
  timeZone: string,
  kind: ReportingPeriodKind,
  referenceInstant?: number,
): PeriodResult {
  try {
    const startDate = new Date(referenceDate.getTime())
    if (kind === 'week') {
      const daysSinceMonday = (startDate.getUTCDay() + 6) % 7
      startDate.setUTCDate(startDate.getUTCDate() - daysSinceMonday)
    } else if (kind === 'month') {
      startDate.setUTCDate(1)
    }

    const endDate = new Date(startDate.getTime())
    if (kind === 'month') endDate.setUTCMonth(endDate.getUTCMonth() + 1)
    else endDate.setUTCDate(endDate.getUTCDate() + (kind === 'week' ? 7 : 1))

    const start = resolveBoundary(startDate, timeZone)
    const startUtc = start === null ? null : normalizeUtcTimestamp(new Date(start).toISOString())
    if (startUtc === null) {
      return failure('startUtc', 'The start boundary could not be verified within the supported UTC range.')
    }
    const end = resolveBoundary(endDate, timeZone)
    const endUtc = end === null ? null : normalizeUtcTimestamp(new Date(end).toISOString())
    if (endUtc === null) {
      return failure('endUtc', 'The end boundary could not be verified within the supported UTC range.')
    }
    if (start === null || end === null ||
        (referenceInstant !== undefined && (referenceInstant < start || referenceInstant >= end)) ||
        start >= end) {
      return failure('period', referenceInstant === undefined
        ? 'The calendar boundaries could not be verified around the reference date.'
        : 'The calendar boundaries could not be verified around the reference instant.')
    }

    return Object.freeze({
      valid: true,
      period: Object.freeze({ kind, timeZone, startUtc, endUtc }),
    })
  } catch {
    return failure('period', 'The timezone library could not reliably resolve this calendar period.')
  }
}

function getCalendarPeriod(
  referenceUtc: UtcTimestamp,
  timeZone: string,
  kind: ReportingPeriodKind,
): PeriodResult {
  const reference = normalizeUtcTimestamp(referenceUtc)
  const validZone = isNamedTimeZone(timeZone)
  const issues: PeriodIssue[] = []
  if (reference === null) {
    issues.push({
      source: 'period', field: 'referenceUtc',
      message: 'Provide a valid, explicit UTC reference timestamp.', entryIndex: null,
    })
  }
  if (!validZone) {
    issues.push({
      source: 'period', field: 'timeZone',
      message: 'Provide a valid, supported IANA timezone name.', entryIndex: null,
    })
  }
  if (reference === null || !validZone) return invalid(issues)

  try {
    const instant = new Date(reference).getTime()
    const local = new TZDateMini(instant, timeZone)
    const date = civilDate(local.getFullYear(), local.getMonth(), local.getDate())
    return buildCalendarPeriod(date, timeZone, kind, instant)
  } catch {
    return failure('period', 'The timezone library could not reliably resolve this calendar period.')
  }
}

/**
 * Build a calendar period from a local civil date such as `2026-11-14`.
 * The date is interpreted in `timeZone`, never as UTC midnight.
 */
export function getCalendarPeriodForDate(
  date: string,
  kind: ReportingPeriodKind,
  timeZone = DEFAULT_TRACKING_SETTINGS.reportingTimeZone,
): PeriodResult {
  const match = typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null
  const year = match === null ? NaN : Number(match[1])
  const month = match === null ? NaN : Number(match[2])
  const day = match === null ? NaN : Number(match[3])
  const parsedDate = match === null ? null : civilDate(year, month - 1, day)
  if (parsedDate === null || parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() + 1 !== month || parsedDate.getUTCDate() !== day) {
    return failure('period', 'Provide a real calendar date in YYYY-MM-DD format.')
  }
  if (!isPeriodKind(kind)) return failure('kind', 'Choose a supported calendar period kind.')
  if (!isNamedTimeZone(timeZone)) {
    return failure('timeZone', 'Provide a valid, supported IANA timezone name.')
  }

  try {
    // A missing midnight can resolve forward within the requested date. Verify
    // the date itself exists before anchoring a daily, weekly, or monthly period.
    const dateStart = resolveBoundary(parsedDate, timeZone)
    if (dateStart === null || localDateValue(dateStart, timeZone) !== parsedDate.getTime()) {
      return failure('period', 'This calendar date does not exist in the selected timezone.')
    }
    const nextDate = new Date(parsedDate.getTime())
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const dateEnd = resolveBoundary(nextDate, timeZone)
    if (dateEnd === null || dateEnd <= dateStart) {
      return failure('period', 'The selected calendar date could not be verified in this timezone.')
    }
    return buildCalendarPeriod(parsedDate, timeZone, kind)
  } catch {
    return failure('period', 'The timezone library could not reliably resolve this calendar date.')
  }
}

/** Calendar day containing the supplied instant; the end is the next day's first valid instant. */
export function getCalendarDayPeriod(
  referenceUtc: UtcTimestamp,
  timeZone = DEFAULT_TRACKING_SETTINGS.reportingTimeZone,
): PeriodResult {
  return getCalendarPeriod(referenceUtc, timeZone, 'day')
}

/** Monday through Sunday in the reporting timezone, with the following Monday excluded. */
export function getCalendarWeekPeriod(
  referenceUtc: UtcTimestamp,
  timeZone = DEFAULT_TRACKING_SETTINGS.reportingTimeZone,
): PeriodResult {
  return getCalendarPeriod(referenceUtc, timeZone, 'week')
}

/** Calendar month containing the supplied instant, ending at the next month's start. */
export function getCalendarMonthPeriod(
  referenceUtc: UtcTimestamp,
  timeZone = DEFAULT_TRACKING_SETTINGS.reportingTimeZone,
): PeriodResult {
  return getCalendarPeriod(referenceUtc, timeZone, 'month')
}
