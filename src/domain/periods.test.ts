import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  getCalendarDayPeriod,
  getCalendarMonthPeriod,
  getCalendarPeriodForDate,
  getCalendarWeekPeriod,
} from './periods'
import type { PeriodResult, ReportingPeriod, ReportingPeriodKind } from './periods'

function periodFrom(result: PeriodResult): ReportingPeriod {
  expect(result.valid).toBe(true)
  if (result.valid === false) throw new Error('Expected a valid calendar reporting period.')
  return result.period
}

function expectPeriod(
  result: PeriodResult,
  kind: ReportingPeriodKind,
  timeZone: string,
  startUtc: string,
  endUtc: string,
) {
  const period = periodFrom(result)
  expect(period).toEqual({ kind, timeZone, startUtc, endUtc })
  return period
}

function expectIssueFields(result: PeriodResult, fields: readonly string[]) {
  expect(result.valid).toBe(false)
  if (result.valid === true) throw new Error('Expected calendar validation issues.')
  expect(result).not.toHaveProperty('period')
  expect(result.issues.map(issue => issue.field).sort()).toEqual([...fields].sort())
  for (const issue of result.issues) {
    expect(issue.source).toBe('period')
    expect(issue.entryIndex).toBeNull()
    expect(issue.message.trim()).not.toBe('')
  }
}

