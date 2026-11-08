import { TZDateMini, tzOffset, tzScan } from '@date-fns/tz'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type { UtcTimestamp } from '../../domain/types'
import { normalizeUtcTimestamp } from '../../domain/validation'

export type LocalTimeChoice = 'earlier' | 'later'

/** Options a form can present when the same clock time occurs twice. */
export interface LocalTimeCandidate {
  readonly choice: LocalTimeChoice
  readonly consumedAt: UtcTimestamp
}

export interface LocalDateTimeIssue {
  readonly field: 'consumedAt' | 'timeZone' | 'disambiguation'
  readonly message: string
}

export type LocalDateTimeResult =
  | { readonly valid: true; readonly consumedAt: UtcTimestamp }
  | {
    readonly valid: false
    readonly issues: readonly LocalDateTimeIssue[]
    readonly candidates?: readonly LocalTimeCandidate[]
  }

function failure(
  issues: readonly LocalDateTimeIssue[],
  candidates?: readonly LocalTimeCandidate[],
): LocalDateTimeResult {
  return Object.freeze({
    valid: false,
    issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))),
    ...(candidates === undefined ? {} : {
      candidates: Object.freeze(candidates.map(candidate => Object.freeze({ ...candidate }))),
    }),
  })
}

function isNamedTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return false
  if (/^[+-]/.test(value)) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

/** Validate the clock fields using the existing parser, without assigning them a timezone yet. */
function parseClockFields(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return null
  const withSeconds = value.length === 16 ? `${value}:00` : value
  // Z here provides a neutral carrier for calendar fields, not the final consumedAt value.
  const normalized = normalizeUtcTimestamp(`${withSeconds}Z`)
  return normalized === null ? null : new Date(normalized)
}

function matchesClockFields(instant: number, fields: Date, timeZone: string): boolean {
  const zoned = new TZDateMini(instant, timeZone)
  return zoned.getFullYear() === fields.getUTCFullYear() &&
    zoned.getMonth() === fields.getUTCMonth() &&
    zoned.getDate() === fields.getUTCDate() &&
    zoned.getHours() === fields.getUTCHours() &&
    zoned.getMinutes() === fields.getUTCMinutes() &&
    zoned.getSeconds() === fields.getUTCSeconds() &&
    zoned.getMilliseconds() === fields.getUTCMilliseconds()
}

/**
 * Convert a datetime-local value in a named timezone to UTC, independently of the host zone.
 * Unlike calendar boundaries, a missing local time is rejected, never shifted forward.
 * Repeated times require an explicit choice; IDs, clock access, and form state belong to callers.
 */
export function resolveLocalDateTime(
  value: string,
  timeZone = DEFAULT_TRACKING_SETTINGS.reportingTimeZone,
  disambiguation?: LocalTimeChoice,
): LocalDateTimeResult {
  const fields = parseClockFields(value)
  const validZone = isNamedTimeZone(timeZone)
  const validChoice = disambiguation === undefined ||
    disambiguation === 'earlier' || disambiguation === 'later'
  const issues: LocalDateTimeIssue[] = []
  if (fields === null) {
    issues.push({ field: 'consumedAt', message: 'Enter a valid local date and time without a UTC offset.' })
  }
  if (!validZone) {
    issues.push({ field: 'timeZone', message: 'Choose a valid, supported IANA timezone name.' })
  }
  if (!validChoice) {
    issues.push({ field: 'disambiguation', message: 'Choose earlier or later when a local time repeats.' })
  }
  if (fields === null || !validZone || !validChoice) return failure(issues)

  try {
    const civil = fields.getTime()
    // This is only a lookup margin for possible offsets, not calendar-day boundary arithmetic.
    const margin = 48 * 60 * 60 * 1000
    const start = new Date(civil - margin)
    const end = new Date(civil + margin)
    const offsets = new Set([
      tzOffset(timeZone, start), tzOffset(timeZone, fields), tzOffset(timeZone, end),
    ])
    for (const change of tzScan(timeZone, { start, end })) {
      const instant = change.date.getTime()
      if (instant < start.getTime() || instant > end.getTime()) continue
      offsets.add(change.offset)
      offsets.add(change.offset - change.change)
    }

    const matches = new Set<UtcTimestamp>()
    for (const offset of offsets) {
      if (!Number.isFinite(offset)) {
        return failure([{ field: 'consumedAt', message: 'This local time could not be resolved reliably.' }])
      }
      const candidate = civil - Math.round(offset * 60 * 1000)
      if (!matchesClockFields(candidate, fields, timeZone)) continue
      const normalized = normalizeUtcTimestamp(new Date(candidate).toISOString())
      if (normalized === null) {
        return failure([{ field: 'consumedAt', message: 'The converted time is outside the supported UTC timestamp range.' }])
      }
      matches.add(normalized)
    }

    const instants = [...matches].sort()
    if (instants.length === 0) {
      return failure([{
        field: 'consumedAt',
        message: 'This local time does not exist in the selected timezone. Choose another time.',
      }])
    }
    if (instants.length === 1) {
      return Object.freeze({ valid: true, consumedAt: instants[0] })
    }
    if (instants.length !== 2) {
      return failure([{ field: 'consumedAt', message: 'This local time has an unsupported timezone ambiguity.' }])
    }

    if (disambiguation === undefined) {
      return failure([{
        field: 'disambiguation',
        message: 'This clock time occurs twice. Choose the earlier or later occurrence.',
      }], [
        { choice: 'earlier', consumedAt: instants[0] },
        { choice: 'later', consumedAt: instants[1] },
      ])
    }
    return Object.freeze({
      valid: true,
      consumedAt: disambiguation === 'earlier' ? instants[0] : instants[1],
    })
  } catch {
    return failure([{ field: 'consumedAt', message: 'This local time could not be resolved reliably.' }])
  }
}
