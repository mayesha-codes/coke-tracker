/** Shared guards for domain boundaries. These checks never coerce or change a value. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** IDs and descriptive labels must be nonempty and have no surrounding whitespace. */
export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

/** Keep integer inputs within JavaScript's exact integer range. */
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Require explicit UTC with seconds, optionally 1–3 fractional digits, and Z or +00:00. */
export function normalizeUtcTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|\+00:00)$/.exec(value)
  if (!parts) return null

  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null

  // Date parsing can roll an impossible day into the next month. Reject that normalization.
  const milliseconds = Number((parts[7] ?? '').padEnd(3, '0'))
  if (
    date.getUTCFullYear() !== Number(parts[1]) ||
    date.getUTCMonth() + 1 !== Number(parts[2]) ||
    date.getUTCDate() !== Number(parts[3]) ||
    date.getUTCHours() !== Number(parts[4]) ||
    date.getUTCMinutes() !== Number(parts[5]) ||
    date.getUTCSeconds() !== Number(parts[6]) ||
    date.getUTCMilliseconds() !== milliseconds
  ) {
    return null
  }

  return date.toISOString()
}
