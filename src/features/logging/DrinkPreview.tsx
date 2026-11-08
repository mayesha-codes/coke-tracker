import { formatMoney } from '../../domain/money'
import type { CurrencyCode } from '../../domain/types'
import type { DrinkPreviewState, PreviewValue } from './drinkPreview.ts'

interface DrinkPreviewProps {
  preview: DrinkPreviewState
  currency: CurrencyCode
}

function UnavailableValue({ reason }: { reason: string }) {
  return (
    <>
      <span className="logging-preview__value" aria-label="Unavailable">—</span>
      <span className="logging-preview__note">{reason}</span>
    </>
  )
}

function NumberValue({ value, unit }: { value: PreviewValue<number>; unit: string }) {
  if (value.status === 'unavailable') return <UnavailableValue reason={value.reason} />

  // Rounding belongs only to this display; preview state retains the full estimate.
  const formatter = new Intl.NumberFormat('en-BD', { maximumFractionDigits: unit === 'ml' ? 0 : 2 })
  const text = value.value > 0 && value.value < 0.01 && unit !== 'ml'
    ? '<0.01'
    : formatter.format(value.value)
  return <span className="logging-preview__value">{text} <span>{unit}</span></span>
}

function DrinkPreview({ preview, currency }: DrinkPreviewProps) {
  const sugar = preview.nutrition.status === 'available'
    ? { status: 'available' as const, value: preview.nutrition.value.sugarGrams }
    : preview.nutrition
  const calories = preview.nutrition.status === 'available'
    ? { status: 'available' as const, value: preview.nutrition.value.kcal }
    : preview.nutrition
  const money = preview.spending.status === 'available'
    ? formatMoney(preview.spending.value)
    : null

  return (
    <section className="logging-preview" aria-labelledby="logging-preview-heading">
      <div className="logging-preview__heading">
        <div>
          <p className="logging-eyebrow">A little perspective</p>
          <h2 id="logging-preview-heading">Draft preview</h2>
        </div>
        <span className="logging-preview__badge">Unsaved estimate</span>
      </div>

      <dl className="logging-preview__grid">
        <div className="logging-preview__metric">
          <dt>Volume</dt>
          <dd><NumberValue value={preview.volume} unit="ml" /></dd>
        </div>
        <div className="logging-preview__metric">
          <dt>Estimated sugar</dt>
          <dd><NumberValue value={sugar} unit="g" /></dd>
        </div>
        <div className="logging-preview__metric">
          <dt>Coke-only calories</dt>
          <dd><NumberValue value={calories} unit="kcal" /></dd>
        </div>
        <div className="logging-preview__metric">
          <dt>Total spending</dt>
          <dd>
            {preview.spending.status === 'unavailable' ? (
              <UnavailableValue reason={preview.spending.reason} />
            ) : money?.valid === true ? (
              <span className="logging-preview__value">{money.formatted ?? 'Unknown'}</span>
            ) : (
              <UnavailableValue reason="The total price could not be formatted." />
            )}
          </dd>
        </div>
      </dl>

      <p className="logging-preview__footer">
        {currency} prices cover all selected drinks. These are draft estimates, not saved consumption.
      </p>
    </section>
  )
}

export default DrinkPreview
