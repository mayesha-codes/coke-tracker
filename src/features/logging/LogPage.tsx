import { TZDateMini } from '@date-fns/tz'
import { useEffect, useRef, useState } from 'react'
import type { EntrySaveReceipt, EntrySaveRequest } from '../../app/session/sessionContext'
import type { PersonalNutritionSetup, SessionEntryRecord } from '../../app/session/sessionState'
import Icon from '../../components/ui/Icon'
import { DEFAULT_TRACKING_SETTINGS } from '../../domain/types'
import type { CurrencyCode, NutritionCatalogReference, UtcTimestamp } from '../../domain/types'
import { isIdentifier, normalizeUtcTimestamp } from '../../domain/validation'
import DrinkEntryForm from './DrinkEntryForm'
import SavedEntryConfirmation from './SavedEntryConfirmation'
import RecentSessionEntries from './RecentSessionEntries'
import { REVIEWED_REFERENCES } from '../nutrition/reviewedProducts'
import './logging.css'

const EMPTY_SESSION_ENTRIES: readonly SessionEntryRecord[] = Object.freeze([])

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
  addEntry?: (request: EntrySaveRequest) => void
  lastEntryResult?: EntrySaveReceipt | null
  isActive?: boolean
  entries?: readonly SessionEntryRecord[]
}

type SaveState =
  | { readonly status: 'editing' }
  | { readonly status: 'submitting' }
  | { readonly status: 'failed'; readonly messages: readonly string[] }
  | { readonly status: 'saved'; readonly record: SessionEntryRecord }

type PendingSave = {
  readonly requestId: string
  readonly entryId: string
  readonly previousReceipt: EntrySaveReceipt | null
}

