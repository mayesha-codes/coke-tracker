import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSession } from '../../app/session/sessionContext'
import type { SessionTransitionResult } from '../../app/session/sessionState'
import Icon from '../../components/ui/Icon'
import type { TrackingSettings } from '../../domain/types'
import { PREFERENCE_CURRENCIES, validatePreferences } from './preferences'
import type { PreferenceIssue, PreferenceIssueField } from './preferences'
import './PreferencesPage.css'

const timezoneSuggestions = [
  'Asia/Tokyo', 'Asia/Dhaka', 'UTC', 'Europe/London', 'Europe/Paris',
  'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'Pacific/Auckland',
] as const

type PendingApplication = {
  preferences: TrackingSettings
  previousResult: SessionTransitionResult | null
  resetsDraft: boolean
}

type PreferencesPageProps = {
  /** App owns this small navigation flag; the form does not own or inspect Log drafts. */
  hasLogDraft?: boolean
}

function samePreferences(first: TrackingSettings, second: TrackingSettings): boolean {
  return first.currency === second.currency && first.reportingTimeZone === second.reportingTimeZone &&
    first.dailyLimitMl === second.dailyLimitMl
}

function fieldSelector(field: PreferenceIssueField): string {
  if (field === 'currency') return '#preferences-currency'
  if (field === 'reportingTimeZone') return '#preferences-timezone'
  return '#preferences-error-summary'
}

function applicationField(field: string): PreferenceIssueField {
  if (field === 'preferences.currency') return 'currency'
  if (field === 'preferences.reportingTimeZone') return 'reportingTimeZone'
  if (field === 'preferences.dailyLimitMl') return 'dailyLimitMl'
  return 'preferences'
}

