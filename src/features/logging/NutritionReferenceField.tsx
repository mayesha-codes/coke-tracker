import type { NutritionCatalogReference } from '../../domain/types'

type NutritionReferenceFieldProps = {
  references: readonly NutritionCatalogReference[]
  value: string
  onChange: (value: string) => void
  error?: string
}

/** References supplied here have already passed catalog validation in the form. */
function NutritionReferenceField({ references, value, onChange, error }: NutritionReferenceFieldProps) {
  const selected = references.find(reference => reference.id === value)
  const empty = references.length === 0
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
        <option value="">{empty ? 'No reviewed product data yet' : 'Choose a reviewed product'}</option>
        {references.map(reference => (
          <option value={reference.id} key={`${reference.id}:${reference.version}`}>{reference.productDescription}</option>
        ))}
      </select>
      {empty ? (
        <div className="logging-reference-setup" id="logging-reference-setup" tabIndex={-1}>
          <strong>Reviewed product data is needed</strong>
          <p>Add a reference checked against the product label or regional manufacturer data to see sugar and calorie estimates.</p>
          <p>You can still explore serving size, quantity, price, and time.</p>
        </div>
      ) : (
        <p className="logging-help" id="logging-reference-help">Choose the product and market that match your drink.</p>
      )}
      {selected && (
        <div className="logging-reference-details">
          <p className="logging-reference-description">{selected.productDescription}</p>
          <p className="logging-help">Reference {selected.id} · Version {selected.version}</p>
          <dl className="logging-reference-rates">
            <div><dt>Sugar per 100 ml</dt><dd>{selected.sugarGramsPer100Ml} g</dd></div>
            <div><dt>Calories per 100 ml</dt><dd>{selected.kcalPer100Ml} kcal</dd></div>
          </dl>
          <p className="logging-help">
            Source: {selected.source.url
              ? <a href={selected.source.url} target="_blank" rel="noopener noreferrer">{selected.source.label}</a>
              : selected.source.label}
          </p>
        </div>
      )}
      {error && <p className="logging-error" id="logging-reference-error">{error}</p>}
    </div>
  )
}

export default NutritionReferenceField