/** Secure IDs belong to this UI boundary, never to domain calculations or reducers. */
function newIdentifier(): string | null {
  try {
    const id = globalThis.crypto.randomUUID()
    return isIdentifier(id) ? id : null
  } catch {
    return null
  }
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

/** Production choices come only from the explicitly reviewed, versioned registry. */
function LogPage({
  references = REVIEWED_REFERENCES,
  personalNutrition = null,
  currency = DEFAULT_TRACKING_SETTINGS.currency,
  timeZone = DEFAULT_TRACKING_SETTINGS.reportingTimeZone,
  initialReferenceUtc,
  draftId,
  headingId = 'view-heading',
  draftWasReset = false,
  addEntry,
  lastEntryResult = null,
  isActive = true,
  entries = EMPTY_SESSION_ENTRIES,
}: LogPageProps) {
  // Clock and identifier generation are confined to the UI boundary, once per mounted draft.
  const [draft, setDraft] = useState(() => ({
    generation: 0,
    identifier: draftId === undefined ? newIdentifier() : draftId,
    initialTime: localInputValue(initialReferenceUtc === undefined ? new Date().toISOString() : initialReferenceUtc, timeZone),
  }))
  const [saving, setSaving] = useState<SaveState>({ status: 'editing' })
  const [restartError, setRestartError] = useState<string>()
  const pageRef = useRef<HTMLDivElement>(null)
  const pending = useRef<PendingSave | null>(null)
  const submissionLocked = useRef(false)
  const focusTarget = useRef<string | null>(null)

  useEffect(() => {
    const request = pending.current
    if (request === null || lastEntryResult === null || lastEntryResult === request.previousReceipt
        || lastEntryResult.requestId !== request.requestId) return
    const result = lastEntryResult.result
    if (result.outcome === 'accepted') {
      const record = result.state.entries.find(saved => saved.entry.id === request.entryId)
      // Even a matching request must contain its accepted record, not some other entry.
      if (record === undefined) return
      pending.current = null
      setSaving({ status: 'saved', record })
      focusTarget.current = '#logging-saved-heading'
    } else {
      pending.current = null
      submissionLocked.current = false
      setSaving({ status: 'failed', messages: result.issues.map(issue => issue.message) })
      focusTarget.current = '#logging-save-error'
    }
  }, [lastEntryResult])

  useEffect(() => {
    if (focusTarget.current === null) return
    if (!isActive || pageRef.current?.closest('[hidden], [inert]')) {
      focusTarget.current = null
      return
    }
    const target = pageRef.current?.querySelector<HTMLElement>(focusTarget.current)
    if (target === undefined || target === null) return
    focusTarget.current = null
    target.focus()
  })

  function saveEntry(record: SessionEntryRecord) {
    if (submissionLocked.current || saving.status === 'saved' || addEntry === undefined) return
    // The ref closes the gap before React can render disabled controls.
    submissionLocked.current = true
    const requestId = newIdentifier()
    if (requestId === null) {
      submissionLocked.current = false
      setSaving({ status: 'failed', messages: ['A secure save request ID could not be created. Your draft is unchanged. Try Save entry again.'] })
      focusTarget.current = '#logging-save-error'
      return
    }
    pending.current = { requestId, entryId: record.entry.id, previousReceipt: lastEntryResult }
    setSaving({ status: 'submitting' })
    addEntry({ requestId, record })
  }

  function retryIdentifier() {
    const identifier = newIdentifier()
    if (identifier === null) return
    // Changing only the ID preserves all existing local form text and selection.
    setDraft(current => ({ ...current, identifier }))
    focusTarget.current = '[name="serving-size"]:checked'
  }

  function logAnother() {
    const identifier = newIdentifier()
    if (identifier === null) {
      setRestartError('A secure entry ID could not be created. Your saved entry is unchanged. Try Log another drink again.')
      focusTarget.current = '#logging-restart-error'
      return
    }
    pending.current = null
    submissionLocked.current = false
    setRestartError(undefined)
    setSaving({ status: 'editing' })
    setDraft(current => ({ generation: current.generation + 1, identifier, initialTime: localInputValue(new Date().toISOString(), timeZone) }))
    focusTarget.current = '[name="serving-size"]:checked'
  }

  return (
    <div className="logging-page" ref={pageRef}>
      <header className="logging-page__heading">
        <div>
          <p className="logging-eyebrow">One small shift at a time</p>
          <h1 id={headingId}>Log a drink<span aria-hidden="true">.</span></h1>
          <p className="logging-page__introduction">
            Start with a serving, a moment, and a little awareness.
          </p>
        </div>
        <span className="logging-mode"><Icon name="sparkles" size={15} /> Session logging</span>
      </header>

      <div className="logging-notice">
        <span className="logging-notice__icon" aria-hidden="true"><Icon name="sparkles" size={20} /></span>
        <p><strong>Your draft stays with you between pages.</strong> Changing currency or reporting timezone starts a new draft.
          Refreshing or closing the app clears entries and preferences. Nothing is stored permanently.</p>
      </div>

      {draftWasReset && (
        <div className="logging-notice" role="status">
          <p><strong>Your previous draft was cleared after a currency or timezone change.</strong> Check the new
            date and time, and enter the total price again before reviewing.</p>
        </div>
      )}

      {saving.status === 'saved' ? (
        <SavedEntryConfirmation record={saving.record} timeZone={timeZone} onLogAnother={logAnother} restartError={restartError} />
      ) : <section className="logging-card" aria-label="Drink entry form">
        {draft.identifier === null && (
          <div className="logging-save-error" role="alert">
            <p>A secure entry ID could not be created. You can keep editing; retry ID setup before saving.</p>
            <button className="logging-button" type="button" onClick={retryIdentifier}>Retry ID setup</button>
          </div>
        )}
        {saving.status === 'failed' && (
          <div className="logging-save-error" id="logging-save-error" tabIndex={-1} role="alert">
            <h2>Entry was not saved</h2>
            <ul>{saving.messages.map((message, index) => <li key={index}>{message}</li>)}</ul>
            <p>Your draft is unchanged. Correct any details needed, then try Save entry again.</p>
          </div>
        )}
        <p className="logging-save-status" role="status" aria-label="Entry saving status">
          {saving.status === 'submitting' ? 'Waiting for the session to accept this entry.' : ''}
        </p>
        <DrinkEntryForm
          key={draft.generation}
          references={references}
          personalNutrition={personalNutrition}
          currency={currency}
          timeZone={timeZone}
          initialLocalDateTime={draft.initialTime}
          draftId={draft.identifier ?? ''}
          onSave={addEntry === undefined ? undefined : saveEntry}
          submitting={saving.status === 'submitting'}
          isActive={isActive}
          onDraftChange={() => { if (saving.status === 'failed') setSaving({ status: 'editing' }) }}
        />
      </section>}
      <RecentSessionEntries entries={entries} timeZone={timeZone} />
    </div>
  )
}

export default LogPage
