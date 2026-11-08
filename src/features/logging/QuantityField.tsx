import { positiveIntegerFromText } from './drinkDraft'

type QuantityFieldProps = {
  value: string
  onChange: (value: string) => void
  error?: string
}

function QuantityField({ value, onChange, error }: QuantityFieldProps) {
  const quantity = positiveIntegerFromText(value)
  const canDecrease = quantity !== null && quantity > 1
  const canIncrease = quantity !== null && quantity < Number.MAX_SAFE_INTEGER
  const describedBy = ['logging-quantity-help', error ? 'logging-quantity-error' : ''].filter(Boolean).join(' ')

  return (
    <div className="logging-field">
      <label className="logging-label" htmlFor="logging-quantity">Quantity</label>
      <div className="logging-quantity-stepper">
        <button
          className="logging-step-button"
          type="button"
          aria-label="Decrease quantity"
          disabled={!canDecrease}
          onClick={() => {
            if (canDecrease && quantity !== null) onChange(String(quantity - 1))
          }}
        >
          <span aria-hidden="true">−</span>
        </button>
        <input
          className="logging-input logging-quantity-input"
          id="logging-quantity"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={event => onChange(event.currentTarget.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
        <button
          className="logging-step-button"
          type="button"
          aria-label="Increase quantity"
          disabled={!canIncrease}
          onClick={() => {
            if (canIncrease && quantity !== null) onChange(String(quantity + 1))
          }}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <p className="logging-help" id="logging-quantity-help">Use a whole number of drinks, starting at one.</p>
      {error && <p className="logging-error" id="logging-quantity-error">{error}</p>}
    </div>
  )
}

export default QuantityField
