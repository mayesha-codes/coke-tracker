import { describe, expect, expectTypeOf, it } from 'vitest'
import { resolveLocalDateTime } from './localDateTime'
import type { LocalDateTimeResult, LocalTimeCandidate } from './localDateTime'

function consumedAtFrom(result: LocalDateTimeResult): string {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a resolved UTC timestamp.')
  return result.consumedAt
}

function expectIssues(result: LocalDateTimeResult, fields: readonly string[]) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected local date/time issues.')
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  expect(result).not.toHaveProperty('consumedAt')
  for (const issue of result.issues) expect(issue.message.trim()).not.toBe('')
}

// Model malformed JavaScript callers without weakening the production function's types.
function resolveUnknown(value: unknown, zone?: unknown, choice?: unknown): LocalDateTimeResult {
  return Reflect.apply(resolveLocalDateTime, undefined, [value, zone, choice])
}

describe('ordinary local date/time conversion', () => {
  it('defaults to Dhaka and moves a time just after local midnight into the previous UTC date', () => {
    expect(consumedAtFrom(resolveLocalDateTime('2026-11-08T00:05')))
      .toBe('2026-11-07T18:05:00.000Z')
  })

  it.each([
    { zone: 'Asia/Dhaka', local: '2026-11-08T12:00', utc: '2026-11-08T06:00:00.000Z' },
    { zone: 'UTC', local: '2026-11-08T12:00', utc: '2026-11-08T12:00:00.000Z' },
    { zone: 'America/New_York', local: '2026-01-01T00:15', utc: '2026-01-01T05:15:00.000Z' },
    { zone: 'Asia/Kathmandu', local: '2026-11-08T12:00', utc: '2026-11-08T06:15:00.000Z' },
    { zone: 'UTC', local: '2024-02-29T23:59:59.999', utc: '2024-02-29T23:59:59.999Z' },
    { zone: 'UTC', local: '2000-02-29T12:00', utc: '2000-02-29T12:00:00.000Z' },
    { zone: 'UTC', local: '0099-01-02T12:00', utc: '0099-01-02T12:00:00.000Z' },
    { zone: 'UTC', local: '0000-01-01T00:00', utc: '0000-01-01T00:00:00.000Z' },
    { zone: 'UTC', local: '1970-01-01T00:00', utc: '1970-01-01T00:00:00.000Z' },
  ])('converts $local in $zone independently of the host timezone', ({ zone, local, utc }) => {
    expect(consumedAtFrom(resolveLocalDateTime(local, zone))).toBe(utc)
  })

  it.each([
    { local: '2026-11-08T00:05:06', utc: '2026-11-07T18:05:06.000Z' },
    { local: '2026-11-08T00:05:06.1', utc: '2026-11-07T18:05:06.100Z' },
    { local: '2026-11-08T00:05:06.12', utc: '2026-11-07T18:05:06.120Z' },
    { local: '2026-11-08T00:05:06.123', utc: '2026-11-07T18:05:06.123Z' },
  ])('preserves seconds and normalizes fractional precision in $local', ({ local, utc }) => {
    expect(consumedAtFrom(resolveLocalDateTime(local))).toBe(utc)
  })

  it.each(['earlier', 'later'] as const)('keeps a unique time unchanged when the valid choice is %s', choice => {
    expect(consumedAtFrom(resolveLocalDateTime('2026-11-08T12:00', 'Asia/Dhaka', choice)))
      .toBe('2026-11-08T06:00:00.000Z')
  })
})