describe('calendar periods from civil dates', () => {
  it('interprets a daily date in Dhaka rather than as UTC midnight', () => {
    expectPeriod(getCalendarPeriodForDate('2026-11-13', 'day', 'Asia/Dhaka'), 'day', 'Asia/Dhaka',
      '2026-11-12T18:00:00.000Z', '2026-11-13T18:00:00.000Z')
  })

  it('interprets a daily date in Tokyo', () => {
    expectPeriod(getCalendarPeriodForDate('2026-11-13', 'day', 'Asia/Tokyo'), 'day', 'Asia/Tokyo',
      '2026-11-12T15:00:00.000Z', '2026-11-13T15:00:00.000Z')
  })

  it('uses Monday through Sunday for a weekly date selection', () => {
    expectPeriod(getCalendarPeriodForDate('2026-11-14', 'week', 'Asia/Dhaka'), 'week', 'Asia/Dhaka',
      '2026-11-08T18:00:00.000Z', '2026-11-15T18:00:00.000Z')
  })

  it('handles leap day and the adjacent month boundary', () => {
    expectPeriod(getCalendarPeriodForDate('2024-02-29', 'month', 'Asia/Dhaka'), 'month', 'Asia/Dhaka',
      '2024-01-31T18:00:00.000Z', '2024-02-29T18:00:00.000Z')
  })

  it('handles a selected date at a year boundary', () => {
    expectPeriod(getCalendarPeriodForDate('2026-12-31', 'month', 'UTC'), 'month', 'UTC',
      '2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')
  })

  it.each([
    { date: '2026-03-08', start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z', hours: 23 },
    { date: '2026-11-01', start: '2026-11-01T04:00:00.000Z', end: '2026-11-02T05:00:00.000Z', hours: 25 },
  ])('uses independently resolved New York boundaries for $date', ({ date, start, end, hours }) => {
    const period = periodFrom(getCalendarPeriodForDate(date, 'day', 'America/New_York'))
    expectPeriod({ valid: true, period }, 'day', 'America/New_York', start, end)
    expect((Date.parse(period.endUtc) - Date.parse(period.startUtc)) / 3600000).toBe(hours)
  })

  it('uses an exclusive next-calendar-date boundary', () => {
    const period = periodFrom(getCalendarPeriodForDate('2026-11-13', 'day', 'Asia/Tokyo'))
    expect(Date.parse(period.endUtc) - Date.parse(period.startUtc)).toBe(24 * 60 * 60 * 1000)
    expectPeriod(getCalendarPeriodForDate('2026-11-14', 'day', 'Asia/Tokyo'), 'day', 'Asia/Tokyo',
      period.endUtc, '2026-11-14T15:00:00.000Z')
  })

  it.each([
    '2026-2-03', '2026/02/03', ' 2026-02-03', '2026-02-03 ', '2026-02-30', '2026-02-29', '',
  ])('rejects malformed or impossible civil date %s', date => {
    expectIssueFields(getCalendarPeriodForDate(date, 'day', 'UTC'), ['period'])
  })

  it('rejects a skipped civil date in Apia instead of normalizing it to the next date', () => {
    expectIssueFields(getCalendarPeriodForDate('2011-12-30', 'day', 'Pacific/Apia'), ['period'])
  })

  it('rejects unsupported period kinds and timezones', () => {
    expectIssueFields(Reflect.apply(getCalendarPeriodForDate, undefined,
      ['2026-11-13', 'year', 'Asia/Dhaka']), ['kind'])
    expectIssueFields(getCalendarPeriodForDate('2026-11-13', 'day', 'Mars/Olympus'), ['timeZone'])
  })

  it('leaves the existing instant-based APIs using the same period boundaries', () => {
    expect(getCalendarDayPeriod('2026-11-07T12:00:00Z', 'Asia/Dhaka')).toEqual(
      getCalendarPeriodForDate('2026-11-07', 'day', 'Asia/Dhaka'),
    )
    expect(getCalendarWeekPeriod('2026-11-08T12:00:00Z', 'Asia/Dhaka')).toEqual(
      getCalendarPeriodForDate('2026-11-08', 'week', 'Asia/Dhaka'),
    )
    expect(getCalendarMonthPeriod('2024-02-29T12:00:00Z', 'Asia/Dhaka')).toEqual(
      getCalendarPeriodForDate('2024-02-29', 'month', 'Asia/Dhaka'),
    )
  })
})

describe('calendar day boundaries', () => {
  it('defaults to Dhaka and returns the whole local day as normalized UTC boundaries', () => {
    expectPeriod(getCalendarDayPeriod('2026-11-07T12:00:00Z'), 'day', 'Asia/Dhaka',
      '2026-11-06T18:00:00.000Z', '2026-11-07T18:00:00.000Z')
  })

  it.each([
    {
      label: 'one millisecond before Dhaka midnight',
      referenceUtc: '2026-11-06T17:59:59.999Z',
      startUtc: '2026-11-05T18:00:00.000Z',
      endUtc: '2026-11-06T18:00:00.000Z',
    },
    {
      label: 'exactly at Dhaka midnight',
      referenceUtc: '2026-11-06T18:00:00Z',
      startUtc: '2026-11-06T18:00:00.000Z',
      endUtc: '2026-11-07T18:00:00.000Z',
    },
    {
      label: 'one millisecond after Dhaka midnight',
      referenceUtc: '2026-11-06T18:00:00.001Z',
      startUtc: '2026-11-06T18:00:00.000Z',
      endUtc: '2026-11-07T18:00:00.000Z',
    },
  ])('selects the right calendar date $label', ({ referenceUtc, startUtc, endUtc }) => {
    expectPeriod(getCalendarDayPeriod(referenceUtc), 'day', 'Asia/Dhaka', startUtc, endUtc)
  })

  it('uses the explicitly configured timezone instead of the host timezone', () => {
    expectPeriod(getCalendarDayPeriod('2026-11-07T12:00:00Z', 'UTC'), 'day', 'UTC',
      '2026-11-07T00:00:00.000Z', '2026-11-08T00:00:00.000Z')
  })

  it('accepts an explicit zero offset and normalizes the output to Z timestamps', () => {
    expect(getCalendarDayPeriod('2026-11-07T12:00:00+00:00')).toEqual(
      getCalendarDayPeriod('2026-11-07T12:00:00.000Z'),
    )
  })

  it('keeps a four-digit year below 100 instead of applying Date constructor year-1900 rules', () => {
    expectPeriod(getCalendarDayPeriod('0099-01-02T12:00:00Z', 'UTC'), 'day', 'UTC',
      '0099-01-02T00:00:00.000Z', '0099-01-03T00:00:00.000Z')
  })
})

describe('calendar week boundaries', () => {
  it('starts on Monday and ends at the following Monday rather than Sunday night', () => {
    expectPeriod(getCalendarWeekPeriod('2026-11-08T12:00:00Z'), 'week', 'Asia/Dhaka',
      '2026-11-01T18:00:00.000Z', '2026-11-08T18:00:00.000Z')
  })

  it('moves to a new week exactly at Monday midnight in Dhaka', () => {
    expectPeriod(getCalendarWeekPeriod('2026-11-08T18:00:00Z'), 'week', 'Asia/Dhaka',
      '2026-11-08T18:00:00.000Z', '2026-11-15T18:00:00.000Z')
  })

  it('keeps the Monday boundary in the previous year when the week spans New Year', () => {
    expectPeriod(getCalendarWeekPeriod('2027-01-01T12:00:00Z'), 'week', 'Asia/Dhaka',
      '2026-12-27T18:00:00.000Z', '2027-01-03T18:00:00.000Z')
  })

  it('uses seven calendar dates across New York spring DST rather than 168 elapsed hours', () => {
    const period = expectPeriod(getCalendarWeekPeriod('2026-03-08T12:00:00Z', 'America/New_York'),
      'week', 'America/New_York', '2026-03-02T05:00:00.000Z', '2026-03-09T04:00:00.000Z')
    expect((Date.parse(period.endUtc) - Date.parse(period.startUtc)) / 3600000).toBe(167)
  })

  it('keeps the calendar week containing Apia’s skipped date without adding a fixed week duration', () => {
    const period = expectPeriod(getCalendarWeekPeriod('2011-12-29T12:00:00Z', 'Pacific/Apia'),
      'week', 'Pacific/Apia', '2011-12-26T10:00:00.000Z', '2012-01-01T10:00:00.000Z')
    expect((Date.parse(period.endUtc) - Date.parse(period.startUtc)) / 3600000).toBe(144)
  })
})

describe('calendar month boundaries', () => {
  it.each([
    {
      label: 'leap-year February', referenceUtc: '2024-02-29T12:00:00Z',
      startUtc: '2024-01-31T18:00:00.000Z', endUtc: '2024-02-29T18:00:00.000Z',
    },
    {
      label: 'non-leap February', referenceUtc: '2026-02-28T12:00:00Z',
      startUtc: '2026-01-31T18:00:00.000Z', endUtc: '2026-02-28T18:00:00.000Z',
    },
    {
      label: 'a 30-day month', referenceUtc: '2026-11-30T12:00:00Z',
      startUtc: '2026-10-31T18:00:00.000Z', endUtc: '2026-11-30T18:00:00.000Z',
    },
    {
      label: 'December ending in the next year', referenceUtc: '2026-12-31T12:00:00Z',
      startUtc: '2026-11-30T18:00:00.000Z', endUtc: '2026-12-31T18:00:00.000Z',
    },
  ])('uses the first date of each adjacent month for $label', ({ referenceUtc, startUtc, endUtc }) => {
    expectPeriod(getCalendarMonthPeriod(referenceUtc), 'month', 'Asia/Dhaka', startUtc, endUtc)
  })

  it('uses the new month exactly at local midnight on its first date', () => {
    expectPeriod(getCalendarMonthPeriod('2026-02-28T18:00:00Z'), 'month', 'Asia/Dhaka',
      '2026-02-28T18:00:00.000Z', '2026-03-31T18:00:00.000Z')
  })

  it('constructs New York month boundaries on their own sides of the DST change', () => {
    expectPeriod(getCalendarMonthPeriod('2026-03-15T12:00:00Z', 'America/New_York'),
      'month', 'America/New_York', '2026-03-01T05:00:00.000Z', '2026-04-01T04:00:00.000Z')
  })

  it('keeps Apia’s December calendar boundaries when an entire local date was skipped', () => {
    expectPeriod(getCalendarMonthPeriod('2011-12-29T12:00:00Z', 'Pacific/Apia'),
      'month', 'Pacific/Apia', '2011-12-01T10:00:00.000Z', '2011-12-31T10:00:00.000Z')
  })
})

describe('unusual timezone transitions', () => {
  // Exact instants below were checked against the runtime's IANA timezone data using Intl.
  // These expectations do not calculate boundaries using the implementation under test.
  it.each([
    {
      label: 'New York’s 23-hour spring day', timeZone: 'America/New_York',
      referenceUtc: '2026-03-08T12:00:00Z', startUtc: '2026-03-08T05:00:00.000Z',
      endUtc: '2026-03-09T04:00:00.000Z', hours: 23,
    },
    {
      label: 'New York’s 25-hour autumn day', timeZone: 'America/New_York',
      referenceUtc: '2026-11-01T12:00:00Z', startUtc: '2026-11-01T04:00:00.000Z',
      endUtc: '2026-11-02T05:00:00.000Z', hours: 25,
    },
    {
      label: 'Lord Howe’s 24.5-hour backward transition', timeZone: 'Australia/Lord_Howe',
      referenceUtc: '2026-04-05T12:00:00Z', startUtc: '2026-04-04T13:00:00.000Z',
      endUtc: '2026-04-05T13:30:00.000Z', hours: 24.5,
    },
    {
      label: 'Lord Howe’s 23.5-hour forward transition', timeZone: 'Australia/Lord_Howe',
      referenceUtc: '2026-10-04T12:00:00Z', startUtc: '2026-10-03T13:30:00.000Z',
      endUtc: '2026-10-04T13:00:00.000Z', hours: 23.5,
    },
    {
      label: 'São Paulo’s missing midnight', timeZone: 'America/Sao_Paulo',
      referenceUtc: '2018-11-04T12:00:00Z', startUtc: '2018-11-04T03:00:00.000Z',
      endUtc: '2018-11-05T02:00:00.000Z', hours: 23,
    },
    {
      label: 'Havana’s repeated midnight', timeZone: 'America/Havana',
      referenceUtc: '2020-11-01T12:00:00Z', startUtc: '2020-11-01T04:00:00.000Z',
      endUtc: '2020-11-02T05:00:00.000Z', hours: 25,
    },
    {
      label: 'Apia’s last day before the skipped calendar date', timeZone: 'Pacific/Apia',
      referenceUtc: '2011-12-29T12:00:00Z', startUtc: '2011-12-29T10:00:00.000Z',
      endUtc: '2011-12-30T10:00:00.000Z', hours: 24,
    },
    {
      label: 'Apia’s first day after the skipped calendar date', timeZone: 'Pacific/Apia',
      referenceUtc: '2011-12-30T12:00:00Z', startUtc: '2011-12-30T10:00:00.000Z',
      endUtc: '2011-12-31T10:00:00.000Z', hours: 24,
    },
  ])('uses the first valid instants for $label', ({ referenceUtc, timeZone, startUtc, endUtc, hours }) => {
    const period = expectPeriod(getCalendarDayPeriod(referenceUtc, timeZone),
      'day', timeZone, startUtc, endUtc)
    expect((Date.parse(period.endUtc) - Date.parse(period.startUtc)) / 3600000).toBe(hours)
  })

  it('selects Havana’s earliest midnight for references in either repeated hour', () => {
    const firstOccurrence = getCalendarDayPeriod('2020-11-01T04:30:00Z', 'America/Havana')
    const secondOccurrence = getCalendarDayPeriod('2020-11-01T05:30:00Z', 'America/Havana')
    expectPeriod(firstOccurrence, 'day', 'America/Havana',
      '2020-11-01T04:00:00.000Z', '2020-11-02T05:00:00.000Z')
    expect(secondOccurrence).toEqual(firstOccurrence)
  })

  it('joins the days around Apia’s skipped date at the same exclusive/inclusive boundary', () => {
    const before = periodFrom(getCalendarDayPeriod('2011-12-29T12:00:00Z', 'Pacific/Apia'))
    const after = periodFrom(getCalendarDayPeriod('2011-12-30T12:00:00Z', 'Pacific/Apia'))
    expect(before.endUtc).toBe(after.startUtc)
    expect(before.endUtc).toBe('2011-12-30T10:00:00.000Z')
  })
})

describe('period input validation and immutable results', () => {
  it.each([
    { label: 'a date without time', value: '2026-11-07' },
    { label: 'a time without timezone', value: '2026-11-07T12:00:00' },
    { label: 'a non-UTC offset', value: '2026-11-07T12:00:00+06:00' },
    { label: 'an unknown -00:00 offset', value: '2026-11-07T12:00:00-00:00' },
    { label: 'an impossible leap date', value: '2026-02-29T12:00:00Z' },
    { label: 'an impossible month date', value: '2026-04-31T12:00:00Z' },
    { label: 'hour 24', value: '2026-11-07T24:00:00Z' },
    { label: 'excessive fractional precision', value: '2026-11-07T12:00:00.1234Z' },
    { label: 'an empty string', value: '' },
    { label: 'a numeric timestamp', value: 0 },
    { label: 'null', value: null },
    { label: 'an array', value: [] },
    { label: 'a missing timestamp', value: undefined },
  ])('rejects $label rather than guessing a reference instant', ({ value }) => {
    const result = Reflect.apply(getCalendarDayPeriod, undefined, [value, 'Asia/Dhaka'])
    expectIssueFields(result, ['referenceUtc'])
  })

  it.each([
    { label: 'an unknown zone', value: 'Mars/Olympus' },
    { label: 'an offset instead of a named zone', value: '+06:00' },
    { label: 'a compact offset', value: '-0600' },
    { label: 'an empty zone', value: '' },
    { label: 'surrounding whitespace', value: ' Asia/Dhaka ' },
    { label: 'a number', value: 6 },
    { label: 'null', value: null },
  ])('rejects $label instead of using the host timezone', ({ value }) => {
    const result = Reflect.apply(getCalendarDayPeriod, undefined, ['2026-11-07T12:00:00Z', value])
    expectIssueFields(result, ['timeZone'])
  })

  it.each([
    { label: 'day', getPeriod: getCalendarDayPeriod },
    { label: 'week', getPeriod: getCalendarWeekPeriod },
    { label: 'month', getPeriod: getCalendarMonthPeriod },
  ])('validates both reference and timezone for a $label period', ({ getPeriod }) => {
    expectIssueFields(getPeriod('2026-02-30T12:00:00Z', 'Mars/Olympus'), [
      'referenceUtc', 'timeZone',
    ])
  })

  it('rejects a month whose exclusive end would leave the four-digit UTC timestamp range', () => {
    expectIssueFields(getCalendarMonthPeriod('9999-12-15T12:00:00Z', 'UTC'), ['endUtc'])
  })

  it('rejects a week whose Monday start would leave the four-digit UTC timestamp range', () => {
    expectIssueFields(getCalendarWeekPeriod('0000-01-01T12:00:00Z', 'UTC'), ['startUtc'])
  })

  it.each([
    { label: 'day', getPeriod: getCalendarDayPeriod },
    { label: 'week', getPeriod: getCalendarWeekPeriod },
    { label: 'month', getPeriod: getCalendarMonthPeriod },
  ])('returns a frozen $label period with strings rather than mutable Date instances', ({ getPeriod }) => {
    const period = periodFrom(getPeriod('2026-11-07T12:00:00Z'))
    const before = { ...period }
    expect(Object.isFrozen(period)).toBe(true)
    expect(typeof period.startUtc).toBe('string')
    expect(typeof period.endUtc).toBe('string')
    expect(period.startUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(period.endUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Reflect.set(period, 'startUtc', '1970-01-01T00:00:00.000Z')).toBe(false)
    expect(period).toEqual(before)
  })

  it('is deterministic for an explicitly supplied reference instant and timezone', () => {
    expect(getCalendarDayPeriod('2020-11-01T05:30:00Z', 'America/Havana')).toEqual(
      getCalendarDayPeriod('2020-11-01T05:30:00Z', 'America/Havana'),
    )
  })

  it('keeps period properties readonly in TypeScript', () => {
    const checkReadonlyContract = (period: ReportingPeriod) => {
      // @ts-expect-error Returned boundary strings cannot be reassigned through this interface.
      period.startUtc = '1970-01-01T00:00:00.000Z'
      // @ts-expect-error A reporting period cannot be relabeled with another timezone.
      period.timeZone = 'UTC'
    }
    // TypeScript checks the helper during npm test; the helper is never executed.
    expectTypeOf(checkReadonlyContract).toBeFunction()
  })
})
