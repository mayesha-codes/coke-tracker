import { useId } from 'react'
import type { SessionEntryRecord } from '../../app/session/sessionState'
import { calculateDailySummary } from '../../domain/reporting'
import type { DailySummaryResult } from '../../domain/reporting'
import type { TrackingSettings } from '../../domain/types'
import { ENGLISH_DISPLAY_LOCALE } from '../preferences/preferences'
import './DashboardPage.css'

interface DashboardPageProps {
  entries: readonly SessionEntryRecord[]
  timeZone: string
  dailyLimitMl: TrackingSettings['dailyLimitMl']
}

const numberFormat = new Intl.NumberFormat(ENGLISH_DISPLAY_LOCALE, { maximumFractionDigits: 2 })

function formatNumber(value: number): string {
  return numberFormat.format(value)
}

function formatToday(referenceUtc: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(ENGLISH_DISPLAY_LOCALE, {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date(referenceUtc))
  } catch {
    return 'Today'
  }
}

function goalMessage(result: Extract<DailySummaryResult, { valid: true }>): string {
  const { goal } = result
  if (goal.state === 'disabled') return 'Daily volume goal is disabled.'
  if (goal.limitMl === 0) {
    return goal.state === 'reached'
      ? 'Your zero-volume limit is reached.'
      : `${formatNumber(goal.excessMl)} ml over your zero-volume limit.`
  }
  if (goal.state === 'within') return `${formatNumber(goal.remainingMl)} ml remaining of ${formatNumber(goal.limitMl)} ml.`
  if (goal.state === 'reached') return `Daily volume limit reached at ${formatNumber(goal.limitMl)} ml.`
  return `${formatNumber(goal.excessMl)} ml over your ${formatNumber(goal.limitMl)} ml limit.`
}

function DailyGoal({ result }: { result: Extract<DailySummaryResult, { valid: true }> }) {
  const { goal } = result
  const goalId = useId()
  const activeLimit = goal.state !== 'disabled' ? goal.limitMl : null
  const canShowProgress = activeLimit !== null && activeLimit > 0
  const progressValue = canShowProgress ? Math.min(goal.consumedMl, activeLimit) : 0

  return (
    <section className="dashboard-goal" aria-labelledby={goalId}>
      <div className="dashboard-goal__heading">
        <div>
          <p className="dashboard-eyebrow">A guide for today</p>
          <h2 id={goalId}>Daily volume goal</h2>
        </div>
        <span className={`dashboard-goal__state dashboard-goal__state--${goal.state}`}>
          {goal.state === 'disabled' ? 'Not set' : goal.state === 'within' ? 'On track' : goal.state === 'reached' ? 'Reached' : 'Over limit'}
        </span>
      </div>

      <div className="dashboard-goal__body">
        <p className="dashboard-goal__consumed">
          <strong>{formatNumber(goal.consumedMl)} ml</strong>
          <span>consumed today</span>
        </p>
        {goal.state === 'disabled' ? (
          <p className="dashboard-goal__message">Set a daily volume limit in Settings to track progress here.</p>
        ) : (
          <>
            {canShowProgress ? (
              <progress
                className="dashboard-goal__progress"
                aria-label={`Daily volume goal progress: ${formatNumber(goal.consumedMl)} of ${formatNumber(activeLimit)} ml`}
                max={activeLimit}
                value={progressValue}
              />
            ) : (
              <span className="dashboard-goal__zero-marker" aria-hidden="true" />
            )}
            <p className="dashboard-goal__message">{goalMessage(result)}</p>
            {activeLimit === 0 && <p className="dashboard-goal__limit">Daily limit: 0 ml</p>}
          </>
        )}
      </div>
      <p className="dashboard-goal__note">This goal tracks drink volume only. Coke-only calories are shown separately.</p>
    </section>
  )
}

function DashboardPage({ entries, timeZone, dailyLimitMl }: DashboardPageProps) {
  const summaryId = useId()
  // The caller supplies the clock reference to the pure reporting API. A fresh
  // value on render means returning to Home and session updates recalculate today.
  const referenceUtc = new Date().toISOString()
  const drinkEntries = entries.map(record => record.entry)
  const summary = calculateDailySummary(drinkEntries, referenceUtc, dailyLimitMl, timeZone)

  return (
    <div className="dashboard-page">
      <header className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">Your daily reset · {timeZone}</p>
          <h1 id="view-heading">Today<span aria-hidden="true">.</span></h1>
          <p>{formatToday(referenceUtc, timeZone)}</p>
        </div>
        {summary.valid && (
          <span className="dashboard-heading__entries">
            {summary.totals.entryCount} {summary.totals.entryCount === 1 ? 'entry' : 'entries'} · {summary.totals.drinkCount} {summary.totals.drinkCount === 1 ? 'drink' : 'drinks'}
          </span>
        )}
      </header>

      {summary.valid ? (
        <>
          <section className="dashboard-overview" aria-labelledby={summaryId}>
            <div className="dashboard-overview__heading">
              <div>
                <p className="dashboard-eyebrow">Consumption overview</p>
                <h2 id={summaryId}>Today's snapshot</h2>
              </div>
              <span className="dashboard-overview__date">{timeZone}</span>
            </div>
            <dl className="dashboard-overview__metrics">
              <div><dt>Drinks</dt><dd>{formatNumber(summary.totals.drinkCount)}</dd></div>
              <div><dt>Total volume</dt><dd>{formatNumber(summary.totals.volumeMl)} <small>ml</small></dd></div>
              <div><dt>Estimated sugar</dt><dd>{formatNumber(summary.totals.sugarGrams)} <small>g</small></dd></div>
              <div><dt>Coke-only calories</dt><dd>{formatNumber(summary.totals.kcal)} <small>kcal</small></dd></div>
            </dl>
            <p className="dashboard-overview__note">Sugar and calories use each drink’s saved nutrition snapshot. Calories are estimates from Coke only.</p>
          </section>

          <DailyGoal result={summary} />
        </>
      ) : (
        <section className="dashboard-error" role="alert" aria-label="Today's summary unavailable">
          <h2>Today's summary is unavailable</h2>
          <p>{summary.issues.map(issue => issue.message).join(' ')}</p>
        </section>
      )}

      <p className="dashboard-temporary">Dashboard totals use drinks saved in this session. Refreshing or closing the app clears entries and preferences.</p>
    </div>
  )
}

export default DashboardPage
