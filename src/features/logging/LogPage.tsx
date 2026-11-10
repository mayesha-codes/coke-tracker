import { TZDateMini } from '@date-fns/tz'
import { useState } from 'react'
import type { PersonalNutritionSetup } from '../../app/session/sessionState'
import Icon from '../../components/ui/Icon'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type { CurrencyCode, NutritionCatalogReference, UtcTimestamp } from '../../domain/types'
import { normalizeUtcTimestamp } from '../../domain/validation'
import DrinkEntryForm from './DrinkEntryForm'
import './logging.css'

const reviewedReferences: readonly NutritionCatalogReference[] = Object.freeze([])

type LogPageProps = {
  references?: readonly NutritionCatalogReference[]
  personalNutrition?: PersonalNutritionSetup | null
  currency?: CurrencyCode
  timeZone?: string
  /** Injectable UI initialization values keep component tests independent of the clock. */
  initialReferenceUtc?: UtcTimestamp
  draftId?: string
  /** A retained, hidden Log view must not duplicate the active page's heading ID. */
  headingId?: string
  draftWasReset?: boolean
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
  personalNutrition = null,
  currency = DEFAULT_TRACKING_SETTINGS.currency,
  timeZone = DEFAULT_TRACKING_SETTINGS.reportingTimeZone,
  initialReferenceUtc,
  draftId,
  headingId = 'view-heading',
  draftWasReset = false,
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
          <h1 id={headingId}>Log a drink<span aria-hidden="true">.</span></h1>
          <p className="logging-page__introduction">
            Start with a serving, a moment, and a little awareness.
          </p>
        </div>
        <span className="logging-mode"><Icon name="sparkles" size={15} /> Preview mode</span>
      </header>

      <div className="logging-notice">
        <span className="logging-notice__icon" aria-hidden="true"><Icon name="sparkles" size={20} /></span>
        <p><strong>Your draft stays with you between pages.</strong> Changing currency or reporting timezone starts a new draft.
          Refreshing clears your draft and preferences. Drink saving is not available yet.</p>
      </div>

      {draftWasReset && (
        <div className="logging-notice" role="status">
          <p><strong>Your previous draft was cleared after a currency or timezone change.</strong> Check the new
            date and time, and enter the total price again before reviewing.</p>
        </div>
      )}

      <section className="logging-card" aria-label="Drink entry form">
        <DrinkEntryForm
          references={references}
          personalNutrition={personalNutrition}
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
