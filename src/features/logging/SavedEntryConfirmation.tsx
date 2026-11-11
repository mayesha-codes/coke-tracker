import type { SessionEntryRecord } from '../../app/session/sessionState'
import Icon from '../../components/ui/Icon'
import { formatMoney } from '../../domain/money'
import { createNutritionReference } from '../../domain/nutrition'
import { calculateEntryTotals } from '../../domain/totals'
import { normalizeUtcTimestamp } from '../../domain/validation'
import { ENGLISH_DISPLAY_LOCALE } from '../preferences/preferences'

interface SavedEntryConfirmationProps {
  record: SessionEntryRecord
  timeZone: string
  onLogAnother: () => void
  restartError?: string
}

function estimate(value: number): string {
  if (value > 0 && value < 0.01) return '<0.01'
  return new Intl.NumberFormat(ENGLISH_DISPLAY_LOCALE, { maximumFractionDigits: 2 }).format(value)
}

/** Present the accepted record only; no current draft or live nutrition lookup is used. */
function SavedEntryConfirmation({ record, timeZone, onLogAnother, restartError }: SavedEntryConfirmationProps) {
  const { entry, nutritionProvenance } = record
  const totals = calculateEntryTotals(entry)
  const reference = createNutritionReference(nutritionProvenance.reference)
  const money = formatMoney({ amountMinor: entry.totalPriceMinor, currency: entry.currency }, ENGLISH_DISPLAY_LOCALE)
  const timestamp = normalizeUtcTimestamp(entry.consumedAt)
  let localTime: string | null = null
  if (timestamp !== null) {
    try {
      localTime = new Intl.DateTimeFormat(ENGLISH_DISPLAY_LOCALE, {
        timeZone, dateStyle: 'medium', timeStyle: 'short',
      }).format(new Date(timestamp))
    } catch {
      // A display preference must never replace or reinterpret the saved UTC instant.
      localTime = null
    }
  }

  return (
    <section className="logging-saved" aria-labelledby="logging-saved-heading">
      <div className="logging-saved__heading">
        <span className="logging-saved__symbol" aria-hidden="true"><Icon name="sparkles" size={25} /></span>
        <div>
          <p className="logging-eyebrow">One small shift, recorded</p>
          <h2 id="logging-saved-heading" tabIndex={-1}>Your drink is logged.</h2>
          <p className="logging-saved__status" role="status">Saved for this session only.</p>
        </div>
      </div>

      <p className="logging-saved__product">{reference.valid === true
        ? reference.reference.productDescription : 'Product details unavailable'}</p>
      <p className="logging-reference-provenance">{nutritionProvenance.kind === 'user-provided'
        ? 'User-provided — not independently verified.' : 'Reviewed reference.'}</p>

      <dl className="logging-saved__details">
        <div><dt>Quantity</dt><dd>{totals.valid === true ? entry.quantity : 'Unavailable'}</dd></div>
        <div><dt>Serving size</dt><dd>{totals.valid === true
          ? `${new Intl.NumberFormat(ENGLISH_DISPLAY_LOCALE).format(entry.servingMl)} ml` : 'Unavailable'}</dd></div>
        <div><dt>Total volume</dt><dd>{totals.valid === true
          ? `${new Intl.NumberFormat(ENGLISH_DISPLAY_LOCALE).format(totals.totals.volumeMl)} ml` : 'Unavailable'}</dd></div>
        <div><dt>Total price</dt><dd>{money.valid === true
          ? money.formatted ?? `Unknown (${entry.currency})` : 'Unavailable'}</dd></div>
        <div><dt>Estimated sugar</dt><dd>{totals.valid === true
          ? `${estimate(totals.totals.sugarGrams)} g` : 'Unavailable'}</dd></div>
        <div><dt>Coke-only calories</dt><dd>{totals.valid === true
          ? `${estimate(totals.totals.kcal)} kcal` : 'Unavailable'}</dd></div>
      </dl>

      <div className="logging-saved__time">
        <h3>Consumption time</h3>
        <p>{localTime === null ? 'Local display unavailable.' : <time dateTime={timestamp ?? undefined}>{localTime}</time>}</p>
        <p className="logging-help">Display timezone: {timeZone}</p>
        <p className="logging-help">Saved UTC timestamp: <code>{timestamp ?? 'Unavailable'}</code></p>
      </div>

      {reference.valid === true && (
        <details className="logging-nutrition-details">
          <summary>Nutrition details</summary>
          <div className="logging-reference-details">
            <p className="logging-help">Reference {entry.nutrition.referenceId} · Version {entry.nutrition.referenceVersion}</p>
            <dl className="logging-reference-rates">
              <div><dt>Sugar per 100 ml</dt><dd>{entry.nutrition.sugarGramsPer100Ml} g</dd></div>
              <div><dt>Calories per 100 ml</dt><dd>{entry.nutrition.kcalPer100Ml} kcal</dd></div>
            </dl>
            <p className="logging-help">Source: {reference.reference.source.url === undefined
              ? reference.reference.source.label
              : <a href={reference.reference.source.url} target="_blank" rel="noopener noreferrer">{reference.reference.source.label}</a>}</p>
          </div>
        </details>
      )}

      <p className="logging-saved__temporary">Refreshing or closing the app clears entries and preferences.</p>
      {restartError && <p className="logging-save-error" id="logging-restart-error" tabIndex={-1} role="alert">{restartError}</p>}
      <button className="logging-button logging-button--primary" type="button" onClick={onLogAnother}>
        Log another drink
      </button>
    </section>
  )
}

export default SavedEntryConfirmation