/** Settings are applied to the shared session; editable fields remain local until submit. */
function PreferencesPage({ hasLogDraft = false }: PreferencesPageProps) {
  const { state, updatePreferences, lastPreferenceResult } = useSession()
  const [currency, setCurrency] = useState(state.preferences.currency)
  const [reportingTimeZone, setReportingTimeZone] = useState(state.preferences.reportingTimeZone)
  const [touched, setTouched] = useState<Partial<Record<PreferenceIssueField, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState<PendingApplication | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const pendingFocus = useRef<PreferenceIssueField | null>(null)

  // Preserve the setting that this page does not edit, rather than resetting a future goal.
  const candidate: TrackingSettings = { currency, reportingTimeZone, dailyLimitMl: state.preferences.dailyLimitMl }
  const checked = validatePreferences(candidate)
  const applicationResult = pending !== null && lastPreferenceResult !== pending.previousResult
    ? lastPreferenceResult : null
  const applicationIssues: readonly PreferenceIssue[] = applicationResult?.outcome === 'invalid'
    ? applicationResult.issues.map(issue => ({ field: applicationField(issue.field), message: issue.message })) : []
  const issues = checked.valid === false ? checked.issues : applicationIssues
  const applied = pending !== null && applicationResult?.outcome === 'accepted' &&
    samePreferences(applicationResult.state.preferences, pending.preferences)
  const currentCurrencyOutsideMenu = !PREFERENCE_CURRENCIES.some(option => option.code === state.preferences.currency)

  // Only a submission moves focus; live validation never interrupts typing.
  useEffect(() => {
    const field = pendingFocus.current
    if (field === null) return
    pendingFocus.current = null
    formRef.current?.querySelector<HTMLElement>(fieldSelector(field))?.focus()
  })

  useEffect(() => {
    if (applicationResult?.outcome !== 'invalid') return
    const first = applicationResult.issues[0]
    formRef.current?.querySelector<HTMLElement>(fieldSelector(applicationField(first?.field ?? 'preferences')))?.focus()
  }, [applicationResult])

  function fieldError(field: PreferenceIssueField): string | undefined {
    if (!submitted && !touched[field]) return undefined
    return issues.filter(issue => issue.field === field).map(issue => issue.message).join(' ') || undefined
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setPending(null)
    if (checked.valid === false) {
      pendingFocus.current = checked.issues[0]?.field ?? 'preferences'
      return
    }
    setPending({
      preferences: checked.preferences,
      previousResult: lastPreferenceResult,
      resetsDraft: hasLogDraft && (state.preferences.currency !== currency ||
        state.preferences.reportingTimeZone !== reportingTimeZone),
    })
    updatePreferences(checked.preferences)
  }

  const currencyError = fieldError('currency')
  const timezoneError = fieldError('reportingTimeZone')

  return (
    <div className="preferences-page">
      <header className="preferences-heading">
        <div>
          <p className="preferences-eyebrow">A setup that fits your day</p>
          <h1 id="view-heading">Settings<span aria-hidden="true">.</span></h1>
          <p>Choose how your next drink draft works, wherever you are.</p>
        </div>
        <span className="preferences-session-badge"><Icon name="sparkles" size={15} /> Your session</span>
      </header>

      <div className="preferences-layout">
        <section className="preferences-card" aria-labelledby="preferences-form-heading">
          <div className="preferences-card-heading">
            <span className="preferences-card-icon"><Icon name="settings" size={23} /></span>
            <div><p className="preferences-eyebrow">Make it yours</p><h2 id="preferences-form-heading">Your preferences</h2></div>
          </div>
          <p className="preferences-introduction">JPY and Asia/Tokyo are starting suggestions. Choose the currency and timezone that fit your day.</p>

          <form ref={formRef} className="preferences-form" noValidate onSubmit={handleSubmit}>
            {submitted && issues.length > 0 && (
              <div className="preferences-error-summary" id="preferences-error-summary" tabIndex={-1}
                aria-labelledby="preferences-error-title">
                <h3 id="preferences-error-title">Check your preferences</h3>
                <ul>{issues.map(issue => <li key={issue.field}>{issue.message}</li>)}</ul>
              </div>
            )}

            <div className="preferences-field">
              <label htmlFor="preferences-currency">Currency</label>
              <select id="preferences-currency" className="preferences-input" value={currency} required
                aria-invalid={Boolean(currencyError)}
                aria-describedby={`preferences-currency-help${currencyError ? ' preferences-currency-error' : ''}`}
                onBlur={() => setTouched(previous => ({ ...previous, currency: true }))}
                onChange={event => { setCurrency(event.currentTarget.value); setPending(null) }}>
                {PREFERENCE_CURRENCIES.map(option => <option key={option.code} value={option.code}>{option.code} — {option.label}</option>)}
                {currentCurrencyOutsideMenu && <option value={state.preferences.currency}>{state.preferences.currency} — Current currency</option>}
              </select>
              <p className="preferences-help" id="preferences-currency-help">Used for new drafts. Previous entries keep their original currency; no currency conversion is performed.</p>
              {currencyError && <p className="preferences-error" id="preferences-currency-error">{currencyError}</p>}
            </div>

            <div className="preferences-field">
              <label htmlFor="preferences-timezone">Reporting timezone</label>
              <input id="preferences-timezone" className="preferences-input" type="text" value={reportingTimeZone}
                list="preferences-timezone-suggestions" required autoComplete="off" spellCheck={false}
                aria-invalid={Boolean(timezoneError)}
                aria-describedby={`preferences-timezone-help${timezoneError ? ' preferences-timezone-error' : ''}`}
                onBlur={() => setTouched(previous => ({ ...previous, reportingTimeZone: true }))}
                onChange={event => { setReportingTimeZone(event.currentTarget.value); setPending(null) }} />
              <datalist id="preferences-timezone-suggestions">
                {timezoneSuggestions.map(timeZone => <option value={timeZone} key={timeZone} />)}
              </datalist>
              <p className="preferences-help" id="preferences-timezone-help">Enter an IANA timezone such as Asia/Tokyo, Asia/Dhaka, America/New_York, or UTC. Other supported IANA zones are welcome.</p>
              {timezoneError && <p className="preferences-error" id="preferences-timezone-error">{timezoneError}</p>}
            </div>

            <div className="preferences-draft-note">
              <strong>Your unfinished Log draft stays with you between pages.</strong>
              <p>Applying a different currency or timezone resets that draft, including its price and local date/time. Existing entries stay unchanged.</p>
            </div>
            <button className="preferences-apply" type="submit">Apply preferences</button>
            <div className="preferences-confirmation" role="status">
              {applied && <><p>Preferences applied for this session.</p>{pending?.resetsDraft && <p>Your previous Log draft has been reset.</p>}</>}
            </div>
          </form>
        </section>

        <aside className="preferences-notes" aria-label="About your preferences">
          <section className="preferences-note preferences-note--temporary" aria-labelledby="preferences-temporary-title">
            <Icon name="sparkles" size={23} />
            <p className="preferences-eyebrow">A little heads-up</p>
            <h2 id="preferences-temporary-title">For this session</h2>
            <p>Preferences and entries are temporary. Refreshing or closing this page clears them.</p>
          </section>
          <section className="preferences-note" aria-labelledby="preferences-history-title">
            <Icon name="history" size={23} />
            <h2 id="preferences-history-title">Your history stays yours</h2>
            <p>Your previous drinks keep their original prices, serving sizes, times, nutrition information, and source details.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default PreferencesPage
