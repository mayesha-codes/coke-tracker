import { useId } from 'react'
import type { SessionEntryRecord } from '../../app/session/sessionState'
import { formatMoney } from '../../domain/money'
import { createNutritionReference } from '../../domain/nutrition'
import { calculateEntryTotals } from '../../domain/totals'
import { normalizeUtcTimestamp } from '../../domain/validation'
import { ENGLISH_DISPLAY_LOCALE } from '../preferences/preferences'

interface RecentSessionEntriesProps {
  entries: readonly SessionEntryRecord[]
  timeZone: string
}

/** Formatting changes the display only, never the stored UTC instant. */
function consumptionTime(timestamp: string, timeZone: string) {
  try {
    const date = new Date(timestamp)
    const label = new Intl.DateTimeFormat(ENGLISH_DISPLAY_LOCALE, {
      timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(date)
    const offset = new Intl.DateTimeFormat(ENGLISH_DISPLAY_LOCALE, {
      timeZone, timeZoneName: 'shortOffset',
    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value
    return { label, offset }
  } catch {
    return null
  }
}

function RecentEntry({ record, timeZone }: { record: SessionEntryRecord; timeZone: string }) {
  const headingId = useId()
  const { entry, nutritionProvenance } = record
  const reference = createNutritionReference(nutritionProvenance.reference)
  const totals = calculateEntryTotals(entry)
  const money = formatMoney({ amountMinor: entry.totalPriceMinor, currency: entry.currency }, ENGLISH_DISPLAY_LOCALE)
  const timestamp = normalizeUtcTimestamp(entry.consumedAt)
  const consumed = timestamp === null ? null : consumptionTime(timestamp, timeZone)
  const number = new Intl.NumberFormat(ENGLISH_DISPLAY_LOCALE)

  return (
    <li className="logging-recent__item">
      <article className="logging-recent__entry" aria-labelledby={headingId}>
        <div className="logging-recent__identity">
          <h3 id={headingId}>{reference.valid === true
            ? reference.reference.productDescription : 'Product details unavailable'}</h3>
          <p className="logging-recent__provenance">{nutritionProvenance.kind === 'user-provided'
            ? 'User-provided — not independently verified.' : 'Reviewed reference.'}</p>
          <p className="logging-recent__version">Nutrition version {entry.nutrition.referenceVersion}</p>
        </div>

        <div className="logging-recent__consumption">
          <p>Consumed {timestamp !== null && consumed !== null
            ? <time dateTime={timestamp}>{consumed.label}</time> : 'time unavailable'}</p>
          {consumed?.offset && <p className="logging-recent__offset">UTC offset: {consumed.offset}</p>}
          {timestamp !== null && consumed === null && (
            <p className="logging-recent__offset">UTC: <time dateTime={timestamp}>{timestamp}</time></p>
          )}
        </div>

        <dl className="logging-recent__metrics">
          <div><dt>Quantity</dt><dd>{totals.valid === true ? number.format(entry.quantity) : 'Unavailable'}</dd></div>
          <div><dt>Serving size</dt><dd>{totals.valid === true ? `${number.format(entry.servingMl)} ml` : 'Unavailable'}</dd></div>
          <div><dt>Total volume</dt><dd>{totals.valid === true ? `${number.format(totals.totals.volumeMl)} ml` : 'Unavailable'}</dd></div>
          <div><dt>Total price</dt><dd>{money.valid === true ? money.formatted ?? `Unknown (${entry.currency})` : 'Unavailable'}</dd></div>
        </dl>

        {reference.valid === true && (
          <details className="logging-recent__source">
            <summary>Source details</summary>
            <p>Reference {entry.nutrition.referenceId} · Version {entry.nutrition.referenceVersion}</p>
            <p>{reference.reference.source.url === undefined ? reference.reference.source.label
              : <a href={reference.reference.source.url} target="_blank" rel="noopener noreferrer">{reference.reference.source.label}</a>}</p>
          </details>
        )}
      </article>
    </li>
  )
}

/** A view of accepted session records, with no separate history state or announcements. */
function RecentSessionEntries({ entries, timeZone }: RecentSessionEntriesProps) {
  const headingId = useId()
  // Session transitions append accepted entries. Consumption dates do not determine save order.
  const recentEntries = entries.slice(-5).reverse()

  return (
    <section className="logging-recent" aria-labelledby={headingId}>
      <header className="logging-recent__heading">
        <div>
          <p className="logging-eyebrow">Already recorded</p>
          <h2 id={headingId}>Recent session entries</h2>
          <p className="logging-recent__help">Up to five most recently saved entries, newest first.</p>
        </div>
        <p className="logging-recent__zone">Reporting timezone: {timeZone}</p>
      </header>

      {recentEntries.length === 0 ? (
        <p className="logging-recent__empty">No drinks saved this session yet.</p>
      ) : (
        <ol className="logging-recent__list">
          {recentEntries.map(record => <RecentEntry key={record.entry.id} record={record} timeZone={timeZone} />)}
        </ol>
      )}

      <p className="logging-recent__temporary">Refreshing or closing the app clears session entries and preferences.</p>
    </section>
  )
}

export default RecentSessionEntries
