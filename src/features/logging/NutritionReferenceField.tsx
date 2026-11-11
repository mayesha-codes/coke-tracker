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
    'logging-product-unsupported',
    error ? 'logging-reference-error' : '',
  ].filter(Boolean).join(' ')
  const groups = [
    { kind: 'reviewed', label: 'Reviewed products' },
    { kind: 'user-provided', label: 'My label values' },
  ] as const

  return (
    <div className="logging-field logging-reference-field">
      <label className="logging-label" htmlFor="logging-reference">Coke product</label>
      <select
        className="logging-input"
        id="logging-reference"
        value={value}
        disabled={empty}
        onChange={event => onChange(event.currentTarget.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      >
        <option value="">{empty ? 'No product values available' : 'Choose a Coke product'}</option>
        {groups.map(group => {
          const groupedOptions = options.filter(option => option.nutrition.kind === group.kind)
          if (groupedOptions.length === 0) return null
          return (
            <optgroup label={group.label} key={group.kind}>
              {groupedOptions.map(option => {
                const hasOtherVersion = groupedOptions.some(other =>
                  other.nutrition.reference.id === option.nutrition.reference.id
                  && other.nutrition.reference.version !== option.nutrition.reference.version,
                )
                return (
                  <option value={option.value} key={option.value}>
                    {option.nutrition.reference.productDescription}
                    {hasOtherVersion ? ` · Version ${option.nutrition.reference.version}` : ''}
                  </option>
                )
              })}
            </optgroup>
          )
        })}
      </select>
      {empty ? (
        <div className="logging-reference-setup" id="logging-reference-setup" tabIndex={-1}>
          <strong>Nutrition setup is needed</strong>
          <p>Choose a product with reviewed values or add the per-100-ml values from your bottle or can in Settings.</p>
          <p>You can still explore serving size, quantity, price, and time.</p>
        </div>
      ) : (
        <p className="logging-help" id="logging-reference-help">Choose the product and market that match your drink. Your selection stays unchanged until you choose newer values.</p>
      )}
      <p className="logging-help" id="logging-product-unsupported">Product not listed? Add your label values in Settings.</p>
      {selected && reference && (
        <>
          <div className="logging-product-selection">
            <p className="logging-reference-description">{reference.productDescription}</p>
            <p className="logging-reference-provenance">{selected.kind === 'user-provided'
              ? 'User-provided — not independently verified.' : 'Reviewed source'}</p>
          </div>
          <details className="logging-nutrition-details">
            <summary>Nutrition details</summary>
            <div className="logging-reference-details">
              <p className="logging-reference-provenance">{selected.kind === 'user-provided'
                ? 'User-provided — not independently verified.' : 'Reviewed against manufacturer or package information.'}</p>
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
          </details>
        </>
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
