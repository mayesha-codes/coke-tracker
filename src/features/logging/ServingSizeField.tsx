import { SERVING_PRESETS } from '../../domain/servings'
import type { ServingPresetId } from '../../domain/types'

/** Custom is a form choice; the domain receives only its actual millilitre value. */
export type ServingSizeSelection = ServingPresetId | 'custom'

type ServingSizeFieldProps = {
  selection: ServingSizeSelection
  customMlText: string
  onSelectionChange: (selection: ServingSizeSelection) => void
  onCustomMlChange: (text: string) => void
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

function CustomServingIllustration() {
  return (
    <svg className="logging-serving-card__art" width="42" height="60" viewBox="0 0 42 60" aria-hidden="true" focusable="false">
      <path d="M9 10h24l-3 39a6 6 0 0 1-6 6h-6a6 6 0 0 1-6-6Z" fill="currentColor" opacity=".2" />
      <path d="M8 10h26M10 10l3 39a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5l3-39" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M13 34h16v14a5 5 0 0 1-5 5h-6a5 5 0 0 1-5-5Z" fill="currentColor" opacity=".65" />
      <path d="M13 20h7M14 27h5M15 35h5M16 43h4" fill="none" stroke="var(--color-text)" strokeWidth="1.5" strokeLinecap="round" opacity=".6" />
    </svg>
  )
}

function ServingSizeField({ selection, customMlText, onSelectionChange, onCustomMlChange, error }: ServingSizeFieldProps) {
  const customDescription = ['logging-custom-serving-help', error ? 'logging-serving-error' : ''].filter(Boolean).join(' ')

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
              checked={selection === preset.id}
              onChange={() => onSelectionChange(preset.id)}
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
        <label className="logging-serving-card">
          <input
            id="logging-serving-custom"
            type="radio"
            name="serving-size"
            value="custom"
            checked={selection === 'custom'}
            onChange={() => onSelectionChange('custom')}
            aria-label="Custom"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'logging-serving-error' : undefined}
          />
          <span className="logging-serving-card__body">
            <CustomServingIllustration />
            <strong>Custom</strong>
            <span>Your size</span>
          </span>
        </label>
      </div>
      {selection === 'custom' && (
        <div className="logging-custom-serving">
          <label className="logging-label" htmlFor="logging-custom-serving">Custom serving size (ml)</label>
          <input
            className="logging-input"
            id="logging-custom-serving"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={customMlText}
            onChange={event => onCustomMlChange(event.currentTarget.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={customDescription}
          />
          <p className="logging-help" id="logging-custom-serving-help">Enter whole millilitres per drink, for example 375.</p>
        </div>
      )}
      {error && <p className="logging-error" id="logging-serving-error">{error}</p>}
    </fieldset>
  )
}

export default ServingSizeField
