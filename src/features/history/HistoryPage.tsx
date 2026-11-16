import { useId, useState } from 'react'
import type { SessionEntryRecord } from '../../app/session/sessionState'
import { calculateDailySummary, calculatePeriodTotals, filterEntriesForPeriod } from '../../domain/reporting'
import type { ConsumptionTotals } from '../../domain/totals'
import type { DailyVolumeGoal } from '../../domain/goals'
import { getCalendarDateRangePeriod, getCalendarPeriodForDate } from '../../domain/periods'
import type { ReportingPeriodKind } from '../../domain/periods'
import { createNutritionReference } from '../../domain/nutrition'
import { formatMoney } from '../../domain/money'
import { calculateEntryTotals } from '../../domain/totals'
import { normalizeUtcTimestamp } from '../../domain/validation'
import { ENGLISH_DISPLAY_LOCALE } from '../preferences/preferences'
import './HistoryPage.css'

interface HistoryPageProps {
  entries: readonly SessionEntryRecord[]
  timeZone: string
  dailyLimitMl: number | null
  headingId?: string
}

const numberFormat = new Intl.NumberFormat(ENGLISH_DISPLAY_LOCALE, { maximumFractionDigits: 2 })
type HistoryPeriodMode = ReportingPeriodKind | 'custom'

function formatNumber(value: number): string {
  return numberFormat.format(value)
}

function currentCivilDate(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat(ENGLISH_DISPLAY_LOCALE, {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date())
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
    return `${value('year').padStart(4, '0')}-${value('month')}-${value('day')}`
  } catch {
    return ''
  }
}

function formatPeriodDate(timestamp: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(ENGLISH_DISPLAY_LOCALE, {
      timeZone, year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date(timestamp))
  } catch {
    return timestamp
  }
}

