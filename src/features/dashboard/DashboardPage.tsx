import { useEffect, useId, useState } from 'react'
import type { SessionEntryRecord } from '../../app/session/sessionState'
import { calculateDailySummary, calculatePeriodTotals } from '../../domain/reporting'
import type { DailySummaryResult } from '../../domain/reporting'
import { formatMoney } from '../../domain/money'
import { getCalendarDayPeriod, getCalendarWeekPeriod } from '../../domain/periods'
import type { ReportingPeriod } from '../../domain/periods'
import type { ConsumptionTotals } from '../../domain/totals'
import type { TrackingSettings } from '../../domain/types'
import RecentSessionEntries from '../logging/RecentSessionEntries'
import { ENGLISH_DISPLAY_LOCALE } from '../preferences/preferences'
import './DashboardPage.css'

interface DashboardPageProps {
  entries: readonly SessionEntryRecord[]
  timeZone: string
  dailyLimitMl: TrackingSettings['dailyLimitMl']
  onViewHistory: () => void
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

function formatPeriodDate(timestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat(ENGLISH_DISPLAY_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(new Date(timestamp))
}

function formatWeekRange(period: ReportingPeriod): string {
  const lastInstant = new Date(Date.parse(period.endUtc) - 1).toISOString()
  return `${formatPeriodDate(period.startUtc, period.timeZone)} – ${formatPeriodDate(lastInstant, period.timeZone)}`
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

function SpendingOverview({ totals }: { totals: ConsumptionTotals }) {
  const headingId = useId()

  return (
    <section className="dashboard-spending" aria-labelledby={headingId}>
      <div className="dashboard-spending__heading">
        <div>
          <p className="dashboard-eyebrow">Today, by original currency</p>
          <h2 id={headingId}>Today’s spending</h2>
        </div>
        {totals.unknownPriceEntryCount > 0 && (
          <span className="dashboard-spending__unknown-total">
            {totals.unknownPriceEntryCount} {totals.unknownPriceEntryCount === 1 ? 'entry has' : 'entries have'} an unknown price
          </span>
        )}
      </div>

      {totals.entryCount === 0 ? (
        <p className="dashboard-spending__empty">No spending entries recorded today.</p>
      ) : (
        <ul className="dashboard-spending__list">
          {totals.spendingByCurrency.map(row => {
            const formatted = formatMoney(
              { amountMinor: row.knownAmountMinor, currency: row.currency },
              ENGLISH_DISPLAY_LOCALE,
            )
            const complete = row.unknownPriceEntryCount === 0

            return (
              <li className="dashboard-spending__item" key={row.currency}>
                <div>
                  <h3>{row.currency}</h3>
                  <p>Known-price subtotal</p>
                </div>
                <strong>{formatted.valid ? formatted.formatted : 'Unavailable'}</strong>
                <span className={complete ? 'dashboard-spending__complete' : 'dashboard-spending__incomplete'}>
                  {complete ? 'Complete' : `Incomplete · ${row.unknownPriceEntryCount} unknown`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="dashboard-spending__note">
        Unknown prices are excluded, so marked subtotals are incomplete. Amounts stay in each drink’s original currency; no conversion is applied.
      </p>
    </section>
  )
}

function WeeklyContext({ entries, referenceUtc, timeZone }: {
  entries: readonly SessionEntryRecord[]
  referenceUtc: string
  timeZone: string
}) {
  const headingId = useId()
  const period = getCalendarWeekPeriod(referenceUtc, timeZone)
  const drinkEntries = entries.map(record => record.entry)
  const result = period.valid
    ? calculatePeriodTotals(drinkEntries, period.period)
    : period

  return (
    <section className="dashboard-week" aria-labelledby={headingId}>
      <div className="dashboard-week__heading">
        <div>
          <p className="dashboard-eyebrow">Weekly context</p>
          <h2 id={headingId}>This Week</h2>
        </div>
        <div className="dashboard-week__period">
          {period.valid ? (
            <>
              <p>{formatWeekRange(period.period)}</p>
              <span>Reporting timezone: {timeZone}</span>
            </>
          ) : (
            <p>Reporting timezone: {timeZone}</p>
          )}
        </div>
      </div>

      {result.valid ? (
        <>
          <dl className="dashboard-week__metrics">
            <div><dt>Drinks this week</dt><dd>{formatNumber(result.totals.drinkCount)}</dd></div>
            <div><dt>Total volume this week</dt><dd>{formatNumber(result.totals.volumeMl)} <small>ml</small></dd></div>
          </dl>
          {result.totals.entryCount === 0 && (
            <p className="dashboard-week__empty">No drinks recorded this week yet.</p>
          )}
        </>
      ) : (
        <p className="dashboard-week__error" role="alert">Weekly summary is unavailable: {result.issues.map(issue => issue.message).join(' ')}</p>
      )}
      <p className="dashboard-week__note">Monday through Sunday in your reporting timezone. This is a weekly total, not a daily trend.</p>
    </section>
  )
}

function DashboardPage({ entries, timeZone, dailyLimitMl, onViewHistory }: DashboardPageProps) {
  const [, setDayRefresh] = useState(0)
  const referenceUtc = new Date().toISOString()
  const summaryId = useId()
  const drinkEntries = entries.map(record => record.entry)
  const summary = calculateDailySummary(drinkEntries, referenceUtc, dailyLimitMl, timeZone)

  // Refresh once at the next reporting-day boundary. The domain period supplies
  // the timezone-aware instant, including DST changes; cleanup handles navigation.
  useEffect(() => {
    const day = getCalendarDayPeriod(referenceUtc, timeZone)
    if (day.valid === false) return

    const delay = Math.max(1, Date.parse(day.period.endUtc) - Date.now() + 1)
    const timeout = window.setTimeout(() => setDayRefresh(value => value + 1), delay)
    return () => window.clearTimeout(timeout)
  }, [referenceUtc, timeZone])

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
          <SpendingOverview totals={summary.totals} />
          <WeeklyContext entries={entries} referenceUtc={referenceUtc} timeZone={timeZone} />
        </>
      ) : (
        <section className="dashboard-error" role="alert" aria-label="Today's summary unavailable">
          <h2>Today's summary is unavailable</h2>
          <p>{summary.issues.map(issue => issue.message).join(' ')}</p>
        </section>
      )}

      <RecentSessionEntries
        entries={entries}
        timeZone={timeZone}
        heading="Recent activity"
        onViewHistory={onViewHistory}
        showTemporaryNotice={false}
      />

      <p className="dashboard-temporary">Dashboard totals use drinks saved in this session. Refreshing or closing the app clears entries and preferences.</p>
    </div>
  )
}

export default DashboardPage
