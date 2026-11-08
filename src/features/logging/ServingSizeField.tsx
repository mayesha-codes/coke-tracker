import { SERVING_PRESETS } from '../../domain/servings'

type ServingSizeFieldProps = {
  value: string
  onChange: (value: string) => void
  error?: string
}

/** A small, unbranded illustration that helps distinguish the size choices visually. */
function ServingIllustration({ servingMl }: { servingMl: number }) {
  const bottle = servingMl >= 500
  const scale = servingMl === 200 ? 0.78 : servingMl === 1000 ? 1 : 0.9

  return (
    <svg className="logging-serving-card__art" width="42" height="60" viewBox="0 0 42 60" aria-hidden="true" focusable="false">
      <g transform={`translate(21 57) scale(${scale}) translate(-21 -57)`}>
        {bottle ? (
          <>
            <path d="M15 6h12v9l5 9c2 4 3 8 3 12v14a6 6 0 0 1-6 6H13a6 6 0 0 1-6-6V36c0-4 1-8 3-12l5-9Z" fill="currentColor" />
            <rect x="14" y="3" width="14" height="5" rx="2" fill="currentColor" />
            <path d="M8 33h26v12H8Z" fill="var(--color-text)" opacity=".16" />
            <path d="M15 25c-2 3-3 7-3 11v12" fill="none" stroke="var(--color-text)" strokeWidth="2" strokeLinecap="round" opacity=".35" />
          </>
        ) : (
          <>
            <rect x="8" y="9" width="26" height="47" rx="7" fill="currentColor" />
            <path d="M11 15h20M11 50h20" fill="none" stroke="var(--color-text)" strokeWidth="2" strokeLinecap="round" opacity=".5" />
            <path d="M9 28h24v11H9Z" fill="var(--color-text)" opacity=".16" />
            <path d="M13 20v24" fill="none" stroke="var(--color-text)" strokeWidth="2" strokeLinecap="round" opacity=".35" />
          </>
        )}
      </g>
    </svg>
  )
}

function ServingSizeField({ value, onChange, error }: ServingSizeFieldProps) {
  return (
    <fieldset className="logging-fieldset logging-serving-field" aria-describedby={error ? 'logging-serving-error' : undefined}>
      <legend className="logging-legend">Serving size</legend>
      <div className="logging-serving-grid">
        {SERVING_PRESETS.map(preset => (
          <label className="logging-serving-card" key={preset.id}>
            <input
              id={`logging-serving-${preset.id}`}
              type="radio"
              name="serving-size"
              value={String(preset.servingMl)}
              checked={value === String(preset.servingMl)}
              onChange={() => onChange(String(preset.servingMl))}
              aria-label={`${preset.servingMl} ml`}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'logging-serving-error' : undefined}
            />
            <span className="logging-serving-card__body">
              <ServingIllustration servingMl={preset.servingMl} />
              <strong>{preset.label}</strong>
              <span>Per drink</span>
            </span>
          </label>
        ))}
      </div>
      {error && <p className="logging-error" id="logging-serving-error">{error}</p>}
    </fieldset>
  )
}

export default ServingSizeField
