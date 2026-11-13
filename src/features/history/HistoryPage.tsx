import { useId } from 'react'
import type { SessionEntryRecord } from '../../app/session/sessionState'
import { createNutritionReference } from '../../domain/nutrition'
import { formatMoney } from '../../domain/money'
import { calculateConsumptionTotals, calculateEntryTotals } from '../../domain/totals'
import { normalizeUtcTimestamp } from '../../domain/validation'
import { ENGLISH_DISPLAY_LOCALE } from '../preferences/preferences'
import './HistoryPage.css'

interface HistoryPageProps {
  /** The frozen session records are the sole source for this read-only view. */
  entries: readonly SessionEntryRecord[]
  timeZone: string
}

const numberFormat = new Intl.NumberFormat(ENGLISH_DISPLAY_LOCALE, { maximumFractionDigits: 2 })

function formatNumber(value: number): string {
  return numberFormat.format(value)
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
            <span className="history-entry__offset">
              UTC offset: {consumed?.offset ?? 'UTC'}
            </span>
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

function HistorySummary({ entries }: { entries: readonly SessionEntryRecord[] }) {
  const summaryId = useId()
  const result = calculateConsumptionTotals(entries.map(record => record.entry))

  if (result.valid === false) {
    return (
      <section className="history-summary" aria-labelledby={summaryId}>
        <h2 id={summaryId}>Session summary</h2>
        <p role="alert">Summary unavailable because one or more saved entries could not be validated.</p>
      </section>
    )
  }

  const { totals } = result
  return (
    <section className="history-summary" aria-labelledby={summaryId}>
      <div className="history-summary__heading">
        <div>
          <p className="history-eyebrow">So far this session</p>
          <h2 id={summaryId}>Session summary</h2>
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
          <p>No prices recorded yet.</p>
        ) : (
          <ul>
            {totals.spendingByCurrency.map(row => {
              const formatted = formatMoney({ amountMinor: row.knownAmountMinor, currency: row.currency }, ENGLISH_DISPLAY_LOCALE)
              const knownAmount = formatted.valid ? formatted.formatted ?? `Unavailable (${row.currency})` : `Unavailable (${row.currency})`
              const incomplete = row.unknownPriceEntryCount > 0
              return (
                <li key={row.currency}>
                  <span>{row.currency}</span>
                  {' '}
                  <span>Known subtotal: {knownAmount}{incomplete ? ' · incomplete' : ''}</span>
                  {incomplete && <>
                    {' '}
                    <span>{row.unknownPriceEntryCount} {row.unknownPriceEntryCount === 1 ? 'entry has' : 'entries have'} unknown price</span>
                  </>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <p className="history-summary__calorie-note">Calories are estimated from each entry’s saved Coke nutrition values.</p>
    </section>
  )
}

function HistoryPage({ entries, timeZone }: HistoryPageProps) {
  const listId = useId()
  // Entries are appended only after an accepted save. Reverse a copy to preserve that array.
  const newestFirst = [...entries].reverse()

  return (
    <div className="history-page">
      <header className="history-page__heading">
        <div>
          <p className="history-eyebrow">Your habits, with a little perspective</p>
          <h1 id="view-heading">History<span aria-hidden="true">.</span></h1>
          <p>Review drinks saved during this session, newest saved first.</p>
        </div>
        <span className="history-page__timezone">Times shown in {timeZone}</span>
      </header>

      <p className="history-page__temporary">
        These entries are temporary. Refreshing or closing the application clears this session’s history and preferences.
      </p>

      <HistorySummary entries={entries} />

      <section className="history-list" aria-labelledby={listId}>
        <div className="history-list__heading">
          <div>
            <p className="history-eyebrow">Saved in this session</p>
            <h2 id={listId}>All entries</h2>
          </div>
          <span>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
        </div>

        {newestFirst.length === 0 ? (
          <p className="history-list__empty">No drinks saved this session yet. Log a drink to start your history.</p>
        ) : (
          <ol className="history-entry-list">
            {newestFirst.map(record => <EntryCard key={record.entry.id} record={record} timeZone={timeZone} />)}
          </ol>
        )}
      </section>
    </div>
  )
}

export default HistoryPage
