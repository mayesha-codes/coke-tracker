import type { NutritionProvenance } from '../../app/session/sessionState'

export type NutritionReferenceOption = {
  readonly value: string
  readonly nutrition: NutritionProvenance
}

type NutritionReferenceFieldProps = {
  options: readonly NutritionReferenceOption[]
  selected: NutritionProvenance | null
  value: string
  onChange: (value: string) => void
  updateAvailable: boolean
  onUseLatest: () => void
  error?: string
}

/** The form supplies validated options and the draft's independent, immutable selection. */
function NutritionReferenceField({
  options,
  selected,
  value,
  onChange,
  updateAvailable,
  onUseLatest,
  error,
}: NutritionReferenceFieldProps) {
  const reference = selected?.reference
  const empty = options.length === 0
  const describedBy = [
    empty ? 'logging-reference-setup' : 'logging-reference-help',
    error ? 'logging-reference-error' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="logging-field logging-reference-field">
      <label className="logging-label" htmlFor="logging-reference">Nutrition reference</label>
      <select
        className="logging-input"
        id="logging-reference"
        value={value}
        disabled={empty}
        onChange={event => onChange(event.currentTarget.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      >
        <option value="">{empty ? 'No nutrition values available' : 'Choose nutrition values'}</option>
        {options.map(option => (
          <option value={option.value} key={option.value}>
            {option.nutrition.reference.productDescription} — {option.nutrition.kind === 'user-provided'
              ? 'User-provided' : 'Reviewed reference'} · Version {option.nutrition.reference.version}
          </option>
        ))}
      </select>
      {empty ? (
        <div className="logging-reference-setup" id="logging-reference-setup" tabIndex={-1}>
          <strong>Nutrition setup is needed</strong>
          <p>Enter the per-100-ml values from your bottle or can in Settings, then explicitly select them here.</p>
          <p>You can still explore serving size, quantity, price, and time.</p>
        </div>
      ) : (
        <p className="logging-help" id="logging-reference-help">Choose the values that match your drink. This draft keeps its selected version until you choose another version.</p>
      )}
      {selected && reference && (
        <div className="logging-reference-details">
          <p className="logging-reference-description">{reference.productDescription}</p>
          <p className="logging-reference-provenance">{selected.kind === 'user-provided'
            ? 'User-provided — not independently verified.' : 'Reviewed reference.'}</p>
          <p className="logging-help">Reference {reference.id} · Version {reference.version}</p>
          <dl className="logging-reference-rates">
            <div><dt>Sugar per 100 ml</dt><dd>{reference.sugarGramsPer100Ml} g</dd></div>
            <div><dt>Calories per 100 ml</dt><dd>{reference.kcalPer100Ml} kcal</dd></div>
          </dl>
          <p className="logging-help">
            Source: {reference.source.url
              ? <a href={reference.source.url} target="_blank" rel="noopener noreferrer">{reference.source.label}</a>
              : reference.source.label}
          </p>
        </div>
      )}
      <div className="logging-nutrition-updates" role="status" aria-label="Nutrition updates">
        {updateAvailable && <p>Updated nutrition is available.</p>}
      </div>
      {updateAvailable && (
        <div className="logging-nutrition-update-action">
          <p className="logging-help">Your preview still uses the selected version. Adopting the latest values clears its Review confirmation and keeps your other drink details.</p>
          <button className="logging-nutrition-adopt" type="button" onClick={onUseLatest}>Use latest values</button>
        </div>
      )}
      {error && <p className="logging-error" id="logging-reference-error">{error}</p>}
    </div>
  )
}

export default NutritionReferenceField