describe('nonexistent local clock times', () => {
  it.each([
    { label: 'New York spring-forward gap', local: '2026-03-08T02:30', zone: 'America/New_York' },
    { label: 'Lord Howe half-hour gap', local: '2026-10-04T02:15', zone: 'Australia/Lord_Howe' },
    { label: 'São Paulo missing midnight', local: '2018-11-04T00:30', zone: 'America/Sao_Paulo' },
    { label: 'Apia skipped calendar date', local: '2011-12-30T12:00', zone: 'Pacific/Apia' },
  ])('rejects the $label instead of shifting the user’s input', ({ local, zone }) => {
    const result = resolveLocalDateTime(local, zone)
    expectIssues(result, ['consumedAt'])
    expect(result).not.toHaveProperty('candidates')
  })

  it('rejects a missing time even when the caller requests a later occurrence', () => {
    expectIssues(resolveLocalDateTime('2026-03-08T02:30', 'America/New_York', 'later'), ['consumedAt'])
  })

  it.each([
    { local: '2026-03-08T01:30', zone: 'America/New_York', utc: '2026-03-08T06:30:00.000Z' },
    { local: '2026-03-08T03:30', zone: 'America/New_York', utc: '2026-03-08T07:30:00.000Z' },
    { local: '2026-10-04T02:30', zone: 'Australia/Lord_Howe', utc: '2026-10-03T15:30:00.000Z' },
    { local: '2018-11-04T01:00', zone: 'America/Sao_Paulo', utc: '2018-11-04T03:00:00.000Z' },
    { local: '2011-12-31T00:00', zone: 'Pacific/Apia', utc: '2011-12-30T10:00:00.000Z' },
  ])('accepts the real time $local in $zone next to a transition', ({ local, zone, utc }) => {
    expect(consumedAtFrom(resolveLocalDateTime(local, zone))).toBe(utc)
  })
})

describe('repeated local clock times', () => {
  const overlaps = [
    {
      label: 'New York repeated hour', local: '2026-11-01T01:30', zone: 'America/New_York',
      earlier: '2026-11-01T05:30:00.000Z', later: '2026-11-01T06:30:00.000Z',
    },
    {
      label: 'Lord Howe repeated half hour', local: '2026-04-05T01:45', zone: 'Australia/Lord_Howe',
      earlier: '2026-04-04T14:45:00.000Z', later: '2026-04-04T15:15:00.000Z',
    },
    {
      label: 'Havana repeated midnight', local: '2020-11-01T00:30', zone: 'America/Havana',
      earlier: '2020-11-01T04:30:00.000Z', later: '2020-11-01T05:30:00.000Z',
    },
    {
      label: 'Goose Bay historical date rollback', local: '1988-10-29T23:30', zone: 'America/Goose_Bay',
      earlier: '1988-10-30T01:30:00.000Z', later: '1988-10-30T03:30:00.000Z',
    },
  ]

  it.each(overlaps)('requires an explicit choice for the $label', ({ local, zone, earlier, later }) => {
    const result = resolveLocalDateTime(local, zone)
    expectIssues(result, ['disambiguation'])
    if (result.valid === true) throw new Error('Expected ambiguity choices.')
    expect(result.candidates).toEqual([
      { choice: 'earlier', consumedAt: earlier },
      { choice: 'later', consumedAt: later },
    ])
  })

  it.each(overlaps)('resolves both explicit occurrences of the $label', ({ local, zone, earlier, later }) => {
    expect(consumedAtFrom(resolveLocalDateTime(local, zone, 'earlier'))).toBe(earlier)
    expect(consumedAtFrom(resolveLocalDateTime(local, zone, 'later'))).toBe(later)
  })

  it('freezes ambiguity options without changing the caller’s inputs', () => {
    const inputs = Object.freeze(['2026-11-01T01:30', 'America/New_York'] as const)
    const result = resolveLocalDateTime(...inputs)
    expectIssues(result, ['disambiguation'])
    if (result.valid === true || result.candidates === undefined) throw new Error('Expected options.')
    expect(inputs).toEqual(['2026-11-01T01:30', 'America/New_York'])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.issues)).toBe(true)
    expect(Object.isFrozen(result.candidates)).toBe(true)
    expect(Object.isFrozen(result.candidates[0])).toBe(true)
    expect(Reflect.set(result.candidates[0], 'consumedAt', '1970-01-01T00:00:00Z')).toBe(false)
  })
})

