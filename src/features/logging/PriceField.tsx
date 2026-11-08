import { getCurrencyFractionDigits } from '../../domain/money'
import type { CurrencyCode } from '../../domain/types'

type PriceFieldProps = {
  mode: 'known' | 'unknown'
  amountText: string
  currency: CurrencyCode
  onModeChange: (mode: 'known' | 'unknown') => void
  onAmountChange: (value: string) => void
  error?: string
}

function PriceField({ mode, amountText, currency, onModeChange, onAmountChange, error }: PriceFieldProps) {
  const precision = getCurrencyFractionDigits(currency)
  const describedBy = [
    'logging-price-help', 'logging-price-precision', error ? 'logging-price-error' : '',
  ].filter(Boolean).join(' ')

  return (
    <fieldset className="logging-fieldset logging-price-field" aria-invalid={Boolean(error)} aria-describedby={describedBy}>
      <legend className="logging-legend">Total price</legend>
      <div className="logging-choice-row">
        <label className="logging-choice">
          <input type="radio" name="price-mode" value="known" checked={mode === 'known'} onChange={() => onModeChange('known')} />
          <span>Price known</span>
        </label>
        <label className="logging-choice">
          <input type="radio" name="price-mode" value="unknown" checked={mode === 'unknown'} onChange={() => onModeChange('unknown')} />
          <span>Price unknown</span>
        </label>
      </div>
      <label className="logging-label" htmlFor="logging-price">Total paid for all drinks</label>
      <div className="logging-price-input-wrap">
        <span className="logging-currency" aria-hidden="true">{currency}</span>
        <input
          className="logging-input logging-price-input"
          id="logging-price"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amountText}
          disabled={mode === 'unknown'}
          onChange={event => onAmountChange(event.currentTarget.value)}
          aria-label={`Total paid for all drinks (${currency})`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          placeholder="Enter total"
        />
      </div>
      <p className="logging-help" id="logging-price-help">Zero means free. This total covers all selected drinks.</p>
      <p className="logging-help" id="logging-price-precision">
        {mode === 'unknown' ? 'The price will remain explicitly unknown.'
          : precision.valid === true
            ? `${currency} allows ${precision.fractionDigits} decimal places.`
            : 'Choose a supported currency.'}
      </p>
      {error && <p className="logging-error" id="logging-price-error">{error}</p>}
    </fieldset>
  )
}

export default PriceField
