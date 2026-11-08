import type { LocalTimeCandidate, LocalTimeChoice } from './localDateTime'

type ConsumptionTimeFieldProps = {
  value: string
  timeZone: string
  onChange: (value: string) => void
  choice?: LocalTimeChoice
  onChoiceChange: (choice: LocalTimeChoice) => void
  candidates?: readonly LocalTimeCandidate[]
  error?: string
}

function candidateLabel(candidate: LocalTimeCandidate, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
    }).format(new Date(candidate.consumedAt))
  } catch {
    // The normalized UTC value remains useful if this browser cannot format an offset.
    return candidate.consumedAt
  }
}

function ConsumptionTimeField({ value, timeZone, onChange, choice, onChoiceChange, candidates, error }: ConsumptionTimeFieldProps) {
  const describedBy = ['logging-time-zone', error ? 'logging-time-error' : ''].filter(Boolean).join(' ')

  return (
    <div className="logging-field logging-time-field">
      <label className="logging-label" htmlFor="logging-time">Consumption date and time</label>
      <input
        className="logging-input"
        id="logging-time"
        type="datetime-local"
        step="0.001"
        value={value}
        onChange={event => onChange(event.currentTarget.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
      <p className="logging-help" id="logging-time-zone">Timezone: <strong>{timeZone}</strong></p>
      {candidates && candidates.length > 0 && (
        <fieldset className="logging-fieldset logging-time-choices" aria-describedby={error ? 'logging-time-error' : undefined}>
          <legend className="logging-legend">Choose which occurrence</legend>
          <p className="logging-help">This clock time occurs twice because the timezone changed.</p>
          <div className="logging-choice-row">
            {candidates.map(candidate => (
              <label className="logging-choice logging-time-choice" key={candidate.choice}>
                <input
                  type="radio"
                  name="logging-time-choice"
                  value={candidate.choice}
                  checked={choice === candidate.choice}
                  onChange={() => onChoiceChange(candidate.choice)}
                  aria-describedby={error ? 'logging-time-error' : undefined}
                />
                <span>
                  <strong>{candidate.choice === 'earlier' ? 'Earlier occurrence' : 'Later occurrence'}</strong>
                  <span>{candidateLabel(candidate, timeZone)}</span>
                  <time dateTime={candidate.consumedAt}>{candidate.consumedAt}</time>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && <p className="logging-error" id="logging-time-error">{error}</p>}
    </div>
  )
}

export default ConsumptionTimeField