describe('invalid input and no fallback values', () => {
  it.each([
    { label: 'a non-leap February 29', value: '2026-02-29T12:00' },
    { label: 'a non-leap century date', value: '1900-02-29T12:00' },
    { label: 'April 31', value: '2026-04-31T12:00' },
    { label: 'month 13', value: '2026-13-01T12:00' },
    { label: 'hour 24', value: '2026-11-08T24:00' },
    { label: 'minute 60', value: '2026-11-08T12:60' },
    { label: 'a leap second', value: '2026-11-08T12:00:60' },
    { label: 'excessive fractional precision', value: '2026-11-08T12:00:00.1234' },
    { label: 'a date without a time', value: '2026-11-08' },
    { label: 'a UTC suffix', value: '2026-11-08T12:00Z' },
    { label: 'a numeric UTC offset', value: '2026-11-08T12:00+06:00' },
    { label: 'surrounding spaces', value: ' 2026-11-08T12:00 ' },
    { label: 'an empty input', value: '' },
    { label: 'a number', value: 0 },
    { label: 'an array', value: [] },
    { label: 'a Date object', value: new Date('2026-11-08T12:00:00Z') },
    { label: 'null', value: null },
    { label: 'a missing value', value: undefined },
  ])('rejects $label instead of substituting another time', ({ value }) => {
    expectIssues(resolveUnknown(value), ['consumedAt'])
  })

  it.each([
    { label: 'an unknown name', zone: 'Mars/Olympus' },
    { label: 'a literal offset', zone: '+06:00' },
    { label: 'a blank zone', zone: '' },
    { label: 'whitespace', zone: ' Asia/Dhaka ' },
    { label: 'a number', zone: 6 },
    { label: 'null', zone: null },
  ])('rejects $label as a timezone instead of using the host timezone', ({ zone }) => {
    expectIssues(resolveUnknown('2026-11-08T12:00', zone), ['timeZone'])
  })

  it.each([
    { label: 'a made-up choice', choice: 'compatible' },
    { label: 'incorrect casing', choice: 'Earlier' },
    { label: 'null', choice: null },
    { label: 'a boolean', choice: true },
  ])('rejects $label as an occurrence choice', ({ choice }) => {
    expectIssues(resolveUnknown('2026-11-08T12:00', 'Asia/Dhaka', choice), ['disambiguation'])
  })

  it('returns all independently invalid input fields', () => {
    expectIssues(resolveUnknown('', 'Mars/Olympus', 'guess'), [
      'consumedAt', 'timeZone', 'disambiguation',
    ])
  })

  it.each([
    { local: '0000-01-01T00:00', zone: 'Etc/GMT-6' },
    { local: '9999-12-31T23:59', zone: 'Etc/GMT+6' },
  ])('rejects $local in $zone when UTC leaves the supported timestamp range', ({ local, zone }) => {
    expectIssues(resolveLocalDateTime(local, zone), ['consumedAt'])
  })

  it('returns the same frozen UTC value on repeated calls with explicit inputs', () => {
    const result = resolveLocalDateTime('2026-11-08T00:05')
    expect(result).toEqual(resolveLocalDateTime('2026-11-08T00:05'))
    expect(Object.isFrozen(result)).toBe(true)
    expect(Reflect.set(result, 'consumedAt', '1970-01-01T00:00:00Z')).toBe(false)
  })

  it('keeps returned occurrence options readonly in TypeScript', () => {
    const checkReadonly = (candidate: LocalTimeCandidate, result: LocalDateTimeResult) => {
      // @ts-expect-error A presented UTC option cannot be reassigned through this interface.
      candidate.consumedAt = '1970-01-01T00:00:00Z'
      if (result.valid === true) {
        expectTypeOf(result.consumedAt).toBeString()
        // @ts-expect-error A success does not expose validation issues.
        void result.issues
      }
    }
    // TypeScript checks this helper without executing it.
    expectTypeOf(checkReadonly).toBeFunction()
  })
})