function formatConsumptionTime(timestamp: string, timeZone: string) {
  const instant = normalizeUtcTimestamp(timestamp)
  if (instant === null) return null

  try {
    const date = new Date(instant)
    const label = new Intl.DateTimeFormat(ENGLISH_DISPLAY_LOCALE, {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
    const offset = new Intl.DateTimeFormat(ENGLISH_DISPLAY_LOCALE, {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value
    return { instant, label, offset }
  } catch {
    return { instant, label: `${instant} (UTC)`, offset: 'UTC' }
  }
}

function EntryCard({ record, timeZone }: { record: SessionEntryRecord; timeZone: string }) {
  const headingId = useId()
  const { entry, nutritionProvenance } = record
  const referenceResult = createNutritionReference(nutritionProvenance.reference)
  const totalsResult = calculateEntryTotals(entry)
  const formattedPrice = formatMoney({ amountMinor: entry.totalPriceMinor, currency: entry.currency }, ENGLISH_DISPLAY_LOCALE)
  const consumed = formatConsumptionTime(entry.consumedAt, timeZone)
  const product = referenceResult.valid ? referenceResult.reference.productDescription : 'Product details unavailable'
  const totals = totalsResult.valid ? totalsResult.totals : null
  const price = formattedPrice.valid
    ? formattedPrice.formatted ?? `Unknown (${entry.currency})`
    : `Price unavailable (${entry.currency})`

  return (
    <li className="history-entry-list__item">
      <article className="history-entry" aria-labelledby={headingId}>
        <header className="history-entry__identity">
          <div>
            <h2 id={headingId}>{product}</h2>
            <p className="history-entry__provenance">
              {nutritionProvenance.kind === 'user-provided'
                ? 'User-provided — not independently verified.'
                : 'Reviewed reference.'}
            </p>
            <p className="history-entry__version">Nutrition version {entry.nutrition.referenceVersion}</p>
          </div>
          <p className="history-entry__time">
            <span>Consumed </span>
            {consumed === null
              ? <time dateTime={entry.consumedAt}>{entry.consumedAt} (UTC)</time>
              : <time dateTime={consumed.instant}>{consumed.label}</time>}
            <span className="history-entry__offset">UTC offset: {consumed?.offset ?? 'UTC'}</span>
          </p>
        </header>

        <dl className="history-entry__metrics">
          <div><dt>Quantity</dt><dd>{formatNumber(entry.quantity)}</dd></div>
          <div><dt>Serving size</dt><dd>{formatNumber(entry.servingMl)} ml</dd></div>
          <div><dt>Total volume</dt><dd>{totals === null ? 'Unavailable' : `${formatNumber(totals.volumeMl)} ml`}</dd></div>
          <div><dt>Estimated sugar</dt><dd>{totals === null ? 'Unavailable' : `${formatNumber(totals.sugarGrams)} g`}</dd></div>
          <div><dt>Coke-only calories</dt><dd>{totals === null ? 'Unavailable' : `${formatNumber(totals.kcal)} kcal`}</dd></div>
          <div><dt>Total price</dt><dd>{price}</dd></div>
        </dl>

        {referenceResult.valid && (
          <details className="history-entry__source">
            <summary>Nutrition source details</summary>
            <p>Reference {entry.nutrition.referenceId} · Version {entry.nutrition.referenceVersion}</p>
            <p>{referenceResult.reference.source.url === undefined
              ? referenceResult.reference.source.label
              : <a href={referenceResult.reference.source.url} target="_blank" rel="noopener noreferrer">
                  {referenceResult.reference.source.label}
                </a>}</p>
            <dl>
              <div><dt>Sugar per 100 ml</dt><dd>{formatNumber(entry.nutrition.sugarGramsPer100Ml)} g</dd></div>
              <div><dt>Calories per 100 ml</dt><dd>{formatNumber(entry.nutrition.kcalPer100Ml)} kcal</dd></div>
            </dl>
          </details>
        )}
      </article>
    </li>
  )
}

function HistorySummary({
  totals, goal, kind,
}: { totals: ConsumptionTotals; goal: DailyVolumeGoal | null; kind: HistoryPeriodMode }) {
  const summaryId = useId()
  return (
    <section className="history-summary" aria-labelledby={summaryId}>
      <div className="history-summary__heading">
        <div>
          <p className="history-eyebrow">{kind === 'custom' ? 'Selected custom date range' : 'Selected calendar period'}</p>
          <h2 id={summaryId}>Period summary</h2>
        </div>
        <p className="history-summary__count">
          {totals.entryCount} {totals.entryCount === 1 ? 'entry' : 'entries'} · {totals.drinkCount} {totals.drinkCount === 1 ? 'drink' : 'drinks'}
        </p>
      </div>

      <dl className="history-summary__metrics">
        <div><dt>Total volume</dt><dd>{formatNumber(totals.volumeMl)} ml</dd></div>
        <div><dt>Estimated sugar</dt><dd>{formatNumber(totals.sugarGrams)} g</dd></div>
        <div><dt>Coke-only calories</dt><dd>{formatNumber(totals.kcal)} kcal</dd></div>
        <div><dt>Entries with unknown prices</dt><dd>{formatNumber(totals.unknownPriceEntryCount)}</dd></div>
      </dl>

      <section className="history-summary__spending" aria-labelledby={`${summaryId}-spending`}>
        <h3 id={`${summaryId}-spending`}>Spending by currency</h3>
        {totals.spendingByCurrency.length === 0 ? (
          <p>No prices recorded in this period.</p>
        ) : (
          <ul>
            {totals.spendingByCurrency.map(row => {
              const formatted = formatMoney({ amountMinor: row.knownAmountMinor, currency: row.currency }, ENGLISH_DISPLAY_LOCALE)
              const knownAmount = formatted.valid ? formatted.formatted ?? `Unavailable (${row.currency})` : `Unavailable (${row.currency})`
              const incomplete = row.unknownPriceEntryCount > 0
              return (
                <li key={row.currency}>
                  <span>{row.currency}</span>
                  <span>Known subtotal: {knownAmount}{incomplete ? ' · incomplete' : ' · complete'}</span>
                  {incomplete && <span>{row.unknownPriceEntryCount} {row.unknownPriceEntryCount === 1 ? 'entry has' : 'entries have'} unknown price</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {kind === 'day' && goal !== null && (
        <section className="history-goal" aria-label="Daily volume goal status">
          <h3>Daily volume goal</h3>
          {goal.state === 'disabled' ? <p>Goal disabled.</p> : (
            <p>
              {goal.state === 'within' ? `${formatNumber(goal.remainingMl)} ml remaining` :
                goal.state === 'reached' ? 'Daily limit reached.' : `${formatNumber(goal.excessMl)} ml above your daily limit.`}
            </p>
          )}
        </section>
      )}
      <p className="history-summary__calorie-note">Calories are estimated from each entry’s saved Coke nutrition values.</p>
    </section>
  )
}

function HistoryPage({ entries, timeZone, dailyLimitMl = null, headingId = 'view-heading' }: HistoryPageProps) {
  const listId = useId()
  const [kind, setKind] = useState<HistoryPeriodMode>('day')
  const [selectedDate, setSelectedDate] = useState(() => currentCivilDate(timeZone))
  const [customDates, setCustomDates] = useState<{ start: string; end: string } | null>(null)
  const customStartDate = customDates?.start ?? selectedDate
  const customEndDate = customDates?.end ?? selectedDate
  const periodResult = kind === 'custom'
    ? getCalendarDateRangePeriod(customStartDate, customEndDate, timeZone)
    : getCalendarPeriodForDate(selectedDate, kind, timeZone)
  const drinkEntries = entries.map(record => record.entry)

  const dailyReport = periodResult.valid && kind === 'day'
    ? calculateDailySummary(drinkEntries, periodResult.period.startUtc, dailyLimitMl, timeZone)
    : null
  const rangeReport = periodResult.valid && kind !== 'day'
    ? calculatePeriodTotals(drinkEntries, periodResult.period)
    : null
  const report = dailyReport ?? rangeReport
  const selection = periodResult.valid
    ? filterEntriesForPeriod(drinkEntries, periodResult.period)
    : null

  const totals = report?.valid ? report.totals : null
  const goal = dailyReport?.valid ? dailyReport.goal : null
  const selectedRecords = selection?.valid
    ? selection.originalIndices.map(index => entries[index]).reverse()
    : []
  const errorMessage = !periodResult.valid
    ? periodResult.issues.map(issue => issue.message).join(' ')
    : report?.valid === false
      ? report.issues.map(issue => issue.message).join(' ')
      : selection?.valid === false
        ? selection.issues.map(issue => issue.message).join(' ')
        : null

  return (
    <div className="history-page">
      <header className="history-page__heading">
        <div>
          <p className="history-eyebrow">Your habits, with a little perspective</p>
          <h1 id={headingId}>History<span aria-hidden="true">.</span></h1>
          <p>Review drinks saved during this session, newest saved first.</p>
        </div>
        <span className="history-page__timezone">Times shown in {timeZone}</span>
      </header>

      <p className="history-page__temporary">
        These entries are temporary. Refreshing or closing the application clears this session’s history and preferences.
      </p>

      <section className={`history-period-controls${kind === 'custom' ? ' history-period-controls--custom' : ''}`} aria-labelledby="history-period-heading">
        <div>
          <p className="history-eyebrow">Explore your history</p>
          <h2 id="history-period-heading">Choose a period</h2>
        </div>
        <fieldset className="history-period-controls__modes">
          <legend>Calendar period</legend>
          {(['day', 'week', 'month', 'custom'] as const).map(value => (
            <label key={value}>
              <input type="radio" name="history-period-kind" value={value} checked={kind === value}
                onChange={() => {
                  if (value === 'custom' && customDates === null) {
                    setCustomDates({ start: selectedDate, end: selectedDate })
                  }
                  setKind(value)
                }} />
              <span>{value === 'day' ? 'Daily' : value === 'week' ? 'Weekly' : value === 'month' ? 'Monthly' : 'Custom'}</span>
            </label>
          ))}
        </fieldset>
        {kind === 'custom' ? (
          <div className="history-period-controls__custom-dates">
            <label className="history-period-controls__date">
              Start date
              <input type="date" value={customStartDate}
                onChange={event => {
                  const value = event.currentTarget.value
                  setCustomDates(previous => ({ start: value, end: previous?.end ?? selectedDate }))
                }} />
            </label>
            <label className="history-period-controls__date">
              End date
              <input type="date" value={customEndDate}
                onChange={event => {
                  const value = event.currentTarget.value
                  setCustomDates(previous => ({ start: previous?.start ?? selectedDate, end: value }))
                }} />
            </label>
            <p>Both selected dates are included.</p>
          </div>
        ) : (
          <label className="history-period-controls__date">
            Reference date
            <input type="date" value={selectedDate} onChange={event => setSelectedDate(event.currentTarget.value)} />
          </label>
        )}
        {errorMessage !== null && (
          <p className="history-period-error" role="alert">History for this period is unavailable. {errorMessage}</p>
        )}
      </section>

      {periodResult.valid && (
        <p className="history-period-range">
          {kind === 'custom' ? (
            <>From <time dateTime={customStartDate}>{customStartDate}</time> through <time dateTime={customEndDate}>{customEndDate}</time> (inclusive) in {timeZone}.</>
          ) : (
            <>
              <span>Period in {timeZone}: </span>
              <time dateTime={periodResult.period.startUtc}>{formatPeriodDate(periodResult.period.startUtc, timeZone)}</time>
              {' – '}
              <time dateTime={periodResult.period.endUtc}>{formatPeriodDate(periodResult.period.endUtc, timeZone)} (exclusive)</time>
            </>
          )}
        </p>
      )}

      {errorMessage === null && totals !== null && (
        <HistorySummary totals={totals} goal={goal} kind={kind} />
      )}

      <section className="history-list" aria-labelledby={listId}>
        <div className="history-list__heading">
          <div>
            <p className="history-eyebrow">Saved in this period</p>
            <h2 id={listId}>Period entries</h2>
          </div>
          <span>{errorMessage === null ? `${selectedRecords.length} ${selectedRecords.length === 1 ? 'entry' : 'entries'}` : 'Unavailable'}</span>
        </div>

        {errorMessage !== null ? (
          <p className="history-list__empty">Entries are hidden until the selected period can be validated.</p>
        ) : selectedRecords.length === 0 ? (
          <p className="history-list__empty">
            {entries.length === 0
              ? 'No drinks saved this session yet. Log a drink to start your history.'
              : 'No drinks were saved in this period. The session may contain drinks from other dates; try another date or period.'}
          </p>
        ) : (
          <ol className="history-entry-list">
            {selectedRecords.map(record => <EntryCard key={record.entry.id} record={record} timeZone={timeZone} />)}
          </ol>
        )}
      </section>
    </div>
  )
}

export default HistoryPage
