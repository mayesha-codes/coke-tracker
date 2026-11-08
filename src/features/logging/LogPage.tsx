import { TZDateMini } from '@date-fns/tz'
import { useState } from 'react'
import Icon from '../../components/ui/Icon'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type { CurrencyCode, NutritionCatalogReference, UtcTimestamp } from '../../domain/types'
import { normalizeUtcTimestamp } from '../../domain/validation'
import DrinkEntryForm from './DrinkEntryForm'
import './logging.css'

const reviewedReferences: readonly NutritionCatalogReference[] = Object.freeze([])

type LogPageProps = {
  references?: readonly NutritionCatalogReference[]
  currency?: CurrencyCode
  timeZone?: string
  /** Injectable UI initialization values keep component tests independent of the clock. */
  initialReferenceUtc?: UtcTimestamp
  draftId?: string
}

function localInputValue(reference: UtcTimestamp, timeZone: string): string {
  const normalized = normalizeUtcTimestamp(reference)
  if (normalized === null) return ''
  const zoned = new TZDateMini(Date.parse(normalized), timeZone)
  if (!Number.isFinite(zoned.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(zoned.getFullYear()).padStart(4, '0')}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}` +
    `T${pad(zoned.getHours())}:${pad(zoned.getMinutes())}`
}

/** The production catalog remains empty until actual product-label data is reviewed. */
function LogPage({
  references = reviewedReferences,
  currency = DEFAULT_TRACKING_SETTINGS.currency,
  timeZone = DEFAULT_TRACKING_SETTINGS.reportingTimeZone,
  initialReferenceUtc,
  draftId,
}: LogPageProps) {
  // Clock and identifier generation are confined to the UI boundary, once per mounted draft.
  const [initialTime] = useState(() => localInputValue(
    initialReferenceUtc === undefined ? new Date().toISOString() : initialReferenceUtc,
    timeZone,
  ))
  const [identifier] = useState(() => draftId === undefined ? crypto.randomUUID() : draftId)

  return (
    <div className="logging-page">
      <header className="logging-page__heading">
        <div>
          <p className="logging-eyebrow">One small shift at a time</p>
          <h1 id="view-heading">Log a drink<span aria-hidden="true">.</span></h1>
          <p className="logging-page__introduction">
            Start with a serving, a moment, and a little awareness.
          </p>
        </div>
        <span className="logging-mode"><Icon name="sparkles" size={15} /> Preview mode</span>
      </header>

      <div className="logging-notice">
        <span className="logging-notice__icon" aria-hidden="true"><Icon name="sparkles" size={20} /></span>
        <p><strong>Your draft, without the commitment.</strong> Explore the form and review your details.
          Nothing is recorded; saving and persistence will be added later.</p>
      </div>

      <section className="logging-card" aria-label="Drink entry form">
        <DrinkEntryForm
          references={references}
          currency={currency}
          timeZone={timeZone}
          initialLocalDateTime={initialTime}
          draftId={identifier}
        />
      </section>
    </div>
  )
}

export default LogPage
